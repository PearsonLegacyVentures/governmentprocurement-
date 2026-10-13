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
import re
from procurement import fetch, read_xlsx, parse_amount, normalize_name, write_json

KNOWN_SUMMARIES = {
    "2026-07": "https://mofvendors.gov.bs/wp-content/uploads/2026/09/BAHAMAS-PUBLIC-PROCUREMENT-AWARDED-CONTRACTS-SUMMARY-REPORT-JULY-1-31-2026.xlsx",
}

def parse_summary(binary):
    entries = []
    reported_total = None
    audit = []
    for sheet_name, rows in read_xlsx(binary):
        # The official monthly reports have been observed with values in
        # columns B, F and G. Never assume a fixed spreadsheet column.
        header_row = None
        value_col = None
        for index, row in enumerate(rows[:15]):
            for col, value in enumerate(row):
                if col > 0 and str(value or "").strip().lower() in (
                    "total", "award total", "total amount", "total awarded"):
                    header_row, value_col = index, col
                    break
            if value_col is not None:
                break
        if value_col is None:
            audit.append({"sheet": sheet_name, "status": "total_column_not_detected",
                          "summary_rows_found": 0})
            continue
        parsed = 0
        for i, row in enumerate(rows[header_row+1:], header_row+2):
            if value_col >= len(row):
                continue
            name = str(row[0] or "").strip()
            amount = parse_amount(row[value_col])
            if amount is None:
                continue
            if not name or name.lower() in ("total", "grand total", "total amount", "overall total"):
                reported_total = Decimal(amount)
            elif ("report" not in name.lower()) and ("summary" not in name.lower()):
                entries.append({"agency_name": name, "nominal_value": amount,
                                "sheet": sheet_name, "row": i})
                parsed += 1
        audit.append({"sheet": sheet_name, "status": "parsed" if parsed else "no_agency_rows",
                      "total_column_index": value_col,
                      "header_row": header_row + 1, "summary_rows_found": parsed})
    return entries, reported_total, audit

def reconcile(award_rows, summary_rows):
    by_code = {}
    for a in award_rows:
        code = a.get("agency_key") or "not-listed"
        by_code[code] = by_code.get(code, Decimal(0)) + Decimal(a["amount"])
    if not summary_rows:
        return {"official_summary_rows": 0, "project_award_rows": len(award_rows),
                "summary_total_nominal": None, "project_total_nominal": None,
                "difference": None, "status": "summary_layout_unmapped",
                "matched_agency_codes_by_amount": [], "unmapped_agency_codes": sorted(by_code)}
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

def project_signature(records):
    """Hash individual records as well as amounts before trusting a cached match."""
    values = sorted(
        (str(r.get("id", "")), str(r.get("amount", "")),
         str(r.get("source_sha256", "")))
        for r in records
    )
    return hashlib.sha256(json.dumps(values, separators=(",", ":")).encode()).hexdigest()

def cached_match(previous, signature):
    if not previous or previous.get("status") not in ("totals_match", "totals_match_cached"):
        return None
    if previous.get("project_signature") != signature:
        return None
    result = dict(previous)
    result["status"] = "totals_match_cached"
    result["cached_from_verification"] = previous.get("verified_at") or previous.get("cached_from_verification")
    return result

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
    older_path = output / "reconciliation.json"
    older = json.loads(older_path.read_text()) if older_path.exists() else {}
    prior = {c["period"]: c for c in older.get("checks", []) if c.get("period")}
    summary_links = {period: [url] for period, url in KNOWN_SUMMARIES.items()}
    for report in manifest.get("reports", []):
        if report.get("report_type") == "summary" and report.get("period") and report.get("url"):
            summary_links.setdefault(report["period"], []).append(report["url"])
    # Prefer newer official upload versions, fall back to alternatives if offline.
    def version_key(url):
        m = re.search(r"/uploads/(20\\d{2})/(\\d{2})/", url)
        return (int(m.group(1)), int(m.group(2)), url) if m else (0, 0, url)
    for period in summary_links:
        summary_links[period] = sorted(set(summary_links[period]),
                                       key=version_key, reverse=True)
    periods = sorted({r.get("report_period") for r in award_rows if r.get("report_period")})
    grouped = {p: [r for r in award_rows if r.get("report_period") == p] for p in periods}
    checks = []
    verified_at = datetime.now(timezone.utc).isoformat()
    for period in periods:
        records = grouped[period]
        signature = project_signature(records)
        candidates = summary_links.get(period, [])
        last_issue = None
        checked = None
        for url in candidates:
            try:
                blob = fetch(url, retries=0)
                values, grand, audit = parse_summary(blob)
                candidate = reconcile(records, values)
                candidate.update({"period": period, "official_summary_url": url,
                    "source_sha256": hashlib.sha256(blob).hexdigest(),
                    "reported_total_row": str(grand) if grand is not None else None,
                    "audit": audit, "project_signature": signature,
                    "verified_at": verified_at})
                if candidate["status"] == "summary_layout_unmapped":
                    last_issue = candidate
                    continue
                checked = candidate
                break
            except (RuntimeError, ValueError) as exc:
                last_issue = {"period": period, "official_summary_url": url,
                              "status": "summary_unavailable", "error": str(exc)[:300]}
        if checked is None:
            cached = cached_match(prior.get(period), signature)
            if cached:
                checked = cached
            elif last_issue is not None:
                checked = {**last_issue, "project_signature": signature}
            else:
                checked = {"period": period, "status": "missing_official_summary_link",
                           "project_signature": signature}
        checks.append(checked)
    write_json(output / "reconciliation.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
        "method": "Compare extracted source-row totals against the official agency summary for the same reporting period; do not infer payment or currency.",
        "caution": "Equal-value agency-code matches require independent identity verification. Cached matches apply only when row IDs, source hashes and values remain unchanged.",
    })
    for entry in checks:
        print(entry.get("period"), entry.get("status"), entry.get("project_total_nominal"),
              entry.get("summary_total_nominal"), entry.get("difference"))
    return 0 if checks else 2

if __name__ == "__main__":
    raise SystemExit(main())
