use std::time::{Duration, Instant};

use drop2_crypto::Pin;

use crate::error::LocalError;

const MAX_FAILURES: u8 = 3;
const COOLDOWN: Duration = Duration::from_secs(15 * 60);

#[derive(Default)]
pub(crate) struct PinGate {
    failures: u8,
    blocked_until: Option<Instant>,
}

impl PinGate {
    pub(crate) fn verify(
        &mut self,
        expected: &Pin,
        supplied: Option<&str>,
        now: Instant,
    ) -> Result<(), LocalError> {
        if let Some(until) = self.blocked_until {
            if now < until {
                return Err(LocalError::PinRejected);
            }
            self.failures = 0;
            self.blocked_until = None;
        }
        if supplied.and_then(|value| Pin::parse(value).ok()).as_ref() == Some(expected) {
            self.failures = 0;
            return Ok(());
        }
        self.failures += 1;
        if self.failures >= MAX_FAILURES {
            self.blocked_until = Some(now + COOLDOWN);
        }
        Err(LocalError::PinRejected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_all_attempts_after_three_failures_until_cooldown_ends() {
        let mut gate = PinGate::default();
        let pin = Pin::parse("4821").unwrap();
        let now = Instant::now();
        for supplied in [None, Some("bad"), Some("0000")] {
            assert!(gate.verify(&pin, supplied, now).is_err());
        }
        assert!(gate.verify(&pin, Some("4821"), now).is_err());
        assert!(gate.verify(&pin, Some("4821"), now + COOLDOWN).is_ok());
        assert!(gate.verify(&pin, Some("0000"), now + COOLDOWN).is_err());
        assert!(gate.verify(&pin, Some("4821"), now + COOLDOWN).is_ok());
    }
}
