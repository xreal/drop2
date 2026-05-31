# drop2

**Share files from the terminal — encrypted end-to-end, with a link anyone can open.**

[drop2.app](https://drop2.app) · [GitHub](https://github.com/xreal/drop2)

[![CI](https://github.com/xreal/drop2/actions/workflows/ci.yml/badge.svg)](https://github.com/xreal/drop2/actions/workflows/ci.yml)

Send a file or folder with one command:

```bash
drop2 report.pdf
```

You get a short link (for example `https://drop2.app/s/gS8M5b`) and, for internet shares, a 4-digit PIN.
Receivers open the link in a browser or download with the CLI:

```bash
drop2 get https://drop2.app/s/gS8M5b --pin 4821
```

The hosted service and LAN relay never see your plaintext. Encryption happens on the sender and receiver.

## Why drop2

- **One command to share** — no account, no upload UI, no config file
- **End-to-end encrypted** — X25519 key exchange and XChaCha20-Poly1305; infrastructure stores ciphertext only
- **Works offline** — `--local` shares on your LAN with an embedded browser receiver (HTTPS, self-signed cert)
- **Live or stored** — stream while you are online, or upload an encrypted copy that expires after five days by default
- **Browser-first receiving** — receivers use a zero-install web page; CLI fallback with `drop2 get`

## Share modes

| Mode | Command | Sender online? | Link | Default PIN |
|------|---------|----------------|------|-------------|
| **Live (internet)** | `drop2 file.zip` | Yes | Short public URL | Auto-generated |
| **Live (LAN)** | `drop2 --local file.zip` | Yes | Local HTTPS URL | Optional |
| **Stored** | `drop2 --keep file.zip` | No (after upload) | Short public URL | Auto-generated |

Live shares auto-close after one hour if no download starts (override with `--wait`).
Stored shares default to a five-day retention (`--expires 7d` to change).

## Install

### Pre-built binaries

Tagged releases publish macOS and Linux binaries on the [GitHub Releases](https://github.com/xreal/drop2/releases) page.
Download the artifact for your platform, make it executable, and put it on your `PATH`.

### Build from source

**Requirements:** Rust 1.85+, Node.js 22+ (for the embedded browser receiver)

```bash
git clone https://github.com/xreal/drop2.git
cd drop2
make install
```

This builds the receiver assets, compiles a release binary, and installs `drop2` to `~/.cargo/bin`.

Build without installing:

```bash
make release
./target/release/drop2 --help
```

Verify:

```bash
drop2 --version
drop2 --help
```

## Usage

### Send

```bash
# Live share — internet when reachable, otherwise LAN
drop2 presentation.key

# Force LAN-only sharing
drop2 --local photos/

# Stored encrypted share (5-day expiry)
drop2 --keep backup.tar.zst

# Optional controls
drop2 --pin 4821 --wait 2h --open report.pdf
drop2 --keep --expires 7d --name "Q1 backup" archive.zip
```

While a live share is active, the CLI prints download progress:

```text
Status: download started
Status: download completed
Status: completed
```

### Receive

```bash
drop2 get https://drop2.app/s/gS8M5b
drop2 get https://drop2.app/s/gS8M5b --pin 4821
drop2 get 'https://drop2.app/s/gS8M5b#secret' --output ~/Downloads
```

For stored shares, the decryption secret lives in the URL fragment (`#...`).
It is never sent to the server when the page loads.

### Flags

| Flag | Description |
|------|-------------|
| `--keep` | Stored share instead of live |
| `--local` | LAN-only live share |
| `--expires 7d` | Stored share lifetime (`m`, `h`, `d`) |
| `--pin 4821` | Set a 4-digit PIN |
| `--wait 1h` | Close live share if no download starts in time |
| `--open` | Open the receiver page in your default browser |
| `--name "label"` | Override the displayed file or folder name |

## How it works

```text
Sender (drop2 CLI)                Untrusted relay                 Receiver (browser or CLI)
       │                                 │                                │
       │  encrypt locally                │                                │
       ├──────── ciphertext ────────────►│──────── ciphertext ───────────►│
       │                                 │                                │ decrypt locally
```

- **Live shares:** ephemeral keys exchanged over a WebSocket; content streamed frame-by-frame.
- **Stored shares:** encrypted locally, uploaded as chunks; metadata and ciphertext live in Cloudflare D1 and R2.
- **LAN shares:** the CLI embeds the browser receiver — no CDN, no third-party scripts.
- **PINs:** gate access on the control plane; they are not the primary decryption secret for stored shares.

See [SECURITY.md](SECURITY.md) for the threat model, review checklist, and responsible disclosure.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `DROP2_API_URL` | `https://drop2.app` | Hosted API for internet live and stored shares |

Point at a local Worker during development:

```bash
export DROP2_API_URL=http://127.0.0.1:8787
drop2 test.zip
```

## Development

```bash
make test          # Rust + receiver + worker tests
make check         # tests + worker typecheck
make receiver      # rebuild browser assets only
make bench         # latency smoke checks against a Worker
./scripts/deploy.sh --check   # deploy Worker to Cloudflare
```

Project layout:

| Path | Role |
|------|------|
| `crates/` | Rust CLI and shared libraries |
| `assets/receiver/` | Browser receiver (embedded in the CLI for LAN mode) |
| `worker/` | Cloudflare Worker, Durable Objects, D1, R2 |

Pull requests welcome. Run `make check` before opening one.

## Deploying the hosted service

Self-host the control plane on Cloudflare Workers, or follow the production checklist in [RELEASE.md](RELEASE.md).

## Platform support

| Component | Support |
|-----------|---------|
| **Sender CLI** | macOS, Linux |
| **Receiver** | Current Chromium and Firefox |
| **Hosted backend** | Cloudflare Workers, Durable Objects, D1, R2 |

Windows sender support is not part of the current MVP.

## License

Dual-licensed under **MIT OR Apache-2.0**, at your option (see `Cargo.toml`).
