# Bahamas Government Procurement Intelligence

A **source-backed, internal-first procurement intelligence workspace** for Pearson Legacy Ventures (PLV), built around official Bahamas government tender and award reports.

**Project status:** initial ingestion and dashboard working, historical expansion in progress. This repository is PUBLIC, but the future private portal is **not deployed** and no confidential PLV bid notes are stored here.

## What works today

- Download official Ministry of Finance **Project Awards** Excel workbooks using network-connected GitHub Actions.
- Extract awarded vendor names, agency codes, award values, project types, dates and descriptions with verifiable source URLs, original row positions and file SHA-256 checksums.
- Import public award records as JSON; reject invalid XLSX responses and quarantine unknown layouts.
- Compare the Project Awards totals against the official **Awarded Contracts Summary** for each reporting month that has a summary link. Previously verified reconciliations may be reused only when the source-record signature is unchanged; cached periods are explicitly flagged.
- Explore source records in a read-only dashboard with searches, filters, top suppliers, agencies, agency group totals and CSV exports.
- Open on a **personalized Opportunity Brief**, which ranks the strongest title-based matches for PLV ventures before displaying historical contract records. It separates direct service signals, realistic partner leads, and weak sector watches; adds due-date urgency, an explicit next action, and an official tender link. This uses a **dated capture**, not real-time guaranteed tender availability.
- Review the complete source-backed **Opportunity Radar** with published Bonfire references, dates, buyer names, and explainable matches to PLV businesses below the short brief. A weak keyword overlap is not treated as a bid recommendation.
- Run automated Python tests and dashboard JavaScript checks.
- Attempt broader historical imports each **Monday**, with audit artifacts saved even if an import fails.

### Historical dataset and quality filters

All official records are preserved in `data/public/awards.json`. A separate `quality_report.json` records the eligibility of each row for comparative financial rankings. The dashboard defaults to **Reconciled only**, with a filter to inspect all source rows, missing dates or mismatched summaries. The `analytics.json` ranking file uses the same quality gate. This distinction is essential for large undated legacy reports and files whose totals differ from the government's monthly summary.

### First validated dataset

The July 2026 Project Awards workbook yielded **170 award records** and **129 normalized supplier names** across **22 agency codes**. The project-row nominal total (**29,402,595.24**) matches the government's July awarded-contract summary within floating-point tolerance. This is **reported award value, not cash paid**, and some original contract titles contain "Duplicate". Preserve those source rows until the underlying tender and award references are reviewed.

[Source July Project Awards](https://mofvendors.gov.bs/wp-content/uploads/2026/09/BAHAMAS-PUBLIC-PROCUREMENT-PROJECT-AWARDS-REPORT-JULY-1-31-2026.xlsx) · [Source July Summary](https://mofvendors.gov.bs/wp-content/uploads/2026/09/BAHAMAS-PUBLIC-PROCUREMENT-AWARDED-CONTRACTS-SUMMARY-REPORT-JULY-1-31-2026.xlsx)

## Opportunity Brief usage

Open the site and begin with the **Your Opportunity Brief** section. Start with direct service signals; review partner leads only when a qualified prime or subcontracting role is credible. Sector watches are research signals, not actions to bid. The initial shortlist uses only the published tender title, a known business offering and deadline proximity. It does not establish scope, budget, eligibility, margin or likelihood of winning. Open the official tender before making a bid/no-bid decision.

**Proactive outbound notifications are not enabled.** The current branch improves prioritization *inside the app*. Automatic email or WhatsApp alerts will require a verified current listing feed, delivery service, recipient preferences, duplicate suppression and alert thresholds. Never label the snapshot as live. The website remains a public, read-only dataset until the Cloudflare private API is configured.

## Opportunity Radar without Cloudflare tokens

The October 13 Bonfire browser-observed listing snapshot is preserved in `data/sources/bonfire-2026-10-13.json`. It contains official tender URLs, titles, agencies and deadlines only. The `scripts/radar.mjs` normalization tool rejects non-Bonfire URLs, invalid deadlines and repeated IDs; its keyword-based PLV matches are documented research leads, not bid eligibility opinions.

```bash
node --test tests/radar.test.mjs
node scripts/radar.mjs data/sources/bonfire-2026-10-13.json data/public/opportunities.json
```

The checked-in normalized snapshot is displayed on the Opportunity Radar screen, together with the source date, expiry state and official Bonfire links. **The date must advance only when a new official listing scan has actually occurred.** Do not reuse an old snapshot and claim to have checked today.

## Deploy to Cloudflare Pages

Use build command `node scripts/build-site.mjs`, output directory `dist`, root directory blank, and production branch `main`. See [Cloudflare private deployment and D1/Access setup](docs/CLOUDFLARE_DEPLOY.md). **Do not enter bid strategies or real contact details until the private API session check succeeds.**

## View the working dashboard locally

From the repository root:

```bash
python -m http.server 8000
```

Open **http://localhost:8000/dashboard/** in a browser.

The dashboard consumes the checked-in files under `data/public/`. It is **not authenticated** and is not suitable for confidential notes; those belong in a later private product.

## Run the data pipeline

```bash
python -m unittest discover -s tests -v
python scripts/procurement.py --output data/public --max-pages 80 --max-reports 100
python scripts/reconcile.py --output data/public
python scripts/analytics.py --output data/public
```

The `Import Bahamas award reports` workflow is scheduled weekly and can be dispatched manually from GitHub Actions. The `Bootstrap July 2026` workflow is a separate, quick, proven single-report recovery path.

**Data contracts:** `awards.json`, `source_manifest.json`, `import_status.json`, `reconciliation.json`, `analytics.json`, `quality_report.json`.

## Development roadmap

1. **Source coverage and QA:** backfill all accessible monthly awards; reconcile each against agency summaries; publish missing-month diagnostics.
2. **Official tender linking:** ingest Bonfire open and past tenders and match with citations, not fuzzy guesses.
3. **Entity resolution:** review aliases and resolve agency abbreviations against official records.
4. **Internal private application:** authentication, private PLV opportunity notes, fit scores, deadlines and watchlists.
5. **Commercial version:** consider a public-facing subscription product once data rights, consistency and buyer demand are established.

See [Architecture](docs/ARCHITECTURE.md) and [Data Policy](docs/DATA_POLICY.md) for safeguards and implementation details.
