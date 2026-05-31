use shr_core::{run_local_share, ExitCode, LocalShareOptions};
use shr_crypto::Pin;
use tokio::signal;

use crate::args::{Cli, Command};

pub async fn execute(cli: Cli) -> i32 {
    if let Err(msg) = cli.validate() {
        eprintln!("error: {msg}");
        return ExitCode::Usage.as_i32();
    }

    let path = cli.path.clone();
    match (&cli.command, path.as_ref()) {
        (Some(Command::Get { .. }), _) => {
            eprintln!("error: shr get is not implemented yet (Phase 2/3)");
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

    let opts = LocalShareOptions {
        path,
        pin,
        name: cli.name,
    };

    let mut result = match run_local_share(opts).await {
        Ok(r) => r,
        Err(err) => {
            eprintln!("error: {err}");
            return err.exit_code().as_i32();
        }
    };

    shr_core::print_local_share(&result);

    if cli.open {
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
