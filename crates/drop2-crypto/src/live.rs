use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::{CapabilitySecret, CryptoError, EphemeralKeyPair, ShareId};

pub struct AuthenticatedLiveJoin {
    pub server_public_key: [u8; 32],
    pub server_proof: [u8; 32],
    pub content_key: Zeroizing<[u8; 32]>,
}

/// Authenticate the end of a live stream so a relay cannot truncate whole valid frames.
pub fn live_completion_proof(content_key: &[u8; 32], plaintext_bytes: u64) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(content_key).expect("HMAC accepts 32-byte keys");
    mac.update(b"drop2.v2.live.complete");
    mac.update(&plaintext_bytes.to_le_bytes());
    mac.finalize().into_bytes().into()
}

/// Verify capability possession before accepting a relay-supplied receiver key.
pub fn accept_live_receiver(
    capability: &CapabilitySecret,
    share_id: &ShareId,
    client_public: &[u8; 32],
    client_proof: &[u8; 32],
) -> Result<AuthenticatedLiveJoin, CryptoError> {
    let share_id = share_id.to_string();
    let client_mac = mac(
        capability,
        b"drop2.v2.live.client",
        &share_id,
        client_public,
    );
    client_mac
        .verify_slice(client_proof)
        .map_err(|_| CryptoError::InvalidKey)?;

    // Fresh sender keys also prevent key/nonce reuse if a valid request is replayed.
    let sender = EphemeralKeyPair::generate();
    let server_public = sender.public_key_bytes();
    let keys = sender.complete(client_public)?;
    let mut server_mac = mac(
        capability,
        b"drop2.v2.live.server",
        &share_id,
        client_public,
    );
    server_mac.update(&server_public);
    Ok(AuthenticatedLiveJoin {
        server_public_key: server_public,
        server_proof: server_mac.finalize().into_bytes().into(),
        content_key: live_content_key(
            capability,
            &share_id,
            client_public,
            &server_public,
            &keys.content_key,
        ),
    })
}

fn mac(
    capability: &CapabilitySecret,
    domain: &[u8],
    share_id: &str,
    client: &[u8; 32],
) -> Hmac<Sha256> {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(capability.as_bytes()).expect("HMAC accepts 32-byte keys");
    mac.update(domain);
    mac.update(share_id.as_bytes());
    mac.update(client);
    mac
}

fn live_content_key(
    capability: &CapabilitySecret,
    share_id: &str,
    client: &[u8; 32],
    server: &[u8; 32],
    dh_content_key: &[u8; 32],
) -> Zeroizing<[u8; 32]> {
    let info = [
        b"drop2.v2.live.content".as_slice(),
        share_id.as_bytes(),
        client,
        server,
    ]
    .concat();
    let mut key = Zeroizing::new([0; 32]);
    Hkdf::<Sha256>::new(Some(capability.as_bytes()), dh_content_key)
        .expand(&info, &mut *key)
        .expect("32 bytes is a valid HKDF length");
    key
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    fn proof(capability: &CapabilitySecret, id: &ShareId, client: &[u8; 32]) -> [u8; 32] {
        mac(capability, b"drop2.v2.live.client", &id.to_string(), client)
            .finalize()
            .into_bytes()
            .into()
    }

    #[test]
    fn authenticated_peers_derive_the_same_key_and_replays_get_fresh_keys() {
        let capability = CapabilitySecret::generate();
        let id = ShareId::parse("abc123").unwrap();
        let client = EphemeralKeyPair::generate();
        let public = client.public_key_bytes();
        let proof = proof(&capability, &id, &public);
        let join = accept_live_receiver(&capability, &id, &public, &proof).unwrap();
        let keys = client.complete(&join.server_public_key).unwrap();
        assert_eq!(
            *join.content_key,
            *live_content_key(
                &capability,
                "abc123",
                &public,
                &join.server_public_key,
                &keys.content_key
            )
        );
        let mut server_mac = mac(&capability, b"drop2.v2.live.server", "abc123", &public);
        server_mac.update(&join.server_public_key);
        assert!(server_mac.verify_slice(&join.server_proof).is_ok());
        let replay = accept_live_receiver(&capability, &id, &public, &proof).unwrap();
        assert_ne!(*join.content_key, *replay.content_key);
    }

    #[test]
    fn rejects_relay_key_substitution_wrong_share_and_wrong_capability() {
        let capability = CapabilitySecret::generate();
        let id = ShareId::parse("abc123").unwrap();
        let public = EphemeralKeyPair::generate().public_key_bytes();
        let proof = proof(&capability, &id, &public);
        assert!(accept_live_receiver(&CapabilitySecret::generate(), &id, &public, &proof).is_err());
        assert!(accept_live_receiver(
            &capability,
            &ShareId::parse("abc124").unwrap(),
            &public,
            &proof
        )
        .is_err());
        assert!(accept_live_receiver(&capability, &id, &[0; 32], &proof).is_err());
        assert!(accept_live_receiver(
            &capability,
            &id,
            &[0; 32],
            &self::proof(&capability, &id, &[0; 32])
        )
        .is_err());
    }

    #[test]
    fn matches_browser_handshake_fixture() {
        let raw = include_str!("../../../assets/receiver/test/fixtures/live-handshake.json");
        let fixture: serde_json::Value = serde_json::from_str(raw).unwrap();
        let bytes = |field: &str| -> [u8; 32] {
            URL_SAFE_NO_PAD
                .decode(fixture[field].as_str().unwrap())
                .unwrap()
                .try_into()
                .unwrap()
        };
        let capability = CapabilitySecret::parse(fixture["capability"].as_str().unwrap()).unwrap();
        let id = ShareId::parse("abc123").unwrap();
        let client = bytes("client_public_key");
        let server = bytes("server_public_key");
        assert_eq!(
            live_completion_proof(&bytes("content_key"), 150000),
            bytes("completion_proof")
        );
        assert_eq!(proof(&capability, &id, &client), bytes("client_proof"));
        let mut server_mac = mac(&capability, b"drop2.v2.live.server", "abc123", &client);
        server_mac.update(&server);
        assert!(server_mac.verify_slice(&bytes("server_proof")).is_ok());
        assert_eq!(
            *live_content_key(
                &capability,
                "abc123",
                &client,
                &server,
                &bytes("dh_content_key")
            ),
            bytes("content_key")
        );
    }
}
