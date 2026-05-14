use tauri::Manager;
use tauri_plugin_stronghold::Builder as StrongholdBuilder;

// Dev-time sanity check that the Tauri-backed FsAdapter wiring works inside
// the sandbox. Writes one byte under appLocalDataDir and reads it back.
// Wired in only via the JS dev console (`window.__hoppperSelfTest()` in
// Phase 5's checkpoint walkthrough); it is not user-facing.
#[tauri::command]
async fn stem_cache_self_test(app: tauri::AppHandle, byte: u8) -> Result<u8, String> {
    use std::fs;
    let mut path = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("could not resolve app local data dir: {e}"))?;
    fs::create_dir_all(&path).map_err(|e| format!("mkdir failed: {e}"))?;
    path.push("self_test.bin");
    fs::write(&path, [byte]).map_err(|e| format!("write failed: {e}"))?;
    let read = fs::read(&path).map_err(|e| format!("read failed: {e}"))?;
    read.first()
        .copied()
        .ok_or_else(|| "self-test wrote 1 byte but read 0".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            StrongholdBuilder::new(|password| {
                // Hoppper's vault password is already a 64-char hex string of
                // 32 random bytes (see openTokenStore); the Stronghold plugin
                // hashes whatever we hand it, so passing the hex bytes through
                // is enough — no extra KDF is required on the Rust side.
                password.as_bytes().to_vec()
            })
            .build(),
        )
        .invoke_handler(tauri::generate_handler![stem_cache_self_test])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
