import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

test('Pages build generates root index, JS and official JSON', () => {
  execFileSync(process.execPath,['scripts/build-site.mjs'],{stdio:'pipe'});
  for (const p of ['dist/index.html','dist/app.js','dist/style.css','dist/data/public/awards.json','dist/data/public/quality_report.json']) {
    assert.equal(existsSync(p),true,`Expected ${p}`);
  }
  assert.match(readFileSync('dist/index.html','utf8'),/Procurement Intelligence/);
  const dataset=JSON.parse(readFileSync('dist/data/public/awards.json','utf8'));
  assert.ok(dataset.awards.length>0);
});
