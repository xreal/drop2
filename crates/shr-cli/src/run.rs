use std::time::Duration;

use shr_core::{
    is_hosted_available, parse_duration, print_hosted_share, print_local_share, run_hosted_share,
    run_local_share, ExitCode, HostedShareOptions, LocalShareOptions,
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

    let path = cli.path.clone();
    match (&cli.command, path.as_ref()) {
        (Some(Command::Get { .. }), _) => {
            eprintln!("error: shr get is not implemented yet (Phase 3)");
            ExitCode::Usage.as_i32()
        }
        (None, Some(path)) => send(cli, path.clone()).await,
        (None, None) => {
            eprintln!("error: missing path (see shr --help)");
            ExitCode::Usage.as_i32()
        }
    }
}

async fn send(cli: Cli, path: std::path::PathBuf) -> i32 {
    if cli.keep {
        eprintln!("error: stored shares are not implemented yet (Phase 3)");
        return ExitCode::Usage.as_i32();
    }

    if cli.password {
        eprintln!("error: --password is not implemented yet");
        return ExitCode::Usage.as_i32();
    }

    let pin = match cli.pin.as_deref() {
        Some(raw) => match Pin::parse(raw) {
            Ok(pin) => Some(pin),
            Err(err) => {
                eprintln!("error: {err}");
                return ExitCode::Usage.as_i32();
            }
        },
        None => None,
    };

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
