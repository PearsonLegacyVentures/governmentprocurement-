# Automated Cloudflare database provisioning

**Never paste API tokens, S3 keys or credentials into ChatGPT, GitHub source files, screenshots or GitHub issue comments.**

Use a proper Cloudflare API token, not an R2 object-storage token. In Cloudflare **My Profile → API Tokens → Create Token → Create Custom Token**, choose the selected account and grant **Account / D1 / Edit** and **Account / Cloudflare Pages / Edit** (Cloudflare API docs: D1 Write and Pages Write). Do not use an unrestricted Global API key. After setup, revoke the provisioning token if it is no longer needed.

In your repository **Settings → Secrets and variables → Actions**:
1. Under **Secrets**, set `CLOUDFLARE_API_TOKEN` to the NEW, replacement Cloudflare API token. Never disclose it in this chat.
2. Under **Variables**, set `CLOUDFLARE_ACCOUNT_ID` to your account ID (32 hex characters).
3. Under **Variables**, set `CLOUDFLARE_PAGES_PROJECT` to the **Cloudflare Pages project name** (not the GitHub repository name unless identical). This variable is optional; without it the database and schema are created but binding is skipped.

Then go to **Actions → Provision private Cloudflare D1 → Run workflow**.

The script checks for an existing `plv-procurement-private` D1 database and reuses it if found, otherwise creates one; applies the idempotent migration; checks for the three private tables; optionally applies the production `PRIVATE_DB` D1 Pages binding without changing the preview binding or overriding another database; and checks the binding after the update. Failures stop the job.

**Cloudflare Access remains a separate required security step** before recording any contacts, bid strategies or pricing notes.

Relevant source code: `scripts/provision-cloudflare.py` and `.github/workflows/provision-d1.yml`.
