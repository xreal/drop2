# Security

`shr` is designed so untrusted infrastructure never receives plaintext file contents. This document is the pre-launch security review checklist and vulnerability reporting guide.

## Threat model summary

| Boundary | Trust level | Must not learn |
|----------|-------------|----------------|
| Control plane (Worker) | Untrusted | Plaintext, capability secrets, passwords, data keys |
| Relay (Durable Object) | Untrusted | Plaintext content |
| Storage (R2) | Untrusted | Plaintext, meaningful filenames in object keys |
| LAN | Untrusted | Plaintext without client-side decryption |

## Pre-launch review checklist

### Cryptography

- [ ] Live transfers use X25519 key exchange + XChaCha20-Poly1305 AEAD
- [ ] Stored shares encrypt locally before upload; DEK wrapped with capability secret
- [ ] PIN is an access gate only, not the primary decryption secret for stored shares
- [ ] Chunk and manifest integrity is authenticated (AEAD tags)

### Client-side authority

- [ ] Browser receiver decrypts locally; server never decrypts on behalf of users
- [ ] Capability secrets travel in URL fragments (not sent to server on navigation)
- [ ] CLI embeds receiver assets for LAN mode — no CDN dependency

### Access control

- [ ] Internet live shares require PIN by default
- [ ] PIN verification uses salted hashes, not plaintext storage
- [ ] Failed PIN attempts per IP per share trigger cooldown (3 → 15 min)
- [ ] Cross-share probing from one IP triggers global cooldown (20 failures)
- [ ] Join tokens are short-lived and bound to session state
- [ ] One active receiver per live share (MVP)

### Logging and privacy

- [ ] No logging of URL fragments, capability secrets, passwords, or plaintext PINs
- [ ] IP addresses stored as keyed hashes where persistence is needed
- [ ] Error responses are generic externally, specific internally

### Lifecycle

- [ ] Live shares expire on wait timeout (default 1h before first download)
- [ ] Stored shares expire deterministically in D1
- [ ] Hourly cron cleans expired stored metadata and R2 objects
- [ ] Sender disconnect ends active live share

### Supply chain

- [ ] Dependencies pinned in `Cargo.lock`, `package.json`, and worker lockfile
- [ ] CI runs `make check` on every push
- [ ] Release binaries built from tagged commits in GitHub Actions

## Known accepted limits

- 4-digit PINs are not strong cryptographic protection alone
- 6-character Share IDs are locators, not secrets
- Traffic analysis (timing, sizes, IPs) is not fully hidden
- Compromised sender/receiver endpoints are out of scope

## Reporting vulnerabilities

If you find a security issue, please report it responsibly:

1. **Do not** open a public GitHub issue for exploitable vulnerabilities.
2. Email the maintainers with:
   - Description of the issue
   - Steps to reproduce
   - Impact assessment
   - Suggested fix (if any)
3. Allow reasonable time for a fix before public disclosure.

We aim to acknowledge reports within 72 hours.

## Security-related environment variables

| Variable | Component | Purpose |
|----------|-----------|---------|
| `SHR_API_URL` | CLI | Override hosted API base URL |

Never commit `.env` files, private keys, or Cloudflare API tokens to the repository.
