#!/usr/bin/env python3
"""Provision a PRIVATE Cloudflare D1 database using GitHub Actions secrets.

No credentials, business contacts or bid data are ever committed or logged.
The operation is deliberately manual (workflow_dispatch only).
"""
import json
import os
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

BASE = "https://api.cloudflare.com/client/v4"
EXPECTED_REPOSITORY = "PearsonLegacyVentures/governmentprocurement-"
DATABASE_NAME = "plv-procurement-private"


def api(method, route, token, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = Request(BASE + route, method=method, data=data, headers={
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "PLV-Procurement-Provisioner/1.0",
    })
    try:
        with urlopen(request, timeout=35) as response:
            answer = json.load(response)
    except HTTPError as exc:
        # Error messages may be useful, but do not print raw authorization details.
        raise RuntimeError("Cloudflare API returned HTTP " + str(exc.code) +
                           " during " + method + " " + route.split("?")[0]) from None
    except (URLError, TimeoutError):
        raise RuntimeError("Cloudflare API network request failed") from None
    if not isinstance(answer, dict) or not answer.get("success", False):
        codes = [str(e.get("code", "unknown")) for e in answer.get("errors", [])
                 if isinstance(e, dict)]
        raise RuntimeError("Cloudflare API rejected request " + method +
                           " " + route.split("?")[0] + " (codes: " + ",".join(codes) + ")")
    return answer["result"]


def main():
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    project_input = os.environ.get("CLOUDFLARE_PAGES_PROJECT", "").strip()
    if not token:
        raise RuntimeError("Missing GitHub Actions secret CLOUDFLARE_API_TOKEN")
    if not re.fullmatch(r"[0-9a-fA-F]{32}", account):
        raise RuntimeError("Missing or invalid CLOUDFLARE_ACCOUNT_ID repository variable")

    base = "/accounts/" + account
    project = project_input if re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", project_input) else ""
    if project_input and not project:
        print("Pages project variable is not a project slug; will look for the connected GitHub project.")
    matches = api("GET", base + "/d1/database?" +
                  urlencode({"name": DATABASE_NAME, "per_page": 50}), token)
    existing = [d for d in matches if d.get("name") == DATABASE_NAME]
    if len(existing) > 1:
        raise RuntimeError("More than one D1 database has the exact target name")
    if existing:
        database = existing[0]
        print("Reusing existing private D1 database.")
    else:
        database = api("POST", base + "/d1/database", token,
                       {"name": DATABASE_NAME})
        print("Created private D1 database.")

    database_id = database.get("uuid") or database.get("id")
    if not database_id or not re.fullmatch(r"[0-9a-fA-F-]{36}", database_id):
        raise RuntimeError("Cloudflare did not return a valid D1 database ID")

    schema_path = Path("migrations/0001_initial.sql")
    sql = schema_path.read_text(encoding="utf-8")
    result = api("POST", base + "/d1/database/" + database_id + "/query",
                 token, {"sql": sql})
    if not isinstance(result, list) or any(not x.get("success", False) for x in result):
        raise RuntimeError("D1 schema execution returned a failed statement")
    verified = api("POST", base + "/d1/database/" + database_id + "/query",
                   token, {"sql": "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('contacts','bid_opportunities','bid_tasks')"})
    tables = {r["name"] for part in verified for r in part.get("results", [])}
    if tables != {"contacts", "bid_opportunities", "bid_tasks"}:
        raise RuntimeError("Private D1 schema verification failed")
    print("Schema verified: contacts, bid_opportunities, bid_tasks.")

    if not project:
        try:
            projects = api("GET", base + "/pages/projects?" +
                           urlencode({"per_page": 100}), token)
            matches = []
            for candidate in projects if isinstance(projects, list) else []:
                cfg = ((candidate.get("source") or {}).get("config") or {})
                repo_name = str(cfg.get("repo_name") or "")
                owner = str(cfg.get("owner") or "")
                repo_url = str(cfg.get("repo_url") or "")
                if repo_name.lower() != EXPECTED_REPOSITORY.split("/")[1].lower():
                    continue
                if owner and owner.lower() != EXPECTED_REPOSITORY.split("/")[0].lower():
                    continue
                if repo_url and EXPECTED_REPOSITORY.lower() not in repo_url.lower():
                    continue
                matches.append(candidate.get("name"))
            matches = sorted(set(x for x in matches if x))
            if len(matches) == 1:
                project = matches[0]
                print("Found the unique Pages project connected to the expected GitHub repository.")
            elif matches:
                print("More than one Pages project is linked to this repository; skipping the binding.")
            else:
                print("No Pages project was uniquely matched to the repository; skipping the binding.")
        except RuntimeError:
            print("Pages project discovery unavailable with the current token; skipping the binding.")

    if project:
        route = base + "/pages/projects/" + project
        info = api("GET", route, token)
        source = (info.get("source") or {}).get("config") or {}
        repo_name = source.get("repo_name", "")
        owner = source.get("owner", "")
        if repo_name and repo_name.lower() != EXPECTED_REPOSITORY.split("/")[1].lower():
            raise RuntimeError("Selected Pages project is bound to a different GitHub repository")
        if owner and owner.lower() != EXPECTED_REPOSITORY.split("/")[0].lower():
            raise RuntimeError("Selected Pages project belongs to a different GitHub owner")
        production = ((info.get("deployment_configs") or {}).get("production") or {})
        original = production.get("d1_databases") or {}
        binding = dict(original)
        if "PRIVATE_DB" in binding and binding["PRIVATE_DB"].get("id") not in (None, database_id):
            raise RuntimeError("Existing PRIVATE_DB binding targets a different database; refusing to overwrite")
        binding["PRIVATE_DB"] = {"id": database_id}
        if original != binding:
            api("PATCH", route, token,
                {"deployment_configs": {"production": {"d1_databases": binding}}})
        refreshed = api("GET", route, token)
        found = ((refreshed.get("deployment_configs") or {}).get("production") or {}).get("d1_databases") or {}
        if (found.get("PRIVATE_DB") or {}).get("id") != database_id:
            raise RuntimeError("Pages binding verification failed")
        print("Production Pages project now has the PRIVATE_DB binding.")
        print("Production redeploy may be required to activate the new binding.")
    else:
        print("Pages binding skipped: CLOUDFLARE_PAGES_PROJECT is not set.")
    print("Provisioning completed. Cloudflare Access must still be set up before storing private data.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("Provisioning failed: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
