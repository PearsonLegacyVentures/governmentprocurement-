# Bahamas Procurement Intelligence: architecture

## Mission
Build an internal-first, provenance-backed government procurement intelligence platform: who buys, what they buy, who receives reported awards, the disclosed amounts, and patterns in repeat categories. First operator: Pearson Legacy Ventures. A separate public product comes **after** coverage, quality and commercial validation.

## Phase 1 (active): official data ingestion
- Discover official Ministry of Finance award notices and Project Awards/Summary Excel workbooks.
- Preserve source notice URL, workbook URL, file hash, reporting period, source worksheet and row.
- Reject HTML posing as XLSX. Quarantine unrecognized columns, report errors, and never manufacture award records.
- Export versioned JSON only when there are successfully parsed award rows.
- Next: verify currency, verify header mappings against real source workbooks, and reconcile project totals to government summaries.

## Phase 2: cross-reference tenders
- Import Bonfire open and historical opportunity metadata via permitted access.
- Link awards to tenders only with source references or reviewed candidate matches.
- Preserve supplier aliases separately from official raw names.

## Phase 3: private authenticated portal
Spending overview; contract award explorer; supplier profiles; agency profiles; seasonal procurement analysis; opportunity alerts; PLV bid pipeline. Confidential notes and bid strategies must live in a separate **private datastore**, never in this public repository.

## Phase 4: evaluate product
Assess actual supplier demand, data availability/licensing, pricing, confidentiality and uptime before launching publicly.

## Run and test
```bash
python -m unittest discover -s tests -v
python scripts/procurement.py --output data/public --max-pages 45 --max-reports 40
```
GitHub Actions runs tests and ingestion every Monday, and stores an ingestion audit artifact even when imports fail. An unsuccessful run does not overwrite committed awards.

## Data interpretation
- Report publication can lag award reporting period.
- A closed Bonfire opportunity is not evidence of an award.
- Award amounts are not evidence of payment or supplier profit.
- Currency stays unspecified until verified.
- A raw nominal sum is only diagnostic and must not be advertised as total government spending.
