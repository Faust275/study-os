import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// 1. Check JS syntax of all <script> blocks in index.html
const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), (m) => m[1]);
assert.equal(scripts.length, 3, 'Expected 3 script blocks in index.html');
scripts.forEach((code, idx) => {
  new vm.Script(code, { filename: `index.html#script-${idx + 1}` });
});
console.log('[PASS] All 3 <script> blocks parse with zero syntax errors');

function makeClock(isoStr) {
  const RealDate = Date;
  let fixedMs = RealDate.parse(isoStr);
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixedMs);
      else super(...args);
    }
    static now() { return fixedMs; }
  }
  return {
    FixedDate,
    setNow(nextIso) { fixedMs = RealDate.parse(nextIso); }
  };
}

async function waitFor(cond, msg = 'Condition timed out', timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert(cond(), msg);
}

class FakeClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  _syncFromAttr(cls) { this.set = new Set(String(cls || '').split(/\s+/).filter(Boolean)); }
  add(...tokens) { tokens.forEach((t) => t && this.set.add(t)); }
  remove(...tokens) { tokens.forEach((t) => this.set.delete(t)); }
  toggle(token, force) {
    const on = force !== undefined ? !!force : !this.set.has(token);
    if (on) this.set.add(token); else this.set.delete(token);
    return on;
  }
  contains(token) { return this.set.has(token); }
}

class FakeElement {
  constructor(id = '', tag = 'div', doc = null) {
    this.id = id;
    this.tagName = tag.toUpperCase();
    this._doc = doc;
    this.textContent = '';
    this._innerHTML = '';
    this.value = '';
    this.href = '';
    this.disabled = false;
    this.isContentEditable = false;
    this.style = { cssText: '' };
    this.attrs = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList(this);
  }
  set className(v) { this._className = String(v); this.classList._syncFromAttr(v); }
  get className() { return [...this.classList.set].join(' '); }
  set innerHTML(v) {
    this._innerHTML = String(v);
    this.innerHTMLWrites = (this.innerHTMLWrites || 0) + 1;
    const m = this._innerHTML.match(/<div class="([^"]*\bweek-now-line\b[^"]*)" data-week-now="([^"]+)" style="top:(\d+)px"[^>]*><span class="week-now-dot"><\/span><span class="week-now-label">([^<]*)<\/span><\/div>/);
    if (m) {
      const lineEl = new FakeElement('', 'div', this._doc);
      lineEl.className = m[1];
      lineEl.setAttribute('data-week-now', m[2]);
      lineEl.style.top = m[3] + 'px';
      const labelEl = new FakeElement('', 'span', this._doc);
      labelEl.className = 'week-now-label';
      labelEl.textContent = m[4];
      lineEl.querySelector = (sel) => (sel === '.week-now-label' ? labelEl : null);
      this._nowLineEl = lineEl;
    } else {
      this._nowLineEl = null;
    }
  }
  get innerHTML() { return this._innerHTML; }
  querySelector(sel) {
    if (sel === '[data-week-now]') return this._nowLineEl || null;
    const dm = String(sel).match(/^\[data-axis-date="([^"]+)"\]$/);
    if (dm) return this._innerHTML.includes('data-axis-date="' + dm[1] + '"') ? {} : null;
    return null;
  }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  dispatch(type, extra = {}) {
    const fns = this.listeners.get(type) || [];
    const evt = {
      target: this,
      key: extra.key || '',
      keyCode: extra.keyCode || 0,
      isComposing: !!extra.isComposing,
      preventDefault() {},
      closest: () => null,
      ...extra
    };
    fns.forEach((fn) => fn.call(this, evt));
  }
  click() { this.dispatch('click'); }
  focus() { if (this._doc) this._doc.activeElement = this; }
  blur() { if (this._doc && this._doc.activeElement === this) this._doc.activeElement = null; }
  select() {}
  appendChild() {}
  removeChild() {}
}

function createHarness(initialStorage = {}, opts = {}) {
  const isNative = opts.isNative !== false;
  const asyncHistory = !!opts.asyncHistory;
  const isMobile = !!opts.isMobile;
  const nowIso = opts.nowIso || '2026-11-27T12:00:00Z';
  const clock = makeClock(nowIso);
  const elements = new Map();
  const document = {
    hidden: false,
    activeElement: null,
    documentElement: null,
    body: null,
    listeners: new Map(),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id, 'div', document));
      return elements.get(id);
    },
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === '.cal-m-btn') return calBtns;
      if (sel === '.tab-view') return tabViews;
      if (sel === '.nav-btn') return navBtns;
      return [];
    },
    createElement(tag) { return new FakeElement('', tag, document); },
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    },
    dispatch(type, extra = {}) {
      const fns = this.listeners.get(type) || [];
      const evt = {
        target: extra.target || this,
        key: extra.key || '',
        keyCode: extra.keyCode || 0,
        isComposing: !!extra.isComposing,
        preventDefault() { this._prevented = true; },
        closest: () => null,
        ...extra
      };
      fns.forEach((fn) => fn.call(this, evt));
      return evt;
    }
  };
  document.documentElement = new FakeElement('html', 'html', document);
  document.body = new FakeElement('body', 'body', document);

  for (const m of html.matchAll(/<([a-zA-Z0-9]+)\b([^>]*?\bid="([^"]+)"[^>]*)>/g)) {
    const [, tag, attrStr, id] = m;
    const el = new FakeElement(id, tag, document);
    const clsM = attrStr.match(/\bclass="([^"]*)"/);
    if (clsM) el.className = clsM[1];
    const valM = attrStr.match(/\bvalue="([^"]*)"/);
    if (valM) el.value = valM[1];
    const contentM = attrStr.match(/\bcontent="([^"]*)"/);
    if (contentM) el.setAttribute('content', contentM[1]);
    const tabM = attrStr.match(/\bdata-tab="([^"]*)"/);
    if (tabM) el.setAttribute('data-tab', tabM[1]);
    elements.set(id, el);
  }

  const calBtns = Array.from(html.matchAll(/<button[^>]*data-cal-ym="([^"]+)"[^>]*>/g), (m) => {
    const b = new FakeElement('', 'button', document);
    b.setAttribute('data-cal-ym', m[1]);
    return b;
  });
  const tabViews = Array.from(html.matchAll(/<section[^>]*\bid="(view-[^"]+)"[^>]*>/g), (m) => elements.get(m[1]));
  const navBtns = Array.from(html.matchAll(/<button[^>]*\bdata-tab="([^"]+)"[^>]*\bclass="nav-btn[^"]*"[^>]*>/g), (m) => {
    const b = new FakeElement('', 'button', document);
    b.className = 'nav-btn';
    b.setAttribute('data-tab', m[1]);
    return b;
  });

  const store = new Map(Object.entries(initialStorage));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; }
  };

  let pushedSnapshots = [];
  let scheduledAlarms = [];
  let savedExports = [];
  const historyStack = [null];
  let historyIdx = 0;
  let historyPushCount = 0;
  let historyBackCount = 0;
  let popstateCount = 0;
  let minimizeCount = 0;
  const backHandlers = [];
  const winListeners = new Map();

  function dispatchWindow(type, extra = {}) {
    if (type === 'popstate') popstateCount++;
    (winListeners.get(type) || []).forEach((fn) => fn({ type, ...extra }));
  }

  function stepBackAndDispatch() {
    if (asyncHistory) {
      const t = globalThis.setTimeout(() => {
        if (historyIdx > 0) historyIdx--;
        dispatchWindow('popstate', { state: historyStack[historyIdx] });
      }, 15);
      if (t && typeof t.unref === 'function') t.unref();
    } else {
      if (historyIdx > 0) historyIdx--;
      dispatchWindow('popstate', { state: historyStack[historyIdx] });
    }
  }

  const sandbox = {
    console,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Promise,
    Uint8Array,
    TextDecoder,
    Blob: class { constructor(parts, optsB) { this.parts = parts; this.opts = optsB; } },
    URL: { createObjectURL: () => 'blob:mock' },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    setTimeout: asyncHistory
      ? (fn, ms) => {
          const t = globalThis.setTimeout(fn, ms);
          if (t && typeof t.unref === 'function') t.unref();
          return t;
        }
      : (fn) => { fn(); return 1; },
    clearTimeout: asyncHistory ? (t) => globalThis.clearTimeout(t) : () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    Date: clock.FixedDate,
    document,
    navigator: {},
    localStorage,
    history: {
      get state() { return historyStack[historyIdx]; },
      pushState(st) {
        historyPushCount++;
        historyStack.splice(historyIdx + 1);
        historyStack.push(st);
        historyIdx = historyStack.length - 1;
      },
      back() {
        historyBackCount++;
        if (historyIdx > 0) stepBackAndDispatch();
      }
    }
  };
  if (isNative) {
    sandbox.AndroidBridge = {
      pushSnapshot: (json) => pushedSnapshots.push(JSON.parse(json))
    };
    sandbox.Capacitor = {
      Plugins: {
        App: {
          addListener(ev, fn) {
            if (ev === 'backButton') backHandlers.push(fn);
            return Promise.resolve({ remove() {} });
          },
          minimizeApp() {
            minimizeCount++;
            return Promise.resolve();
          }
        },
        Notify: {
          available: () => Promise.resolve({ notifications: true, exact: true }),
          requestPermission: () => Promise.resolve({ notifications: true, exact: true, granted: true }),
          schedule: ({ items }) => { scheduledAlarms.push(items); return Promise.resolve({ scheduled: items.length, skipped: 0, exact: true }); },
          cancelAll: () => Promise.resolve({ cancelled: true }),
          scheduleTimer: () => Promise.resolve({ scheduled: true }),
          cancelTimer: () => Promise.resolve({ cancelled: true })
        },
        BackupExport: {
          saveToDownloads: (payload) => { savedExports.push(payload); return Promise.resolve({ ok: true }); }
        }
      }
    };
  }
  sandbox.window = sandbox;
  sandbox.window.addEventListener = (type, fn) => {
    if (!winListeners.has(type)) winListeners.set(type, []);
    winListeners.get(type).push(fn);
  };
  sandbox.window.scrollTo = () => {};
  sandbox.window.matchMedia = (q) => ({ matches: isMobile && String(q).includes('639px') });
  sandbox.window.confirm = () => true;

  vm.createContext(sandbox);
  vm.runInContext(scripts[0], sandbox);
  vm.runInContext(scripts[1], sandbox);

  return {
    elements,
    store,
    document,
    pushedSnapshots,
    scheduledAlarms,
    savedExports,
    sandbox,
    FakeElement,
    getHistoryPushCount: () => historyPushCount,
    getHistoryBackCount: () => historyBackCount,
    getPopstateCount: () => popstateCount,
    getHistoryIndex: () => historyIdx,
    getHistoryState: () => historyStack[historyIdx],
    getMinimizeCount: () => minimizeCount,
    browserBack: () => {
      if (historyIdx > 0) stepBackAndDispatch();
    },
    triggerBack: () => backHandlers.forEach((fn) => fn()),
    setClock: (nextIso) => clock.setNow(nextIso),
    dispatchWindow
  };
}

// Test Case A: Fixed-clock 2026-11-27 boot + Next-day clock 2026-11-28 simulation
const h1 = createHarness({}, { nowIso: '2026-11-27T12:00:00Z' });
const cdHtml = h1.elements.get('cal-countdowns').innerHTML;
assert(cdHtml.includes('40 天后') && cdHtml.includes('50 天后') && cdHtml.includes('71 天后'),
  'Expected 40/50/71 days on 2026-11-27, got: ' + cdHtml);
console.log('[PASS] Fixed-clock 2026-11-27 countdowns show 40 / 50 / 71 天后');

const hNextDay = createHarness({}, { nowIso: '2026-11-28T12:00:00Z' });
await new Promise((r) => setTimeout(r, 20));
const cdNext = hNextDay.elements.get('cal-countdowns').innerHTML;
assert(cdNext.includes('39 天后') && cdNext.includes('49 天后') && cdNext.includes('70 天后'),
  'Expected 39/49/70 days on 2026-11-28, got: ' + cdNext);
const snapNext = hNextDay.pushedSnapshots[hNextDay.pushedSnapshots.length - 1];
assert(snapNext && snapNext.scheduleByDate['2026-11-28'].length > 0, '2026-11-28 schedule should be active on launch day');
console.log('[PASS] Next-day clock 2026-11-28 dynamically shifts countdowns to 39 / 49 / 70 天后');

assert.equal(h1.elements.get('meta-theme-color').getAttribute('content'), '#F6F3EC');
h1.elements.get('btn-toggle-theme').click();
assert.equal(h1.elements.get('meta-theme-color').getAttribute('content'), '#12141A');
console.log('[PASS] meta-theme-color syncs with light/dark theme (#F6F3EC <-> #12141A)');

const calGridHtml = h1.elements.get('cal-grid').innerHTML;
assert(calGridHtml.includes('十九') && calGridHtml.includes('廿一') && calGridHtml.includes('正式启动'));
assert(!calGridHtml.includes('>·<'));
console.log('[PASS] Calendar grid renders lunar dates on all non-special days');

for (let i = 0; i < 8; i++) h1.elements.get('btn-cal-next').click();
assert.equal(h1.elements.get('cal-month-title').textContent, '2027 年 7 月');
console.log('[PASS] Calendar month navigation rolls across years cleanly (2027 年 7 月)');

const latestSnap = h1.pushedSnapshots[h1.pushedSnapshots.length - 1];
assert.equal(Object.keys(latestSnap.scheduleByDate).length, 7);
assert.equal(latestSnap.scheduleByDate['2026-11-27'].length, 0);
assert(latestSnap.scheduleByDate['2026-11-28'].length > 0);
assert(latestSnap.todos[0].dueDate);
console.log('[PASS] Widget snapshot contains 7-day effective schedule dictionary + dueDate without term-boundary leak');

// Test Case B (P1): Real user data entered while isDemoData=true MUST survive clearDemoDataAction (even clicked twice!)
const realWhileDemo = JSON.parse(h1.store.get('study_os_state'));
realWhileDemo.isDemoData = true;
realWhileDemo.quadTasks.unshift({ id: 'qt_user_1', q: 'q1', title: '我自己加的实变函数笔记', done: false, subs: [] });
realWhileDemo.backfills['2026-11-28'].push({ id: 'bf_user_1', t: '19:00–20:00', title: '用户真实补录' });
realWhileDemo.grades[0].root.children[1].score = 97; // g1|r1p2
realWhileDemo.grades[4].root.children[1].score = 89; // g5|r5p2
realWhileDemo.grades[0].hypo = 95;
realWhileDemo.focusToday = 45;
realWhileDemo.focusHistory = { '2026-11-27': 45 };
realWhileDemo.courseFocusMins['数学分析'] = 270 + 45;
realWhileDemo.quotaCounts = { w1: { 'q-ana': 2 } };
realWhileDemo.sleepHistory = [{ date: '2026-11-27', deep: 110, light: 240, rem: 90, awake: 10 }];

const h2 = createHarness({ study_os_state: JSON.stringify(realWhileDemo) }, { nowIso: '2026-11-27T12:00:00Z' });
h2.elements.get('btn-clear-demo').click();
h2.elements.get('btn-clear-demo').click();
const afterClear = JSON.parse(h2.store.get('study_os_state'));
assert.equal(afterClear.isDemoData, false);
assert.equal(afterClear.demoFocusCleared, true);
assert.equal(afterClear.quadTasks.length, 1);
assert.equal(afterClear.quadTasks[0].id, 'qt_user_1');
assert.equal(afterClear.backfills['2026-11-28'].length, 1);
assert.equal(afterClear.backfills['2026-11-28'][0].id, 'bf_user_1');
assert.equal(afterClear.ledger.length, 0);
assert.equal(afterClear.grades[0].root.children[0].children[0].score, null, 'Unchanged demo g1|r1p1a should be cleared');
assert.equal(afterClear.grades[0].root.children[1].score, 97, 'User-modified g1|r1p2 (97) must survive clearDemo');
assert.equal(afterClear.grades[4].root.children[1].score, 89, 'User-entered g5|r5p2 (89) must survive clearDemo');
assert.equal(afterClear.grades[0].hypo, 95, 'User hypo must survive clearDemo');
assert.equal(afterClear.focusToday, 45, 'focusToday must survive clearDemo');
assert.equal(afterClear.focusHistory['2026-11-27'], 45, 'focusHistory must survive clearDemo');
assert.equal(afterClear.courseFocusMins['数学分析'], 45, 'Seed 270m deducted once, real 45m preserved');
assert.equal(afterClear.courseFocusMins['代数学'], 0, 'Seed 180m deducted to 0');
assert.deepEqual(afterClear.quotaCounts, { w1: { 'q-ana': 2 } }, 'quotaCounts must survive clearDemo');
assert.equal(afterClear.sleepHistory.length, 1, 'Real sleepHistory must survive clearDemo');
assert.equal(afterClear.sleepRec.source, 'empty', 'Demo sleepRec must reset to empty');
console.log('[PASS] P1: clearDemoDataAction strictly removes demo seeds and preserves all real user grades/focus/quotas/sleep');

// Test Case C: APK cross-origin isolation vs Web same-origin hub sync
const hubStorage = {
  wb_eng_wrong: JSON.stringify({ abandon: 1, lemma: 1 }),
  wb_mastery_ch01: JSON.stringify({ 'wb-ex-1': 1 })
};
const hNative = createHarness(hubStorage, { isNative: true, nowIso: '2026-11-27T12:00:00Z' });
assert.equal(hNative.elements.get('hub-eng-link').textContent, '英语听写与错词 ↗');
assert(hNative.elements.get('hub-mastery-box').classList.contains('hidden'), 'APK must keep hub-mastery-box hidden');
const hWeb = createHarness(hubStorage, { isNative: false, nowIso: '2026-11-27T12:00:00Z' });
assert.equal(hWeb.elements.get('hub-eng-link').textContent, '错词本 2 词待刷 ↗');
assert(!hWeb.elements.get('hub-mastery-box').classList.contains('hidden'), 'Web PWA must display same-origin doubtful examples');
console.log('[PASS] APK cross-origin isolation hides invalid same-origin sync while Web PWA keeps it active');

// Test Case D: Midnight-wrapping shift + skip -> ICS SEQUENCE & Native Notification filtering + Early-8am comparison + Legacy quota migration
const customState = JSON.parse(h2.store.get('study_os_state'));
customState.uiIso = '2026-11-30';
customState.followToday = false;
customState.shifted['2026-11-30|m5'] = '23:45–00:15';
customState.skipped['2026-11-30|m1'] = true;
customState.isDemoData = false;
customState.quotaCounts = { 'q-ana': 3, 'q-alg': 2, 'q-vocab': 5 };
customState.vocabDone = { '2026-11-28': true, '2026-11-30': true };
customState.focusHistory = { '2026-11-29': 95 };
customState.calSelected = '2026-11-29';
customState.sleepHistory = [
  { date: '2026-12-02', deep: 100, light: 220, rem: 80, awake: 10 },
  { date: '2026-12-03', deep: 110, light: 230, rem: 80, awake: 10 },
  { date: '2026-11-28', deep: 120, light: 260, rem: 100, awake: 10 },
  { date: '2026-11-29', deep: 130, light: 270, rem: 100, awake: 10 }
];

const h3 = createHarness({ study_os_state: JSON.stringify(customState) }, { nowIso: '2026-11-27T12:00:00Z' });
h3.elements.get('btn-toggle-10d').click();
const saved3 = JSON.parse(h3.store.get('study_os_state'));
assert.deepEqual(saved3.quotaCounts.w1, { 'q-ana': 3, 'q-alg': 2 });
assert(h3.elements.get('quota-plans-list').innerHTML.includes('2 / 7'));
assert(h3.elements.get('cal-capsules').innerHTML.includes('95 min'));
assert(h3.elements.get('health-10d-grid').innerHTML.includes('早八 6.8h vs 非早八 8.2h（-80m，N=2/2）'));
console.log('[PASS] Quota migration + habit auto-link + historical focus capsule + wake-date early-8am insight verified');

h3.elements.get('btn-export-ics').click();
assert.equal(h3.savedExports.length, 1);
const ics = h3.savedExports[0].content;
const seqMatch = ics.match(/SEQUENCE:(\d+)/);
assert(seqMatch && Number(seqMatch[1]) > 1000000, 'Expected monotonic timestamp SEQUENCE in ICS, got: ' + (seqMatch && seqMatch[1]));
assert(ics.includes('UID:20261130-m1@studyos\r\n') && ics.includes('STATUS:CANCELLED\r\n'));
assert(ics.includes('UID:20261130-m5@studyos') && ics.includes('DTSTART;TZID=Asia/Shanghai:20261130T234500') && ics.includes('DTEND;TZID=Asia/Shanghai:20261201T001500'));
console.log('[PASS] ICS export emits monotonic SEQUENCE (' + seqMatch[1] + '), stable UIDs, STATUS:CANCELLED, and next-day DTEND');

h3.elements.get('btn-native-notify').click();
await new Promise((r) => setTimeout(r, 20));
assert.equal(h3.scheduledAlarms.length, 1);
const alarms = h3.scheduledAlarms[0];
assert(!alarms.some((a) => a.title.includes('几何学') && new Date(a.at).getDate() === 30));
assert(alarms.some((a) => a.title.includes('交周志') && a.body.startsWith('23:45–00:15')));
console.log('[PASS] Native notifications exclude skipped items and use shifted times');

// Test Case E: P1 edit edge cases across grades, quadTasks (q & subs), diary, ledger, diet
const hEdit = createHarness({}, { nowIso: '2026-11-27T12:00:00Z' });
const gradeInp = new hEdit.FakeElement('', 'input', hEdit.document);
gradeInp.className = 'gnode-s';
gradeInp.setAttribute('data-gnode-s', 'g1|r1p2');
gradeInp.value = '88';
hEdit.document.dispatch('change', { target: gradeInp });
const stateBeforeClear = JSON.parse(hEdit.store.get('study_os_state'));
stateBeforeClear.quadTasks.find((t) => t.id === 'qt1').subs[0].title = '改成我自己要做的题';
stateBeforeClear.quadTasks.find((t) => t.id === 'qt2').q = 'q1';
stateBeforeClear.backfills['2026-11-28'][0].t = '10:00–11:00';
stateBeforeClear.diary.find((d) => d.id === 'd1').text = '我自己改写过的反例';
stateBeforeClear.ledger.find((l) => l.id === 'l1').note = '自己改过的午饭备注';
stateBeforeClear.diet.find((dt) => dt.id === 'dt1').name = '自己改过的早饭名称';

const hEdit2 = createHarness({ study_os_state: JSON.stringify(stateBeforeClear) }, { nowIso: '2026-11-27T12:00:00Z' });
hEdit2.elements.get('btn-clear-demo').click();
const afterEditClear = JSON.parse(hEdit2.store.get('study_os_state'));
assert.equal(afterEditClear.grades[0].root.children[1].score, 88, 'User-edited grade score 88 must survive clearDemo');
assert.equal(afterEditClear.grades[0].root.children[1].userEdited, true, 'userEdited flag must survive migrateState');
assert.equal(afterEditClear.grades[0].root.children[2].score, null, 'Untouched seed score g1|r1p3 must still be cleared');
assert(afterEditClear.quadTasks.some((t) => t.id === 'qt1'), 'Modified qt1 subtask title must survive clearDemo');
assert(afterEditClear.quadTasks.some((t) => t.id === 'qt2'), 'Modified qt2 quadrant must survive clearDemo');
assert(!afterEditClear.quadTasks.some((t) => t.id === 'qt3'), 'Untouched qt3 must be cleared');
assert(afterEditClear.backfills['2026-11-28'].some((b) => b.id === 'bf1' && b.t === '10:00–11:00'),
  'Edited bf1 time must survive clearDemo');
assert.deepEqual(afterEditClear.diary.map((d) => d.id), ['d1'], 'Edited d1 survives, untouched d2 cleared');
assert.deepEqual(afterEditClear.ledger.map((l) => l.id), ['l1'], 'Edited l1 survives, untouched l2/l3 cleared');
assert.deepEqual(afterEditClear.diet.map((dt) => dt.id), ['dt1'], 'Edited dt1 survives, untouched dt2 cleared');
console.log('[PASS] P1 strict seed matching: edited grade/quad/backfill/diary/ledger/diet survive while untouched seeds clear');

// Test Case F: Web/PWA LIFO stack + Esc/IME + history sentinel cleanup on X/Esc close
hWeb.elements.get('btn-open-settings').click();
assert.equal(hWeb.getHistoryIndex(), 1);
assert.equal(hWeb.getHistoryState()?.studyOsOverlay, true);
hWeb.elements.get('btn-close-settings').click();
assert(hWeb.elements.get('settings-modal').classList.contains('hidden'));
assert.equal(hWeb.getHistoryIndex(), 0, 'Closing overlay via X must pop history sentinel');
assert.equal(hWeb.getHistoryState(), null);

// Open focus first, then settings -> LIFO must close settings before focus!
hWeb.elements.get('btn-open-focus').click();
hWeb.elements.get('btn-open-settings').click();
assert.equal(hWeb.getHistoryIndex(), 1);
hWeb.browserBack();
assert(hWeb.elements.get('settings-modal').classList.contains('hidden'), 'LIFO browserBack #1 must close settings-modal (opened second)');
assert(!hWeb.elements.get('focus-modal').classList.contains('hidden'), 'focus-modal (opened first) stays open');
assert.equal(hWeb.getHistoryIndex(), 1, 'History sentinel re-pushed while focus-modal remains open');
hWeb.browserBack();
assert(hWeb.elements.get('focus-modal').classList.contains('hidden'), 'LIFO browserBack #2 closes focus-modal');
assert.equal(hWeb.getHistoryIndex(), 0, 'History sentinel cleared after last overlay closes');

// Esc + IME + blur-first + direct search Esc
hWeb.elements.get('btn-open-search').click();
assert.equal(hWeb.document.activeElement.id, 'global-search-input');
hWeb.document.dispatch('keydown', { key: 'Escape', isComposing: true, keyCode: 229 });
assert(!hWeb.elements.get('search-modal').classList.contains('hidden'), 'IME Esc must not close search-modal');
hWeb.document.dispatch('keydown', { key: 'Escape' });
assert(hWeb.elements.get('search-modal').classList.contains('hidden'), 'Esc in #global-search-input closes search-modal directly');
assert.equal(hWeb.getHistoryIndex(), 0, 'Esc closing overlay must clean history sentinel');

hWeb.elements.get('btn-new-goal').click();
assert.equal(hWeb.document.activeElement.id, 'goal-title');
hWeb.document.dispatch('keydown', { key: 'Escape' });
assert(!hWeb.elements.get('goal-modal').classList.contains('hidden'), 'First Esc inside form input should only blur input');
assert.equal(hWeb.document.activeElement, null);
hWeb.document.dispatch('keydown', { key: 'Escape' });
assert(hWeb.elements.get('goal-modal').classList.contains('hidden'), 'Second Esc after blur closes goal-modal');
assert.equal(hWeb.getHistoryIndex(), 0);
console.log('[PASS] Web/PWA LIFO stack, Esc (IME/search/blur), and history sentinel cleanup verified');

// Test Case G: APK backButton isolation + LIFO stack + fallback to today + minimizeApp
await new Promise((r) => setTimeout(r, 20));
hNative.elements.get('btn-open-focus').click();
assert.equal(hNative.getHistoryPushCount(), 0, 'APK must NEVER push Web history sentinel');
hNative.elements.get('btn-open-settings').click();
hNative.elements.get('btn-quick-add').click();

hNative.triggerBack();
assert(hNative.elements.get('quick-add-box').classList.contains('hidden'), 'APK Back #1 closes quick-add-box (LIFO top)');
assert(!hNative.elements.get('settings-modal').classList.contains('hidden'));
assert(!hNative.elements.get('focus-modal').classList.contains('hidden'));

hNative.triggerBack();
assert(hNative.elements.get('settings-modal').classList.contains('hidden'), 'APK Back #2 closes settings-modal');
assert(!hNative.elements.get('focus-modal').classList.contains('hidden'));

hNative.triggerBack();
assert(hNative.elements.get('focus-modal').classList.contains('hidden'), 'APK Back #3 closes focus-modal');

const lifeNav = new hNative.FakeElement('', 'button', hNative.document);
lifeNav.className = 'nav-btn';
lifeNav.setAttribute('data-tab', 'life');
hNative.document.dispatch('click', {
  target: { closest: (sel) => (sel === '.nav-btn' ? lifeNav : null) }
});
assert.equal(JSON.parse(hNative.store.get('study_os_state')).tab, 'life');

hNative.triggerBack();
assert.equal(JSON.parse(hNative.store.get('study_os_state')).tab, 'today', 'Back on non-today tab switches back to today');
assert.equal(hNative.getMinimizeCount(), 0);

hNative.triggerBack();
assert.equal(hNative.getMinimizeCount(), 1, 'Back on clean today screen calls App.minimizeApp()');
console.log('[PASS] APK backButton isolation, true LIFO stack, tab fallback, and minimizeApp verified');

// Test Case H: Safe-area CSS contract
assert(/<body\b[^>]*\bclass="[^"]*\bapp-body\b[^"]*"/.test(html), '<body> must carry .app-body');
assert(!/<body\b[^>]*\bclass="[^"]*\bpb-24\b/.test(html), '<body> must not carry .pb-24 overriding .app-body safe-b');
assert(/<header\b[^>]*\bclass="[^"]*\bapp-header\b[^"]*"/.test(html), '<header> must carry .app-header');
assert(html.includes('.app-header { padding-top: var(--safe-t); }'), 'Missing .app-header safe-t rule');
assert(html.includes('.app-body { padding-bottom: calc(6rem + var(--safe-b)); }'), 'Missing .app-body safe-b rule');
console.log('[PASS] Top & bottom safe-area CSS contract verified');

// Test Case I: True async history.back()/browserBack() sentinel cleanup + condition polling + LIFO z-index alignment
const hAsync = createHarness({}, { isNative: false, asyncHistory: true, nowIso: '2026-11-27T12:00:00Z' });
hAsync.elements.get('btn-open-settings').click();
assert.equal(hAsync.getHistoryIndex(), 1);
assert.equal(hAsync.getPopstateCount(), 0);
hAsync.elements.get('btn-close-settings').click();
assert(hAsync.elements.get('settings-modal').classList.contains('hidden'));
assert.equal(hAsync.getHistoryIndex(), 1, 'history.back() must stay pending synchronously before async popstate');
await waitFor(
  () => hAsync.getPopstateCount() === 1 && hAsync.getHistoryIndex() === 0 && hAsync.getHistoryState() === null,
  'Async history.back() must decrement index and deliver popstate'
);

hAsync.elements.get('btn-open-focus').click();
hAsync.elements.get('btn-open-settings').click();
const zFocus = Number(hAsync.elements.get('focus-modal').style.zIndex);
const zSettings = Number(hAsync.elements.get('settings-modal').style.zIndex);
assert(zFocus >= 40 && zSettings > zFocus && zSettings < 50,
  `Expected dynamic z-index settings(${zSettings}) > focus(${zFocus}) and < 50`);
hAsync.elements.get('btn-close-settings').click();
assert.equal(hAsync.elements.get('settings-modal').style.zIndex, '', 'Closed modal zIndex must reset');
assert(!hAsync.elements.get('focus-modal').classList.contains('hidden'));
hAsync.elements.get('btn-close-focus').click();
await waitFor(
  () => hAsync.getPopstateCount() === 2 && hAsync.getHistoryIndex() === 0 && hAsync.getHistoryState() === null,
  'Closing last stacked overlay must deliver async popstate and clear sentinel'
);
assert.equal(hAsync.elements.get('focus-modal').style.zIndex, '');

// True async browserBack() after reopen must close modal cleanly without being swallowed
hAsync.elements.get('btn-open-settings').click();
assert.equal(hAsync.getHistoryIndex(), 1);
hAsync.browserBack();
assert(!hAsync.elements.get('settings-modal').classList.contains('hidden'), 'browserBack() must execute asynchronously');
await waitFor(
  () => hAsync.getPopstateCount() === 3 && hAsync.elements.get('settings-modal').classList.contains('hidden') && hAsync.getHistoryIndex() === 0,
  'True async browserBack() must close reopened settings-modal'
);

// X close -> immediate reopen before the stale popstate lands: stale pop must be swallowed, new modal stays open
hAsync.elements.get('btn-open-settings').click();
assert.equal(hAsync.getHistoryIndex(), 1);
hAsync.elements.get('btn-close-settings').click();
assert(hAsync.elements.get('settings-modal').classList.contains('hidden'));
hAsync.elements.get('btn-open-settings').click();
assert.equal(hAsync.getHistoryIndex(), 2, 'Reopen before stale popstate must push a fresh sentinel');
await waitFor(
  () => hAsync.getPopstateCount() === 4 && hAsync.getHistoryIndex() === 1,
  'Stale cleanup popstate must land without closing the reopened modal'
);
assert(!hAsync.elements.get('settings-modal').classList.contains('hidden'), 'Stale popstate must not close the reopened settings-modal');
hAsync.browserBack();
await waitFor(
  () => hAsync.getPopstateCount() === 5 && hAsync.getHistoryIndex() === 0 && hAsync.elements.get('settings-modal').classList.contains('hidden'),
  'Browser back after reopen must close settings-modal'
);
console.log('[PASS] True async popstate/browserBack sentinel cleanup & LIFO modal z-index alignment verified');

// Test Case J: Outlook-style week-axis current-time horizontal line (coordinates, boundaries, 3-day adjacent col, in-place tick)
const hNow = createHarness({}, { nowIso: '2026-11-28T12:11:00' });
const axisNow = hNow.elements.get('week-axis-wrap').innerHTML;
assert.equal((axisNow.match(/data-week-now=/g) || []).length, 1, 'Today must render exactly one current-time line');
assert(axisNow.includes('data-week-now="2026-11-28"'));
assert(axisNow.includes('12:11'));
assert(/top:\s*239px/.test(axisNow), '12:11 must map to top 239px');
assert(!hNow.elements.get('now-time').textContent.includes('12:11'), '#now-time must keep block time range, not wall clock');

const hPre = createHarness({}, { nowIso: '2026-11-27T12:11:00' });
assert(!hPre.elements.get('week-axis-wrap').innerHTML.includes('data-week-now'), 'Pre-launch must not render a current-time line');

const hEarly = createHarness({}, { nowIso: '2026-11-28T07:29:00' });
assert(!hEarly.elements.get('week-axis-wrap').innerHTML.includes('data-week-now'), 'Before 07:30 must hide line');

const hStart = createHarness({}, { nowIso: '2026-11-28T07:30:00' });
const axisStart = hStart.elements.get('week-axis-wrap').innerHTML;
assert(/top:\s*0px/.test(axisStart) && axisStart.includes('is-near-top'), '07:30 must render at top:0px with is-near-top');

const hLate = createHarness({}, { nowIso: '2026-11-28T23:39:00' });
const axisLate = hLate.elements.get('week-axis-wrap').innerHTML;
assert(/top:\s*824px/.test(axisLate) && !axisLate.includes('is-near-top'), '23:39 must render at top:824px');

const hEnd = createHarness({}, { nowIso: '2026-11-28T23:40:00' });
assert(!hEnd.elements.get('week-axis-wrap').innerHTML.includes('data-week-now'), 'At 23:40 [7:30, 23:40) must hide line');

const hNext = createHarness({}, { nowIso: '2026-11-29T12:11:00' });
const axisNext = hNext.elements.get('week-axis-wrap').innerHTML;
assert.equal((axisNext.match(/data-week-now=/g) || []).length, 1);
assert(axisNext.includes('data-week-now="2026-11-29"'));
assert(!axisNext.includes('data-week-now="2026-11-28"'));

// Spring Festival rest week still displays the clock line when viewing that week
const restSeed = JSON.parse(h1.store.get('study_os_state'));
restSeed.uiIso = '2027-02-06';
restSeed.followToday = true;
const hRest = createHarness({ study_os_state: JSON.stringify(restSeed) }, { nowIso: '2027-02-06T12:11:00' });
assert(hRest.elements.get('week-axis-wrap').innerHTML.includes('data-week-now="2027-02-06"'), 'Rest week must still render clock line');

// Mobile 3-day view: when uiIso is yesterday (2026-11-28) and today is 2026-11-29, line renders ONLY in adjacent 2026-11-29 col
const mobSeed = JSON.parse(h1.store.get('study_os_state'));
mobSeed.uiIso = '2026-11-28';
mobSeed.followToday = false;
mobSeed.weekAxisCompact = false;
const hMobAdj = createHarness({ study_os_state: JSON.stringify(mobSeed) }, { isMobile: true, nowIso: '2026-11-29T12:11:00' });
const mobHtml = hMobAdj.elements.get('week-axis-wrap').innerHTML;
const mobCols = mobHtml.split('data-axis-date="').slice(1);
assert.equal(mobCols.length, 3, 'Mobile 3-day view must render 3 day columns');
assert(!mobCols[0].includes('data-week-now=') && !mobCols[1].includes('data-week-now='), 'Non-today columns must not have now-line');
assert(mobCols[2].startsWith('2026-11-29"') && mobCols[2].includes('data-week-now="2026-11-29"'), 'Adjacent today column must carry now-line');

// Out of 3-day window -> hidden
mobSeed.uiIso = '2026-12-02';
const hMobOut = createHarness({ study_os_state: JSON.stringify(mobSeed) }, { isMobile: true, nowIso: '2026-11-29T12:11:00' });
assert(!hMobOut.elements.get('week-axis-wrap').innerHTML.includes('data-week-now='), 'Out-of-window today must not render line');

// In-place minute tick updates top & label WITHOUT rebuilding week-axis-wrap.innerHTML; crossing 23:40 rebuilds to remove line
const tickSeed = JSON.parse(h1.store.get('study_os_state'));
tickSeed.tab = 'list';
tickSeed.listSub = 'timetable';
const hTick = createHarness({ study_os_state: JSON.stringify(tickSeed) }, { nowIso: '2026-11-28T12:11:00' });
const wrapEl = hTick.elements.get('week-axis-wrap');
const writesBefore = wrapEl.innerHTMLWrites;
hTick.setClock('2026-11-28T12:31:00');
hTick.document.dispatch('visibilitychange');
assert.equal(wrapEl.innerHTMLWrites, writesBefore, 'Minute tick must update in-place without rebuilding week-axis-wrap.innerHTML');
assert.equal(wrapEl.querySelector('[data-week-now]').style.top, '256px');
assert.equal(wrapEl.querySelector('[data-week-now]').querySelector('.week-now-label').textContent, '12:31');

hTick.setClock('2026-11-28T23:40:00');
hTick.document.dispatch('visibilitychange');
assert(wrapEl.innerHTMLWrites > writesBefore, 'Crossing out of [07:30, 23:40) must rebuild axis to clear stale line');
assert.equal(wrapEl.querySelector('[data-week-now]'), null);
console.log('[PASS] Week-axis Outlook current-time line (coords, boundaries, rest week, 3-day adjacent col, in-place tick) verified');

// Test Case K: 3B Today Editorial Hero + Progress Ring + Vertical Timeline + Early-Past Fold + Quick-Add Slots + Weekend Tint + Floating Capsule Nav
// Static CSS contract checks for A1 (.hero-today-chip.hidden) & A2 (opaque right-aligned .week-now-label) & C1 (.scroll-fade-x)
assert(/\.hero-today-chip\.hidden[\s\S]*?display:\s*none/.test(html), 'A1: .hero-today-chip.hidden must explicitly force display:none');
assert(/\.week-now-label\s*\{[^}]*right:\s*3px;[^}]*background:\s*var\(--surface\);/.test(html), 'A2: .week-now-label must be right-aligned with solid surface background');
assert(html.includes('scroll-fade-x'), 'C1: horizontal subtab strips must carry scroll-fade-x');

// On Tuesday 2026-12-01 at 14:30:
// First verify B4: if t1 is done, but t2 (attendable class 10:00–12:25) has NO attendance recorded yet, t2 MUST NOT fold away!
const heroSeed = JSON.parse(h1.store.get('study_os_state'));
heroSeed.uiIso = '2026-12-01';
heroSeed.followToday = true;
heroSeed.blockDone['2026-12-01|t1'] = true;
const hUnrecAtt = createHarness({ study_os_state: JSON.stringify(heroSeed) }, { nowIso: '2026-12-01T14:30:00' });
assert(!hUnrecAtt.elements.get('schedule-flow').innerHTML.includes('id="btn-toggle-past-today"'),
  'B4: ended attendable lecture without attendance record must remain visible (not folded)');

// Once t2 has attendance recorded, both t1 and t2 cleanly fold into neutral "已收起 2 项已结束安排" (B3)
heroSeed.attendance['2026-12-01|t2'] = { status: '已到', note: '黎曼积分定义', course: '数学分析' };
const h3b = createHarness({ study_os_state: JSON.stringify(heroSeed) }, { nowIso: '2026-12-01T14:30:00' });

assert.equal(h3b.elements.get('hero-date').textContent, '12月1日');
assert(h3b.elements.get('hero-kicker').textContent.includes('周二'));
assert(h3b.elements.get('hero-countdown').textContent.includes('正在进行 · 距本段结束还有 80 分钟'),
  'Expected live remaining countdown, got: ' + h3b.elements.get('hero-countdown').textContent);
assert.equal(h3b.elements.get('hero-ring-num').textContent, '2/6');
// B5: at 2/6 with 0 focus minutes, ring subtitle shows percentage rather than "已完成"
assert.equal(h3b.elements.get('hero-ring-sub').textContent, '完成 33%');
const dashOff = Number(h3b.elements.get('hero-ring-fg').getAttribute('stroke-dashoffset'));
assert(dashOff > 100 && dashOff < 110, 'Expected ~2/6 ring stroke-dashoffset (~104.7), got: ' + dashOff);

// Primary Now-Card shows active item with live pill & ana accent
assert.equal(h3b.elements.get('now-tag-label').textContent, '此刻进行中');
assert(h3b.elements.get('now-card').className.includes('now-accent-ana'));

// Vertical timeline folds the 2 ended & recorded blocks by default, highlights active t3, and separates truncate title from shrink-0 badge (B2)
const flowCollapsed = h3b.elements.get('schedule-flow').innerHTML;
assert(flowCollapsed.includes('id="btn-toggle-past-today"') && flowCollapsed.includes('已收起 2 项已结束安排'));
assert(!flowCollapsed.includes('早间'), 'B3: fold bar must use time-neutral wording without hardcoded 早间');
assert(!flowCollapsed.includes('data-itemkey="2026-12-01|t1"'), 'Folded block t1 must be hidden when collapsed');
assert(flowCollapsed.includes('data-itemkey="2026-12-01|t3"') && flowCollapsed.includes('tl-card-active'));
assert(flowCollapsed.includes('</span><span class="tl-badge tint-ana">进行中</span>'),
  'B2: badge must sit outside the truncated title span');

const foldBtnFake = new h3b.FakeElement('btn-toggle-past-today', 'button', h3b.document);
h3b.document.dispatch('click', {
  target: { closest: (sel) => (sel === '#btn-toggle-past-today' ? foldBtnFake : null) }
});
const flowExpanded = h3b.elements.get('schedule-flow').innerHTML;
assert(flowExpanded.includes('data-itemkey="2026-12-01|t1"') && flowExpanded.includes('收起 ▴'),
  'Clicking fold bar must reveal folded blocks');

// Overdue unfinished morning block MUST NOT be swept into the fold bar!
delete heroSeed.blockDone['2026-12-01|t1'];
const hOverdue = createHarness({ study_os_state: JSON.stringify(heroSeed) }, { nowIso: '2026-12-01T14:30:00' });
const flowOverdue = hOverdue.elements.get('schedule-flow').innerHTML;
assert(!flowOverdue.includes('id="btn-toggle-past-today"'), 'Unfinished overdue morning task must never be hidden behind fold bar');
assert(flowOverdue.includes('data-itemkey="2026-12-01|t1"') && flowOverdue.includes('overdue-block'));

// Browsing another day reveals #btn-hero-today and clicking it jumps back to live today
const otherDayBtn = new h3b.FakeElement('', 'button', h3b.document);
otherDayBtn.className = 'day-btn';
otherDayBtn.setAttribute('data-day-iso', '2026-12-03');
h3b.document.dispatch('click', {
  target: { closest: (sel) => (sel === '.day-btn' ? otherDayBtn : null) }
});
assert(!h3b.elements.get('btn-hero-today').classList.contains('hidden'), 'Viewing non-today date must show #btn-hero-today');
assert(h3b.elements.get('qa-slot-now').classList.contains('hidden'), 'B1: quick-add now chip must hide off live today');
const backTodayFake = new h3b.FakeElement('btn-hero-today', 'button', h3b.document);
h3b.document.dispatch('click', {
  target: { closest: (sel) => (sel === '#btn-hero-today' ? backTodayFake : null) }
});
assert.equal(h3b.elements.get('hero-date').textContent, '12月1日');
assert(h3b.elements.get('btn-hero-today').classList.contains('hidden'));
assert(!h3b.elements.get('qa-slot-now').classList.contains('hidden'), 'B1: quick-add now chip must return on live today');

// B1: Quick-add slot preset at 14:30 -> 14:30–15:30; at 22:50 -> 22:50–23:50 (never backwards!); at 23:40 -> #qa-slot-now hidden
const slotBtnFake = new h3b.FakeElement('', 'button', h3b.document);
slotBtnFake.className = 'qa-preset-btn';
slotBtnFake.setAttribute('data-qa-slot', 'now');
h3b.document.dispatch('click', {
  target: { closest: (sel) => (sel === '.qa-preset-btn' ? slotBtnFake : null) }
});
assert.equal(h3b.elements.get('qa-time').value, '14:30–15:30');
h3b.setClock('2026-12-01T22:50:00');
h3b.document.dispatch('click', {
  target: { closest: (sel) => (sel === '.qa-preset-btn' ? slotBtnFake : null) }
});
assert.equal(h3b.elements.get('qa-time').value, '22:50–23:50', 'B1: late-evening quick slot must not clamp back to 22:30');
const hLateSlot = createHarness({ study_os_state: JSON.stringify(heroSeed) }, { nowIso: '2026-12-01T23:30:00' });
assert.equal(hLateSlot.elements.get('qa-slot-now').textContent, '此刻 至 23:55', 'B1: capped late slot must state its real end time');
const lateBtnFake = new hLateSlot.FakeElement('', 'button', hLateSlot.document);
lateBtnFake.className = 'qa-preset-btn';
lateBtnFake.setAttribute('data-qa-slot', 'now');
hLateSlot.document.dispatch('click', {
  target: { closest: (sel) => (sel === '.qa-preset-btn' ? lateBtnFake : null) }
});
assert.equal(hLateSlot.elements.get('qa-time').value, '23:30–23:55', 'B1: 23:30 quick slot must end at the 23:55 cap');
const hMidnightNear = createHarness({ study_os_state: JSON.stringify(heroSeed) }, { nowIso: '2026-12-01T23:40:00' });
assert(hMidnightNear.elements.get('qa-slot-now').classList.contains('hidden'), 'B1: after 23:35 #qa-slot-now chip should hide');

// A2 collision padding & 3D widget course kind check
const hCollide = createHarness({ study_os_state: JSON.stringify(heroSeed) }, { nowIso: '2026-12-01T13:30:00' });
assert(hCollide.elements.get('week-axis-wrap').innerHTML.includes('padding-right:36px'),
  'A2: block whose title band overlaps now-line must reserve right padding for label');
const snap3d = h3b.pushedSnapshots[h3b.pushedSnapshots.length - 1];
assert(snap3d.scheduleByDate['2026-12-01'].some((c) => c.name.includes('分析学') && c.kind === 'ana'),
  '3D: widget snapshot courses must carry Paper & Ink theme kind');

// Week-axis weekend column tint & floating capsule nav contract
const wkHtml = h3b.elements.get('week-axis-wrap').innerHTML;
const wkCols = wkHtml.split('data-axis-date="').slice(1);
const satCol = wkCols.find((c) => c.startsWith('2026-11-28"'));
const monCol = wkCols.find((c) => c.startsWith('2026-11-30"'));
assert(satCol && !monCol.slice(0, 60).includes('axis-col-weekend'));
assert(wkHtml.includes('axis-col-weekend') && wkHtml.includes('tint-class'));
assert(html.includes('nav-capsule-grid') && html.includes('border-radius: 9999px'));
console.log('[PASS] 3B+3D Polish (A1/A2/B1–B5/C1) + Widget Theme Kinds + Capsule Nav verified');
