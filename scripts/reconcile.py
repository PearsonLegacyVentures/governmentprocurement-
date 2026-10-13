#!/usr/bin/env python3
"""Reconcile source-backed project awards with official agency summary reports.

A contract awarded is not a government payment. Matches inferred from equal
totals are evidence for review, not proof of entity identity.
"""
import argparse
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
from procurement import fetch, read_xlsx, parse_amount, normalize_name, write_json

KNOWN_SUMMARIES = {
    "2026-07": "https://mofvendors.gov.bs/wp-content/uploads/2026/09/BAHAMAS-PUBLIC-PROCUREMENT-AWARDED-CONTRACTS-SUMMARY-REPORT-JULY-1-31-2026.xlsx",
}

def parse_summary(binary):
    entries = []
    reported_total = None
    audit = []
    for sheet_name, rows in read_xlsx(binary):
        parsed = 0
        for i, row in enumerate(rows, 1):
            if len(row) < 2:
                continue
            name = str(row[0] or "").strip()
            amount = parse_amount(row[1])
            if not name or amount is None:
                continue
            if name.lower() in ("total", "grand total", "total amount", "overall total"):
                reported_total = Decimal(amount)
            elif ("report" not in name.lower()) and ("summary" not in name.lower()):
                entries.append({"agency_name": name, "nominal_value": amount,
                                "sheet": sheet_name, "row": i})
                parsed += 1
        audit.append({"sheet": sheet_name, "summary_rows_found": parsed})
    return entries, reported_total, audit

def reconcile(award_rows, summary_rows):
    by_code = {}
    for a in award_rows:
        code = a.get("agency_key") or "not-listed"
        by_code[code] = by_code.get(code, Decimal(0)) + Decimal(a["amount"])
    claimed = sum((Decimal(r["nominal_value"]) for r in summary_rows), Decimal(0))
    observed = sum(by_code.values(), Decimal(0))
    mappings = []
    used_codes = set()
    for expected in summary_rows:
        candidate_codes = [k for k, v in by_code.items()
                           if abs(v - Decimal(expected["nominal_value"])) <= Decimal("0.02")]
        if len(candidate_codes) == 1 and candidate_codes[0] not in used_codes:
            code = candidate_codes[0]
            used_codes.add(code)
            mappings.append({"source_agency_name": expected["agency_name"], "raw_agency_code": code,
                             "match_type": "unique_equal_award_total", "reviewed": False})
    difference = observed - claimed
    return {"official_summary_rows": len(summary_rows), "project_award_rows": len(award_rows),
            "summary_total_nominal": str(claimed), "project_total_nominal": str(observed),
            "difference": str(difference),
            "status": "totals_match" if abs(difference) <= Decimal("0.05") else "totals_mismatch",
            "matched_agency_codes_by_amount": mappings, "unmapped_agency_codes": sorted(set(by_code) - used_codes)}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", type=Path, default=Path("data/public"))
    args = ap.parse_args()
    output = args.output
    awards_path = output / "awards.json"
    if not awards_path.exists():
        raise SystemExit("No verified awards.json available")
    award_rows = json.loads(awards_path.read_text()).get("awards", [])
    manifest_path = output / "source_manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    summary_links = dict(KNOWN_SUMMARIES)
    for report in manifest.get("reports", []):
        if report.get("report_type") == "summary" and report.get("period") and report.get("url"):
            summary_links[report["period"]] = report["url"]
    periods = sorted({r.get("report_period") for r in award_rows if r.get("report_period")})
    checks = []
    for period in periods:
        url = summary_links.get(period)
        if not url:
            checks.append({"period": period, "status": "missing_official_summary_link"})
            continue
        try:
            blob = fetch(url, retries=0)
            values, grand, audit = parse_summary(blob)
            checked = reconcile([r for r in award_rows if r.get("report_period") == period], values)
            checked.update({"period": period, "official_summary_url": url,
                            "source_sha256": hashlib.sha256(blob).hexdigest(),
                            "reported_total_row": str(grand) if grand is not None else None,
                            "audit": audit})
            checks.append(checked)
        except (RuntimeError, ValueError) as exc:
            checks.append({"period": period, "official_summary_url": url,
                           "status": "summary_unavailable", "error": str(exc)[:300]})
    write_json(output / "reconciliation.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
        "method": "Compare extracted source-row totals against the official agency summary for the same reporting period; do not infer payment or currency.",
        "caution": "Equal-value agency-code matches require independent identity verification.",
    })
    for entry in checks:
        print(entry.get("period"), entry.get("status"), entry.get("project_total_nominal"),
              entry.get("summary_total_nominal"), entry.get("difference"))
    return 0 if checks else 2

if __name__ == "__main__":
    raise SystemExit(main())
