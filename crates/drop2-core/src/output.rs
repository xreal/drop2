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

pub fn print_stored_share(result: &crate::stored_share::StoredShareOutcome) {
    println!("Sharing: {}", result.display_name);
    println!("Mode: Stored");
    let secs = result.expires.as_secs();
    if secs >= 86_400 && secs % 86_400 == 0 {
        println!("Expires: {}d", secs / 86_400);
    } else if secs >= 3600 && secs % 3600 == 0 {
        println!("Expires: {}h", secs / 3600);
    } else {
        println!("Expires: {secs}s");
    }
    println!("Link: {}", result.share_url);
    if let Some(pin) = result.pin {
        println!("PIN: {pin}");
    }
    println!("Status: uploaded");
}

pub fn print_receive(result: &crate::stored_share::ReceiveOutcome, url: &str) {
    println!("Receiving: {}", result.display_name);
    println!("From: {url}");
    println!("Saving to: {}", result.output_path.display());
    println!("Done: {} bytes", result.bytes_written);
}

pub fn print_hosted_share(result: &crate::hosted_share::HostedShareOutcome) {
    println!("Sharing: {}", result.display_name);
    println!("Mode: Live");
    println!("Link: {}", result.share_url);
    if let Some(pin) = result.pin {
        println!("PIN: {pin}");
    }
    let secs = result.wait.as_secs();
    if secs >= 3600 && secs % 3600 == 0 {
        println!("Wait: {}h for first download", secs / 3600);
    } else if secs >= 60 && secs % 60 == 0 {
        println!("Wait: {}m for first download", secs / 60);
    } else {
        println!("Wait: {secs}s for first download");
    }
    println!("Status: waiting for receiver");
}
