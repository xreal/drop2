use std::io::Write;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use shr_crypto::{generate_share_id, ReceiverEphemeral};
use shr_local::LocalServer;
use shr_transfer::{inspect_path, InputKind};
use tempfile::tempdir;

#[tokio::test]
async fn local_share_downloads_file() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("hello.txt");
    std::fs::File::create(&file)
        .unwrap()
        .write_all(b"hello shr")
        .unwrap();

    let input = inspect_path(&file).unwrap();
    assert_eq!(input.kind, InputKind::File);

    let share_id = generate_share_id();
    let handle = LocalServer::start(input, share_id, None, None)
        .await
        .expect("server starts");

    let base = format!("http://127.0.0.1:{}", handle.urls.bind_addr.port());
    let client = reqwest::Client::new();

    let info: serde_json::Value = client
        .get(format!("{base}/api/info"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(info["name"], "hello.txt");

    let (_receiver, public) = ReceiverEphemeral::generate();
    let join: serde_json::Value = client
        .post(format!("{base}/api/join"))
        .json(&serde_json::json!({
            "client_public_key": URL_SAFE_NO_PAD.encode(public),
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let stream_res = client
        .get(format!("{base}/api/stream"))
        .header("x-shr-join-token", join["join_token"].as_str().unwrap())
        .send()
        .await
        .unwrap();
    assert!(stream_res.status().is_success());
    let body = stream_res.bytes().await.unwrap();
    assert!(!body.is_empty());
}
