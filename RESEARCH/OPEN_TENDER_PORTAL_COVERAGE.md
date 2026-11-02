---
title: "Open-Tender Portal Coverage Map — Australia (federal + NSW/VIC/QLD/WA/SA)"
tags: [research, austender, procurement, portals, coverage]
status: active
created: 2026-11-02
---

# Open-Tender Portal Coverage Map — Australia

**Purpose:** Decide which Australian government procurement portals are machine-readable enough to build adapters for, before writing any adapter code. Every claim below was verified by an actual fetch on **2026-11-02** (see "Verified" lines — URL + observed HTTP result). Raw response bodies retained in the author's scratch dir.

**Target verticals (commercial lens):** defence, apparel/uniforms, PPE, IT services.

**Existing repo state (as of this research):** AusTender `/atm` is fetched via Jina Reader (`src/adapters/austender-atm.ts`) because direct fetch was believed CloudFront-blocked; CN weekly xlsx export is parsed (`austender-cn.ts`). **Key finding: the `/atm` CloudFront block is User-Agent-dependent — a realistic browser UA now returns 200 directly, making Jina unnecessary for AusTender.** State portals (NSW/VIC/QLD/WA/SA) claimed but unbuilt. NSW has migrated off `tenders.nsw.gov.au` to **`buy.nsw.gov.au`**.

---

## Ranking (accessibility × commercial value)

| # | Portal | Open tenders | Machine access | Wall | Cheapest working method | Priority |
|---|--------|-------------|----------------|------|-------------------------|----------|
| 1 | **AusTender (federal)** | ✅ 120 live ATMs | ✅ Server-rendered HTML | CloudFront (UA-sensitive; browser UA passes) | Direct HTTP with browser UA | **BUILD NOW** |
| 2 | **NSW — buy.nsw.gov.au** | ✅ 186 open opportunities (EOI/RFT) | ✅ Server-rendered HTML | AWS WAF challenge under request bursts | Direct HTTP at low rate; **Jina Reader as bypass** | **BUILD NOW** |
| 3 | **VIC — tenders.vic.gov.au** | ✅ Open RFx (EOI/RFT) | ⚠️ HTML behind CF; Jina renders it | Cloudflare 403 direct | **Jina Reader** | **BUILD NOW** |
| 4 | **WA — Tenders WA** | ✅ Current tenders | ⚠️ Session + CSRF-nonce POST (Java/Struts) | None | Direct HTTP w/ cookie jar + nonce | **BUILD (med effort)** |
| 5 | **SA — Tenders & Contracts SA** | ✅ exists, unreachable | ❌ Jina partial (homepage only) | Cloudflare + Turnstile | None established; needs stealth browser | **DEFER / spike** |
| 6 | **QLD — QTenders** | Presumed in-app | ❌ Blazor WASM shell only | JS-walled (WASM) | None; needs browser automation / WASM API reverse-engineering | **DEFER / spike** |

Rationale for value: AusTender covers every federal agency incl. Defence (defence vertical) and all IT services categories in one feed. NSW + VIC are the two biggest state markets for IT services (both expose agency/category + close dates). WA has a live Apparel category and no wall. SA/QLD are medium/large spenders but currently inaccessible → defer until a browser-automation spike is funded.

---

## 1. Federal — AusTender `tenders.gov.au`

- **Base URL:** https://www.tenders.gov.au/
- **Open tenders listed?** ✅ Yes — `/atm` renders a searchable list of **published ATMs**. Verified: `GET https://www.tenders.gov.au/atm` → **200**, 142 KB, "Showing 1-15 of **120** records" with per-card: Title, ATM ID, Close Date & Time (ACT local), Agency, Category, Description, Last Updated. Pagination verified: `GET /atm?page=2` → **200**.
  - Record deep link: `GET https://www.tenders.gov.au/Atm/Show/f9643d84-c472-42c4-83e4-a36b5725ce58` → **200** (106 KB). List cards link to `/Atm/Show/{guid}` and `/Advert/Show/{guid}`.
  - Search params (GET form on `/atm`): `Number` (ATM ID), `Keyword`, `filter=published` (hidden), `OrderBy` (Close Date & Time - Ascending/Descending, Title, ATM ID, Agency, Category, Last Updated).
- **Awarded contracts (CN) / standing offers (SON):** ✅ directly fetchable too: `GET /cn/search` → 200 (119 KB), `GET /son/search` → 200 (120 KB).
- **JSON/CSV/RSS/API endpoint?** No public JSON API found — probes returned 404/302: `/api/atm`, `/odata`, `/Atm/GetAtms`. **Weekly xlsx export (CN only):** `GET https://www.tenders.gov.au/Reports/CnWeeklyExportList` → **200**; download `GET /Reports/CnWeeklyExportDownload/{guid}` (e.g. `a3c7a778-3ee3-48f5-b4e9-7e77c17fae9e`, week 25-Oct-26…31-Oct-26) → **200**, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, 252 KB (PK zip = xlsx). **No ATM weekly export**: `GET /Reports/AtmWeeklyExportList` → 302 → `/file-not-found`.
- **Cloudflare / JS wall?** CloudFront, **not** JS-walled. No-UA `curl` → **403** "The request could not be satisfied" (CloudFront). With a browser User-Agent → **200**. So: UA-sensitive WAF, zero JS execution needed.
- **Cheapest working access:** direct HTTP with a realistic browser UA (`Mozilla/5.0 … Chrome/126`). Jina Reader also works (existing adapter) but is unnecessary overhead here.
- **Robots note:** `GET /robots.txt` → 200; disallows `/Search/*`, `/Reports/*`, `/Cn/List*`, `/Son/List*`, `/admin*` (crawl etiquette for production scraper).

## 2. NSW — `buy.nsw.gov.au` (replaced tenders.nsw.gov.au)

- **Base URL:** https://buy.nsw.gov.au/ — `GET https://tenders.nsw.gov.au/` → **301** → `https://www.tenders.nsw.gov.au/` → **301** → `buy.nsw.gov.au` (F5/BigIP -> New South Wales platform; verified 2 hops).
- **Open tenders listed?** ✅ Yes — `/opportunity/search/` = "All opportunities". Verified direct `GET https://buy.nsw.gov.au/opportunity/search/` → **200**, "Displaying 1-10 of **186** results", each item has **Closes:** datetime, categories, reference ID, description, opportunity type (**Expression of interest / Request for tender**), agency, deep link `/prcOpportunity/{guid}`. Example: "Geospatial Intelligence Platform", closes 17-Nov-2026 15:00, NSW Police Force, ref YR-2026-0065 (EOI); "MR56 Natural Disaster Repairs …" RFT, Transport Infrastructure Projects, closes 20-Nov-2026.
- **Notice registry:** `/notices/search` = "All notices" (18,799 total). Notice types (across `can`/`son`/`app`/`pic`/`rev`): **Contract award** (CAN IDs; 15,807 under `?noticeTypes=can` — includes supplier name, agency, category, publish date, contract period, **estimated amount incl. GST**, ABN-owner flags), **Standing offer** (SON), **Planned procurement** (PP IDs; 337 under `?noticeTypes=app`, "Estimated date of approach to market"), Public interest certificate, Sale/lease of property. Pagination: `?page=N&noticeTypes=X&mode=regular`.
- **JSON/CSV/RSS/API endpoint?** Not found — HTML only. `/notices/notice-reports` exists (potential reporting/download surface) but was WAF-challenged during testing; needs follow-up.
- **Cloudflare / JS wall?** AWS WAF on CloudFront. Verified: low-frequency direct GETs → **200** (server-rendered); a burst of rapid requests → **202** with header `x-amzn-waf-action: challenge` (empty body — JS challenge). Jina Reader bypasses it completely: `https://r.jina.ai/https://buy.nsw.gov.au/notices/search?noticeTypes=can` → **200**, full markdown of CAN results w/ amounts; `…/opportunity/search/` → **200**, all 186 opportunities with close dates.
- **Cheapest working access:** direct curl at low rate (1 request per few seconds) with browser UA; **Jina Reader as the reliable bypass** (same pattern the repo already uses for AusTender). Note `robots.txt` disallows `/search` only.

## 3. VIC — `tenders.vic.gov.au` (Buying for Victoria Tenders Portal, fka TendersVIC)

- **Base URL:** https://www.tenders.vic.gov.au/ — marketing site **buyingfor.vic.gov.au** (Drupal; `robots.txt` shows Drupal path schema; `/browse-tenders`, `/close-tenders` = guidance pages only) links "View advance notices" → `https://www.tenders.vic.gov.au/login/` (verified link in `/browse-tenders` HTML). The real tendering system is `tenders.vic.gov.au`.
- **Open tenders listed?** ✅ Yes — `GET https://www.tenders.vic.gov.au/tender/search?preset=open` (rendered via Jina) lists open RFx: **RFx Number** (e.g. `PROCF22-000236`, `PROCF23-149`, `ITR-SS-05-2018`), Status **Open**, Type (**Expression of Interest / Request for Tender**), **Issued by** agency (TAC, Department of Treasury…), **UNSPSC** code + description, **Opened / Closing** datetimes. Presets: `open`, `electronic`, `future`, `closed`, `new`.
- **JSON/CSV/RSS/API endpoint?** Not found.
- **Cloudflare / JS wall?** Cloudflare bot-management: direct `GET https://www.tenders.vic.gov.au/` with browser UA → **403** "Attention Required! | Cloudflare". **Jina Reader passes** (verified twice: homepage → 200 "Buying for Victoria Tenders Portal (formerly TendersVIC)"; `/tender/search?preset=open` → 200, full RFx listing).
- **Cheapest working access:** **Jina Reader** on `/tender/search?preset=open` (+ paging params to discover during adapter work). Direct curl is blocked.

## 4. QLD — QTenders `qtenders.hpw.qld.gov.au`

- **Base URL:** https://qtenders.hpw.qld.gov.au/ → **200**, but the body is a **Blazor WebAssembly SPA shell** (25 KB; `_framework/blazor.webassembly.w3qd1tpl0e.js`, Telerik UI for Blazor/Kendo theme, `autostart="false"` custom asset loader). No server-rendered content on any path.
- **Open tenders listed?** Public QTenders does list tenders (site is Queensland's official queue) — but **not machine-accessible**: every probed path (`/tender/search`, `/api/tender/search`, `/api/tenders`, `/TenderApi/tender/search`, `/api/reference/categories`, `/qtenders`, `/home`) returned the same **200 SPA shell** (all `text/html` — SPA fallback; no JSON endpoints found by probing with `Accept: application/json`).
- **JSON/CSV/RSS/API endpoint?** None discoverable without running the WASM app: `/_framework/blazor.boot.json` → **404** (and versioned variant → **404**, though the loader js itself is 200).
- **Cloudflare / JS wall?** **JS-walled (Blazor WASM)**. Jina Reader attempted to render it → "An unhandled error has occurred" (WASM app fails in headless renderer). Plain HTTP gives only the shell.
- **Cheapest working access:** none today. Needs a dedicated spike: Playwright/headless browser driving the WASM UI, or reverse-engineering the app's XHR API from the WASM/JS bundle. **Do not build an adapter before that spike.**

## 5. WA — Tenders WA `tenders.wa.gov.au`

- **Base URL:** https://www.tenders.wa.gov.au/ → **200** (210 B meta-refresh → `https://www.tenders.wa.gov.au/watenders/index.do` → **200** "Tenders WA"). Java/Struts2 web app (`*.action` + Velocity `*.vm`, CSRF nonces, F5 BigIP).
- **Open tenders listed?** ✅ Yes, server-rendered search: `GET /watenders/tender/search/tender-search.action?action=search-from-main-page` → **200** (68 KB search form: keyword, tender code/title, opening/closing/award date ranges, UNSPSC L1-L3, region, agency, status filter incl. **Current**, category dropdown w/ live counts e.g. "Apparel and Luggage and Personal Care Products (1)"). **Search executes server-side**: `POST …/tender-search.action?CSRFNONCE={session}&noreset=yes&action=do-advanced-tender-search` with an empty criteria set → **200** (140 KB) with "The results have been reduced as there are too many records matching your selection" (i.e. the backend returned matches; unqualified searches are truncated). Also: contract search `/watenders/contract/list.action?action=contract-search` on the same platform.
- **JSON/CSV/RSS/API endpoint?** Not found on-page (no export/RSS links in tested HTML).
- **Cloudflare / JS wall?** None — no Cloudflare/AWS WAF detected; HTML is server-rendered. Requires **session cookies + per-session CSRF nonce** (nonce rotates every response; `TenderSearch.js` sets `action=do-advanced-tender-search`).
- **Cheapest working access:** direct HTTP with cookie jar: GET search page (capture nonce) → POST with `action=do-advanced-tender-search`, `viaSearchButton=true`, status=Current + minimal fields to avoid truncation. Medium effort — a session-aware fetcher, no browser needed.

## 6. SA — SA Tenders and Contracts `tenders.sa.gov.au`

- **Base URL:** https://www.tenders.sa.gov.au/ — **403** "Attention Required! | Cloudflare" for every UA tested (curl/8.0, Chrome 120 Windows, Googlebot 2.1) → IP-reputation + bot-management block, not UA-based.
- **Open tenders listed?** Yes on the platform, but guarded: Jina-rendered homepage (200) exposes nav — "View Current Tenders" = `/tender/search?preset=open`, presets `open`/`electronic`/`future`/`closed`/`new`; contract search `/contract/search`; same portal family as VIC. But `GET /tender/search?preset=open` via Jina → **403 "Just a moment… Enable JavaScript and cookies to continue"** (Cloudflare Turnstile challenge even for Jina's egress).
- **JSON/CSV/RSS/API endpoint?** Not found; not reachable to test deeper.
- **Cloudflare / JS wall?** **Yes — Cloudflare bot-management + Turnstile** on tender subpaths (homepage passes Jina; search does not).
- **Cheapest working access:** not established from this environment. Candidates for a spike: stealth browser (Playwright + CF-bypass trickery) or a human-operated export where available. **Do not build a plain-HTTP adapter.**

---

## Adapter implications (short)

1. **AusTender ATM:** replace the Jina base in `austender-atm.ts` with direct fetch + browser UA (or keep Jina as fallback). Parse stays the same; add `page` iteration; `filter=published` = open list; deep links `/Atm/Show/{guid}` now resolvable (better evidence than list-URL).
2. **NSW opportunities:** new adapter — hit `buy.nsw.gov.au/opportunity/search/` (low rate) or Jina; fields: title, closes, type (EOI/RFT), agency, ref, `/prcOpportunity/{guid}` deep link. Bonus: CAN feed (`/notices/search?noticeTypes=can`) = awarded-contract spend intelligence with amounts.
3. **VIC:** new adapter — Jina on `tenders.vic.gov.au/tender/search?preset=open`; fields: RFx number, agency, UNSPSC, open/close dates.
4. **WA:** new adapter — cookie jar + CSRF nonce POST; filter status=Current; watch truncation (add date-range or category constraints).
5. **SA / QLD:** no adapter until a browser-automation spike proves a cheap path. Recommended spike order: **QLD** (biggest IT spend of the two, single official portal) → SA.

## Appendix — verification log (2026-11-02, all fetched from this machine)

| URL | Result |
|-----|--------|
| https://www.tenders.gov.au/ | 403 (no UA) / **200** (browser UA) |
| https://www.tenders.gov.au/atm | 200, "1-15 of 120 records" |
| https://www.tenders.gov.au/atm?page=2 | 200 |
| https://www.tenders.gov.au/Atm/Show/f9643d84-c472-42c4-83e4-a36b5725ce58 | 200 (106 KB detail) |
| https://www.tenders.gov.au/cn/search · /son/search | 200 / 200 |
| https://www.tenders.gov.au/Reports/CnWeeklyExportList | 200; downloads `CnWeeklyExportDownload/{guid}` → 200 xlsx (252 KB) |
| https://www.tenders.gov.au/Reports/AtmWeeklyExportList | 302 → file-not-found |
| https://www.tenders.gov.au/api/atm · /odata | 404 / 404 |
| https://tenders.nsw.gov.au/ | 301 → www → 301 → buy.nsw.gov.au |
| https://buy.nsw.gov.au/opportunity/search/ | 200, "1-10 of 186 results" |
| https://buy.nsw.gov.au/notices/search (~burst) | 202, `x-amzn-waf-action: challenge` |
| https://r.jina.ai/https://buy.nsw.gov.au/notices/search?noticeTypes=can | 200, 15,807 CAN results |
| https://r.jina.ai/https://buy.nsw.gov.au/opportunity/search/ | 200, 186 opportunities |
| https://www.buyingfor.vic.gov.au/browse-tenders | 200 (Drupal guidance; links to tenders.vic.gov.au) |
| https://www.tenders.vic.gov.au/ | 403 Cloudflare |
| https://r.jina.ai/https://www.tenders.vic.gov.au/tender/search?preset=open | 200, open RFx list |
| https://qtenders.hpw.qld.gov.au/ | 200 Blazor shell (25 KB) |
| https://qtenders.hpw.qld.gov.au/_framework/blazor.boot.json (+versioned) | 404 |
| https://r.jina.ai/https://qtenders.hpw.qld.gov.au/ | 200, "An unhandled error has occurred" |
| https://www.tenders.wa.gov.au/ | 200 → /watenders/index.do → 200 |
| https://www.tenders.wa.gov.au/watenders/tender/search/tender-search.action?action=search-from-main-page | 200 (68 KB form) |
| POST tender-search.action (action=do-advanced-tender-search, session nonce) | 200 (140 KB, "too many records" truncation msg) |
| https://www.tenders.sa.gov.au/ | 403 Cloudflare (curl, Chrome, Googlebot UAs) |
| https://r.jina.ai/https://www.tenders.sa.gov.au/ | 200 (homepage nav only) |
| https://r.jina.ai/https://www.tenders.sa.gov.au/tender/search?preset=open | 403 "Just a moment…" (Turnstile) |
