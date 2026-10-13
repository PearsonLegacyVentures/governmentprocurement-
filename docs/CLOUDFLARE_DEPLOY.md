# Cloudflare Pages deployment & private procurement workspace

This repository is PUBLIC. Published award records are served as static files. **Bid strategy, supplier pricing, contacts, relationship notes and action tasks belong exclusively in Cloudflare D1, accessed through a signed Cloudflare Access identity.** The private API fails closed if its identity or database configuration is missing.

## 1. Build the existing connected Pages project

Go to Cloudflare → Workers & Pages → this Pages project → Settings → Build.

| Setting | Exact value |
|---|---|
| Repository | PearsonLegacyVentures/governmentprocurement- |
| Framework preset | None |
| Build command | node scripts/build-site.mjs |
| Build output directory | dist |
| Root directory | Leave blank |
| Production branch | main |
| Automatic deployment | Enabled |
| Build system | Version 3 |

Save and redeploy. The generated bundle contains a homepage at the root URL, public award JSON under /data/public/, and the private CRM interface. Pages Functions are compiled from the repository-level functions/ directory.

Private CRM views stay locked until the steps below are complete. No live contact or strategic data should be entered before the security check passes.

## 2. Create a private Cloudflare D1 database

Go to **Storage & databases → D1** and create a database, such as **plv-procurement-private**.

Open the database Console and execute the SQL from **migrations/0001_initial.sql** in this repository. It creates tables:

- contacts: agencies, potential prime contractors, vendors, responsible people, relationship notes and follow-ups.
- bid_opportunities: bid stages, ventures, estimated values, eligibility, win themes, pricing assumptions, competitors, risks and strategies.
- bid_tasks: due dates, assignments, progress and tasks linked to bids.

Then go to the Pages project's **Settings → Bindings → Add → D1 database**. Set the variable name to exactly **PRIVATE_DB** and choose the new database. Save and redeploy.

For preview deployments, do NOT attach production D1. Leave preview unbound or use an isolated test D1 database.

## 3. Put Cloudflare Access in front of the application

Under **Cloudflare Zero Trust → Access controls → Applications**, create an Access self-hosted application for your production procurement hostname. Allow only specifically approved email identities. Avoid Bypass policies for private endpoints. Use an identity provider such as Google or a one-time PIN and consider a short session duration.

Protect all relevant hostnames:
- The custom production domain, if you have one.
- The default production Pages domain on pages.dev.
- Preview deployment URLs separately.

Note: Cloudflare Pages' **Settings → General → Enable access policy** initially protects preview deployments only. It does not automatically protect the production Pages domain or custom domain. Follow Cloudflare's official known-issues instructions to protect the production pages.dev domain. If preview and production have distinct Access applications, they also have different audience tags. Configure the environment-specific audience accordingly or leave the preview API locked.

Official docs:
https://developers.cloudflare.com/pages/configuration/preview-deployments/
https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain
https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/

## 4. Bind your Access policy to the private server API

Under **Workers & Pages → project → Settings → Variables and Secrets**, add these variables to the production environment:

| Name | What to enter |
|---|---|
| ACCESS_TEAM_DOMAIN | Your Zero Trust team domain, for example myteam.cloudflareaccess.com (NO https prefix) |
| ACCESS_AUD | The application audience (AUD) tag from your production Access application |
| ADMIN_EMAILS | Comma-separated, individually approved email accounts |

Do not store these configuration values in GitHub or frontend JavaScript.

The API verifies the signed Access application token using the team signing certificates, including signature, issuing team, AUD, token age, expiry and exact allowed email. A private D1 binding is required for every request.

## 5. Test that private access is truly secure

1. Visit the dashboard home page. The official award explorer should load.
2. Visit /api/private/session **without authentication**. It must not return a ready private session.
3. Authenticate through Cloudflare Access using an authorized email.
4. Visit /api/private/session again. It should return ready: true and your authenticated email.
5. Create a disposable bid, contact and task, reload, and verify persistence.
6. Archive the disposable records; verify they no longer show.
7. Try an unapproved email. Its private requests must be rejected.
8. Verify your custom domain, pages.dev hostname and preview URLs cannot bypass intended access controls.

Common errors:
- Access not configured (503): set ACCESS_TEAM_DOMAIN, ACCESS_AUD and ADMIN_EMAILS.
- Access login required (401): ensure the Access app and signed application token cover this hostname.
- Account not authorized (403): check the verified account against ADMIN_EMAILS.
- PRIVATE_DB not configured (503): attach the correct D1 binding and redeploy.
- D1 migration missing (503): run migrations/0001_initial.sql in D1 Console.

## Security and data boundaries

- This GitHub repository is public. Never commit business contacts, vendor quotations, privately negotiated costs or strategy files.
- Private data is returned only by Pages Functions under /api/private/ with no-store headers. All D1 writes use prepared SQL and server-side validation.
- Archived records remain in D1 for recovery; no record is permanently deleted through the UI.
- The historical award database shows what government reported, not proof of cash paid or a finding of wrongdoing.
- Preview environments must never read or write your production CRM database.
- Government tenders and awarding data are publicly sourced; contact and strategy information are not.

## Follow-on product work

Connect open Bonfire tenders with the private bid pipeline, build reviewed supplier organization leads from official award winners, implement formal bid/no-bid scoring, document contact outreach and create deadline alerts.
