import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

const styleBlocks = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi), (m) => m[1]);
const defined = new Set();
const definedVars = new Set();

for (const block of [css, ...styleBlocks]) {
  const text = block.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/\.((?:\\.|[A-Za-z0-9_%-]|[^\x00-\x7F])+)/g)) {
    defined.add(m[1].replace(/\\(.)/g, '$1'));
  }
  for (const vm of text.matchAll(/--([A-Za-z0-9_-]+)\s*:/g)) {
    definedVars.add(vm[1]);
  }
}

const used = new Map();
function addTokenList(rawStr, line) {
  for (const token of rawStr.split(/\s+/)) {
    if (!token || /[\\'"`+$<>{}=;()|&?]/.test(token)) continue;
    if (/^[\u4e00-\u9fff]/.test(token)) continue;
    if (!used.has(token)) used.set(token, line);
  }
}

function addMarkupClassAttr(attrVal, line) {
  // Strip JS string concatenations inside template strings: class="foo ' + expr + ' bar"
  const cleaned = attrVal
    .replace(/'\s*\+[\s\S]*?\+\s*'/g, ' ')
    .replace(/"\s*\+[\s\S]*?\+\s*"/g, ' ')
    .replace(/'\s*\+[\s\S]*$/g, ' ')
    .replace(/"\s*\+[\s\S]*$/g, ' ');
  addTokenList(cleaned, line);
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

// Heuristic: looks like a CSS utility / app class token in dynamic JS variables
const UTILITY_LIKE = /^(?:sm:|lg:|xl:|dark:|hover:|focus:|last:)?(?:-?(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|min-w|min-h|max-w|max-h|gap|space-y|text|font|leading|tracking|bg|border|rounded|ring|shadow|opacity|z|inset|top|bottom|left|right|grid|flex|items|justify|shrink|overflow|transition|duration|backdrop-blur|animate)-|surf(?:-2)?$|tint-(?:ana|alg|due|rest|ok|danger|warn|class)$|txt-(?:main|soft|faint|ana|danger|warn)$|tl-(?:dot|card|node)-|now-accent-|now-live-pill$|axis-col-weekend$|font-serif-ink$|brand-serif$|modal-mask$|sheet-panel$|app-nav$|app-toast$|day-active$|day-live$|subtab-active$|nav-item-active$|done-block$|overdue-block$|num-tab$|fade-in$|no-scrollbar$|snap-|hidden$|block$|inline-block$|truncate$|underline$|line-through$|whitespace-nowrap$|select-none$|pointer-events-none$|cursor-pointer$|antialiased$|divide-y$|relative$|absolute$|fixed$|sticky$)/;

const missingVars = [];

html.split('\n').forEach((line, index) => {
  const lineNo = index + 1;
  for (const vm of line.matchAll(/var\(--([A-Za-z0-9_-]+)\)/g)) {
    const vName = vm[1];
    if (!vName.startsWith('tw-') && !definedVars.has(vName)) {
      missingVars.push({ name: '--' + vName, line: lineNo });
    }
  }
  for (const m of line.matchAll(/class=(?:"([^"]*)"|'([^']*)')/g)) {
    addMarkupClassAttr(m[1] ?? m[2], lineNo);
  }
  for (const m of line.matchAll(/classList\.(add|remove|toggle)\(([^)]*)\)/g)) {
    const quoted = Array.from(m[2].matchAll(/'([^']*)'|"([^"]*)"/g), (q) => q[1] ?? q[2]);
    const tokens = m[1] === 'toggle' ? quoted.slice(0, 1) : quoted;
    for (const token of tokens) addTokenList(token, lineNo);
  }
  if (/\.className\s*=/.test(line)) {
    const rhs = line
      .slice(line.indexOf('className') + 9)
      .replace(/(?:===?|!==?)\s*(?:'[^']*'|"[^"]*")/g, '')
      .replace(/getAttribute\(\s*(?:'[^']*'|"[^"]*")\s*\)/g, '');
    for (const q of rhs.matchAll(/'([^']*)'|"([^"]*)"/g)) {
      addTokenList(q[1] ?? q[2], lineNo);
    }
  }
  // Scan dynamic JS variables / maps holding utility classes (cls, cardCls, chipCls, dotColor, blockColor, etc.)
  if (/(?:\b(?:cls|cardCls|chipCls|badgeCls|dotColor|blockColor|color)\b\s*[:=])/.test(line)) {
    for (const q of line.matchAll(/'([^']*)'|"([^"]*)"/g)) {
      const val = (q[1] ?? q[2]).trim();
      if (!val || val.startsWith('#')) continue;
      const parts = val.split(/\s+/).filter(Boolean);
      if (parts.length && parts.every((p) => UTILITY_LIKE.test(p))) {
        addTokenList(val, lineNo);
      }
    }
  }
});

const missing = [];
for (const [token, line] of used) {
  if (!defined.has(token) && !selectorOnly.has(token)) missing.push({ token, line });
}

if (missing.length || missingVars.length) {
  if (missing.length) {
    missing.sort((a, b) => a.line - b.line || a.token.localeCompare(b.token));
    console.error('Missing CSS classes (' + missing.length + '):');
    for (const { token, line } of missing) console.error('  ' + token + '  (index.html:' + line + ')');
  }
  if (missingVars.length) {
    console.error('Undefined CSS custom properties (' + missingVars.length + '):');
    for (const { name, line } of missingVars) console.error('  ' + name + '  (index.html:' + line + ')');
  }
  process.exit(1);
}

console.log('CSS check OK: ' + used.size + ' classes and ' + definedVars.size + ' custom properties verified.');
