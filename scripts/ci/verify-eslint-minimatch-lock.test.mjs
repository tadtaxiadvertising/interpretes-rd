import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const packages = lock.packages ?? {};
const tree = packages['node_modules/@typescript-eslint/typescript-estree'];
const exactMinimatch = packages[
  'node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch'
];

test('typescript-eslint parser uses the patched minimatch major version', () => {
  assert.ok(tree, 'typescript-estree package missing from pinned lockfile');
  assert.equal(tree.version, '8.73.0');
  assert.equal(tree.dependencies?.minimatch, '^11.0.1');
  assert.ok(exactMinimatch, 'Expected a patched nested minimatch dependency');
  const [major, minor, patch] = exactMinimatch.version.split('.').map(Number);
  assert.ok(major > 11 || (major === 11 && (minor > 0 || patch >= 1)));
});

test('no locked minimatch is in the known vulnerable versions 7–10', () => {
  const matches = Object.entries(packages)
    .filter(([path]) => path === 'node_modules/minimatch' || path.endsWith('/node_modules/minimatch'))
    .map(([path, pkg]) => ({path, version: pkg.version}));
  assert.ok(matches.length, 'No minimatch packages found: inspect lockfile');
  for (const {path, version} of matches) {
    const [major, minor, patch] = version.split('.').map(Number);
    const vulnerable = major >= 7 && (major < 11 || (major === 11 && minor === 0 && patch < 1));
    assert.equal(vulnerable, false, path + '@' + version + ' has GHSA-g3hv-75wg-m249');
  }
});
