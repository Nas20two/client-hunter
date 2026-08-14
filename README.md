# client-hunter

Nightly lead discovery + packaging pipeline for nasyhub products.

## Status

- Phase 1 (TI only) in build.
- Source strategy: AusTender `/atm` via Jina Reader primary; CN export as secondary signal.
- Compliance: per-lead approval, no auto-send, verified-email gate, suppression list. CN parser: zero external dependencies (Node.js built-in zlib + XML parser), clean supply chain.

## Canonical Repo (2026-08-14)

- **Canonical:** https://github.com/Nas20two/client-hunter (private) — owned by NaSy
- **Workflow:** Buzz agents work in branches + open PRs (NIP-34) → Kai reviews + merges → push to GitHub → GitHub Actions runs nightly cron
- **Remotes:** `origin` = GitHub (canonical), `buzz` = relay git (agent sandbox, auth via Buzz keys)
- **Rule:** `main` is protected by convention — never push directly; always branch → PR → review → merge

## GitHub Actions Secrets

| Secret | Status |
|--------|--------|
| `BUZZ_RELAY_URL` | ✅ set |
| `BUZZ_PRIVATE_KEY` | ✅ set |
| `BUZZ_AUTH_TAG` | ✅ set |
| `OPENAI_API_KEY` | ⏳ pending (needed when scorer/packager lands) |

## Docs

- `PLANS/CLIENT_HUNTER_PHASE1_TI_BUILD_BRIEF.md`
- `PLANS/CLIENT_HUNTER_ARCHITECTURE.md`
- `PLANS/CLIENT_HUNTER_UX.md`
- `PLANS/AUSTENDER_ADAPTER_SPIKE.md`

## Quick start

```bash
npm install
cp .env.example .env
npm run hunt
```
