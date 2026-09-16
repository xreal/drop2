use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use drop2_crypto::{generate_share_id, Pin, ReceiverEphemeral};
use drop2_local::LocalServer;
use drop2_transfer::inspect_path;

#[tokio::test]
async fn concurrent_wrong_pins_cannot_bypass_the_share_cooldown() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("file.txt");
    std::fs::write(&file, b"private").unwrap();
    let mut server = LocalServer::start(
        inspect_path(&file).unwrap(),
        generate_share_id(),
        Some(Pin::parse("4821").unwrap()),
        None,
    )
    .await
    .unwrap();
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .unwrap();
    let (_, public_key) = ReceiverEphemeral::generate();
    let url = format!("{}/api/join", server.urls.loopback_url);
    let requests = (0..16).map(|_| {
        client
            .post(&url)
            .json(&serde_json::json!({
                "pin": "0000",
                "client_public_key": URL_SAFE_NO_PAD.encode(public_key),
            }))
            .send()
    });
    for response in futures::future::join_all(requests).await {
        assert_eq!(
            response.unwrap().status(),
            reqwest::StatusCode::UNAUTHORIZED
        );
    }
    let response = client
        .post(&url)
        .json(&serde_json::json!({
            "pin": "4821",
            "client_public_key": URL_SAFE_NO_PAD.encode(public_key),
        }))
        .send()
        .await
        .unwrap();
    server.stop();
    assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
}
