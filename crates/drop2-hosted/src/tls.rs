use std::sync::Once;

static INSTALL_PROVIDER: Once = Once::new();

pub(crate) fn ensure_rustls_provider() {
    INSTALL_PROVIDER.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}
