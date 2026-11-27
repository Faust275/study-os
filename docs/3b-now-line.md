# StudyOS 3B · 整周时间轴「当前时间横线」设计说明（已落地口径）

> 分支：`feat/3b-today`（基线 `main@ab724b6`）
> 状态：已在 `index.html` 与 `tools/verify-web.mjs` 落地实现并完成回归验证。
> 目标：借鉴 Outlook，在整周时间轴中给「今天」单列渲染随当前本地时间移动的横线，且不遮挡课程标题。

---

## 1. 最终效果

只画在**今天那一列**，不横跨整周：

```text
时间槽        周二（今天）                  周三
08:00        [ 晨间安排 ]                  [ 安排 ]
  ...             │                            │
12:00        [ 课程 / 自习         ]       [ 安排 ]
             ●────────────── [12:11]       [ 安排 ]
  ...             │                            │
```

具体行为：

- 横线位于今天列的对应时间高度，左端带墨色圆点，右端内侧贴附实底胶囊标签 `HH:mm`。
- 线只存在于今天列内部，不进入左侧时间刻度槽，也不延伸到其他日期列。
- 颜色使用中性墨水色（`var(--ink)` 混合），不使用「过时未做」的红色（`--danger`），避免语义冲突。
- 标签采用 100% 实色背景 `var(--surface)` + 细边框 `var(--line-strong)` 置于列右侧（`right: 3px; top: -8px`）；当今天列某个时间块标题带（`top + 8 ± 14px`）与当前时间横线重合时，`renderDayBlocks()` 自动为该时间块预留 `padding-right: 36px`，避免压住左侧课程标题。
- 整条线 `pointer-events: none`，不阻挡底层时间块点击。
- 普通分钟推进时只原地更新 `top`、`is-near-top` 与时间文本，不重建整个时间轴。
- 今天不在当前渲染窗口或当前时间越界时，整条线不渲染。
- 休息周不做额外隐藏：只要今天在该列且时间在轴范围内就显示（它是墙钟，不是学习进度）。

---

## 2. 坐标与显示条件

### 2.1 共享坐标常量

`WEEK_START_M`、`WEEK_END_M`、`WEEK_PX_PER_MIN`、`WEEK_TOTAL_H` 与 `renderDayBlocks()` / `renderWeekAxis()` 共用同一套映射：

```js
var WEEK_START_M = 7 * 60 + 30;   // 450 (07:30)
var WEEK_END_M = 23 * 60 + 40;    // 1420 (23:40)
var WEEK_PX_PER_MIN = 0.85;
var WEEK_TOTAL_H = Math.round((WEEK_END_M - WEEK_START_M) * WEEK_PX_PER_MIN); // 825
```

纵坐标公式：

```js
top = Math.round((nc.nowMin - WEEK_START_M) * WEEK_PX_PER_MIN);
```

| 当前时间 | top |
| --- | ---: |
| 07:30 | 0 |
| 12:11 | 239 |
| 23:39 | 824 |
| 23:40 | 不显示 |

每次计算统一调用 `computeNowContext()` 获取本地 `todayIso`、`nowMin` 与 `preLaunch`，不使用 UTC 或缓存的 `NOW_MIN`。

### 2.2 显示条件（同时满足）

```js
!nc.preLaunch
  && nc.nowMin >= WEEK_START_M
  && nc.nowMin < WEEK_END_M
  && iso === nc.todayIso
```

边界行为：

| 情况 | 行为 |
| --- | --- |
| 11-28 正式启动前（`preLaunch`） | 隐藏 |
| 今天不在当前周 / 不在手机 3 日窗口 | 隐藏 |
| 今天在手机 3 日窗口相邻列（非焦点列） | 正常显示在今天那一列 |
| 当前时间 `< 07:30` 或 `>= 23:40` | 隐藏（左闭右开，不夹取钉边） |
| 当前时间 `07:30`（`top < 14`） | 附加 `is-near-top`，标签下移避免顶边裁切 |
| 跨午夜 | 下次 tick / 可见性刷新自动重绘并切到新日期列 |
| 休息周 | 今天在范围内仍正常显示 |

---

## 3. 核心实现结构

### 3.1 单列横线渲染 `renderNowLine(iso, nc)`

```js
function renderNowLine(iso, nc) {
  if (!nc || nc.preLaunch || iso !== nc.todayIso) return '';
  if (nc.nowMin < WEEK_START_M || nc.nowMin >= WEEK_END_M) return '';
  var top = Math.round((nc.nowMin - WEEK_START_M) * WEEK_PX_PER_MIN);
  var hh = pad2(Math.floor(nc.nowMin / 60));
  var mm = pad2(nc.nowMin % 60);
  var nearTop = top < 14;
  return '<div class="week-now-line' +
    (nearTop ? ' is-near-top' : '') +
    '" data-week-now="' + nc.todayIso + '" style="top:' + top + 'px" aria-hidden="true">' +
    '<span class="week-now-dot"></span>' +
    '<span class="week-now-label">' + hh + ':' + mm + '</span>' +
    '</div>';
}
```

### 3.2 标题带避让（`renderDayBlocks`）

当渲染今天列（且非 7 日超窄缩略列）时，若某时间块首行标题带与横线高度重合（`Math.abs((top + 8) - curLineTop) <= 14`），为该时间块内联追加 `padding-right: 36px`，使长标题在右侧时间胶囊前自然截断，不发生文字叠压。

### 3.3 原地分钟更新 `updateWeekNowLine()` 与整分对齐时钟 `syncWeekNowClock()`

- `updateWeekNowLine()`：仅在 `state.tab === 'list' && state.listSub === 'timetable'` 时工作。若今天列不在当前窗口但旧线仍在、或今天列在窗口但线缺失/跨日，才调用一次 `renderWeekAxis()`；其余常规分钟推进只原地更新 `line.style.top`、`is-near-top` 和 `.week-now-label` 文本。
- `syncWeekNowClock()`：采用单次整分边界对齐 `setTimeout` + 稳定 `setInterval(..., 60000)`（配合 `clearTimeout` / `clearInterval` 清理，无递归定时器链），并在主 60 秒 ticker、`visibilitychange` 与 `window.focus` 时同步触发 `updateWeekNowLine()`。

### 3.4 样式契约

```css
.week-now-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  z-index: 6;
  pointer-events: none;
  border-top: 1.5px solid color-mix(in srgb, var(--ink) 55%, transparent);
}
.week-now-dot {
  position: absolute;
  left: -3.5px;
  top: -4px;
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  background: var(--ink);
  box-shadow: 0 0 0 2px var(--surface);
}
.week-now-label {
  position: absolute;
  right: 3px;
  top: -8px;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 9px;
  line-height: 14px;
  font-weight: 600;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: 0 1px 2px rgba(18, 22, 33, 0.06);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.week-now-line.is-near-top .week-now-label {
  top: 2px;
}
```

---

## 4. 自动化回归覆盖（`tools/verify-web.mjs`）

- `12:11` 精确映射 `top: 239px`，全轴唯一 `data-week-now`。
- 启动日前（`2026-11-27`）、`< 07:30`、`>= 23:40` 严格隐藏；`07:30`（`top: 0px` + `is-near-top`）与 `23:39`（`top: 824px`）边界精确显示。
- 跨日（`2026-11-29`）与休息周（`2027-01-20`）正常渲染。
- 手机 3 日视图在 `uiIso` 处于昨天时，今天相邻列仍准确画出横线。
- 分钟推进原地更新 `top` 与标签且不触发整轴 DOM 重建；标题带重合时自动注入 `padding-right:36px` 避让。
