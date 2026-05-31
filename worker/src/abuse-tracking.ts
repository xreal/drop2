export interface AbuseTrackingState {
  failed_pins: Record<string, number>;
  cooldown_until: Record<string, number>;
}

const MAX_TRACKED_IPS = 256;

export function recordFailedPin(
  state: AbuseTrackingState,
  ipKey: string,
  cooldownUntil: number | null,
): void {
  state.failed_pins[ipKey] = (state.failed_pins[ipKey] ?? 0) + 1;
  if (cooldownUntil !== null) {
    state.cooldown_until[ipKey] = cooldownUntil;
  }
}

export function pruneAbuseTracking(
  state: AbuseTrackingState,
  now: number,
): void {
  const entries = collectEntries(state);
  if (entries.length === 0) {
    state.failed_pins = {};
    state.cooldown_until = {};
    return;
  }

  const active = entries.filter((entry) => entry.cooldownUntil > now);
  const retained = active.length > 0 ? active : entries;
  retained.sort((left, right) => right.cooldownUntil - left.cooldownUntil);

  const limited = retained.slice(0, MAX_TRACKED_IPS);
  state.failed_pins = Object.fromEntries(
    limited.map((entry) => [entry.ipKey, entry.failures]),
  );
  state.cooldown_until = Object.fromEntries(
    limited
      .filter((entry) => entry.cooldownUntil > now)
      .map((entry) => [entry.ipKey, entry.cooldownUntil]),
  );
}

interface AbuseEntry {
  ipKey: string;
  failures: number;
  cooldownUntil: number;
}

function collectEntries(state: AbuseTrackingState): AbuseEntry[] {
  const ipKeys = new Set([
    ...Object.keys(state.failed_pins),
    ...Object.keys(state.cooldown_until),
  ]);

  return [...ipKeys].map((ipKey) => ({
    ipKey,
    failures: state.failed_pins[ipKey] ?? 0,
    cooldownUntil: state.cooldown_until[ipKey] ?? 0,
  }));
}
