# shr.rip — Release Checklist

Use this checklist before pointing production DNS at the hosted service.

## 1. Build and test

- [ ] `make check` passes locally and in CI
- [ ] `make release` produces a working `shr` binary
- [ ] `shr --local` works end-to-end on LAN (browser receive)
- [ ] `shr get` works for local, live, and stored shares

## 2. Cloudflare resources

Create and wire these before first deploy:

| Resource | Wrangler binding | Notes |
|----------|------------------|-------|
| Worker | `shr-worker` | API + browser app |
| Durable Object | `LIVE_SHARE` | One instance per live share |
| D1 database | `DB` | Stored-share metadata |
| R2 bucket | `STORED` | Encrypted ciphertext only |

### First-time setup

```bash
cd worker
npm install

# Create D1 (replace placeholder database_id in wrangler.jsonc)
wrangler d1 create shr-db
wrangler d1 migrations apply shr-db --remote

# Create R2 bucket
wrangler r2 bucket create shr-stored

# Deploy
npm run deploy
```

Update `worker/wrangler.jsonc` with real `database_id` values before deploying.

### Secrets and vars

No secrets are required for the MVP Worker itself. Optional tuning:

- Set `IP_HASH_KEY` as a Worker secret if you want stable IP hashing across deploys (see `worker/src/ip-hash.ts`).

## 3. DNS and domain

- [ ] Domain `shr.rip` (or your domain) is on Cloudflare
- [ ] Worker route covers `shr.rip/*` (automatic with custom domain in Workers dashboard)
- [ ] TLS is active (Cloudflare proxy or Workers custom domain)

## 4. Pre-launch benchmarks

Run automated smoke checks against your deployed or local Worker:

```bash
export SHR_API_URL=https://shr.rip   # or http://127.0.0.1:8787
make bench
```

Manual validation gates (from roadmap):

- [ ] Durable Object relay handles realistic file sizes without timeouts
- [ ] Relay cost profile is acceptable for expected traffic
- [ ] R2 multi-chunk upload/download works from CLI and browser
- [ ] Cold-start latency for first receiver page load is acceptable
- [ ] PIN rate limits and cooldowns trigger under abuse simulation

See `scripts/bench/README.md` for detailed benchmark procedures.

## 5. Security review

Work through [SECURITY.md](SECURITY.md) before public launch.

Critical items:

- [ ] Relay and storage never receive plaintext
- [ ] URL fragments and capability secrets are not logged
- [ ] PIN throttling works (3 failures → cooldown per IP per share)
- [ ] Cross-share IP probing triggers global cooldown
- [ ] Expired shares return deterministic errors; cleanup cron runs hourly
- [ ] Local mode does not fetch hosted assets

## 6. Post-deploy smoke test

```bash
export SHR_API_URL=https://shr.rip

# Health
curl -s "$SHR_API_URL/api/v1/health" | jq .

# Live share
shr test.zip
# Open printed link in browser, enter PIN, download

# Stored share
shr --keep test.zip
# Open link with fragment, enter PIN, download

# CLI receive
shr get '<url>' --pin <pin>
```

## 7. Release artifacts

Tag and publish CLI binaries when ready:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The GitHub release workflow builds macOS and Linux binaries automatically.

## 8. Rollback plan

- Worker: redeploy previous version with `wrangler rollback` or redeploy prior git tag
- D1: migrations are forward-only; test migrations on a staging D1 first
- R2: expired object cleanup is idempotent; no urgent rollback needed for storage

## 9. Monitoring

After launch, watch:

- Worker error rates and p99 latency (Cloudflare dashboard)
- Durable Object alarm failures
- D1 query errors
- R2 egress volume
- Failed PIN / abuse cooldown metrics in Worker logs (no plaintext PINs)
