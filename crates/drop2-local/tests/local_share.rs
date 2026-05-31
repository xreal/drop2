use std::io::Write;
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use drop2_crypto::{decrypt_frame_stream, generate_share_id, ReceiverEphemeral};
use drop2_local::LocalServer;
use drop2_transfer::{inspect_path, InputKind};
use tempfile::tempdir;
use tokio::time::sleep;

#[tokio::test]
async fn local_share_downloads_and_decrypts_file() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("hello.txt");
    let expected = b"hello drop2";
    std::fs::File::create(&file)
        .unwrap()
        .write_all(expected)
        .unwrap();

    let client = local_client();
    let (plaintext, mut handle) =
        download_via_local_share(&client, &file, expected.len() as u64).await;
    handle.stop();
    assert_eq!(plaintext, expected);
}

#[tokio::test]
async fn local_share_downloads_readme_sized_file() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("readme-sized.bin");
    let expected: Vec<u8> = (0..778).map(|i| (i % 251) as u8).collect();
    std::fs::File::create(&file)
        .unwrap()
        .write_all(&expected)
        .unwrap();

    let client = local_client();
    let (plaintext, mut handle) = download_via_local_share(&client, &file, 778).await;
    handle.stop();
    assert_eq!(plaintext, expected);
}

#[tokio::test]
async fn local_share_supports_sequential_downloads() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("twice.bin");
    let expected: Vec<u8> = (0..2048).map(|i| (i % 251) as u8).collect();
    std::fs::File::create(&file)
        .unwrap()
        .write_all(&expected)
        .unwrap();

    let input = inspect_path(&file).unwrap();
    let share_id = generate_share_id();
    let mut handle = LocalServer::start(input, share_id, None, None)
        .await
        .expect("server starts");

    assert!(handle.urls.local_url.starts_with("https://"));
    assert!(handle.urls.loopback_url.starts_with("https://127.0.0.1:"));

    let client = local_client();
    let first = download_once(&client, &handle.urls.loopback_url).await;
    let second = download_once(&client, &handle.urls.loopback_url).await;

    handle.stop();

    assert_eq!(first, expected);
    assert_eq!(second, expected);
}

#[tokio::test]
async fn local_share_info_status_reflects_activity() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("status.bin");
    let expected: Vec<u8> = (0..512_000).map(|i| (i % 251) as u8).collect();
    std::fs::File::create(&file)
        .unwrap()
        .write_all(&expected)
        .unwrap();

    let input = inspect_path(&file).unwrap();
    let share_id = generate_share_id();
    let mut handle = LocalServer::start(input, share_id, None, None)
        .await
        .expect("server starts");

    let client = local_client();
    let base = handle.urls.loopback_url.clone();

    assert_eq!(share_status(&client, &base).await, "waiting");

    let (receiver, client_public) = ReceiverEphemeral::generate();
    let join: serde_json::Value = client
        .post(format!("{base}/api/join"))
        .json(&serde_json::json!({
            "client_public_key": URL_SAFE_NO_PAD.encode(client_public),
        }))
        .send()
        .await
        .expect("join request")
        .json()
        .await
        .expect("join json");

    wait_for_status(&client, &base, "active").await;

    let stream = client
        .get(format!("{base}/api/stream"))
        .header("x-drop2-join-token", join["join_token"].as_str().unwrap())
        .send()
        .await
        .expect("stream request");

    let server_public = decode_key(join["server_public_key"].as_str().unwrap());
    let session = receiver
        .complete(&server_public)
        .expect("session keys derived");
    let encrypted = stream.bytes().await.expect("stream body").to_vec();
    let plaintext =
        decrypt_frame_stream(session.content_key.clone(), &encrypted).expect("decrypt stream");
    assert_eq!(plaintext, expected);

    wait_for_status(&client, &base, "waiting").await;
    handle.stop();
}

async fn download_via_local_share(
    client: &reqwest::Client,
    file: &std::path::Path,
    expected_size: u64,
) -> (Vec<u8>, drop2_local::LocalServerHandle) {
    let input = inspect_path(file).unwrap();
    assert_eq!(input.kind, InputKind::File);
    assert_eq!(input.size, expected_size);

    let share_id = generate_share_id();
    let handle = LocalServer::start(input, share_id, None, None)
        .await
        .expect("server starts");

    let base = handle.urls.loopback_url.clone();

    let plaintext = download_once(client, &base).await;
    (plaintext, handle)
}

async fn download_once(client: &reqwest::Client, base: &str) -> Vec<u8> {
    let (receiver, client_public) = ReceiverEphemeral::generate();
    let join: serde_json::Value = client
        .post(format!("{base}/api/join"))
        .json(&serde_json::json!({
            "client_public_key": URL_SAFE_NO_PAD.encode(client_public),
        }))
        .send()
        .await
        .expect("join request")
        .json()
        .await
        .expect("join json");

    let server_public = decode_key(join["server_public_key"].as_str().unwrap());
    let session = receiver
        .complete(&server_public)
        .expect("session keys derived");

    let encrypted = client
        .get(format!("{base}/api/stream"))
        .header("x-drop2-join-token", join["join_token"].as_str().unwrap())
        .send()
        .await
        .expect("stream request")
        .bytes()
        .await
        .expect("stream body")
        .to_vec();

    assert!(!encrypted.is_empty());
    decrypt_frame_stream(session.content_key.clone(), &encrypted).expect("decrypt stream")
}

async fn share_status(client: &reqwest::Client, base: &str) -> String {
    let info: serde_json::Value = client
        .get(format!("{base}/api/info"))
        .send()
        .await
        .expect("info request")
        .json()
        .await
        .expect("info json");
    info["status"].as_str().unwrap_or_default().to_string()
}

async fn wait_for_status(client: &reqwest::Client, base: &str, expected: &str) {
    for _ in 0..30 {
        if share_status(client, base).await == expected {
            return;
        }
        sleep(Duration::from_millis(25)).await;
    }
    panic!("status did not become {expected}");
}

fn local_client() -> reqwest::Client {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .expect("reqwest client")
}

fn decode_key(encoded: &str) -> [u8; 32] {
    let bytes = URL_SAFE_NO_PAD.decode(encoded).expect("valid key encoding");
    assert_eq!(bytes.len(), 32);
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    key
}
