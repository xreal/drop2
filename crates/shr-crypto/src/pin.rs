use std::fmt;

use crate::error::CryptoError;

/// Four-digit access PIN (0000–9999).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Pin(u16);

impl Pin {
    pub fn new(value: u16) -> Self {
        Self(value % 10_000)
    }

    pub fn parse(input: &str) -> Result<Self, CryptoError> {
        if input.len() != 4 || !input.chars().all(|c| c.is_ascii_digit()) {
            return Err(CryptoError::InvalidPin);
        }
        let value: u16 = input.parse().unwrap_or(0);
        Ok(Self(value))
    }

    pub fn digits(&self) -> String {
        format!("{:04}", self.0)
    }
}

impl fmt::Display for Pin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:04}", self.0)
    }
}

impl fmt::Debug for Pin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Pin({self})")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_formatting() {
        assert_eq!(Pin::new(42).to_string(), "0042");
    }

    #[test]
    fn pin_parse_rejects_bad_input() {
        assert!(Pin::parse("123").is_err());
        assert!(Pin::parse("abcd").is_err());
    }
}
