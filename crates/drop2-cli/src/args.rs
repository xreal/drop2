use std::path::PathBuf;

use clap::{Parser, Subcommand};
use drop2_core::parse_duration;

#[derive(Parser)]
#[command(name = "drop2", about = "Share files fast and securely", version)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,

    #[arg(value_name = "PATH")]
    pub path: Option<PathBuf>,

    #[arg(long, conflicts_with = "local")]
    pub keep: bool,

    #[arg(long, requires = "keep")]
    pub expires: Option<String>,

    #[arg(long)]
    pub password: bool,

    /// Force local LAN live share.
    #[arg(long, conflicts_with = "keep")]
    pub local: bool,

    #[arg(long, value_name = "NNNN")]
    pub pin: Option<String>,

    #[arg(long, value_name = "DURATION")]
    pub wait: Option<String>,

    #[arg(long)]
    pub open: bool,

    #[arg(long, value_name = "LABEL")]
    pub name: Option<String>,
}

#[derive(Subcommand)]
pub enum Command {
    Get {
        url: String,
        #[arg(long, value_name = "PATH")]
        output: Option<PathBuf>,
        #[arg(long, value_name = "NNNN")]
        pin: Option<String>,
        #[arg(long)]
        password: bool,
    },
}

impl Cli {
    pub fn validate(&self) -> Result<(), String> {
        if self.keep && self.local {
            return Err("--keep and --local cannot be used together".into());
        }
        if self.expires.is_some() && !self.keep {
            return Err("--expires is only valid with --keep".into());
        }
        if self.wait.is_some() && self.keep {
            return Err("--wait is only valid for live shares".into());
        }
        if let Some(pin) = &self.pin {
            drop2_crypto::Pin::parse(pin).map_err(|e| e.to_string())?;
        }
        if let Some(expires) = &self.expires {
            parse_duration(expires).map_err(|e| e.to_string())?;
        }
        if let Some(wait) = &self.wait {
            parse_duration(wait).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
