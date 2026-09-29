// Lists tr("...") strings in src/ that have no French translation, and translations whose English source no longer exists.
// Usage: npm run i18n:check   (exits 1 when something is missing, so it can gate CI)
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src');
const used = new Set();

(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'i18n') walk(p); continue; }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const re = /\btr\(("(?:[^"\\]|\\.)*")/g;
    const text = fs.readFileSync(p, 'utf8');
    let m;
    while ((m = re.exec(text))) used.add(JSON.parse(m[1]));
  }
})(src);

const translated = new Set();
const i18nDir = path.join(src, 'i18n');
const files = [path.join(i18nDir, 'fr-text.ts'), ...fs.readdirSync(path.join(i18nDir, 'fr')).map((f) => path.join(i18nDir, 'fr', f))];
for (const file of files) {
  const re = /^\s*("(?:[^"\\]|\\.)*"):/gm;
  const text = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = re.exec(text))) translated.add(JSON.parse(m[1]));
}

const missing = [...used].filter((s) => !translated.has(s)).sort();
const unused = [...translated].filter((s) => !used.has(s)).sort();
console.log(`tr() strings: ${used.size}, French translations: ${translated.size}`);
if (missing.length) console.log(`\nMissing French (${missing.length}):\n` + missing.map((s) => '  ' + JSON.stringify(s)).join('\n'));
// Many labels live in constants and are only translated dynamically (tr(variable)), so "unused" here is informational.
// Pass --unused to list them.
if (unused.length) console.log(`\n${unused.length} translations are not referenced by a literal tr("...") call (constants/labels resolved at render time).` + (process.argv.includes('--unused') ? '\n' + unused.map((s) => '  ' + JSON.stringify(s)).join('\n') : ''));
process.exit(missing.length ? 1 : 0);
