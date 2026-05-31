use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../../assets/receiver/dist/"]
pub struct ReceiverAssets;

pub fn index_html() -> String {
    ReceiverAssets::get("index.html")
        .map(|f| String::from_utf8_lossy(f.data.as_ref()).into_owned())
        .unwrap_or_else(fallback_html)
}

fn fallback_html() -> String {
    "<!doctype html><title>shr</title><p>Receiver assets missing.</p>".to_string()
}
