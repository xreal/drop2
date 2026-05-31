# drop2.app

`drop2` is a privacy-first file sharing tool for the terminal.

Share a file or folder with one command:

```bash
drop2 test.zip
```

You get a short link like `https://drop2.app/s/gS8M5b`.
The receiver opens it in the browser or uses `drop2 get <url>`.

## Features

- End-to-end encrypted transfers — infrastructure never sees plaintext
- Local/LAN sharing without internet (`drop2 --local`)
- Internet live shares with a short link and 4-digit PIN
- Stored shares encrypted before upload, expiring after 5 days by default
- Browser-first receiving with CLI fallback (`drop2 get`)

## Install

### From source (macOS / Linux)

Requirements: Rust 1.85+, Node.js 22+ (for building the embedded browser receiver).

```bash
git clone <your-repo-url>
cd drop2.app
make install
```

This builds the receiver assets, compiles a release binary, and installs `drop2` to `~/.cargo/bin`.

To build without installing:

```bash
make release
./target/release/drop2 --help
```

### Verify

```bash
drop2 --version
drop2 --help
```

## Usage

```bash
# Live share (internet if available, else LAN)
drop2 test.zip

# Force local-only sharing
drop2 --local photos/

# Stored encrypted share (5-day expiry)
drop2 --keep backup.tar.zst

# Receive a share
drop2 get https://drop2.app/s/gS8M5b --pin 4821
drop2 get 'https://drop2.app/s/gS8M5b#secret' --output ~/Downloads
```

### Common flags

| Flag | Description |
|------|-------------|
| `--keep` | Stored share instead of live |
| `--local` | LAN-only live share |
| `--expires 7d` | Stored share expiry (with `--keep`) |
| `--pin 4821` | Set a 4-digit PIN |
| `--wait 1h` | Auto-close live share if no download starts |
| `--open` | Open receiver page in your browser |
| `--password` | Add optional password protection |

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `DROP2_API_URL` | `https://drop2.app` | Hosted control plane for internet shares |

Point at a local Worker during development:

```bash
export DROP2_API_URL=http://127.0.0.1:8787
drop2 test.zip
```

## Development

```bash
make test          # Rust + receiver + worker unit tests
make check         # tests + worker typecheck
make receiver      # rebuild browser assets only
make bench         # pre-launch latency smoke checks
./scripts/deploy.sh --check   # deploy Worker to Cloudflare
```

Project layout:

- `crates/` — Rust CLI and libraries
- `assets/receiver/` — browser receiver (embedded in CLI for LAN mode)
- `worker/` — Cloudflare Worker, Durable Objects, D1, R2

Internal design docs live in `docs/` (not shipped with releases).

## Deploying the hosted service

See [RELEASE.md](RELEASE.md) for the Cloudflare deployment checklist and pre-launch validation gates.

## Security

See [SECURITY.md](SECURITY.md) for the security review checklist and how to report issues.

## Platform support

- **Sender:** macOS, Linux (MVP)
- **Receiver:** current Chromium browsers and Firefox
- **Hosted backend:** Cloudflare Workers + Durable Objects + D1 + R2

## License

MIT OR Apache-2.0
