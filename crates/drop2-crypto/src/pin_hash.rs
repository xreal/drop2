use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;

use crate::pin::Pin;

const SALT_LEN: usize = 16;
const HASH_LEN: usize = 32;
const ITERATIONS: u32 = 100_000;

/// Server-storable PIN verifier (salt + PBKDF2-SHA256 hash).
#[derive(Clone)]
pub struct PinHash {
    salt: [u8; SALT_LEN],
    hash: [u8; HASH_LEN],
}

impl PinHash {
    pub fn hash_pin(pin: &Pin) -> Self {
        let mut salt = [0u8; SALT_LEN];
        rand::rngs::OsRng.fill_bytes(&mut salt);
        let hash = derive(&salt, pin.digits().as_bytes());
        Self { salt, hash }
    }

    pub fn from_parts(salt: [u8; SALT_LEN], hash: [u8; HASH_LEN]) -> Self {
        Self { salt, hash }
    }

    pub fn verify(&self, pin: &Pin) -> bool {
        let candidate = derive(&self.salt, pin.digits().as_bytes());
        constant_time_eq(&candidate, &self.hash)
    }

    pub fn salt(&self) -> &[u8; SALT_LEN] {
        &self.salt
    }

    pub fn hash(&self) -> &[u8; HASH_LEN] {
        &self.hash
    }

    pub fn salt_b64(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.salt)
    }

    pub fn hash_b64(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.hash)
    }

    pub fn decode(salt_b64: &str, hash_b64: &str) -> Option<Self> {
        let salt = decode_fixed::<SALT_LEN>(salt_b64)?;
        let hash = decode_fixed::<HASH_LEN>(hash_b64)?;
        Some(Self { salt, hash })
    }
}

fn derive(salt: &[u8; SALT_LEN], pin: &[u8]) -> [u8; HASH_LEN] {
    let mut out = [0u8; HASH_LEN];
    pbkdf2_hmac::<Sha256>(pin, salt, ITERATIONS, &mut out);
    out
}

fn decode_fixed<const N: usize>(encoded: &str) -> Option<[u8; N]> {
    let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    if bytes.len() != N {
        return None;
    }
    let mut out = [0u8; N];
    out.copy_from_slice(&bytes);
    Some(out)
}

fn constant_time_eq(a: &[u8; HASH_LEN], b: &[u8; HASH_LEN]) -> bool {
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verify_accepts_matching_pin() {
        let pin = Pin::parse("4821").unwrap();
        let stored = PinHash::hash_pin(&pin);
        assert!(stored.verify(&pin));
    }

    #[test]
    fn verify_rejects_wrong_pin() {
        let pin = Pin::parse("4821").unwrap();
        let stored = PinHash::hash_pin(&pin);
        assert!(!stored.verify(&Pin::parse("1234").unwrap()));
    }

    #[test]
    fn b64_roundtrip() {
        let pin = Pin::parse("0001").unwrap();
        let stored = PinHash::hash_pin(&pin);
        let decoded = PinHash::decode(&stored.salt_b64(), &stored.hash_b64()).expect("decode");
        assert!(decoded.verify(&pin));
    }
}
