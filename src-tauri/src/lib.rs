mod games;
mod releases;

use tauri::Manager;

/// Starts the native KNeuron desktop shell.
///
/// Keep this layer intentionally small. Device access, EEG processing,
/// sidecars and module infrastructure must be introduced behind explicit
/// interfaces instead of leaking into native window setup.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(games::GameProcesses::default())
        .manage(releases::GameInstalls::default())
        .invoke_handler(tauri::generate_handler![
            games::launch_game,
            games::stop_game,
            games::is_game_running,
            releases::installed_game,
            releases::latest_game_release,
            releases::install_latest_game
        ])
        .build(tauri::generate_context!())
        .expect("error while building KNeuron")
        .run(|app, event| {
            // Games started from KNeuron end with it, like its sidecars.
            if let tauri::RunEvent::Exit = event {
                games::stop_all(&app.state::<games::GameProcesses>());
            }
        });
}
