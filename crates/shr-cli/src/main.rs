mod args;
mod run;

use clap::Parser;

use crate::args::Cli;
use crate::run::execute;

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let code = execute(cli).await;
    std::process::exit(code);
}
