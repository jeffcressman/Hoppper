use std::sync::OnceLock;

use base64::{engine::general_purpose::STANDARD as Base64Std, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_stronghold::Builder as StrongholdBuilder;

// HTTP/1.1-only reqwest client. tauri-plugin-http defaults to HTTP/2 and
// Endlesss's Cloudflare-fronted endpoints (api.endlesss.fm, data.endlesss.fm)
// return HTTP 500 on requests with reqwest's HTTP/2 fingerprint. curl and
// undici over HTTP/1.1 succeed against the same endpoint from the same host
// and IP, so the failure is in the protocol layer rather than auth or scope.
// We expose this client through the endlesss_http_fetch command and the SDK
// routes its EndlesssClient traffic through it.
fn endlesss_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .http1_only()
            .build()
            .expect("failed to build HTTP/1.1 reqwest client")
    })
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct EndlesssHttpRequest {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    /// Base64-encoded body. Empty string means no body.
    bodyBase64: String,
}

#[derive(Serialize)]
#[allow(non_snake_case)]
struct EndlesssHttpResponse {
    status: u16,
    headers: Vec<(String, String)>,
    bodyBase64: String,
}

#[tauri::command]
async fn endlesss_http_fetch(req: EndlesssHttpRequest) -> Result<EndlesssHttpResponse, String> {
    let method = reqwest::Method::from_bytes(req.method.as_bytes())
        .map_err(|e| format!("bad method: {e}"))?;
    let mut builder = endlesss_http_client().request(method, &req.url);
    for (h, v) in req.headers {
        builder = builder.header(h, v);
    }
    if !req.bodyBase64.is_empty() {
        let body = Base64Std
            .decode(&req.bodyBase64)
            .map_err(|e| format!("bad bodyBase64: {e}"))?;
        builder = builder.body(body);
    }
    let resp = builder.send().await.map_err(|e| format!("send: {e}"))?;
    let status = resp.status().as_u16();
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body_bytes = resp.bytes().await.map_err(|e| format!("read body: {e}"))?;
    Ok(EndlesssHttpResponse {
        status,
        headers,
        bodyBase64: Base64Std.encode(&body_bytes),
    })
}

fn decode_hex_key(password: &str) -> Vec<u8> {
    assert_eq!(
        password.len(),
        64,
        "vault password must be 64-char hex (32 bytes)"
    );
    let mut out = Vec::with_capacity(32);
    let bytes = password.as_bytes();
    for chunk in bytes.chunks(2) {
        let hi = hex_nibble(chunk[0]);
        let lo = hex_nibble(chunk[1]);
        out.push((hi << 4) | lo);
    }
    out
}

fn hex_nibble(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => panic!("non-hex character in vault password"),
    }
}

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
                // Hoppper's vault password is the 64-char hex of 32 random
                // bytes generated JS-side (see openTokenStore + ensureVaultKey).
                // Stronghold uses this callback's output directly as the
                // snapshot encryption key and demands exactly 32 bytes —
                // anything else trips "illegal non-contiguous size" inside
                // libsodium. Decode the hex back to the original 32 bytes.
                decode_hex_key(password)
            })
            .build(),
        )
        .invoke_handler(tauri::generate_handler![
            stem_cache_self_test,
            endlesss_http_fetch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
