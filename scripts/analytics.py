#!/usr/bin/env python3
"""Build transparent, non-predictive supplier and procurement analytics."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
import re

STOP = {"the", "and", "for", "of", "to", "in", "at", "a", "an", "on"}
CATEGORIES = {
    "Agriculture": r"\b(feed|poultry|agricultur\w*|farm\w*|fertiliz\w*|crop\w*|livestock|calcium)\b",
    "Software & IT": r"\b(software|website|computer\w*|network\w*|digitiz\w*|information system|database|server\w*|cyber|ict|technology)\b",
    "Wellness": r"\b(fitness|wellness|massage|spa|physical activity|exercise\w*)\b",
    "Events & Hospitality": r"\b(event\w*|venue|audio|banquet|conference\w*|catering|tent\w*|chair rental|staging)\b",
    "Facilities & Maintenance": r"\b(maintenance|cleaning|landscap\w*|air condition\w*|generator|fumigation|repair\w*|servicing)\b",
    "Infrastructure & Materials": r"\b(bitumen|aggregate\w*|asphalt|construction|road\w*|concrete|build\w*|materials|paving)\b",
    "Equipment & Supplies": r"\b(equipment|furniture|office suppl\w*|uniform\w*|vehicle\w*|purchas\w*|supplies)\b",
}

def classify(text):
    t = (text or "").lower()
    return next((name for name, pattern in CATEGORIES.items() if re.search(pattern, t)), "Other / Unclassified")

def prefix(text):
    if not text or re.search(r"(?i)\bduplicate\b", text):
        return None
    words = [x for x in re.findall(r"[a-z]+", text.lower()) if x not in STOP]
    return " ".join(words[:5]) if len(words) >= 3 else None

def quality_of(record, summary_checks):
    """Classification for financial comparison, not a judgment on awards."""
    if not record.get("award_date_iso"):
        return "undated"
    check = summary_checks.get(record.get("report_period")) or {}
    return {
        "totals_match": "reconciled",
        "totals_match_cached": "reconciled",
        "totals_mismatch": "summary_mismatch",
        "summary_layout_unmapped": "summary_unmapped",
        "summary_unavailable": "summary_unavailable",
        "missing_official_summary_link": "no_summary",
    }.get(check.get("status"), "no_summary")

def aggregate(rows):
    suppliers = defaultdict(lambda: {"rows":0,"value":Decimal(0),"periods":set(),"agencies":set(),"names":set()})
    agencies = defaultdict(lambda: {"rows":0,"value":Decimal(0),"periods":set(),"names":set()})
    monthly = defaultdict(lambda: {"rows":0,"value":Decimal(0),"suppliers":set(),"agencies":set()})
    categories = defaultdict(lambda: {"rows":0,"value":Decimal(0)})
    families = defaultdict(lambda: {"rows":0,"value":Decimal(0),"periods":set(),"titles":set()})
    duplicates = 0
    for r in rows:
        val = Decimal(r["amount"])
        sid = r.get("supplier_key") or "unknown"
        aid = r.get("agency_key") or "unknown"
        period = r.get("report_period") or "unmapped"
        sv, av, mv = suppliers[sid], agencies[aid], monthly[period]
        sv["rows"] += 1; sv["value"] += val; sv["periods"].add(period); sv["agencies"].add(aid); sv["names"].add(r["supplier_raw"])
        av["rows"] += 1; av["value"] += val; av["periods"].add(period); av["names"].add(r.get("agency_raw") or "Unknown")
        mv["rows"] += 1; mv["value"] += val; mv["suppliers"].add(sid); mv["agencies"].add(aid)
        cv = categories[classify(r.get("description"))]
        cv["rows"] += 1; cv["value"] += val
        if re.search(r"(?i)\bduplicate\b", r.get("description") or ""):
            duplicates += 1
        title = prefix(r.get("description"))
        if title and ".." not in period and period != "unmapped":
            fv = families[(aid,title)]
            fv["rows"] += 1; fv["value"] += val; fv["periods"].add(period)
            if len(fv["titles"]) < 5: fv["titles"].add(r["description"])
    def group(d):
        result = [{"key":k,"nominal_value":str(v["value"]),"award_rows":v["rows"],
                   "period_count":len(v["periods"]),"raw_names":sorted(v["names"])}
                  for k,v in d.items()]
        return sorted(result,key=lambda x:(Decimal(x["nominal_value"]),x["award_rows"]),reverse=True)
    repeats = [{"agency_code":agency,"project_title_prefix":title,"award_rows":v["rows"],
                "months_observed":sorted(v["periods"]),"nominal_value":str(v["value"]),"examples":sorted(v["titles"])}
               for (agency,title),v in families.items() if v["rows"] >= 3 and len(v["periods"]) >= 2]
    repeats.sort(key=lambda x:(len(x["months_observed"]),x["award_rows"]),reverse=True)
    return {
        "generated_at":datetime.now(timezone.utc).isoformat(),
        "total_source_rows":len(rows),
        "distinct_supplier_keys":len(suppliers),
        "distinct_agency_codes":len(agencies),
        "possible_duplicate_labelled_rows":duplicates,
        "top_suppliers":group(suppliers)[:100],
        "top_agencies":group(agencies)[:100],
        "categories":[{"name":k,"award_rows":v["rows"],"nominal_value":str(v["value"])}
                      for k,v in sorted(categories.items(), key=lambda p:p[1]["value"],reverse=True)],
        "monthly":[{"period":k,"award_rows":v["rows"],"nominal_value":str(v["value"]),
                    "supplier_keys":len(v["suppliers"]),"agency_codes":len(v["agencies"])}
                   for k,v in sorted(monthly.items())],
        "repeat_title_prefix_candidates":repeats[:100],
        "disclosures":[
            "Nominal values are awarded contracts, not government payments or supplier profit.",
            "Source workbooks may have overlapping coverage, and titles may contain Duplicate labels.",
            "Supplier name normalization is not proof of legal-entity identity.",
            "Keyword categories and repeat titles are heuristic research signals, not predictions.",
            "Source currency is not independently confirmed; cross-currency aggregation prohibited."
        ]
    }

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--output", type=Path, default=Path("data/public"))
    options = p.parse_args()
    f = options.output / "awards.json"
    rows = json.loads(f.read_text())["awards"]
    checks_file = options.output / "reconciliation.json"
    checks = json.loads(checks_file.read_text()).get("checks", []) if checks_file.exists() else []
    by_period = {c["period"]: c for c in checks if c.get("period")}
    flags = {r["id"]: quality_of(r, by_period) for r in rows}
    from collections import Counter
    counts = dict(Counter(flags.values()))
    # Supplier rankings use only fully reconciled, dated records.
    # All other official records remain available in the raw award explorer.
    eligible = [r for r in rows if flags[r["id"]] == "reconciled"]
    result = aggregate(eligible)
    result["source_record_count"] = len(rows)
    result["ranked_record_count"] = len(eligible)
    result["excluded_from_rankings"] = len(rows) - len(eligible)
    result["quality_counts"] = counts
    result["cached_summary_periods"] = [
        k for k, check in by_period.items() if check.get("status") == "totals_match_cached"
    ]
    result["quality_method"] = "Only records with a parsed award date AND matching official period summary appear in comparative financial rankings."
    result["disclosures"].append("Historical supplier and agency rankings exclude undated or unreconciled source rows by default.")
    result["disclosures"].append("Previously reconciled rows may be included only when their source-record signature remains unchanged; cached periods are disclosed.")
    (options.output / "analytics.json").write_text(json.dumps(result, indent=2, ensure_ascii=False)+"\n")
    quality_report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_record_count": len(rows),
        "ranked_record_count": len(eligible),
        "quality_counts": counts,
        "quality_by_record_id": flags,
        "summary_checks": {k: c.get("status") for k,c in by_period.items()},
        "cached_summary_periods": result["cached_summary_periods"],
        "quality_method": result["quality_method"],
        "cautions": ["Source-backed does not mean summary-reconciled.",
                     "A missing award date can reflect a historical format, not an invalid award.",
                     "No contract-award figure is confirmed as government cash disbursed."]
    }
    (options.output / "quality_report.json").write_text(json.dumps(quality_report, indent=2, ensure_ascii=False)+"\n")
    print("ANALYTICS_SOURCE_ROWS", len(rows), "RANKED_ROWS", len(eligible),
          "QUALITY_COUNTS", counts, "REPEAT_CANDIDATES", len(result["repeat_title_prefix_candidates"]))

if __name__ == "__main__":
    main()
