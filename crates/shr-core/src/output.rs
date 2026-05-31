use crate::local_share::LocalShareResult;

pub fn print_local_share(result: &LocalShareResult) {
    let urls = &result.handle.urls;
    println!("Sharing: {}", result.display_name);
    println!("Mode: Live (LAN)");
    println!("Share ID: {}", urls.share_id);
    println!("Local URL: http://{}", urls.lan_addr);
    println!("Loopback: http://127.0.0.1:{}", urls.bind_addr.port());
    if let Some(pin) = result.pin {
        println!("PIN: {pin}");
    }
    println!("Status: waiting for receiver");
}
