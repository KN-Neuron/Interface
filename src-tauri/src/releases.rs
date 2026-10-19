//! Installing the games from their GitHub releases.
//!
//! Each game publishes its Unity builds as release assets named
//! `<Name>-linux-x86_64-<tag>.tar.gz` and `<Name>-windows-x64-<tag>.zip`.
//! KNeuron downloads the latest one for this platform, checks it against the
//! SHA-256 digest GitHub publishes, and unpacks it into its data folder:
//!
//! ```text
//! <app data>/games/<game id>/<tag>/...        the unpacked build
//! <app data>/games/<game id>/installed.json   which version is installed
//! ```
//!
//! Only the newest version is kept.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::games::{self, GameSpec};

/// Part of the asset name, and its extension, for this platform's build.
#[cfg(windows)]
const ASSET_PLATFORM: (&str, &str) = ("-windows-x64-", ".zip");
#[cfg(not(windows))]
const ASSET_PLATFORM: (&str, &str) = ("-linux-x86_64-", ".tar.gz");

/// Event sent to the webview while a game downloads and unpacks.
pub const INSTALL_PROGRESS_EVENT: &str = "game-install-progress";

const INSTALLED_FILE: &str = "installed.json";

/// How deep in an unpacked build to look for the executable.
const EXECUTABLE_SEARCH_DEPTH: usize = 3;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledGame {
    /// Release tag, e.g. "v1.1.0".
    pub version: String,
    pub executable: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestRelease {
    version: String,
    asset_name: String,
    /// Download size in bytes.
    size: u64,
    page_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
    /// "sha256:<hex>", published by GitHub for release assets.
    digest: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress<'a> {
    game_id: &'a str,
    /// "downloading" or "unpacking".
    phase: &'static str,
    downloaded: u64,
    total: u64,
}

/// Games being installed, so the same game can't be installed twice at once.
#[derive(Default)]
pub struct GameInstalls(Mutex<HashSet<String>>);

/// Removes a game from [`GameInstalls`] when its install ends, however it ends.
struct InstallGuard<'a> {
    installs: &'a GameInstalls,
    game_id: String,
}

impl<'a> InstallGuard<'a> {
    fn acquire(installs: &'a GameInstalls, game_id: &str) -> Result<Self, String> {
        let mut active = installs
            .0
            .lock()
            .map_err(|_| "The game install table is unavailable.".to_string())?;

        if !active.insert(game_id.to_string()) {
            return Err(format!("{game_id} is already being installed."));
        }

        Ok(Self {
            installs,
            game_id: game_id.to_string(),
        })
    }
}

impl Drop for InstallGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.installs.0.lock() {
            active.remove(&self.game_id);
        }
    }
}

fn game_dir(app: &AppHandle, spec: &GameSpec) -> Result<PathBuf, String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("KNeuron's data folder is unavailable: {error}"))?;

    Ok(data.join("games").join(spec.id))
}

/// The installed version, if its executable is still there.
fn read_installed(dir: &Path) -> Option<InstalledGame> {
    let text = fs::read_to_string(dir.join(INSTALLED_FILE)).ok()?;
    let installed: InstalledGame = serde_json::from_str(&text).ok()?;

    installed.executable.is_file().then_some(installed)
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("KNeuron/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Could not set up the download client: {error}"))
}

async fn fetch_latest_release(
    client: &reqwest::Client,
    spec: &GameSpec,
) -> Result<GithubRelease, String> {
    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        spec.repository
    );

    let response = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|error| format!("Could not reach GitHub: {error}"))?;

    match response.status().as_u16() {
        200 => {}
        404 => return Err(format!("{} has no published release.", spec.repository)),
        403 | 429 => {
            return Err("GitHub's rate limit was reached; try again in a while.".to_string())
        }
        status => return Err(format!("GitHub answered with HTTP {status}.")),
    }

    response
        .json::<GithubRelease>()
        .await
        .map_err(|error| format!("Unexpected answer from GitHub: {error}"))
}

/// The release asset holding this platform's build.
fn pick_asset<'a>(release: &'a GithubRelease, spec: &GameSpec) -> Result<&'a GithubAsset, String> {
    let (platform, extension) = ASSET_PLATFORM;
    // Only download from the game's own release, never from a URL elsewhere.
    let allowed_prefix = format!("https://github.com/{}/releases/download/", spec.repository);

    release
        .assets
        .iter()
        .find(|asset| {
            asset.name.contains(platform)
                && asset.name.ends_with(extension)
                && asset.browser_download_url.starts_with(&allowed_prefix)
        })
        .ok_or_else(|| {
            format!(
                "Release {} of {} has no build for this platform (*{platform}*{extension}).",
                release.tag_name, spec.repository
            )
        })
}

/// Lower-case hex of a SHA-256 hash.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Checks a download against the digest GitHub published for it.
fn verify_digest(asset: &GithubAsset, actual_sha256: &str) -> Result<(), String> {
    match asset
        .digest
        .as_deref()
        .and_then(|digest| digest.strip_prefix("sha256:"))
    {
        Some(expected) if !expected.eq_ignore_ascii_case(actual_sha256) => Err(format!(
            "{} is corrupted: its SHA-256 does not match the release.",
            asset.name
        )),
        _ => Ok(()),
    }
}

async fn download(
    client: &reqwest::Client,
    asset: &GithubAsset,
    destination: &Path,
    mut progress: impl FnMut(u64),
) -> Result<(), String> {
    let mut response = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("Downloading {} failed: {error}", asset.name))?;

    let mut file = File::create(destination)
        .map_err(|error| format!("Could not write {}: {error}", destination.display()))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Downloading {} failed: {error}", asset.name))?
    {
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|error| format!("Could not write {}: {error}", destination.display()))?;
        downloaded += chunk.len() as u64;
        progress(downloaded);
    }

    file.flush()
        .map_err(|error| format!("Could not write {}: {error}", destination.display()))?;

    if downloaded != asset.size {
        return Err(format!(
            "Downloading {} stopped early ({downloaded} of {} bytes).",
            asset.name, asset.size
        ));
    }

    verify_digest(asset, &hex(&hasher.finalize()))
}

/// Unpacks a .tar.gz or .zip build. Both refuse entries that would land
/// outside `destination`.
fn unpack(archive: &Path, destination: &Path) -> Result<(), String> {
    let file = File::open(archive)
        .map_err(|error| format!("Could not open {}: {error}", archive.display()))?;
    let name = archive.to_string_lossy();

    let result = if name.ends_with(".tar.gz") {
        tar::Archive::new(flate2::read::GzDecoder::new(BufReader::new(file)))
            .unpack(destination)
            .map_err(|error| error.to_string())
    } else if name.ends_with(".zip") {
        zip::ZipArchive::new(BufReader::new(file))
            .and_then(|mut zip| zip.extract(destination))
            .map_err(|error| error.to_string())
    } else {
        Err("unsupported archive format".to_string())
    };

    result.map_err(|error| format!("Could not unpack {}: {error}", archive.display()))
}

/// The game's executable inside an unpacked build.
fn find_executable(dir: &Path, spec: &GameSpec, depth: usize) -> Option<PathBuf> {
    let mut subdirectories = Vec::new();

    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        let file_type = entry.file_type().ok()?;

        if file_type.is_file() && games::is_game_executable(spec, &path) {
            return Some(path);
        }

        if file_type.is_dir() {
            subdirectories.push(path);
        }
    }

    if depth == 0 {
        return None;
    }

    subdirectories
        .iter()
        .find_map(|subdirectory| find_executable(subdirectory, spec, depth - 1))
}

#[cfg(unix)]
fn ensure_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)
        .map_err(|error| error.to_string())?
        .permissions();

    if permissions.mode() & 0o111 == 0 {
        permissions.set_mode(permissions.mode() | 0o755);
        fs::set_permissions(path, permissions).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// Unpacks a downloaded build as the installed version and removes older ones.
fn install_archive(
    archive: &Path,
    dir: &Path,
    version: &str,
    spec: &GameSpec,
) -> Result<InstalledGame, String> {
    if version.is_empty() || version.contains(['/', '\\']) || version.starts_with('.') {
        return Err(format!("Unexpected release tag \"{version}\"."));
    }

    let staging = dir.join(format!(".unpacking-{version}"));
    let target = dir.join(version);
    let io_error = |error: std::io::Error| error.to_string();

    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(io_error)?;
    }
    fs::create_dir_all(&staging).map_err(io_error)?;

    if let Err(error) = unpack(archive, &staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    let Some(staged_executable) = find_executable(&staging, spec, EXECUTABLE_SEARCH_DEPTH) else {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!(
            "The {version} build of {} contains no {} executable.",
            spec.repository,
            spec.executable_names.join(" or ")
        ));
    };

    let relative = staged_executable
        .strip_prefix(&staging)
        .map_err(|error| error.to_string())?
        .to_path_buf();

    if target.exists() {
        fs::remove_dir_all(&target).map_err(io_error)?;
    }
    fs::rename(&staging, &target).map_err(io_error)?;

    let installed = InstalledGame {
        version: version.to_string(),
        executable: target.join(relative),
    };

    ensure_executable(&installed.executable)?;

    let record = serde_json::to_string_pretty(&installed).map_err(|error| error.to_string())?;
    fs::write(dir.join(INSTALLED_FILE), record).map_err(io_error)?;

    // Older versions. Best effort: on Windows a folder in use can't be removed.
    for entry in fs::read_dir(dir).map_err(io_error)?.flatten() {
        let path = entry.path();

        if path.is_dir() && path != target {
            let _ = fs::remove_dir_all(&path);
        }
    }

    Ok(installed)
}

/// The installed release of a game, if any.
#[tauri::command]
pub fn installed_game(app: AppHandle, game_id: String) -> Result<Option<InstalledGame>, String> {
    let spec = games::game_spec(&game_id)?;

    Ok(read_installed(&game_dir(&app, spec)?))
}

/// The game's latest release on GitHub.
#[tauri::command]
pub async fn latest_game_release(game_id: String) -> Result<LatestRelease, String> {
    let spec = games::game_spec(&game_id)?;
    let release = fetch_latest_release(&http_client()?, spec).await?;
    let asset = pick_asset(&release, spec)?;

    Ok(LatestRelease {
        version: release.tag_name.clone(),
        asset_name: asset.name.clone(),
        size: asset.size,
        page_url: release.html_url.clone(),
    })
}

/// Makes sure the game's latest release is installed, downloading it if
/// needed, and returns it.
#[tauri::command]
pub async fn install_latest_game(
    app: AppHandle,
    installs: State<'_, GameInstalls>,
    game_id: String,
) -> Result<InstalledGame, String> {
    let spec = games::game_spec(&game_id)?;
    let _guard = InstallGuard::acquire(&installs, spec.id)?;

    let dir = game_dir(&app, spec)?;
    let client = http_client()?;
    let release = fetch_latest_release(&client, spec).await?;

    if let Some(installed) = read_installed(&dir) {
        if installed.version == release.tag_name {
            return Ok(installed);
        }
    }

    let asset = pick_asset(&release, spec)?.clone();
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;

    let archive = dir.join(format!(".download-{}", asset.name));
    let mut last_percent = None;

    let downloaded = download(&client, &asset, &archive, |downloaded| {
        let percent = downloaded * 100 / asset.size.max(1);

        if last_percent != Some(percent) {
            last_percent = Some(percent);
            let _ = app.emit(
                INSTALL_PROGRESS_EVENT,
                InstallProgress {
                    game_id: spec.id,
                    phase: "downloading",
                    downloaded,
                    total: asset.size,
                },
            );
        }
    })
    .await;

    if let Err(error) = downloaded {
        let _ = fs::remove_file(&archive);
        return Err(error);
    }

    let _ = app.emit(
        INSTALL_PROGRESS_EVENT,
        InstallProgress {
            game_id: spec.id,
            phase: "unpacking",
            downloaded: asset.size,
            total: asset.size,
        },
    );

    let version = release.tag_name.clone();
    let unpack_dir = dir.clone();
    let unpack_archive = archive.clone();

    let installed = tauri::async_runtime::spawn_blocking(move || {
        install_archive(&unpack_archive, &unpack_dir, &version, spec)
    })
    .await
    .map_err(|error| format!("Unpacking failed: {error}"))?;

    let _ = fs::remove_file(&archive);

    installed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(id: &str) -> &'static GameSpec {
        games::game_spec(id).unwrap()
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("kneuron-releases-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn asset(name: &str, url: &str) -> GithubAsset {
        GithubAsset {
            name: name.into(),
            browser_download_url: url.into(),
            size: 1,
            digest: None,
        }
    }

    fn release(assets: Vec<GithubAsset>) -> GithubRelease {
        GithubRelease {
            tag_name: "v1.1.0".into(),
            html_url: "https://github.com/KN-Neuron/Neurosniper/releases/tag/v1.1.0".into(),
            assets,
        }
    }

    const BASE: &str = "https://github.com/KN-Neuron/Neurosniper/releases/download/v1.1.0/";

    #[test]
    fn picks_this_platforms_build() {
        let release = release(vec![
            asset(
                "Neurosniper-windows-x64-v1.1.0.zip",
                &format!("{BASE}Neurosniper-windows-x64-v1.1.0.zip"),
            ),
            asset(
                "Neurosniper-linux-x86_64-v1.1.0.tar.gz",
                &format!("{BASE}Neurosniper-linux-x86_64-v1.1.0.tar.gz"),
            ),
        ]);

        let picked = pick_asset(&release, spec("neurosniper")).unwrap();

        assert!(picked.name.contains(ASSET_PLATFORM.0));
        assert!(picked.name.ends_with(ASSET_PLATFORM.1));
    }

    #[test]
    fn ignores_assets_hosted_outside_the_games_releases() {
        let name = format!("Neurosniper{}v1.1.0{}", ASSET_PLATFORM.0, ASSET_PLATFORM.1);
        let release = release(vec![asset(&name, &format!("https://example.com/{name}"))]);

        let error = pick_asset(&release, spec("neurosniper")).unwrap_err();
        assert!(error.contains("no build for this platform"), "{error}");
    }

    #[test]
    fn rejects_a_download_whose_digest_does_not_match() {
        let mut checked = asset("game.tar.gz", BASE);
        checked.digest = Some("sha256:abc123".into());

        assert!(verify_digest(&checked, "ABC123").is_ok());
        assert!(verify_digest(&checked, "ffff")
            .unwrap_err()
            .contains("corrupted"));

        checked.digest = None;
        assert!(verify_digest(&checked, "ffff").is_ok());
    }

    #[test]
    fn hashes_as_lowercase_hex() {
        assert_eq!(
            hex(&Sha256::digest(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn installs_a_tar_build_and_keeps_only_the_newest_version() {
        let dir = temp_dir("tar");
        let spec = spec("neurorun");

        let build = |version: &str| -> PathBuf {
            let archive = dir.join(format!("NeuroRun-linux-x86_64-{version}.tar.gz"));
            let encoder = flate2::write::GzEncoder::new(
                File::create(&archive).unwrap(),
                flate2::Compression::fast(),
            );
            let mut tar = tar::Builder::new(encoder);
            for (path, mode) in [
                ("NeuroRun/NeuroRun.x86_64", 0o755),
                ("NeuroRun/UnityPlayer.so", 0o644),
            ] {
                let mut header = tar::Header::new_gnu();
                header.set_size(4);
                header.set_mode(mode);
                header.set_cksum();
                tar.append_data(&mut header, path, &b"data"[..]).unwrap();
            }
            tar.into_inner().unwrap().finish().unwrap();
            archive
        };

        let first = install_archive(&build("v1.0.0"), &dir, "v1.0.0", spec).unwrap();
        assert_eq!(
            first.executable,
            dir.join("v1.0.0/NeuroRun/NeuroRun.x86_64")
        );
        assert_eq!(read_installed(&dir), Some(first));

        let second = install_archive(&build("v1.1.0"), &dir, "v1.1.0", spec).unwrap();
        assert_eq!(read_installed(&dir), Some(second.clone()));
        assert!(!dir.join("v1.0.0").exists());

        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&second.executable)
                .unwrap()
                .permissions()
                .mode();
            assert_ne!(mode & 0o111, 0);
        }
    }

    #[test]
    fn installs_a_zip_build() {
        let dir = temp_dir("zip");
        let archive = dir.join("Neurosniper.zip");
        let executable = format!(
            "NeuroSniper.{}",
            if cfg!(windows) { "exe" } else { "x86_64" }
        );

        let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file(format!("Neurosniper/{executable}"), options)
            .unwrap();
        zip.write_all(b"data").unwrap();
        zip.finish().unwrap();

        let installed = install_archive(&archive, &dir, "v1.1.0", spec("neurosniper")).unwrap();

        assert_eq!(
            installed.executable,
            dir.join("v1.1.0").join("Neurosniper").join(executable)
        );
    }

    #[test]
    fn refuses_a_build_without_the_game() {
        let dir = temp_dir("empty");
        let archive = dir.join("empty.zip");

        let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
        zip.start_file(
            "README.txt",
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored),
        )
        .unwrap();
        zip.finish().unwrap();

        let error = install_archive(&archive, &dir, "v1.0.0", spec("neurorun")).unwrap_err();

        assert!(
            error.contains("no neurorun or neuorrun executable"),
            "{error}"
        );
        assert!(!dir.join(".unpacking-v1.0.0").exists());
        assert!(read_installed(&dir).is_none());
    }

    #[test]
    fn refuses_tags_that_are_paths() {
        let dir = temp_dir("tags");
        let error =
            install_archive(&dir.join("x.zip"), &dir, "../evil", spec("neurorun")).unwrap_err();

        assert!(error.contains("Unexpected release tag"), "{error}");
    }

    /// Downloads and installs the real latest Neurorun release:
    /// `cargo test --lib -- --ignored real_release`
    #[test]
    #[ignore = "downloads about 70 MB from GitHub"]
    fn real_release_installs() {
        let dir = temp_dir("real");
        let spec = spec("neurorun");

        tauri::async_runtime::block_on(async {
            let client = http_client().unwrap();
            let release = fetch_latest_release(&client, spec).await.unwrap();
            let asset = pick_asset(&release, spec).unwrap().clone();
            let archive = dir.join(&asset.name);

            download(&client, &asset, &archive, |_| {}).await.unwrap();
            let installed = install_archive(&archive, &dir, &release.tag_name, spec).unwrap();

            println!("installed {installed:?}");
            assert!(installed.executable.is_file());
        });
    }
}
