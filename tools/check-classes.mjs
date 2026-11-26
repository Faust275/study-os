import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

const styleBlocks = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi), (m) => m[1]);
const defined = new Set();
for (const block of [css, ...styleBlocks]) {
  const text = block.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/\.((?:\\.|[A-Za-z0-9_%-]|[^\x00-\x7F])+)/g)) {
    defined.add(m[1].replace(/\\(.)/g, '$1'));
  }
}

const used = new Map();
function addTokens(value, line) {
  const literal = value.split("'")[0];
  for (const token of literal.split(/\s+/)) {
    if (!token || /[\\'"`+$<>{}=]/.test(token)) continue;
    if (!used.has(token)) used.set(token, line);
  }
}

const selectorOnly = new Set();
for (const m of html.matchAll(/(?:querySelectorAll?|closest)\(\s*'([^']+)'/g)) {
  for (const c of m[1].matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) {
    selectorOnly.add(c[1].replace(/\\(.)/g, '$1'));
  }
}
for (const m of html.matchAll(/classList\.contains\(\s*'([^']+)'/g)) {
  selectorOnly.add(m[1]);
}

html.split('\n').forEach((line, index) => {
  const lineNo = index + 1;
  for (const m of line.matchAll(/class=(?:"([^"]*)"|'([^']*)')/g)) {
    addTokens(m[1] ?? m[2], lineNo);
  }
  for (const m of line.matchAll(/classList\.(add|remove|toggle)\(([^)]*)\)/g)) {
    const quoted = Array.from(m[2].matchAll(/'([^']*)'|"([^"]*)"/g), (q) => q[1] ?? q[2]);
    const tokens = m[1] === 'toggle' ? quoted.slice(0, 1) : quoted;
    for (const token of tokens) addTokens(token, lineNo);
  }
  for (const m of line.matchAll(/className\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    addTokens(m[1] ?? m[2], lineNo);
  }
});

const missing = [];
for (const [token, line] of used) {
  if (!defined.has(token) && !selectorOnly.has(token)) missing.push({ token, line });
}

if (missing.length) {
  missing.sort((a, b) => a.line - b.line || a.token.localeCompare(b.token));
  console.error('Missing CSS classes (' + missing.length + '):');
  for (const { token, line } of missing) console.error('  ' + token + '  (index.html:' + line + ')');
  process.exit(1);
}

console.log('CSS classes OK: ' + used.size + ' used, all defined in app.css/inline style.');