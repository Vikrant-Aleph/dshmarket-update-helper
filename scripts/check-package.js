import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.notEqual(manifest.private, true, 'Public release must not be private');
assert.equal(manifest.license, 'MIT');
for (const file of ['index.js', 'updater.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE', 'CHANGELOG.md']) {
  assert.ok(existsSync(new URL(file, root)), `Missing ${file}`);
  assert.ok(manifest.files.includes(file), `Distribution list missing ${file}`);
}
for (const locale of ['en', 'zh']) {
  const dict = JSON.parse(readFileSync(new URL(`locale/${locale}.json`, root), 'utf8'));
  assert.ok(dict.meta?.title && dict.meta?.description, `Missing ${locale} metadata`);
}
assert.equal(manifest.exports['./locale/*.json'], './locale/*.json');
assert.equal(manifest.exports['./icon'], './icon.svg');
assert.ok(manifest.files.includes('locale/*.json'));
const icon = readFileSync(new URL('icon.svg', root), 'utf8');
assert.ok(Buffer.byteLength(icon) <= 256 * 1024);
assert.match(icon, /<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
console.log(`Package checks passed: ${manifest.name}@${manifest.version}`);
