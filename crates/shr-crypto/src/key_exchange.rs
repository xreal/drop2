use rand::rngs::OsRng;
use x25519_dalek::{EphemeralSecret, PublicKey, StaticSecret};
use zeroize::{Zeroize, Zeroizing};

use crate::error::CryptoError;
use crate::kdf::derive_content_key;

/// Ephemeral X25519 key pair for a live session.
pub struct EphemeralKeyPair {
    secret: StaticSecret,
    public: PublicKey,
}

impl EphemeralKeyPair {
    pub fn generate() -> Self {
        let secret = StaticSecret::random_from_rng(OsRng);
        let public = PublicKey::from(&secret);
        Self { secret, public }
    }

    pub fn public_key_bytes(&self) -> [u8; 32] {
        self.public.to_bytes()
    }

    pub fn complete(&self, peer_public: &[u8; 32]) -> Result<SessionKeys, CryptoError> {
        let peer = PublicKey::from(*peer_public);
        let shared = self.secret.diffie_hellman(&peer);
        let content_key = derive_content_key(shared.as_bytes())?;
        Ok(SessionKeys { content_key })
    }
}

/// Receiver-side ephemeral key for completing the handshake (CLI receive).
pub struct ReceiverEphemeral(EphemeralSecret);

impl ReceiverEphemeral {
    pub fn generate() -> (Self, [u8; 32]) {
        let secret = EphemeralSecret::random_from_rng(OsRng);
        let public = PublicKey::from(&secret);
        (Self(secret), public.to_bytes())
    }

    pub fn complete(self, sender_public: &[u8; 32]) -> Result<SessionKeys, CryptoError> {
        let peer = PublicKey::from(*sender_public);
        let shared = self.0.diffie_hellman(&peer);
        derive_content_key(shared.as_bytes()).map(|content_key| SessionKeys { content_key })
    }
}

pub struct SessionKeys {
    pub content_key: Zeroizing<[u8; 32]>,
}

impl Drop for SessionKeys {
    fn drop(&mut self) {
        self.content_key.zeroize();
    }
}
