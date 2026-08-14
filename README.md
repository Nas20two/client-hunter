# client-hunter

Nightly lead discovery + packaging pipeline for nasyhub products.

## Status

- Phase 1 (TI only) in build.
- Source strategy: AusTender `/atm` via Jina Reader primary; CN export as secondary signal.
- Compliance: per-lead approval, no auto-send, verified-email gate, suppression list. CN parser: zero external dependencies (Node.js built-in zlib + XML parser), clean supply chain.

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
