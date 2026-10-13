#!/usr/bin/env python3
"""Source-verified ingestion of Bahamas public procurement awards.

Standard-library XLSX reader. Unrecognized columns stay in diagnostics.
Never invent suppliers or amounts. Public records only.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from decimal import Decimal, InvalidOperation
import hashlib
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import xml.etree.ElementTree as ET
from zipfile import ZipFile, BadZipFile

BASE = "https://mofvendors.gov.bs"
MONTHS = "january february march april may june july august september october november december".split()
SEED_PAGES = [f"{BASE}/public-notice-procurement-department-{month}-{year}/" for year in (2025, 2026, 2024) for month in MONTHS]
SITE_MAPS = [f"{BASE}/wp-sitemap-posts-post-{i}.xml" for i in range(1, 4)]
NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
AGENT = "PLV-Procurement-Research/0.1 (public procurement intelligence; github.com/PearsonLegacyVentures/governmentprocurement-)"

def fetch(url, max_bytes=16_000_000, retries=1):
    if urlparse(url).hostname != "mofvendors.gov.bs":
        raise ValueError("Refusing off-domain source: " + url)
    last_error = None
    for attempt in range(retries + 1):
        try:
            req = Request(url, headers={"User-Agent": AGENT, "Accept": "*/*"})
            with urlopen(req, timeout=14) as resp:
                if urlparse(resp.geturl()).hostname != "mofvendors.gov.bs":
                    raise ValueError("Off-domain redirect")
                data = resp.read(max_bytes + 1)
                if len(data) > max_bytes:
                    raise ValueError("Source exceeds configured byte limit")
                return data
        except (HTTPError, URLError, OSError, TimeoutError) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(attempt + 1)
    raise RuntimeError(f"Fetch failed {url}: {last_error}")

class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []
    def handle_starttag(self, tag, attrs):
        if tag == "a" and dict(attrs).get("href"):
            self.urls.append(dict(attrs)["href"])

def period_from_name(url):
    """Recognize full/abbreviated month labels and explicit multi-month ranges."""
    path = urlparse(url).path
    filename = path.split("/")[-1].lower().replace("_", "-")
    month_re = r"(?<![a-z])(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])"
    hits = list(re.finditer(month_re, filename))
    if not hits:
        return None
    years = re.findall(r"20\d{2}", filename)
    upload_year = re.search(r"/uploads/(20\d{2})/", path)
    fallback_year = years[-1] if years else (upload_year.group(1) if upload_year else None)
    if not fallback_year:
        return None
    def month(hit):
        abbr = hit.group(1)[:3].lower()
        return next((i for i, m in enumerate(MONTHS, 1) if m[:3] == abbr), None)
    last_month = month(hits[-1])
    if last_month is None:
        return None
    if len(hits) > 1 and "-to-" in filename:
        first_year = years[0] if len(years) > 1 else fallback_year
        return f"{first_year}-{month(hits[0]):02d}..{fallback_year}-{last_month:02d}"
    return f"{fallback_year}-{last_month:02d}"

def discover(max_pages=45):
    pages = set(SEED_PAGES)
    issues = []
    for sitemap in SITE_MAPS:
        try:
            root = ET.fromstring(fetch(sitemap, retries=0))
            for item in root.iter():
                if item.tag.endswith("loc") and item.text:
                    link = item.text.strip()
                    if link.startswith(BASE) and "procurement" in link:
                        pages.add(link)
        except (RuntimeError, ValueError, ET.ParseError) as exc:
            issues.append({"source": sitemap, "error": str(exc)[:260]})
    pages = sorted(pages, key=lambda x: ("2026" in x, "2025" in x, "2024" in x), reverse=True)
    output = {}
    loaded_pages = 0
    # Most of the 2024-26 month guesses do not exist. Parallelize public
    # announcement fetches so absent pages cannot stall the scheduled run.
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(fetch, page, max_bytes=2_000_000, retries=0): page
                   for page in pages[:max_pages]}
        for future in as_completed(futures):
            page_url = futures[future]
            try:
                html = future.result().decode("utf-8", "replace")
            except (RuntimeError, ValueError) as exc:
                issues.append({"source": page_url, "error": str(exc)[:260]})
                continue
            loaded_pages += 1
            parser = LinkParser()
            parser.feed(html)
            for href in parser.urls:
                url = urljoin(page_url, href).split("?")[0]
                if urlparse(url).hostname != "mofvendors.gov.bs" or not url.lower().endswith(".xlsx"):
                    continue
                upper = url.upper()
                if "PROJECT" in upper and "AWARD" in upper:
                    kind = "project_awards"
                elif "SUMMARY" in upper and ("CONTRACT" in upper or "AWARD" in upper):
                    kind = "summary"
                else:
                    continue
                output[url] = {"url": url, "notice_url": page_url,
                               "period": period_from_name(url), "report_type": kind}
    if not loaded_pages:
        issues.append({"error": "No official notice pages loaded"})
    reports = sorted(output.values(), key=lambda a: (a["period"] or "", a["report_type"]), reverse=True)
    return reports, issues

def read_xlsx(data):
    """Return sheet names and cell matrices; extract cached values only."""
    if not data.startswith(b"PK"):
        raise ValueError("Response is not an XLSX ZIP (possible web block or HTML page)")
    try:
        with ZipFile(io.BytesIO(data)) as z:
            names = set(z.namelist())
            if "xl/workbook.xml" not in names:
                raise ValueError("Not an Excel workbook")
            if sum(e.file_size for e in z.infolist()) > 100_000_000:
                raise ValueError("Uncompressed XLSX exceeds limit")
            shared = []
            if "xl/sharedStrings.xml" in names:
                ss = ET.fromstring(z.read("xl/sharedStrings.xml"))
                for si in ss.findall("x:si", NS):
                    shared.append("".join(n.text or "" for n in si.findall(".//x:t", NS)))
            work = ET.fromstring(z.read("xl/workbook.xml"))
            rels = {}
            relfile = "xl/_rels/workbook.xml.rels"
            if relfile in names:
                for r in ET.fromstring(z.read(relfile)):
                    rels[r.get("Id")] = r.get("Target")
            result = []
            for sh in work.findall("x:sheets/x:sheet", NS):
                rid = sh.get("{" + NS["r"] + "}id")
                target = rels.get(rid, "")
                path = target.lstrip("/") if target.startswith("/") else "xl/" + target.lstrip("./")
                if not target or path not in names:
                    continue
                root = ET.fromstring(z.read(path))
                rows = []
                for row in root.findall(".//x:sheetData/x:row", NS):
                    cells = {}
                    for cell in row.findall("x:c", NS):
                        match = re.match(r"[A-Z]+", cell.get("r", ""))
                        if not match:
                            continue
                        index = 0
                        for char in match.group():
                            index = index * 26 + ord(char) - 64
                        if index > 200:
                            continue
                        ctype = cell.get("t", "")
                        v = cell.find("x:v", NS)
                        if ctype == "inlineStr":
                            value = "".join(n.text or "" for n in cell.findall(".//x:is//x:t", NS))
                        elif v is None or v.text is None:
                            value = ""
                        elif ctype == "s":
                            pos = int(v.text)
                            value = shared[pos] if 0 <= pos < len(shared) else ""
                        elif ctype in ("str", "e", "b"):
                            value = v.text
                        else:
                            try:
                                value = Decimal(v.text)
                            except InvalidOperation:
                                value = v.text
                        cells[index - 1] = value
                    if cells:
                        rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
                    if len(rows) >= 50000:
                        break
                result.append((sh.get("name") or "Sheet", rows))
            return result
    except (BadZipFile, KeyError, ET.ParseError) as exc:
        raise ValueError("Invalid Excel archive: " + str(exc)) from exc

FIELDS = {
    "supplier": [r"(?i)^awarded?\s+(vendor|supplier|contractor)(\s+name)?$", r"(?i)winning\s+(supplier|bidder)", r"(?i)successful\s+(supplier|bidder)",
                 r"(?i)name\s+of\s+(supplier|vendor|contractor|awardee)",
                 r"(?i)^(supplier|vendor|contractor|awardee)(\s+name)?$"],
    "amount": [r"(?i)(award(ed)?|contract|total)\s+(amount|value|sum|price)",
               r"(?i)(amount|value|price|cost)\s+(awarded|of\s+contract)",
               r"(?i)contract\s+sum", r"(?i)^(amount|value)\s*(\(\$\))?$"],
    "agency": [r"(?i)(procuring|purchasing|awarding)\s+(entity|agency|department|ministry)",
               r"(?i)^(ministry|department|agency|public\s+body|entity)$"],
    "description": [r"(?i)^(project|description|contract\s+description|name\s+of\s+project|goods/works/services|procurement\s+description|contract\s+title|tender\s+title)(\s+.*)?$"],
    "date": [r"(?i)^(date\s+of\s+award|award\s+date|date\s+awarded)$"],
    "open_date": [r"(?i)^(open|opening|published|posting)\s+date$"],
    "close_date": [r"(?i)^(close|closing|submission\s+deadline)\s+date$"],
    "project_type": [r"(?i)^(project|procurement|tender)\s+type$"],
    "reference": [r"(?i)^(reference|reference\s+no|tender\s+number|procurement\s+reference|contract\s+number|bid\s+number)$"],
}

def canonical(value):
    return re.sub(r"\s+", " ", str(value or "").strip()).strip(":")

def normalize_name(name):
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower().strip().replace("&", " and ")).strip()

def detect_header(rows):
    best = (0, None, {})
    for i, row in enumerate(rows[:45]):
        fields = {}
        for column, cell in enumerate(row):
            value = canonical(cell)
            if len(value) > 100:
                continue
            for field, patterns in FIELDS.items():
                if field not in fields and any(re.search(p, value) for p in patterns):
                    fields[field] = column
        score = len(fields) + (3 if "supplier" in fields else 0) + (3 if "amount" in fields else 0)
        if score > best[0]:
            best = (score, i, fields)
    return (best[1], best[2]) if {"supplier", "amount"} <= set(best[2]) else (None, best[2])

def parse_amount(value):
    if isinstance(value, Decimal):
        return str(value) if value >= 0 else None
    string = str(value or "").strip().replace(",", "")
    string = re.sub(r"(?i)^(B\$|BSD|USD)\s*", "", string).replace("$", "").strip()
    if not re.fullmatch(r"\(?-?\d+(?:\.\d+)?\)?", string):
        return None
    try:
        amount = Decimal(string.replace("(", "-").replace(")", ""))
        return str(amount) if amount >= 0 else None
    except InvalidOperation:
        return None

def excel_date(value):
    """Interpret Excel serials and day-first public report date strings."""
    if isinstance(value, Decimal) and 20000 <= value <= 90000:
        return (datetime(1899, 12, 30) + timedelta(days=float(value))).date().isoformat()
    if isinstance(value, str):
        raw = value.strip()
        if re.match(r"^20\d{2}-\d{2}-\d{2}", raw):
            try:
                return datetime.fromisoformat(raw[:10]).date().isoformat()
            except ValueError:
                return None
        # Bahamas reports include e.g. 25/02/2026 12:00, so day-first.
        for pattern in ("%d/%m/%Y %H:%M", "%d/%m/%Y", "%d-%m-%Y %H:%M", "%d-%m-%Y"):
            try:
                return datetime.strptime(raw, pattern).date().isoformat()
            except ValueError:
                pass
    return None

def extract_awards(data, report):
    records = []
    diagnostics = []
    sha = hashlib.sha256(data).hexdigest()
    for sheet_name, rows in read_xlsx(data):
        header, fields = detect_header(rows)
        inferred = False
        if header is None:
            # Official February 2026 Table 2 continues without a header,
            # with an extra empty column B. Infer only with strong signals.
            candidates = [row for row in rows[:8] if len(row) >= 9]
            for type_col in (2, 3, 4):
                if len(candidates) < 2:
                    continue
                verified = sum(
                    1 for row in candidates
                    if str(row[type_col]).strip().upper() in
                    {"RFQ", "RFP", "ITT", "DA", "SB", "SS", "RFB", "OTHER"}
                    and type_col + 4 < len(row)
                    and parse_amount(row[type_col + 4]) is not None
                    and str(row[type_col + 1]).strip()
                    and str(row[0]).strip()
                )
                if verified >= 2 and verified >= (len(candidates) + 1) // 2:
                    fields = {"description": 0, "agency": type_col - 1,
                              "project_type": type_col,
                              "supplier": type_col + 1,
                              "amount": type_col + 4,
                              "date": type_col + 5}
                    header = -1
                    inferred = True
                    break
        if header is None:
            diagnostics.append({"sheet": sheet_name, "status": "unrecognized_columns",
                                "detected_fields": fields,
                                "preview": [[str(c)[:100] for c in row[:12]] for row in rows[:12]]})
            continue
        extracted = 0
        for number, row in enumerate(rows[header + 1:], header + 2):
            def get(field):
                idx = fields.get(field)
                return row[idx] if idx is not None and idx < len(row) else ""
            supplier = canonical(get("supplier"))
            amount = parse_amount(get("amount"))
            if not supplier or amount is None or supplier.lower() in ("total", "grand total", "subtotal"):
                continue
            signature = f"{report['url']}\n{sheet_name}\n{number}"
            agency = canonical(get("agency")) or None
            records.append({
                "id": hashlib.sha256(signature.encode()).hexdigest()[:20],
                "supplier_raw": supplier, "supplier_key": normalize_name(supplier),
                "amount": amount, "currency": "unspecified",
                "agency_raw": agency, "agency_key": normalize_name(agency) if agency else None,
                "description": canonical(get("description")) or None,
                "award_date_raw": canonical(get("date")) or None,
                "award_date_iso": excel_date(get("date")),
                "open_date_raw": canonical(get("open_date")) or None,
                "open_date_iso": excel_date(get("open_date")),
                "close_date_raw": canonical(get("close_date")) or None,
                "close_date_iso": excel_date(get("close_date")),
                "project_type_raw": canonical(get("project_type")) or None,
                "tender_reference_raw": canonical(get("reference")) or None,
                "report_period": report.get("period"), "source_notice": report["notice_url"],
                "source_file": report["url"], "source_sha256": sha,
                "sheet": sheet_name, "row": number,
                "evidence": "official_project_awards_workbook"})
            extracted += 1
        diagnostics.append({"sheet": sheet_name,
                            "header_row": None if inferred else header + 1,
                            "status": "inferred_continuation_sheet" if inferred else "parsed",
                            "detected_fields": fields, "parsed_awards": extracted})
    return records, diagnostics

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2,
                               sort_keys=True, default=str) + "\n")

def run(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/public"))
    parser.add_argument("--max-pages", type=int, default=45)
    parser.add_argument("--max-reports", type=int, default=40)
    parser.add_argument("--discovery-only", action="store_true")
    args = parser.parse_args(argv)
    reports, issues = discover(max_pages=args.max_pages)
    # Government may upload the same reporting period more than once.
    # Select only the most recently uploaded variant as the canonical source.
    # Every superseded URL is preserved in the manifest for audit.
    grouped = {}
    for entry in reports:
        if entry["report_type"] == "project_awards" and entry["period"]:
            grouped.setdefault(entry["period"], []).append(entry)
    superseded = set()
    superseded_entries = []
    for period, variants in grouped.items():
        if len(variants) < 2:
            continue
        def version_key(v):
            m = re.search(r"/uploads/(\d{4})/(\d{2})/", v["url"])
            return (int(m.group(1)), int(m.group(2)), v["url"]) if m else (0, 0, v["url"])
        newest = max(variants, key=version_key)
        for item in variants:
            if item["url"] != newest["url"]:
                superseded.add(item["url"])
                superseded_entries.append({**item, "status": "superseded_variant",
                                           "superseded_by": newest["url"]})
    reports = [r for r in reports if r["url"] not in superseded]
    stamp = datetime.now(timezone.utc).isoformat()
    manifest = {"generated_at": stamp, "source": BASE, "discovered": len(reports),
                "reports": [], "superseded_variants": superseded_entries,
                "discovery_issues": issues[:150]}
    imported = []
    success = 0
    def process_report(report):
        entry = dict(report)
        if report["report_type"] != "project_awards" or args.discovery_only:
            entry["status"] = "discovered"
            return entry, []
        try:
            content = fetch(report["url"])
            entry["bytes"] = len(content)
            entry["sha256"] = hashlib.sha256(content).hexdigest()
            records, diagnostic = extract_awards(content, report)
            entry["sheet_diagnostics"] = diagnostic
            entry["status"] = "parsed" if records else "unmapped"
            entry["records"] = len(records)
            return entry, records
        except (RuntimeError, ValueError) as exc:
            entry["status"] = "failed"
            entry["error"] = str(exc)[:320]
            return entry, []

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(process_report, report)
                   for report in reports[:args.max_reports]]
        for future in as_completed(futures):
            entry, records = future.result()
            manifest["reports"].append(entry)
            imported.extend(records)
            success += bool(records)
    manifest["reports"].sort(key=lambda x: (x.get("period") or "", x["report_type"]), reverse=True)
    write_json(args.output / "source_manifest.json", manifest)
    if args.discovery_only:
        print(f"Discovered {len(reports)} official spreadsheets")
        return 0 if reports else 2
    if not success:
        write_json(args.output / "import_status.json", {
            "state": "blocked", "generated_at": stamp,
            "reason": "No official project-awards workbook was successfully mapped",
            "discovered_reports": len(reports)})
        print("BLOCKED: No verified award records; inspect source_manifest.json", file=sys.stderr)
        return 3
    by_id = {r["id"]: r for r in imported}
    old_file = args.output / "awards.json"
    refreshed_periods = {r["report_period"] for r in imported if r.get("report_period")}
    refreshed_files = {r["source_file"] for r in imported}
    if old_file.exists():
        try:
            for record in json.loads(old_file.read_text()).get("awards", []):
                # Do not keep legacy versions of a refreshed reporting period.
                # Retain older verified months only if this run cannot fetch them.
                if record.get("source_file") in superseded:
                    continue
                if record.get("report_period") in refreshed_periods:
                    continue
                if record.get("source_file") in refreshed_files:
                    continue
                if record.get("id") and record["id"] not in by_id:
                    by_id[record["id"]] = record
        except (OSError, ValueError):
            pass
    awards = sorted(by_id.values(), key=lambda r: (r.get("report_period") or "",
                                                    r.get("supplier_key") or ""), reverse=True)
    nominal = sum((Decimal(r["amount"]) for r in awards), Decimal(0))
    write_json(old_file, {"meta": {
        "generated_at": stamp, "award_count": len(awards),
        "nominal_total": str(nominal), "currency": "unspecified",
        "quality_notice": "Raw observed values, incomplete coverage; no supplier alias merging or currency inference"
    }, "awards": awards})
    write_json(args.output / "import_status.json", {
        "state": "partial_verified", "generated_at": stamp,
        "award_count": len(awards), "parsed_reports_this_run": success,
        "discovered_reports": len(reports)})
    print(f"Imported {len(awards)} evidence-backed award rows from {success} workbooks")
    return 0

if __name__ == "__main__":
    raise SystemExit(run())
