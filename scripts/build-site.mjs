#!/usr/bin/env node
/**
 * Cloudflare Pages: turn the repository's read-only dashboard and published
 * government award records into a deployable static site.
 * PRIVATE CRM and bidding data are never sourced from this directory.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const out = join(root, 'dist');
const input = join(root, 'data', 'public');
const dashboard = join(root, 'dashboard');
const required = ['awards.json', 'analytics.json', 'quality_report.json', 'reconciliation.json', 'import_status.json', 'source_manifest.json'];

for (const name of required) {
  const full = join(input, name);
  if (!existsSync(full)) throw Error('Missing required published dataset: ' + name);
  if (statSync(full).size > 25 * 1024 * 1024) throw Error('Cloudflare Pages 25 MB per-file limit exceeded: ' + name);
  JSON.parse(readFileSync(full, 'utf8'));
}
const awards = JSON.parse(readFileSync(join(input,'awards.json'),'utf8'));
const quality = JSON.parse(readFileSync(join(input,'quality_report.json'),'utf8'));
if (!Array.isArray(awards.awards) || awards.awards.length < 1 || quality.source_record_count !== awards.awards.length) {
  throw Error('Public award dataset and quality report do not reconcile');
}
if (existsSync(out)) rmSync(out,{force:true,recursive:true});
mkdirSync(join(out, 'data', 'public'),{recursive:true});
for (const name of ['index.html','app.js','style.css','private.js','radar.js']) {
  const source = join(dashboard,name);
  if (!existsSync(source)) { if (name === 'private.js') continue; throw Error('Missing dashboard asset: '+name); }
  cpSync(source,join(out,name));
}
for (const name of required) cpSync(join(input,name),join(out,'data','public',name));
const optionalFeeds=['opportunities.json'];
for (const name of optionalFeeds) {
 const source=join(input,name);
 if (existsSync(source)) {
   if (statSync(source).size>25*1024*1024)throw Error("Cloudflare Pages file limit exceeded: "+name);
   JSON.parse(readFileSync(source,"utf8"));
   cpSync(source,join(out,'data','public',name));
 }
}
const headers = [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: no-referrer',
  '  X-Frame-Options: DENY',
  '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
  "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  '/data/public/*',
  '  Cache-Control: public, max-age=300',
  ''
].join('\n');
writeFileSync(join(out,'_headers'),headers);
console.log('Cloudflare Pages bundle ready:', out,'public award rows:',awards.awards.length);
