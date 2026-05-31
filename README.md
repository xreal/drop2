# shr.rip

`shr` is a privacy-first file sharing tool for the terminal.

Share a file or folder with one command:

```bash
shr test.zip
```

You get a short link like `https://shr.rip/s/gS8M5b`.
The receiver opens it in the browser or uses `shr get <url>`.

## Features

- End-to-end encrypted transfers — infrastructure never sees plaintext
- Local/LAN sharing without internet (`shr --local`)
- Internet live shares with a short link and 4-digit PIN
- Stored shares encrypted before upload, expiring after 5 days by default
- Browser-first receiving with CLI fallback (`shr get`)

## Install

### From source (macOS / Linux)

Requirements: Rust 1.85+, Node.js 22+ (for building the embedded browser receiver).

```bash
git clone <your-repo-url>
cd shr.rip
make install
```

This builds the receiver assets, compiles a release binary, and installs `shr` to `~/.cargo/bin`.

To build without installing:

```bash
make release
./target/release/shr --help
```

### Verify

```bash
shr --version
shr --help
```

## Usage

```bash
# Live share (internet if available, else LAN)
shr test.zip

# Force local-only sharing
shr --local photos/

# Stored encrypted share (5-day expiry)
shr --keep backup.tar.zst

# Receive a share
shr get https://shr.rip/s/gS8M5b --pin 4821
shr get 'https://shr.rip/s/gS8M5b#secret' --output ~/Downloads
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
| `SHR_API_URL` | `https://shr.rip` | Hosted control plane for internet shares |

Point at a local Worker during development:

```bash
export SHR_API_URL=http://127.0.0.1:8787
shr test.zip
```

## Development

```bash
make test          # Rust + receiver + worker unit tests
make check         # tests + worker typecheck
make receiver      # rebuild browser assets only
make bench         # pre-launch latency smoke checks
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
