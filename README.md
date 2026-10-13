# Bahamas Government Procurement Intelligence

A **source-backed, internal-first procurement intelligence workspace** for Pearson Legacy Ventures (PLV), built around official Bahamas government tender and award reports.

**Project status:** initial ingestion and dashboard working, historical expansion in progress. This repository is PUBLIC, but the future private portal is **not deployed** and no confidential PLV bid notes are stored here.

## What works today

- Download official Ministry of Finance **Project Awards** Excel workbooks using network-connected GitHub Actions.
- Extract awarded vendor names, agency codes, award values, project types, dates and descriptions with verifiable source URLs, original row positions and file SHA-256 checksums.
- Import public award records as JSON; reject invalid XLSX responses and quarantine unknown layouts.
- Compare the Project Awards totals against the official **Awarded Contracts Summary** for each reporting month that has a summary link.
- Explore source records in a read-only dashboard with searches, filters, top suppliers, agencies, agency group totals and CSV exports.
- Run automated Python tests and dashboard JavaScript checks.
- Attempt broader historical imports each **Monday**, with audit artifacts saved even if an import fails.

### First validated dataset

The July 2026 Project Awards workbook yielded **170 award records** and **129 normalized supplier names** across **22 agency codes**. The project-row nominal total (**29,402,595.24**) matches the government's July awarded-contract summary within floating-point tolerance. This is **reported award value, not cash paid**, and some original contract titles contain "Duplicate". Preserve those source rows until the underlying tender and award references are reviewed.

[Source July Project Awards](https://mofvendors.gov.bs/wp-content/uploads/2026/09/BAHAMAS-PUBLIC-PROCUREMENT-PROJECT-AWARDS-REPORT-JULY-1-31-2026.xlsx) · [Source July Summary](https://mofvendors.gov.bs/wp-content/uploads/2026/09/BAHAMAS-PUBLIC-PROCUREMENT-AWARDED-CONTRACTS-SUMMARY-REPORT-JULY-1-31-2026.xlsx)

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
python scripts/procurement.py --output data/public --max-pages 45 --max-reports 40
python scripts/reconcile.py --output data/public
```

The `Import Bahamas award reports` workflow is scheduled weekly and can be dispatched manually from GitHub Actions. The `Bootstrap July 2026` workflow is a separate, quick, proven single-report recovery path.

**Data contracts:** `awards.json`, `source_manifest.json`, `import_status.json`, `reconciliation.json`.

## Development roadmap

1. **Source coverage and QA:** backfill all accessible monthly awards; reconcile each against agency summaries; publish missing-month diagnostics.
2. **Official tender linking:** ingest Bonfire open and past tenders and match with citations, not fuzzy guesses.
3. **Entity resolution:** review aliases and resolve agency abbreviations against official records.
4. **Internal private application:** authentication, private PLV opportunity notes, fit scores, deadlines and watchlists.
5. **Commercial version:** consider a public-facing subscription product once data rights, consistency and buyer demand are established.

See [Architecture](docs/ARCHITECTURE.md) and [Data Policy](docs/DATA_POLICY.md) for safeguards and implementation details.
