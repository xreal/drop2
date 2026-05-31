use std::time::Duration;

use shr_core::{
    default_stored_expiry, is_hosted_available, parse_duration, print_hosted_share, print_local_share,
    print_receive, print_stored_share, run_hosted_share, run_local_share, run_receive, run_stored_share,
    ExitCode, HostedShareOptions, LocalShareOptions, ReceiveOptions, StoredShareOptions,
};
use shr_crypto::Pin;
use tokio::signal;

use crate::args::{Cli, Command};

const DEFAULT_WAIT: Duration = Duration::from_secs(3600);

pub async fn execute(cli: Cli) -> i32 {
    if let Err(msg) = cli.validate() {
        eprintln!("error: {msg}");
        return ExitCode::Usage.as_i32();
    }

    match &cli.command {
        Some(Command::Get { url, output, pin, password }) => {
            if *password {
                eprintln!("error: --password is not implemented yet");
                return ExitCode::Usage.as_i32();
            }
            receive(url.clone(), pin.clone(), output.clone()).await
        }
        None => {
            let path = match cli.path.clone() {
                Some(path) => path,
                None => {
                    eprintln!("error: missing path (see shr --help)");
                    return ExitCode::Usage.as_i32();
                }
            };
            send(cli, path).await
        }
    }
}

async fn send(cli: Cli, path: std::path::PathBuf) -> i32 {
    if cli.password {
        eprintln!("error: --password is not implemented yet");
        return ExitCode::Usage.as_i32();
    }

    let pin = match parse_pin(cli.pin.as_deref()) {
        Ok(pin) => pin,
        Err(code) => return code,
    };

    if cli.keep {
        return send_stored(path, pin, cli.name, cli.expires).await;
    }

    let wait = match cli.wait.as_deref() {
        Some(raw) => match parse_duration(raw) {
            Ok(d) => d,
            Err(err) => {
                eprintln!("error: {err}");
                return ExitCode::Usage.as_i32();
            }
        },
        None => DEFAULT_WAIT,
    };

    if cli.local {
        return send_local(path, pin, cli.name, cli.open).await;
    }

    if is_hosted_available().await {
        send_hosted(path, pin, cli.name, cli.open, wait).await
    } else {
        eprintln!("note: shr.rip unreachable, using local LAN share");
        send_local(path, pin, cli.name, cli.open).await
    }
}

async fn send_stored(
    path: std::path::PathBuf,
    pin: Option<Pin>,
    name: Option<String>,
    expires: Option<String>,
) -> i32 {
    let expires = match expires.as_deref() {
        Some(raw) => match parse_duration(raw) {
            Ok(d) => d,
            Err(err) => {
                eprintln!("error: {err}");
                return ExitCode::Usage.as_i32();
            }
        },
        None => default_stored_expiry(),
    };

    let outcome = match run_stored_share(StoredShareOptions {
        path,
        pin,
        name,
        expires,
    })
    .await
    {
        Ok(r) => r,
        Err(err) => {
            eprintln!("error: {err}");
            return err.exit_code().as_i32();
        }
    };

    print_stored_share(&outcome);
    ExitCode::Success.as_i32()
}

async fn receive(
    url: String,
    pin: Option<String>,
    output: Option<std::path::PathBuf>,
) -> i32 {
    let pin = match parse_pin(pin.as_deref()) {
        Ok(pin) => pin,
        Err(code) => return code,
    };

    let outcome = match run_receive(ReceiveOptions {
        url: url.clone(),
        pin,
        output,
    })
    .await
    {
        Ok(r) => r,
        Err(err) => {
            eprintln!("error: {err}");
            return err.exit_code().as_i32();
        }
    };

    print_receive(&outcome, &url);
    ExitCode::Success.as_i32()
}

fn parse_pin(raw: Option<&str>) -> Result<Option<Pin>, i32> {
    match raw {
        Some(value) => Pin::parse(value)
            .map(Some)
            .map_err(|err| {
                eprintln!("error: {err}");
                ExitCode::Usage.as_i32()
            }),
        None => Ok(None),
    }
}

async fn send_hosted(
    path: std::path::PathBuf,
    pin: Option<Pin>,
    name: Option<String>,
    open: bool,
    wait: Duration,
) -> i32 {
    let outcome = match run_hosted_share(HostedShareOptions {
        path,
        pin,
        name,
        wait,
    })
    .await
    {
        Ok(r) => r,
        Err(err) => {
            eprintln!("error: {err}");
            return err.exit_code().as_i32();
        }
    };

    print_hosted_share(&outcome);

    if open {
        if let Err(err) = open::that(&outcome.share_url) {
            eprintln!("warning: could not open browser: {err}");
        }
    }

    let wait_result = outcome.handle.wait_until_shutdown().await;

    match wait_result {
        Ok(()) => {
            println!("Status: completed");
            ExitCode::Success.as_i32()
        }
        Err(err) => {
            if matches!(err, shr_hosted::HostedError::Cancelled) {
                return ExitCode::Cancelled.as_i32();
            }
            eprintln!("error: {err}");
            ExitCode::Runtime.as_i32()
        }
    }
}

async fn send_local(
    path: std::path::PathBuf,
    pin: Option<Pin>,
    name: Option<String>,
    open: bool,
) -> i32 {
    let opts = LocalShareOptions { path, pin, name };

    let mut result = match run_local_share(opts).await {
        Ok(r) => r,
        Err(err) => {
            eprintln!("error: {err}");
            return err.exit_code().as_i32();
        }
    };

    print_local_share(&result);

    if open {
        let url = format!("http://127.0.0.1:{}", result.handle.urls.bind_addr.port());
        if let Err(err) = open::that(&url) {
            eprintln!("warning: could not open browser: {err}");
        }
    }

    if wait_for_shutdown().await.is_err() {
        return ExitCode::Cancelled.as_i32();
    }

    result.handle.stop();
    println!("Status: completed");
    ExitCode::Success.as_i32()
}

async fn wait_for_shutdown() -> Result<(), ()> {
    signal::ctrl_c().await.map_err(|_| ())
}
