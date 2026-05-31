use std::fmt;

use rand::RngCore;

use crate::error::CryptoError;
use crate::pin::Pin;

const BASE62: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// Short public share locator (6 base62 characters).
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct ShareId([u8; 6]);

impl ShareId {
    pub fn new(raw: [u8; 6]) -> Self {
        Self(raw)
    }

    pub fn as_str(&self) -> &str {
        // SAFETY: BASE62 alphabet is ASCII.
        unsafe { std::str::from_utf8_unchecked(&self.0) }
    }

    pub fn parse(input: &str) -> Result<Self, CryptoError> {
        let bytes = input.as_bytes();
        if bytes.len() != 6 || !bytes.iter().all(|b| BASE62.contains(b)) {
            return Err(CryptoError::InvalidShareId);
        }
        let mut raw = [0u8; 6];
        raw.copy_from_slice(bytes);
        Ok(Self(raw))
    }
}

impl fmt::Display for ShareId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl fmt::Debug for ShareId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ShareId({})", self)
    }
}

pub fn generate_share_id() -> ShareId {
    let mut rng = rand::rngs::OsRng;
    let mut raw = [0u8; 6];
    for byte in &mut raw {
        *byte = BASE62[(rng.next_u32() as usize) % BASE62.len()];
    }
    ShareId(raw)
}

pub fn generate_pin() -> Pin {
    let mut rng = rand::rngs::OsRng;
    Pin::new((rng.next_u32() % 10_000) as u16)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn share_id_roundtrip() {
        let id = generate_share_id();
        let parsed = ShareId::parse(id.as_str()).unwrap();
        assert_eq!(id, parsed);
    }

    #[test]
    fn rejects_invalid_share_id() {
        assert!(ShareId::parse("short").is_err());
        assert!(ShareId::parse("bad!!1").is_err());
    }
}
