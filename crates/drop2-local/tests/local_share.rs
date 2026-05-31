use std::io::Write;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use drop2_crypto::{decrypt_frame_stream, generate_share_id, ReceiverEphemeral};
use drop2_local::LocalServer;
use drop2_transfer::{inspect_path, InputKind};
use tempfile::tempdir;

#[tokio::test]
async fn local_share_downloads_and_decrypts_file() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("hello.txt");
    let expected = b"hello drop2";
    std::fs::File::create(&file)
        .unwrap()
        .write_all(expected)
        .unwrap();

    let (plaintext, _handle) = download_via_local_share(&file, expected.len() as u64).await;
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

    let (plaintext, _handle) = download_via_local_share(&file, 778).await;
    assert_eq!(plaintext, expected);
}

async fn download_via_local_share(
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

    let base = format!("http://127.0.0.1:{}", handle.urls.bind_addr.port());
    let client = reqwest::Client::new();

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
    let plaintext = decrypt_frame_stream(session.content_key.clone(), &encrypted)
        .expect("decrypt stream");
    (plaintext, handle)
}

fn decode_key(encoded: &str) -> [u8; 32] {
    let bytes = URL_SAFE_NO_PAD.decode(encoded).expect("valid key encoding");
    assert_eq!(bytes.len(), 32);
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    key
}
