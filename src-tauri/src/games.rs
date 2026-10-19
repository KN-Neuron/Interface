//! Native game processes launched from KNeuron.
//!
//! The games (Unity builds of Neurosniper and Neurorun) read attention and
//! relaxation from neurostate on their own, so KNeuron only starts and stops
//! them. Only known games can be launched, and only from an executable named
//! like the game, so the webview cannot start arbitrary programs.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// A game KNeuron can install and launch.
pub struct GameSpec {
    pub id: &'static str,

    /// GitHub repository whose releases publish the game's builds.
    pub repository: &'static str,

    /// File names (without extension, lowercase) of the player executable in
    /// the game's Unity builds.
    pub executable_names: &'static [&'static str],
}

pub const GAMES: &[GameSpec] = &[
    GameSpec {
        id: "neurosniper",
        repository: "KN-Neuron/Neurosniper",
        executable_names: &["neurosniper"],
    },
    GameSpec {
        id: "neurorun",
        repository: "KN-Neuron/Neurorun",
        // The Windows build is named after the Unity project: Neuorrun.exe.
        executable_names: &["neurorun", "neuorrun"],
    },
];

/// Extension of a Unity player executable on this platform.
#[cfg(windows)]
const EXECUTABLE_EXTENSION: &str = "exe";
#[cfg(not(windows))]
const EXECUTABLE_EXTENSION: &str = "x86_64";

pub fn game_spec(game_id: &str) -> Result<&'static GameSpec, String> {
    GAMES
        .iter()
        .find(|spec| spec.id == game_id)
        .ok_or_else(|| format!("Unknown game \"{game_id}\"."))
}

/// Whether `path` is named like the game's player executable on this platform.
pub fn is_game_executable(spec: &GameSpec, path: &Path) -> bool {
    let lowercase = |part: Option<&std::ffi::OsStr>| {
        part.and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_lowercase()
    };

    spec.executable_names
        .contains(&lowercase(path.file_stem()).as_str())
        && lowercase(path.extension()) == EXECUTABLE_EXTENSION
}

/// How often the watcher checks whether a game has exited.
const WATCH_INTERVAL: Duration = Duration::from_millis(500);

/// How long a game gets to quit after being asked, before it is killed.
const QUIT_TIMEOUT: Duration = Duration::from_secs(5);

/// Event sent to the webview when a launched game exits.
pub const GAME_EXITED_EVENT: &str = "game-exited";

type ProcessTable = Arc<Mutex<HashMap<String, Child>>>;

/// Running games, by game id.
#[derive(Default)]
pub struct GameProcesses(ProcessTable);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameExited {
    game_id: String,
    code: Option<i32>,
}

/// Checks that `executable` is the given game's player executable.
fn validate_executable(game_id: &str, executable: &str) -> Result<PathBuf, String> {
    let spec = game_spec(game_id)?;
    let path = PathBuf::from(executable);

    if !path.is_absolute() {
        return Err("The game executable path must be absolute.".into());
    }

    if !is_game_executable(spec, &path) {
        let names: Vec<String> = spec
            .executable_names
            .iter()
            .map(|name| format!("{name}.{EXECUTABLE_EXTENSION}"))
            .collect();

        return Err(format!(
            "Choose the game's {} file (any capitalisation).",
            names.join(" or ")
        ));
    }

    let metadata =
        fs::metadata(&path).map_err(|_| format!("{} does not exist.", path.display()))?;

    if !metadata.is_file() {
        return Err(format!("{} is not a file.", path.display()));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(format!(
                "{} is not executable. Make it executable with: chmod +x \"{}\"",
                path.display(),
                path.display()
            ));
        }
    }

    Ok(path)
}

fn lock(table: &ProcessTable) -> Result<std::sync::MutexGuard<'_, HashMap<String, Child>>, String> {
    table
        .lock()
        .map_err(|_| "The game process table is unavailable.".to_string())
}

/// Starts a game and returns its process id.
#[tauri::command]
pub fn launch_game(
    app: AppHandle,
    processes: State<'_, GameProcesses>,
    game_id: String,
    executable: String,
) -> Result<u32, String> {
    let path = validate_executable(&game_id, &executable)?;
    let mut games = lock(&processes.0)?;

    if let Some(child) = games.get_mut(&game_id) {
        if matches!(child.try_wait(), Ok(None)) {
            return Err(format!("{game_id} is already running."));
        }
    }

    let child = Command::new(&path)
        // Unity finds its data folder next to the executable, whatever the working directory.
        .current_dir(path.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start {}: {error}", path.display()))?;

    let pid = child.id();
    games.insert(game_id.clone(), child);
    drop(games);

    watch_game(app, processes.0.clone(), game_id, pid);

    Ok(pid)
}

/// Reports the game's exit to the webview, then forgets it.
fn watch_game(app: AppHandle, table: ProcessTable, game_id: String, pid: u32) {
    thread::spawn(move || loop {
        thread::sleep(WATCH_INTERVAL);

        let code = {
            let Ok(mut games) = table.lock() else {
                return;
            };

            let Some(child) = games.get_mut(&game_id) else {
                return;
            };

            // A newer launch of the same game has its own watcher.
            if child.id() != pid {
                return;
            }

            match child.try_wait() {
                Ok(None) => continue,
                Ok(Some(status)) => {
                    games.remove(&game_id);
                    status.code()
                }
                Err(_) => {
                    games.remove(&game_id);
                    None
                }
            }
        };

        let _ = app.emit(
            GAME_EXITED_EVENT,
            GameExited {
                game_id: game_id.clone(),
                code,
            },
        );
        return;
    });
}

/// Asks the game to quit, as closing its window would, and kills it if it
/// hasn't after a few seconds. Its exit is reported by the watcher.
#[tauri::command]
pub fn stop_game(processes: State<'_, GameProcesses>, game_id: String) -> Result<(), String> {
    let pid = {
        let mut games = lock(&processes.0)?;

        let Some(child) = games.get_mut(&game_id) else {
            return Ok(());
        };

        request_quit(child);
        child.id()
    };

    let table = processes.0.clone();

    thread::spawn(move || {
        thread::sleep(QUIT_TIMEOUT);

        if let Ok(mut games) = table.lock() {
            if let Some(child) = games.get_mut(&game_id) {
                if child.id() == pid && matches!(child.try_wait(), Ok(None)) {
                    let _ = child.kill();
                }
            }
        }
    });

    Ok(())
}

#[cfg(unix)]
fn request_quit(child: &mut Child) {
    // SIGTERM lets Unity quit normally, saving PlayerPrefs such as Neurorun's
    // attention threshold.
    if let Ok(pid) = i32::try_from(child.id()) {
        // SAFETY: kill() only sends a signal to the game process we started.
        unsafe {
            libc::kill(pid, libc::SIGTERM);
        }
    }
}

#[cfg(not(unix))]
fn request_quit(child: &mut Child) {
    let _ = child.kill();
}

#[tauri::command]
pub fn is_game_running(processes: State<'_, GameProcesses>, game_id: String) -> bool {
    let Ok(mut games) = lock(&processes.0) else {
        return false;
    };

    games
        .get_mut(&game_id)
        .is_some_and(|child| matches!(child.try_wait(), Ok(None)))
}

/// Kills every game KNeuron started; called when KNeuron exits.
pub fn stop_all(processes: &GameProcesses) {
    if let Ok(mut games) = processes.0.lock() {
        for (_, mut child) in games.drain() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str, executable: bool) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kneuron-games-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, b"#!/bin/sh\n").unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = if executable { 0o755 } else { 0o644 };
            fs::set_permissions(&path, fs::Permissions::from_mode(mode)).unwrap();
        }
        #[cfg(not(unix))]
        let _ = executable;

        path
    }

    fn executable_name(stem: &str) -> String {
        format!("{stem}.{EXECUTABLE_EXTENSION}")
    }

    #[test]
    fn accepts_the_games_player_in_any_case() {
        let path = temp_file(&executable_name("NeuroSniper"), true);

        assert_eq!(
            validate_executable("neurosniper", path.to_str().unwrap()),
            Ok(path)
        );
    }

    #[test]
    fn accepts_neurorun_under_its_unity_project_name() {
        let path = temp_file(&executable_name("Neuorrun"), true);

        assert_eq!(
            validate_executable("neurorun", path.to_str().unwrap()),
            Ok(path)
        );
    }

    #[test]
    fn rejects_unknown_games() {
        let path = temp_file(&executable_name("Neurosniper"), true);

        let error = validate_executable("solitaire", path.to_str().unwrap()).unwrap_err();
        assert!(error.contains("Unknown game"), "{error}");
    }

    #[test]
    fn rejects_other_programs() {
        let path = temp_file(&executable_name("bash"), true);

        let error = validate_executable("neurorun", path.to_str().unwrap()).unwrap_err();
        assert!(error.contains("neurorun"), "{error}");
    }

    #[test]
    fn rejects_relative_and_missing_paths() {
        let relative = validate_executable("neurorun", &executable_name("NeuroRun")).unwrap_err();
        assert!(relative.contains("absolute"), "{relative}");

        let missing = std::env::temp_dir()
            .join("kneuron-games-test-missing")
            .join(executable_name("NeuroRun"));
        let error = validate_executable("neurorun", missing.to_str().unwrap()).unwrap_err();
        assert!(error.contains("does not exist"), "{error}");
    }

    #[cfg(unix)]
    #[test]
    fn asks_the_game_to_quit_with_sigterm() {
        // Exits with 3 only when it receives SIGTERM.
        let mut child = Command::new("sh")
            .args(["-c", "trap 'exit 3' TERM; while true; do sleep 0.05; done"])
            .spawn()
            .unwrap();
        thread::sleep(Duration::from_millis(200));

        request_quit(&mut child);

        for _ in 0..100 {
            if let Some(status) = child.try_wait().unwrap() {
                assert_eq!(status.code(), Some(3));
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill();
        panic!("the process did not quit on SIGTERM");
    }

    #[cfg(unix)]
    #[test]
    fn explains_how_to_fix_a_missing_executable_bit() {
        let dir = std::env::temp_dir().join(format!("kneuron-games-noexec-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(executable_name("NeuroRun"));
        fs::write(&path, b"").unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        }

        let error = validate_executable("neurorun", path.to_str().unwrap()).unwrap_err();
        assert!(error.contains("chmod +x"), "{error}");
    }
}
