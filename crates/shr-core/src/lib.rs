mod duration;
mod error;
mod hosted_share;
mod local_share;
mod output;
mod stored_share;

pub use duration::parse_duration;
pub use error::{CoreError, ExitCode};
pub use hosted_share::{is_hosted_available, run_hosted_share, HostedShareOptions, HostedShareOutcome};
pub use local_share::{run_local_share, LocalShareOptions, LocalShareResult};
pub use output::{print_hosted_share, print_local_share, print_receive, print_stored_share};
pub use stored_share::{
    default_stored_expiry, run_receive, run_stored_share, ReceiveOptions, ReceiveOutcome,
    StoredShareOptions, StoredShareOutcome,
};
