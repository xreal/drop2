use std::time::Duration;

use crate::error::CoreError;

pub fn parse_duration(input: &str) -> Result<Duration, CoreError> {
    let input = input.trim();
    if input.is_empty() {
        return Err(CoreError::Usage("duration cannot be empty".into()));
    }

    let (num, unit) = input
        .char_indices()
        .find(|(_, c)| !c.is_ascii_digit())
        .map(|(idx, c)| (&input[..idx], c))
        .unwrap_or((input, 's'));

    let value: u64 = num
        .parse()
        .map_err(|_| CoreError::Usage(format!("invalid duration: {input}")))?;

    let secs = match unit {
        's' => value,
        'm' => value.saturating_mul(60),
        'h' => value.saturating_mul(3600),
        'd' => value.saturating_mul(86_400),
        _ => return Err(CoreError::Usage(format!("unsupported duration unit: {input}"))),
    };

    Ok(Duration::from_secs(secs))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hours_and_days() {
        assert_eq!(parse_duration("1h").unwrap(), Duration::from_secs(3600));
        assert_eq!(parse_duration("5d").unwrap(), Duration::from_secs(5 * 86_400));
    }
}
