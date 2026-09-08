#!/usr/bin/env node
/**
 * i18n parity check (E1-13)
 *
 * Fails (exit 1) if the EN and FR app translation trees diverge — every EN key
 * must have an FR counterpart and vice-versa. This guards the B2B surface
 * (org.*, org.console.*, org.errors.*) and everything else against one-language
 * drift. Run in CI.
 *
 * i18next plural keys (`foo_one`, `foo_other`, `foo_many`, legacy `foo_plural`…)
 * use language-specific CLDR categories, so we compare on the plural-stripped
 * BASE key — a plural that exists in either language counts as covering the base.
 *
 * The marketing site (filarr-website) has its own messages/{en,fr}.json checked
 * by an equivalent script in that repo.
 */

const fs = require('fs');
const path = require('path');

const PLURAL_SUFFIX =
  /_(zero|one|two|few|many|other|plural|\d+)$/;

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? flatten(v, prefix + k + '.')
      : [prefix + k]
  );
}

function baseKeys(obj) {
  return new Set(flatten(obj).map((k) => k.replace(PLURAL_SUFFIX, '')));
}

function load(locale) {
  const p = path.join(__dirname, '..', 'src', 'i18n', 'locales', locale, 'translation.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const en = baseKeys(load('en'));
const fr = baseKeys(load('fr'));

const missingInFr = [...en].filter((k) => !fr.has(k)).sort();
const missingInEn = [...fr].filter((k) => !en.has(k)).sort();

if (missingInFr.length || missingInEn.length) {
  if (missingInFr.length) {
    console.error(`\n✗ ${missingInFr.length} key(s) missing in fr:`);
    missingInFr.forEach((k) => console.error('   ' + k));
  }
  if (missingInEn.length) {
    console.error(`\n✗ ${missingInEn.length} key(s) missing in en:`);
    missingInEn.forEach((k) => console.error('   ' + k));
  }
  console.error('\ni18n parity FAILED.');
  process.exit(1);
}

console.log(`i18n parity OK — ${en.size} base keys match across en/fr`);
