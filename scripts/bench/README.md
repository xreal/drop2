# Pre-launch benchmarks

Automated smoke checks plus manual validation gates before public launch.

## Automated checks

Against a running Worker (`wrangler dev` or production):

```bash
export DROP2_API_URL=http://127.0.0.1:8787   # or https://drop2.app
make bench
```

Or run individually:

```bash
node scripts/bench/routes-smoke.mjs
node scripts/bench/health-latency.mjs
```

Environment:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DROP2_API_URL` | `http://127.0.0.1:8787` | Target Worker base URL |
| `DROP2_BENCH_SAMPLES` | `10` | Health latency sample count |

### Pass criteria (automated)

- `/api/v1/health` returns `{ "ok": true }` on every sample
- Health p95 latency under 500ms for warm production (adjust for cold starts during first deploy)
- `/s/AAAAAA` returns the receiver HTML shell

## Manual validation gates

These require real file transfers and cannot be fully automated yet.

### 1. Durable Object relay throughput

```bash
export DROP2_API_URL=https://drop2.app
# Create a 50–500 MiB test file
dd if=/dev/urandom of=/tmp/drop2-bench.bin bs=1m count=100

# Sender
drop2 /tmp/drop2-bench.bin

# Receiver: open link in browser, enter PIN, download
# Record: time to first byte, total transfer time, any disconnects
```

**Gate:** 100 MiB completes without relay timeout; no plaintext visible in Worker logs.

### 2. R2 stored-share chunks

```bash
drop2 --keep /tmp/drop2-bench.bin
# Download via browser and via: drop2 get '<url>' --pin <pin>
```

**Gate:** Multi-chunk upload and download succeed; manifest decrypts; file hash matches.

### 3. Cold-start receiver experience

Open a fresh share URL in an incognito window after Worker idle period.

**Gate:** Receiver page interactive within acceptable UX (target: under 3s on broadband).

### 4. PIN abuse controls

From one IP, submit wrong PIN 3 times on the same share.

**Gate:** 4th attempt returns cooldown error; other shares from same IP eventually hit global cooldown after repeated failures.

### 5. Local mode isolation

```bash
drop2 --local test.zip
# Verify browser loads from sender IP, not drop2.app
# Disconnect internet; transfer should still work
```

**Gate:** No requests to hosted API during local share.

## Recording results

Before launch, log results in your release notes:

| Gate | Date | Result | Notes |
|------|------|--------|-------|
| Health latency | | | |
| DO relay 100 MiB | | | |
| R2 stored multi-chunk | | | |
| PIN cooldown | | | |
| Local isolation | | | |
