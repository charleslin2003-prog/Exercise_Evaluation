# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is a **design mockup**, not a production application. It was exported from a
visual design tool (an "appifact" design canvas / DC — Design Component — editor)
as a standalone static page. Treat `Start.dc.html` as a REFERENCE MOCKUP: the markup
and inline styles carry the design's precise values (colors, font sizes, spacing,
radii, shadows, layout). A real implementation should replicate those values
faithfully in its own components/styling system rather than copy the markup wholesale.

Content is 演習評核 (drill/exercise scoring) — a mobile-sized (390×844) flow for
picking an assessor code, picking an evaluation item, viewing scoring criteria, and
answering a 5-question survey scored 1–5.

The design values (colors, spacing, etc.) are still illustrative-only, but the data
flow is real: `Start.dc.html` fetches exercise/code/criteria/question data from a live
Google Apps Script backend on load and posts scored answers back to it on submit. See
"Backend / data architecture" below.

## File roles

- `Start.dc.html` — the artboard. Contains:
  - An `<x-dc>` block: HTML-like template using a small custom templating syntax
    (`{{ expr }}` interpolation, `<sc-if value="{{ ... }}">`, `<sc-for list="{{ ... }}" as="x">`).
  - A `<script type="text/x-dc" data-dc-script>` block: plain JS defining
    `class Component extends DCLogic` with a `constructor` (sets `this.state`) and a
    `renderVals()` method that returns the values/handlers the template binds to
    (e.g. `showSelect`, `items`, `submit`, `setCode`). This is the only file you'll
    normally edit — screen flow, scoring items, questions, and styling all live here.
  - The `<helmet><style>` block and inline `style="…"` attributes hold the actual
    design values to preserve when reimplementing this UI elsewhere.
- `support.js` — **generated** DC runtime (a template compiler + React host) built from
  a separate `dc-runtime` TypeScript source project via `bun build.ts`. Do not hand-edit;
  there is no source for it in this repo. It parses `<x-dc>`/`<sc-if>`/`<sc-for>`
  templates, evaluates `{{ }}` expressions against `renderVals()` output, and mounts
  the result with React.
- `vendor/react.js`, `vendor/react-dom.js` — vendored React 18 UMD builds used by
  `support.js`. Not part of the design; don't modify.
- `apps-script/Config.gs` — `doGet`-only backend (reads config, no `doPost`).
- `apps-script/ConfigWithSubmit.gs` — the script actually deployed behind `RECORD_URL`;
  has `doGet` (same config-reading logic as `Config.gs`, plus an `action=analysis`
  branch that aggregates submitted scores), and `doPost` (writes submitted scores).
  Edit this when changing what data is loaded, how submissions are recorded, or how
  the analysis aggregation works. See "Backend / data architecture" below.
- `Analysis.html` — standalone (non-DC) dashboard page for reviewing aggregated
  results after evaluators submit. Fetches `RECORD_URL?action=analysis&key=ANALYSIS_KEY`
  on load. Deliberately not linked from `Start.dc.html` or anywhere else — the only
  access control is that its URL (this file's hosted path) isn't shared with
  evaluators, plus the `ANALYSIS_KEY` query param (see "Analysis endpoint" below).
  Tabs (`.tab`/`.panel`, plain show/hide, no routing): 綜合評比 (overview),
  三項潛能雷達圖, 演習覆蓋率, 4S 分析, 排序視圖, 評核官明細, 統計方法. See
  "Analysis.html UI structure" below for what each tab renders and from which
  `DATA` fields.
- `assets/imdl-logo.jpg` — logo shown in `Analysis.html`'s header (replaces the
  original "EMERGENCY EXERCISE EVALUATION DASHBOARD" eyebrow text). Not part of the
  evaluation-system design itself, just branding; swap the file (keep the same path)
  to change it.

## Running / viewing

No build step for the page itself. Serve the folder and open `Start.dc.html` in a
browser (some browsers block the scripts over `file://`):

```
python3 -m http.server
```

Then open `http://localhost:8000/Start.dc.html`.

## Editing the mockup

- All app logic/state/content changes go inside the `<script type="text/x-dc" data-dc-script>`
  block in `Start.dc.html`: the `Component` class's `constructor`/`renderVals()`. There's no
  hardcoded content anymore (no `ITEM_NAMES`/`CRITERIA`/`QUESTIONS` constants) — exercise
  name, codes, criteria, and items/questions all come from `this.state.config`, fetched at
  runtime from the Apps Script backend.
- Screen transitions are driven by `this.state.screen` (`'select' | 'criteria' | 'survey' | 'done'`),
  gated by whether `this.state.config` has loaded (`showLoading`/`showLoadError` cover the
  fetch-in-progress/failed states), with `showSelect`/`showCriteria`/`showSurvey`/`showDone`
  booleans returned from `renderVals()` and consumed by `<sc-if>` blocks in the template.
- Template expressions (`{{ ... }}`) can only reference keys returned by `renderVals()` —
  there's no separate binding step, so any new template value must be added there.
- Inline `style="…"` strings carry the actual design tokens (colors like `#161512`,
  `#7a4e0f`, `#f7f5ee`; radii; spacing) — preserve exact values when adjusting layout.
- `config.items` is a tree, not a flat list: `doGet` builds either grouped nodes
  (`{ name, children }`) or leaf nodes (`{ name, questions }`), and the nesting depth is
  whatever the `項目與問題` sheet's `層N` columns define (see "Config spreadsheet" below).
  The `select` screen walks that tree with `this.state.path` — an index stack pushed one
  level at a time — instead of a single `selectedItem` index. `nodeChildrenAt`/`nodeAt`
  (top-level helper functions above `class Component`) resolve "what's at this path" for
  both the picker grid and the criteria/survey/done screens' `itemName`/`questions`.
  Picking a group node just extends `path` and stays on `showSelect`; picking a leaf node
  (one with `questions`) extends `path` *and* switches `screen` to `'criteria'`. For a
  1-level sheet (today's SCENE case) every root node is already a leaf, so `path` never
  grows past length 1 and behaviour is identical to the old flat-list version.
- The picker grid's layout is computed, not fixed at 3 columns: `gridDims(n, w, h)` (also a
  top-level helper) tries every column count and keeps whichever maximizes the smaller
  cell dimension, so a level with 5 items and a level with 11 items both render without
  scrolling ("夠大 / 不滑動") using the same `<sc-for list="{{ items }}">` markup — only the
  computed `gridStyle`/`it.style` strings change. `w`/`h` are hand-estimated pixel budgets
  for the two picker layouts (root screen with the header+dropdown showing, vs. a
  drilled-in sub-level with just a back bar), not measured from the live DOM — this
  template/runtime has no ref/effect mechanism to measure real layout, so don't try to add
  one; adjust the estimates in `renderVals()` directly if the design's paddings change.

## Backend / data architecture

Two deployed Apps Script `/exec` URLs are hardcoded as `const`s near the top of the
`<script data-dc-script>` block. Neither is a secret (both are shipped client-side in
`Start.dc.html` already):

```
const CONFIG_URL = 'https://script.google.com/macros/s/AKfycbwIoR80BmRBvRWM2-dRrUcN0R6gEL_In1Ko4sBqbCBaixdgl_EDwOYgg5C-0Aft-yYx/exec';
const RECORD_URL = 'https://script.google.com/macros/s/AKfycbzilnn3GjBAA6W-CkmFziFhpXW111kxRyyZZGZY9UQ0iihYVGd_QXlArZZpJHQui7rjLg/exec';
```

`Component.loadConfig()` fetches `CONFIG_URL` (`doGet`) on mount and stores the result
in `this.state.config`. Submitting the survey posts to `RECORD_URL` (`doPost`) instead —
these are two separate deployments, not the same URL, so redeploying one (e.g. after
editing `Config.gs`) doesn't affect the other; keep both in sync manually if the same
script backs both.

`apps-script/ConfigWithSubmit.gs` is the other end of that contract. Config (codes,
criteria, items) is read from spreadsheet ID `1yiZDnbEFNHddzlTMWaz-bBgI0IvRWXMJ0H3WplyPJDk`
("演習評核_設定", `CONFIG_SPREADSHEET_ID`). Submissions are written to a *separate*
spreadsheet, ID `1jD6DXmPgTV9664XoIveD_cqNQd9V8vq6aM7EtMoI6FM` ("演習評核_紀錄",
`RECORD_SPREADSHEET_ID`) — these are two different files, not the same one. It has no
CI/deploy step: after editing it, redeploy manually via the Apps Script editor (Deploy >
Manage deployments > edit the deployment behind `RECORD_URL` > Version: "New version" >
Deploy), execute as "Me", access "Anyone". Picking "New deployment" instead of "New
version" on an existing deployment produces a different `/exec` URL, which silently
breaks `RECORD_URL` in `Start.dc.html` until updated to match.

### Config spreadsheet (`CONFIG_SPREADSHEET_ID`) — read by `doGet`

| Sheet | Columns (header row) | Read as |
|---|---|---|
| `演習資訊` | key/value rows, no fixed header — `readExerciseInfo_` scans column A for `機構名稱`/`演習名稱`/`演習主題` (or `主題`)/`演習日期`/`說明` rows and reads column B of each | `orgName`, `exerciseName`, `exerciseTopic`, `exerciseDate`, `exerciseDesc: string` (all optional; empty string if the row isn't present). `exerciseTopic` accepts either `演習主題` or the shorter `主題` as the label — both land in the same field. `exerciseDesc` (`說明`) backs `Analysis.html`'s "說明" KPI card. |
| `人員代號` | `代號` | `codes: { value, label }[]` (dropdown options, `value === label`) |
| `評分標準` | `分數`, `標籤`, `說明` | `criteria: { score: number, label: string, desc: string }[]`, one row per score (1–5) |
| `項目與問題` | `層1`, `層2`, … (any number, in order; `層1`/`層2` also accept the named aliases `情境階段`/`演練單元`) **or** `項目名稱` as a fallback single grouping column; plus `問題ID` (or `評核題號`), `問題內容` (or `評核題目`/`具體評核題目`), and an optional `測試情境與目標`/`測試情境` column | `items`: a tree, nesting depth = however many `層N` columns exist. Each leaf node also carries `goal` — the first non-blank value of the 測試情境 column under that leaf (empty string if the column doesn't exist). `goal` drives `Start.dc.html`'s picker list text and is also surfaced per-question in the analysis payload (see `buildAnalysis_` below) as the preferred label over the raw stage name. |
| `對應指標` (`INDICATOR_SHEET_NAME`) | `問題ID`, `問題`, `問題所屬指標`, `評核潛能`, `4S 元素` | Read-only lookup, not part of `doGet`'s JSON payload — read separately by `readIndicatorMap_`/`readIndicatorFull_` (see "Analysis endpoint" below). Lives here because it's config data (defines potential/4S/indicator per question), not a record of a submission — despite `ConfigWithSubmit.gs`'s indicator-reading code being physically closer to the submission-handling code in the file |

`readItems_` (identical in `Config.gs` and `ConfigWithSubmit.gs`) scans the header row for
`層1`, `層2`, ... in order and treats those as the grouping columns, one tree level each —
e.g. `層1`/`層2` gives a 2-level tree (`階段` → `情境` → questions). If no `層N` column
exists at all, it falls back to grouping by `項目名稱` alone (today's 10/3 sheet — no
spreadsheet change needed). Each row's grouping-column values, read left to right, walk/build
the tree; the row's `問題ID`/`問題內容` are appended as a question under whichever node the
last non-blank grouping value landed on. A node with rows appended under it comes back as
`{ name, questions: [...] }` (a leaf); a node that only ever contained further groups comes
back as `{ name, children: [...] }`. For a 1-column sheet this produces the exact same flat
`{ name, questions }[]` shape as before — the tree format is a superset, not a breaking change.

`doGet` merges all four into one JSON payload: `{ orgName, exerciseName, exerciseTopic, exerciseDate, exerciseDesc, codes, criteria, items }`.

### Record spreadsheet (`RECORD_SPREADSHEET_ID`) — read/written by `doPost`

This spreadsheet holds **only** the write target — no config/lookup sheets live here.

| Sheet | Columns (header row) | Role |
|---|---|---|
| `評核紀錄` (`RECORD_SHEET_NAME`) | Required: `問題ID` (or `評核題號`), `分數`, `人員代號`, `送出時間`. Optional: `演習名稱`, `項目名稱`, `情境階段`, `演練單元`, `指標代號` | Write target — `appendSubmission_` appends one row per answered question per submission, matching columns by header text via `findHeaderCol_` (alias-then-prefix matching, not fixed position). Missing optional columns are silently skipped on write, not errors — this is how the sheet can be the old 7-column `演習名稱`/`項目名稱`/`指標代號` shape or the newer `情境階段`/`演練單元` shape (no `演習名稱`/`項目名稱`/`指標代號`) without code changes. `情境階段`/`演練單元` are filled per-question from `indexQuestionsByStage_(items)`, not from the client's submitted `itemName` directly. |

`readIndicatorMap_` (writing path) only uses the first three `INDICATOR_*_ALIASES_` columns to
fill `指標代號` when writing to `評核紀錄`; `readIndicatorFull_` (analysis path) also reads
`評核潛能` (`回應`/`監測`/`預期`/`學習`/one containing `覆蓋率`) and `4S 元素` (free-text
label, grouped dynamically — not hardcoded to specific strings). Both read from
`CONFIG_SPREADSHEET_ID`'s `對應指標` sheet (see the config spreadsheet table above), **not**
from this record spreadsheet.

`doPost` (`appendSubmission_`) is idempotent: the client sends a `submissionId`
generated once per submit attempt (`Start.dc.html`'s `submissionId` state), cached via
`CacheService` for 6h and guarded by `LockService`, so client-side retries after a
timeout don't create duplicate rows.

### Analysis endpoint (`doGet` with `action=analysis`) and `Analysis.html`

`CONFIG_URL`/`RECORD_URL` are both shipped in `Start.dc.html`'s client-side source, so
any evaluator's phone can read them from page source — a plain `?action=analysis`
query param on the same `/exec` URL would **not** be hidden from evaluators. Access
control instead relies on an `ANALYSIS_KEY` constant defined in
`ConfigWithSubmit.gs`, which `doGet` requires as a `key` query param before returning
analysis data; `Analysis.html` is the only place that embeds this key. Both copies
are already set to the same generated random string (not the original
`REPLACE_WITH_RANDOM_SECRET` placeholder) — if you ever rotate it, both copies must
be updated together and `ConfigWithSubmit.gs` redeployed, the same way `RECORD_URL`
must be kept in sync after a redeploy.

`buildAnalysis_` reads every row currently in `評核紀錄`, keeping the *last* row per
`(問題ID, 人員代號)` pair (a re-submission for the same question by the same code
overwrites the earlier one), joins each `問題ID` against `對應指標` (`readIndicatorFull_`)
for potential/4S/indicator/question text, and against `項目與問題` (via
`readItems_`/`indexQuestionsByStage_`) for the top-level stage name, leaf item name,
and `goal` (測試情境). Every row in the returned payload (`analysisRows`,
`coverageRows`, `learningRows` alike) carries `{ questionId, stage, itemName, goal,
potential, s4, indicator, question, scores, mean, sd }`. Rows are split into
`analysisRows` (potential `回應`/`監測`/`預期`) and `coverageRows` (potential
containing `覆蓋率`); `學習` rows are **not** dropped — they come back as a third,
separate `learningRows` array, excluded from `stats` (so they don't pollute the
three-potential/4S aggregates) but still available for `Analysis.html`'s 排序視圖
tab, which is the one place that shows them. `stats` includes
per-potential and per-4S-label summaries (n/mean/sd/min/max), plus `icc2k`
(Shrout–Fleiss ICC(2,k), computed only over the evaluator-code intersection common to
every `analysisRows` row — returns `null` if fewer than 2 common raters or fewer than
2 questions) and `within1` (fraction of same-question evaluator score pairs differing
by ≤1, computed per-row over whichever raters actually scored that question, so it
doesn't require a rectangular matrix like `icc2k` does). Both are computed over
`analysisRows` **and** `coverageRows` combined (`consistencyRows` — everything except
the dropped `學習` rows), matching the scope the client's reference mockup used —
verified against that mockup's known output numbers (`icc2k=0.6858`, `within1=0.9846`
on its 26-row simulated dataset) while building this. `stats.potentialByS4` is a
potential × 4S-label cross-tab (`summarize_` output per cell, `n:0`/`mean:null` for
empty combinations) feeding `Analysis.html`'s isometric 3D bar chart on the overview
tab — everything else in `stats` is one-dimensional.

If `項目與問題` or `對應指標` structure changes (e.g. more `層N` levels, renamed
columns), `indexQuestionsByStage_`/`readIndicatorFull_` need matching updates — same
"don't hand-parse by position" rule as the rest of this file.

If sheet/column names change on the spreadsheet side, update the matching alias
constants at the top of `ConfigWithSubmit.gs` (`RECORD_SHEET_NAME`,
`RECORD_*_ALIASES_`, `INDICATOR_SHEET_NAME`, `INDICATOR_*_ALIASES_`, `GOAL_HEADER_ALIASES_`,
etc.) — don't hand-parse by position. Keep the POST payload shape (`submissionId`,
`fillerCode`, `itemName`, `answers: [{ id, score }]`) in sync between `Start.dc.html`'s
`submitScores()` and `ConfigWithSubmit.gs`'s `appendSubmission_` if either side changes.

## Analysis.html UI structure

All rendering is plain DOM string-building off one in-memory `DATA` object (the
`action=analysis` JSON payload) assigned once on load — no framework, no React (unlike
`Start.dc.html`/`support.js`). Each tab has a `render*()` function called from `init()`
and re-run as needed; there's no reactive binding, so any UI update after `DATA`
changes (there currently isn't one — the page loads once) would need its `render*()`
re-invoked manually.

- **綜合評比 (overview, `#overview`)** — `kpis` grid: 主題/說明 (from
  `DATA.meta.exerciseTopic`/`exerciseDesc`, falling back to `—`), 評核官人數,
  評核總數 (`analysisRows + coverageRows + learningRows` counts combined). Below
  that, one card holds three aligned sections in a `1fr 140px 1fr` title row +
  content row: 綜合能力柱狀圖 (the isometric 3D potential × 4S bar chart,
  `svgIso3D`/`renderIso3D`), 演習覆蓋率 (gauge, `svgCoverageGauge`), and 4S整備
  表現直方圖 (`barsSVG` — the simple, non-stacked 4S average; not the same chart
  as the 4S 分析 tab's stacked one). A separate 重點項目 card lists 優勢前三/
  劣勢前三 (top/bottom-3 across all potentials + coverage combined, ranked by
  mean, each row showing stage/goal + potential/s4 + score) and 評核一致性
  (ICC(2,k) + within-1 text).
- **三項潛能雷達圖 (`#radars`)** — one `svgRadar` per potential (回應/監測/預期),
  axes sorted clockwise from lowest to highest score (sorting happens inside
  `svgRadar()` itself, so every caller gets it for free). Each radar card is
  followed by a separate card (not nested inside the same `.chartbox`, so the
  chart's own height stays fixed regardless of table length) holding a
  `radarTable()` — indicator/question/score, sorted ascending, built from the
  same per-row data as the chart.
- **演習覆蓋率 (`#coverage`)** — coverage radar (`svgRadar`) plus a
  `radarTable()` in place of what used to be a plain bar list.
  覆蓋率指標摘要 card shows that table.
- **4S 分析 (`#s4`)** — `stackedHBarsSVG`: one horizontal bar per 4S category,
  stacked by 演練單元/SCENE short code (the `SCENE ` prefix stripped off
  `itemName`), segments ordered by natural code sort (`A1 < A2 < B < ... < F`).
  Segment colors come from an HSL spectrum (`hue = 0..300°` across the sorted
  code list, not a discrete palette) so adjacent codes read as adjacent hues.
  Bar **length** is the real 4S average (`DATA.stats.s4[s4].mean` — the same
  number shown in 4S 統計摘要), so it's always ~1–5; it is *not* a sum of the
  per-scenario means. Each segment's **width**, however, is that scenario's
  share of the sum of all per-scenario means for that S4 (`scenario mean / sum
  of means`), scaled against the bar's total — i.e. width shows relative
  contribution, not an absolute score. Segment label text is `code pct%` (e.g.
  `D2 37%`), not the scenario's actual mean — to read a scenario's real score,
  use the `情境編號對照表` below the chart or the radar-tab legend tables. Bars
  are sorted by their total (the 4S average) descending, largest first. The
  `情境編號對照表` card (`#s4ScenarioTable`) maps each short code to its full
  `goal`/測試情境 text (or the raw `itemName` if `goal` is empty), with a color
  swatch per row matching the chart segment color. 4S 統計摘要 (simple
  per-label mean/SD bars) is unchanged from before this chart existed.
- **排序視圖 (`#ranking`)** — 依潛能分類 and 表現優劣排序 tables; the only tab
  that includes `learningRows` (labelled accordingly), everything else excludes
  學習 entirely.
- **評核官明細 (`#detail`)** — per-question detail table with scope/evaluator
  filters and CSV export; the controls row also shows an `ICC(2,k) = …` badge
  (`#iccBadge`, right-aligned via `margin-left:auto` since `.controls` is flex).
- **統計方法 (`#method`)** — static prose, not data-driven; update by hand if the
  stats computation in `buildAnalysis_` changes.
