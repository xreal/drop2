use std::io::Write;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use drop2_crypto::{generate_share_id, ReceiverEphemeral};
use drop2_local::{LocalServer, LocalTransferEvent};
use drop2_transfer::inspect_path;
use tempfile::tempdir;

#[tokio::test]
async fn local_server_emits_started_and_completed_events() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("events.txt");
    std::fs::File::create(&file)
        .unwrap()
        .write_all(b"event flow")
        .unwrap();

    let input = inspect_path(&file).unwrap();
    let share_id = generate_share_id();
    let mut handle = LocalServer::start(input, share_id, None, None)
        .await
        .expect("server starts");

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .expect("client");
    let base = handle.urls.loopback_url.clone();

    let (_receiver, client_public) = ReceiverEphemeral::generate();
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

    let stream = client
        .get(format!("{base}/api/stream"))
        .header("x-drop2-join-token", join["join_token"].as_str().unwrap())
        .send()
        .await
        .expect("stream request");

    assert_eq!(
        handle.next_transfer_event().await,
        Some(LocalTransferEvent::DownloadStarted)
    );

    let _ = stream.bytes().await.expect("stream bytes");

    assert_eq!(
        handle.next_transfer_event().await,
        Some(LocalTransferEvent::DownloadCompleted)
    );

    handle.stop();
}
