use thiserror::Error;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("encryption failed")]
    Encrypt,
    #[error("decryption failed")]
    Decrypt,
    #[error("invalid key material")]
    InvalidKey,
    #[error("invalid PIN: must be exactly 4 digits")]
    InvalidPin,
    #[error("invalid share id")]
    InvalidShareId,
}
