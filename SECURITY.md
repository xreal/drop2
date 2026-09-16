# Security

`drop2` encrypts file contents end-to-end by default. Browser quick links are an explicit exception: they trade end-to-end encryption for a short URL, become inaccessible after at most two hours, and are then removed by minutely cleanup. This document is the pre-launch security review checklist and vulnerability reporting guide.

## Threat model summary

| Boundary | Trust level | Must not learn |
|----------|-------------|----------------|
| Control plane (Worker) | Untrusted | Plaintext except explicit quick links, capability secrets, passwords, data keys |
| Relay (Durable Object) | Untrusted | Plaintext content |
| Storage (R2) | Untrusted | Plaintext except explicit quick links, meaningful filenames in object keys |
| LAN | Untrusted | Plaintext without client-side decryption |

## Pre-launch review checklist

### Cryptography

- [x] Internet live transfers authenticate X25519 key exchange with a sender-generated 32-byte URL-fragment capability, then use XChaCha20-Poly1305 AEAD
- [ ] Stored shares encrypt locally before upload; DEK wrapped with capability secret
- [ ] PIN is an access gate only, not the primary decryption secret for stored shares
- [ ] Encrypted chunk and manifest integrity is authenticated (AEAD tags)
- [ ] Plaintext quick links are explicitly marked and cannot bypass mandatory PIN, first-completed-download deletion, or two-hour limits

### Client-side authority

- [ ] Browser receiver decrypts locally; server never decrypts on behalf of users
- [ ] Capability secrets travel in URL fragments (not sent to server on navigation)
- [ ] CLI embeds receiver assets for LAN mode — no CDN dependency

### Access control

- [ ] Internet live shares require PIN by default
- [ ] PIN verification uses salted hashes, not plaintext storage
- [x] Hosted PIN checks atomically reserve attempts before verification: at most 3 failed/in-flight checks per IP/share and 20 per IP across shares in a 15-minute window; successful checks refund only their own attempts
- [x] LAN PIN checks use a serialized share-wide budget: 3 failures trigger a 15-minute cooldown
- [ ] Join tokens are short-lived and bound to session state
- [ ] One active receiver per live share (MVP)

### Logging and privacy

- [ ] No logging of URL fragments, capability secrets, passwords, or plaintext PINs
- [ ] IP addresses stored as keyed hashes where persistence is needed
- [ ] Error responses are generic externally, specific internally

### Lifecycle

- [ ] Live shares expire on wait timeout (default 1h before first download)
- [ ] Stored shares expire deterministically in D1
- [ ] Minutely cron cleans expired stored metadata and R2 objects
- [ ] Sender disconnect ends active live share
- [x] CLI downloads publish complete files without replacing existing files or symlinks; sender-supplied hidden names require an explicit output filename
- [x] Stored creates validate exact chunk geometry and ciphertext overhead, bound manifest size, and enforce anonymous/authenticated size limits regardless of client-supplied mode fields
- [x] Account quota is reserved atomically at stored-share creation and converted to usage on completion; stale uploads release reservations during cleanup

## Authenticated live protocol

Hosted live links now require their complete `#capability` fragment. Both clients must use the authenticated protocol; there is no fallback to the unauthenticated handshake. Deploy the updated Worker and browser assets with the updated CLI, and recreate old live shares.

Receiver proofs bind the share ID and receiver public key. Sender proofs and content-key derivation bind both public keys and the share ID, with separate domain labels. Each accepted handshake uses a fresh sender key pair, and non-contributory X25519 keys are rejected. A completion MAC authenticates the final byte count against whole-frame truncation. Rust/browser contract fixtures and a real CLI-to-Worker transfer test cover the protocol.

The relay receives proofs, never the capability. This protects against key substitution by the relay; browser users still trust the delivered application code. The separate optional server-side email feature necessarily sends its link capability to the email-sending Worker, as specified by that feature.

### Supply chain

- [ ] Dependencies pinned in `Cargo.lock`, `package.json`, and worker lockfile
- [ ] CI runs `make check` on every push
- [ ] Release binaries built from tagged commits in GitHub Actions

## Known accepted limits

- 4-digit PINs are not strong cryptographic protection alone
- 6-character Share IDs are locators, not secrets
- Browser quick links are not end-to-end encrypted; the Worker and R2 can read their contents
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
| `DROP2_API_URL` | CLI | Override hosted API base URL |

Never commit `.env` files, private keys, or Cloudflare API tokens to the repository.
