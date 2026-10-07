# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This started as a **design mockup** exported from a visual design tool (an "appifact"
design canvas / DC — Design Component — editor) as a standalone static page, and it
still carries that shape: `Start.dc.html`'s markup and inline styles hold the design's
precise values (colors, font sizes, spacing, radii, shadows, layout), and a real
reimplementation should replicate those values in its own components rather than copy
the markup wholesale.

The data flow, however, is real and in production use: `Start.dc.html` fetches
exercise/code/criteria/question data from a live Google Apps Script backend on load and
posts scored answers back to it on submit; `Analysis.html` reads the aggregated results
back out. See "Backend / data architecture" below.

Content is 演習評核 (drill/exercise scoring) — a mobile-sized (390×844) flow for
picking an assessor code, picking an evaluation item from an accordion, answering that
item's questions on a 1–5 scale (with an optional per-question free-text 觀察紀錄), and
submitting.

### Branch state (dev)

`dev` points at a **test sandbox** owned by `charleslin2003@gmail.com`, not the client's
production files. The constants that differ from `master` are commented inline in each
file with the production value next to them — check those comments before merging.
Not every pre-merge decision is a constant. See **"The `action=sessions` exposure"** below —
accepted on `dev`, and a posture question that has to be re-answered before `master` serves
a real hospital.

| | dev (test sandbox) | master (production) |
|---|---|---|
| `CONFIG_SPREADSHEET_ID` | `1yiZDnbEFNHddzlTMWaz-bBgI0IvRWXMJ0H3WplyPJDk` | `1j3UCbdSKeOip4Nz-Ymek-mjAH3bGTqiZyI3G__-ubdQ` |
| `RECORD_SPREADSHEET_ID` | `1jD6DXmPgTV9664XoIveD_cqNQd9V8vq6aM7EtMoI6FM` | `11HeRKAHkVt4N7T8A8BG6EwstPMNc5EL2FZUIDDatGJ8` |
| `CONFIG_URL` / `RECORD_URL` | the two `AKfycbxuIddv…` / `AKfycbzQLAJCv3…` deployments | the `AKfycbyIEReG…` / `AKfycbzBiivE…` deployments |
| `REGISTRY_SPREADSHEET_ID` | `1oab1W2UFo71qeZ-fEz_cYtE__3dNFw_OG_7TzrUZdfk` (sandbox registry) | **absent** — `master` predates the registry. Merge it as `''` (registry off, every request takes the fallback tenant) until a production registry exists |

Verified live on 2026-10-06 against the sandbox: config branch returns 8 codes
(A01–A07 + TEST-USER); `doPost` writes; `action=analysis` returns
`analysisRows=16 / coverageRows=7 / learningRows=0`, 5 evaluator codes,
`icc2k≈0.5503`, `within1=0.750` over the record sheet's 101 rows.

## File roles

- `Start.dc.html` — the artboard (the evaluator-facing form). Contains:
  - An `<x-dc>` block: HTML-like template using a small custom templating syntax
    (`{{ expr }}` interpolation, `<sc-if value="{{ ... }}">`, `<sc-for list="{{ ... }}" as="x">`).
    Those two elements are the **only** control flow available.
  - A `<script type="text/x-dc" data-dc-script>` block: plain JS defining
    `class Component extends DCLogic` with a `constructor` (sets `this.state`) and a
    `renderVals()` method that returns the values/handlers the template binds to
    (e.g. `showSelect`, `rows`, `submit`, `setCode`). This is the only file you'll
    normally edit for screen flow and styling.
  - The `<helmet><style>` block and inline `style="…"` attributes hold the actual
    design values to preserve when reimplementing this UI elsewhere.
- `support.js` — **generated** DC runtime (a template compiler + React host) built from
  a separate `dc-runtime` TypeScript source project via `bun build.ts`. Do not hand-edit;
  there is no source for it in this repo. It parses `<x-dc>`/`<sc-if>`/`<sc-for>`
  templates, evaluates `{{ }}` expressions against `renderVals()` output, and mounts
  the result with React.
- `vendor/react.js`, `vendor/react-dom.js` — vendored React 18 UMD builds used by
  `support.js`. Not part of the design; don't modify.
- `apps-script/Config.gs` — `doGet`-only backend (reads config, no `doPost`), deployed
  behind `CONFIG_URL`. **It has drifted** from `ConfigWithSubmit.gs`: it has no registry
  code, no `啟用觀察紀錄`/`低分需說明門檻` labels, and no `nullSafeSheet_`/`safeHeaderCol_`
  guards. Seven functions used to be byte-identical between the two files; they no longer
  are. `Start.dc.html` only hits `CONFIG_URL` when the page URL carries **no** `?t=`/`?ex=`
  — which is exactly why the drift is tolerable (see "Which deployment serves the config
  branch" below).
- `apps-script/ConfigWithSubmit.gs` — the script deployed behind `RECORD_URL` and the one
  that gets edited. Serves the config branch, `action=analysis`, `action=selftest`,
  `action=exercises`, `action=sessions` (**no key** — see "Admin / listing endpoints"),
  `action=flush`, and `doPost`.
- `apps-script/Report.gs` — **container-bound** report generator (plan §3.1's 方案B), pasted
  under the 演習評核_設定 spreadsheet (擴充功能 > Apps Script), **not** a Web App and **not**
  deployed: save, reload the sheet, the 演習評核報告 menu appears. It never touches
  `ConfigWithSubmit.gs` and adds zero deploy risk — that is its entire reason to exist.
  Reads `action=analysis` over `UrlFetchApp` and lays the numbers into a copy of an
  owner-owned template Doc, then exports a PDF. **Never executed by anyone** — see
  "Report generator (方案B)".
- `apps-script/ReportDialog.html` — the `HtmlService` modal (560×680) `Report.gs` serves.
  Plain modern browser JS (it runs in Chrome, not the V8 `.gs` runtime), so the ES5 house
  style of the `.gs` files does not apply here. It drives generation by calling
  `reportStart` then `reportContinue` in a loop, one chapter batch per call, rendering a
  progress list, a timer, and the warnings/degradation log.
- `Analysis.html` — standalone (non-DC) dashboard page for reviewing aggregated results.
  Fetches `RECORD_URL?action=analysis&key=…` on load. Deliberately not linked from
  `Start.dc.html`; access control is the unshared URL plus the `key` query param.
  Five tab buttons render: 綜合評比 (overview), 4S 分析, 三項潛能雷達圖, 演習覆蓋率,
  統計方法. Two further panels (`#ranking`, `#detail`) exist in the DOM and are
  populated by `renderRanking()`/`renderDetail()` but have **no tab button** — commit
  `54b33dd` removed those buttons deliberately. See "Analysis.html UI structure".
- `assets/imdl-logo.png` — logo shown in `Analysis.html`'s header (replaces the original
  "EMERGENCY EXERCISE EVALUATION DASHBOARD" eyebrow text). Branding only; swap the file
  (keep the same path) to change it.
- `README.md` — the **owner-facing spreadsheet-filling contract**: what each sheet and
  column in 演習評核_設定 and 評核紀錄 means. If you change what the backend reads or
  writes, this file is part of the change.
- `docs/owner-guide-多醫院多演習.md` — owner-facing zh-TW runbook for the tenant registry:
  the 租戶註冊表 columns, 新增一家醫院 / 同院新增一場演習 / 結束演習 / 換金鑰 procedures,
  how to read `action=selftest`, and the hard rule about not editing the config
  spreadsheet mid-drill.
- `docs/multi-tenant-and-report-plan.md` — the design decision record this work was built
  from (four tenancy options with scores, three report options, the defect list D1–D5,
  the §6 cheap-fix list). Its "實作進度" section at the top records which parts are now
  built. The *rest* of the doc is still written in the future tense and still describes
  pre-implementation code positions — read 實作進度 first, and treat any `file:line`
  reference elsewhere in it as pointing at the pre-change code.

## Running / viewing

No build step. Serve the folder and open `Start.dc.html` in a browser (some browsers
block the scripts over `file://`):

```
python3 -m http.server
```

Then open `http://localhost:8000/Start.dc.html`, or
`http://localhost:8000/Analysis.html` for the dashboard.

Useful URL params while testing:

| Page | Param | Effect |
|---|---|---|
| `Start.dc.html` | `?t=` / `?ex=` | tenant / exercise slug; switches the config fetch to `RECORD_URL` and adds `tenant`/`exercise` to the POST body |
| `Analysis.html` | `?t=` / `?ex=` | forwarded onto `action=analysis` |
| `Analysis.html` | `?key=` | overrides the built-in `ANALYSIS_KEY` |
| `Analysis.html` | `?view=report` | opens the printable report view on load |

With **no** params at all, both pages issue byte-identical requests to what they issued
before multi-tenancy existed. That is a hard compatibility requirement, not an accident.

## Editing the mockup

- All app logic/state/content changes go inside the `<script type="text/x-dc" data-dc-script>`
  block in `Start.dc.html`: the `Component` class's `constructor`/`renderVals()`. There's
  no hardcoded content — exercise name, codes, criteria, and items/questions all come
  from `this.state.config`, fetched at runtime.
- Template expressions (`{{ ... }}`) can only reference keys returned by `renderVals()` —
  there's no separate binding step, so any new template value must be added there.
  **There is no ref/effect/measurement mechanism**; don't try to add one.
- Inline `style="…"` strings carry the actual design tokens (colors like `#161512`,
  `#7a4e0f`, `#f7f5ee`, error `#b00020`, borders `#d8d2bf`/`#e6e0cf`; radii; spacing) —
  preserve exact values when adjusting layout.

### Screens

`this.state.screen` is `'sessions' | 'select' | 'survey' | 'done' | 'exit'`. **There is no
`criteria` screen** — picking a leaf item goes straight to `'survey'`. `'sessions'` is the
initial screen only when `PICKER_MODE` (`?t=` present, `?ex=` absent); every other link
shape starts on `'select'` exactly as before. `renderVals()` returns five
mutually-exclusive `<sc-if>` booleans plus two loading states, and a sessions group:

| boolean | when |
|---|---|
| `showSessionsLoading` / `showSessionsError` / `showSessions` / `showSessionsEmpty` | `PICKER_MODE && screen === 'sessions'` — the `action=sessions` list. Past (`已結束`) rows are folded behind `showClosedToggle` and are not clickable. If the backend answers `REGISTRY_OFF`, or answers with no `sessions` array at all (an `/exec` deployed before `action=sessions` existed falls through to the config branch), `fallBackToSingleSession()` goes straight to `'select'` with the old `?t=`-only request, showing no error |
| `showSessionSwitch` | `PICKER_MODE` and a session has been picked — the 更換場次 link (on the select screen and the load-error screen) |
| `showLoading` / `showLoadError` | config fetch in flight / failed (`loadError` holds the message, `retryLoad` retries) |
| `showSelect` | `screen === 'select'` — the identity header, code dropdown, and the item accordion |
| `showSurvey` | `screen === 'survey'` — the per-question cards |
| `showDone` | `screen === 'done'` **and not** every leaf done |
| `showEnd` | `screen === 'done'` **and** every leaf done — the END screen, with 離開頁面 and 返回選擇項目 |
| `showExit` | `screen === 'exit'` — reached from END's 離開頁面 button. `window.close()` only works on script-opened tabs, so the handler always also switches to this screen so the evaluator gets a visible response |

### The picker is an accordion, not a grid

There is **no `gridDims`** and no computed grid. `flattenRows(nodes, path, depth, openGroupKey, out)`
(a top-level helper) flattens the item tree into the list of currently-visible rows:
every group node is always one row; an open group is immediately followed by its
recursively flattened children; every leaf is one row. `this.state.openGroupKey` is the
single currently-open group's path string (e.g. `"0"`) — only one group is open at a
time, and opening another replaces it. That assumes one level of grouping depth (today's
階段→情境 case); a 3+ level tree would need a different open-state design.

- Clicking a **group** row toggles `openGroupKey` and stays on `showSelect`.
- Clicking a **leaf** row sets `path` and switches `screen` to `'survey'`, clearing
  `answers`, `comments`, `submitError`, `submitRefusal`, `criteriaOpenIds`.
- `nodeAt(root, path)` resolves the pointed-at node; it's only used for the
  survey/done screens' `itemName`/`questions`, not for picker navigation.
- `collectLeafNames` walks the whole tree for the done-count / END detection.

### `showCriteria` is per-question, not a screen

Each question card has its own 評分標準 accordion: `this.state.criteriaOpenIds[q.id]`
drives the per-question `q.showCriteria` flag and `q.toggleCriteria` handler inside the
`questions.map(...)` in `renderVals()`. The whole-screen criteria view described in older
versions of this file does not exist.

### Per-question 觀察紀錄 (free text)

`this.state.comments` is keyed by question id. Inside `questions.map(...)` each question
exposes `showCommentBox`, `commentValue`, `setComment`, `commentPlaceholder`,
`commentRequired`, `showCommentHint`, `commentHintText`, `commentBoxStyle`.

- Shown unless `config.commentEnabled === false` (set via a `啟用觀察紀錄` row in 演習資訊).
- `config.commentRequiredBelow > 0` makes a comment mandatory for any question scored at
  or below that threshold: the placeholder changes, a `#b00020` hint line appears, and
  `submitDisabled` goes true. **This gate is client-side only** — the server never rejects
  a submission over comment content or length, so a half-deployed client can't lose scores.
- The client trims and caps at 500 chars; the server re-caps at `COMMENT_MAX_LENGTH_`.

### Identity header and submit gating

`renderVals()` returns `orgName`/`showOrgName`, `exerciseName` (unchanged 4-level
fallback: `exerciseName || exerciseTopic || exerciseCategory || orgName`),
`exerciseDateText`/`showExerciseDate` — a three-line 機構／演習／日期 header so an
evaluator handed the wrong link can see it. `showOrgName` is suppressed when the
fallback already collapsed `exerciseName` onto `orgName`.

`showSubmitClosed`/`submitClosedReason` surface the backend's `submitOpen === false`
(exercise disabled, or outside the submission window); the submit button is disabled and
relabelled 目前未開放送出 rather than accepting scores the server will refuse.

### URL params and storage key

```
const Q_PARAMS = new URLSearchParams(window.location.search);
const T_PARAM = Q_PARAMS.get('t') || '';
const EX_PARAM = Q_PARAMS.get('ex') || '';
```

This file **never reads `?key=` and never sends any key** — the config branch is
unauthenticated and every evaluator's phone fetches it.

`configRequestUrl(exid)`: with no params it returns `CONFIG_URL` unchanged (no `?` appended
at all); with either param it returns `RECORD_URL + '?t=…&ex=…'`, where `ex` is
`exid || EX_PARAM` — `exid` is the session picked in `PICKER_MODE` (`this.state.sessionExid`),
blank otherwise. See "Which deployment serves the config branch" for why.

`doneStorageKey(config, fillerCode, exid)` has two branches on purpose. **`exid` is
required** at every call site: drop it and two sessions of the same hospital share one key,
so 已完成 flags from one drill show up on the other:

```
no params  -> 'exerciseEvalDone:' + (exerciseName||exerciseTopic||exerciseCategory||'default') + ':' + code
with params-> 'exerciseEvalDone:' + T_PARAM + '/' + (exid || EX_PARAM) + ':' + code
```

`adoptDoneItems` copies a `?t=`-only link's old key (演習代號 slot `''`) into the picked
session's key once — only when the picked session is the registry's `預設演習` (the one the
old link resolved to) and the new key is still empty. It must run once `fillerCode` is known
(`setCode`), since the key contains the code.

The legacy branch is mandatory: an evaluator mid-drill on an already-distributed
no-param link must not lose their 已完成 flags on deploy. The param branch fixes defect
D2 (editing the exercise name used to wipe every evaluator's progress).

### scenePrefix

The two scene regexes and the strip regex are built from
`escapeRegExp(config.scenePrefix || 'SCENE')`, so a hospital that doesn't name its leaves
`SCENE A1` can set its own prefix in the registry. Both fallback mode and the migration
row yield `'SCENE'`, so matching is identical to before.

## Backend / data architecture

Two deployed Apps Script `/exec` URLs are hardcoded as `const`s near the top of
`Start.dc.html`'s `<script data-dc-script>` block (values per branch — see "Branch state"
above). Neither is a secret; both ship client-side already.

`apps-script/ConfigWithSubmit.gs` has no CI/deploy step: after editing it, redeploy
manually via the Apps Script editor (Deploy > Manage deployments > **edit the existing
deployment** behind `RECORD_URL` > Version: "New version" > Deploy), execute as "Me",
access "Anyone". Picking "New deployment" instead produces a different `/exec` URL, which
silently breaks `RECORD_URL` until updated to match.

### Tenant routing (方案 A, 租戶註冊表) — the fallback rule

This is the single most load-bearing piece of behaviour in the backend. `resolveTenant_(e, body)`
returns a tenant object `{ hid, exid, displayName, configId, recordId, recordSheet,
analysisKey, enabled, openFrom, openTo, scenePrefix, source, rowNumber, registryWarning }`,
resolving in exactly this order:

0. `hid` = `normSlug_(body.tenant)` || `normSlug_(e.parameter.t)` || `''`; `exid` likewise
   from `body.exercise` / `e.parameter.ex` (**POST body wins over query**). A code that is
   present but fails `normSlug_` is a hard `BAD_CODE` error, never silently blanked.
1. **`REGISTRY_SPREADSHEET_ID === ''` (the shipped state)** → `fallbackTenant_()`
   unconditionally, *even if `t`/`ex` were supplied*. Supplied codes are echoed back in
   the payload but have zero routing effect. Rationale: links may circulate with `?t=`
   before the registry exists, and failing them would take a live drill down.
2. **Registry configured but unusable** (openById throws, sheet missing, zero data rows,
   or zero rows survive `assertRegistrySane_`) → `fallbackTenant_()` with
   `registryWarning` set. Indistinguishable from case 1 to every client.
3. **Registry usable but `hid === ''`** → `fallbackTenant_()`. The hardcoded constants are
   the permanent "legacy / 第一場" tenant; this is what keeps already-distributed links alive.
4. **Registry usable and `hid !== ''`** → codes route, and **a miss is a hard error, never
   a fallback and never another row**: `NO_TENANT`, `NO_DEFAULT`, `AMBIGUOUS_DEFAULT`,
   `NO_EXERCISE`, `ROW_INVALID`.

`fallbackTenant_()` is built from the four constants that still exist:
`CONFIG_SPREADSHEET_ID`, `RECORD_SPREADSHEET_ID`, `RECORD_SHEET_NAME`, `ANALYSIS_KEY`.
The plan doc proposed deleting them; that is **overridden** — they are the fallback tenant
and must keep their current values. `fallbackTenant_()` is `enabled:true` with a null
window, so neither post-resolution gate can fire in cases 1–3.

Post-resolution gates (both modes):

- `啟用=N` blocks the config branch and `doPost` (`DISABLED`); **allows** `action=analysis`
  (the report is needed after the drill); appears in `action=exercises` with `enabled:false`.
- `開放送出起`/`開放送出迄` are checked **only in `doPost`** (`OUT_OF_WINDOW`). The config
  branch is not gated by the window; it reports `submitOpen:false` + `submitClosedReason`
  so the UI can grey out 送出 instead of accepting scores it will drop.

Every error is HTTP 200 with a JSON body (Apps Script can't set status codes): `error` is
the zh-TW sentence the UI prints verbatim, `errorCode` its machine-readable twin. **One
compat exception**: a bad/missing analysis `key` still returns exactly
`{error:'unauthorized', errorCode:'UNAUTHORIZED'}` — that string is byte-identical on
purpose because `Analysis.html` prints it.

`normSlug_` (`/^[a-z0-9][a-z0-9_-]{0,31}$/`, rejects `Date` outright) and
`isSpreadsheetId_` are the boundary that stops the Web App becoming an arbitrary-Drive
read proxy: **a slug is never passed to `openById`; spreadsheet IDs only ever come out of
a registry row.** `tenantSheetConfig_(t)` / `tenantSheetRecord_(t)` are the only places
that open a tenant's files, each with a zh-TW error.

### 租戶註冊表 (`REGISTRY_SPREADSHEET_ID`, sheet `租戶註冊表`)

Read by `readRegistry_()` via `findHeaderCol_` (alias matching, never by position), cached
under `reg:v2` for 120s. The **config spreadsheet is deliberately never cached** — "改試算表、
重整手機即生效" is a promise to the owner. Columns (aliases in the `REGISTRY_*_ALIASES_`
constants): `醫院代號`, `演習代號`, `顯示名稱`, `設定試算表ID`, `紀錄試算表ID`,
`紀錄分頁名稱`, `分析金鑰`, `啟用`, `開放送出起`, `開放送出迄`, `預設演習`, `scenePrefix`,
`檔案擁有者` (documentation only — never read by routing, never returned by any endpoint).
Full owner-facing meanings and examples are in `docs/owner-guide-多醫院多演習.md`.

`assertRegistrySane_(rows)` marks rows invalid in place (never throws):

| # | rule | scope |
|---|---|---|
| 1 | duplicate `醫院代號`+`演習代號` → **all rows in the group** invalid (not "first wins": identity must not depend on row order) | `啟用=Y` rows only |
| 2 | duplicate `紀錄試算表ID`+`紀錄分頁名稱` (blank sheet name substituted with the default) → all rows in the group invalid. This is the hard block on defect D1 | `啟用=Y` rows only |
| 3 | the same `分析金鑰` under two **different** `醫院代號` → all sharing rows invalid. Same key across two exercises of the *same* hospital is allowed | all rows (an archived key is still a live credential) |
| 4 | any required cell blank | that row |
| 5 | slug / spreadsheet-ID / datetime parse failure | that row |

An invalid row is **invisible to `resolveTenant_`** — a request matching it gets
`ROW_INVALID` with a generic message, never another row's data and never the fallback
tenant. The specific reason strings are returned **only** by `action=selftest`.

### Which deployment serves the config branch

`Start.dc.html` keeps **both** constants. With neither `?t=` nor `?ex=` it fetches
`CONFIG_URL` exactly as before, byte-identical; with either param present it fetches
`RECORD_URL` instead, because `CONFIG_URL` points at the separate `apps-script/Config.gs`
project, which has no registry code and would silently serve the hardcoded tenant for any
`?t=`. Do not "simplify" this into one unconditional URL.

### The `action=sessions` exposure (accepted on `dev`; **re-confirm before merging to `master`**)

`action=sessions` is the **second** branch with no auth of any kind. It is fetched by every
evaluator's phone on a `?t=`-only link, and it reads the registry. It is deliberately a
separate function from `action=exercises` rather than that endpoint with its key relaxed,
for three reasons, none of them optional:

1. `exercises`'s fallback branch **ignores `?t=`** and opens the hardcoded config
   spreadsheet. Unauthenticated, that branch alone would hand the legacy tenant's
   演習名稱／演習日期 to anyone, including a caller with no `?t=` at all.
2. One function, one red line. `exercises` may return file names because it sits behind
   分析金鑰; `sessions` may return nothing but registry text. Both lines inside one
   function behind an `if (key)` is unauditable.
3. `exercises` calls `openById` once per row (a 12-exercise hospital = 12 opens). An
   endpoint every phone hits without a key, sharing `doPost`'s quota, would be a free
   quota amplifier. `sessions` reads only `readRegistry_()` (already cached 120s) and
   opens **zero** spreadsheets — which is also why a row's label is 顯示名稱 and not
   演習名稱: the latter lives in the config spreadsheet, which this branch never opens.

The credential is knowing the 醫院代號 — exactly what the config branch already accepts,
and what `Start.dc.html` already carries in its URL while sending no key at all.

**State the delta rather than assuming it.** A `?t=` holder could already fetch the entire
項目與問題 question bank, the entire 人員代號 roster, every 評分標準 string, the
機構／演習 names and date, and POST scores into that exercise. `sessions` adds:

- **(a) the existence, count and codes of that hospital's other 演習代號.** This is the
  real change: it turns 演習代號 from a weak shared secret into an enumerable value, so the
  range of exercises one `?t=` holder can push scores into widens from 預設演習 to **every
  `啟用=Y` row of that hospital inside its submission window**.
- **(b) each one's 顯示名稱** — already visible to anyone who knew the 演習代號, since the
  config payload has always returned `displayName`.
- **(c) each one's status and window text** — *half* of this is new. For a session that is
  **not** open, `submitClosedReason` has always printed `windowText_` verbatim on the
  unauthenticated config branch. But `submitWindowState_` returns `reason: ''` while a
  session **is** open, and it collapses 尚未開放 and 已結束 into one identical sentence. So
  `sessions` newly exposes an open session's window text, and the distinction between
  「尚未開放」 and 「已結束」. Both are low-sensitivity; neither was previously derivable.

Accepted because 演習代號 was never a credential (`normSlug_` allows 32 chars, but owners
write `2026a`), and because letting one hospital's evaluators enumerate their own sessions
*is* the feature — there is no session picker without it.

Boundaries that do hold, and must keep holding:

- `hid` is required and always passes `normSlug_`; a missing `t` returns `NO_TENANT_CODE`
  **without calling `readRegistry_()` at all**.
- Only rows with `r.hid === hid` are considered. **No endpoint anywhere enumerates
  醫院代號**, and there is no wildcard, so there is no cross-tenant path.
- A slug is never passed to `openById`. Rows failing `assertRegistrySane_` are invisible
  (`ROW_INVALID`, generic message) — never another row's data, never the fallback tenant.
- Neither post-resolution gate moved, but they do not guard the same places. `啟用=N` still
  returns `DISABLED` from **both** the config branch and `doPost`. An out-of-window session
  is refused **only by `doPost`** (`OUT_OF_WINDOW`); the config branch serves it in full
  with `submitOpen:false` + `submitClosedReason`, exactly as it always has. So a session
  this endpoint lists but which is closed cannot have scores written, but *can* still have
  its form fetched — which was already true before the picker existed.
- `sessionSortable_` is the **only** place in the endpoint that builds a returned object,
  and the sort-only fields (`openFrom`, `openTo`, `isDefault`, `exid`) sit *outside* its
  `out`, so they physically cannot ride along in the JSON. Adding a returned field means
  editing that one function — which is what keeps the red line below checkable.

> ⚠️ **Return-value red line, stricter than `action=selftest` because this branch has no
> auth at all.** Never: any spreadsheet ID, 分析金鑰 (this branch never even compares one),
> `ADMIN_KEY`, 紀錄分頁名稱 or any sheet name, 檔案擁有者, registry row numbers,
> `registryWarning`, `assertRegistrySane_` reason strings, any other 醫院代號's row,
> 人員代號／問題ID／分數／觀察紀錄 or any cell contents, or any file name (it opens no
> file, so it cannot physically reach one).

> **Before merging to `master`, re-confirm this exposure is still the decision you want.**
> `dev` is a sandbox owned by one developer; `master` serves a real hospital. Nothing about
> the code changes at merge — this is a posture question, not a defect, and it belongs on
> the pre-merge checklist beside the spreadsheet IDs and keys.

### Config spreadsheet (per-tenant `設定試算表ID`, fallback `CONFIG_SPREADSHEET_ID`) — read by `doGet`

| Sheet | Columns (header row) | Read as |
|---|---|---|
| `演習資訊` | key/value rows, no fixed header — `readExerciseInfo_` scans column A for `機構名稱`/`演習名稱`/`演習主題`(or `主題`)/`演習類別`/`演習日期`/`說明`, plus the two **new** optional labels `啟用觀察紀錄` and `低分需說明門檻`, reading column B of each | `orgName`, `exerciseName`, `exerciseTopic`, `exerciseCategory`, `exerciseDate`, `exerciseDesc: string` (all optional, `''` when absent), `commentEnabled: boolean` (default `true`; only a literal `N`/`n`/`否`/`關閉`/`false` turns it off), `commentRequiredBelow: number` (default `0` = never required). `exerciseTopic` and `exerciseCategory` are **separate fields**, not aliases — the sheet has both a `主題` row (long descriptive title) and a `演習類別` row (short category) at the same time; conflating them silently drops whichever comes later. `Analysis.html`'s header pill uses `exerciseCategory`, its 主題 KPI card uses `exerciseTopic`, its 說明 card uses `exerciseDesc` |
| `人員代號` | `代號` | `codes: { value, label }[]` (dropdown options, `value === label`) |
| `評分標準` | `分數`, `標籤`, `說明` | `criteria: { score, label, desc }[]`, one row per score (1–5) |
| `項目與問題` | `層1`, `層2`, … (any number, in order; `層1`/`層2` also accept `情境階段`/`演練單元`) **or** `項目名稱` as a fallback single grouping column; plus `問題ID` (or `評核題號`), `問題內容` (or `評核題目`/`具體評核題目`), and an optional `測試情境與目標`/`測試情境` column | `items`: a tree whose depth = however many `層N` columns exist. Each leaf also carries `goal` (first non-blank 測試情境 under that leaf) |
| `對應指標` (`INDICATOR_SHEET_NAME`) | `問題ID`, `問題`, `問題所屬指標`, `評核潛能`, `4S 元素` | Read-only lookup, **not** part of `doGet`'s payload — read by `readIndicatorMap_` (write path, first three columns) / `readIndicatorFull_` (analysis path, all five). Lives in the config spreadsheet because it is config, not a record of a submission |

`readItems_` scans the header row for `層1`, `層2`, … in order; if no `層N` column exists
it falls back to grouping by `項目名稱` alone. A node with rows appended under it comes
back as `{ name, questions, goal }` (leaf); a node that only ever contained further groups
comes back as `{ name, children }`.

**Header guards** (plan §6.1/§6.2, now implemented): `nullSafeSheet_(ss, name)` throws a
zh-TW "找不到工作表：…" instead of letting a null sheet produce
`Cannot read property getDataRange of null`; `safeHeaderCol_(header, aliases, label)`
throws "… 缺少欄位：…" instead of `row[-1] === undefined` making a whole sheet read as
silently empty. ⚠️ `readItems_`'s `層N` probe must keep using plain `indexOf` — a `-1`
there is the loop terminator, not an error.

### Config payload (`doGet` with no `action`)

The existing keys are unchanged (`orgName`, `exerciseName`, `exerciseTopic`,
`exerciseCategory`, `exerciseDate`, `exerciseDesc`, `codes`, `criteria`, `items`), plus
nine additive fields: `tenant`, `exercise`, `displayName`, `scenePrefix`,
`commentEnabled`, `commentRequiredBelow`, `submitOpen`, `submitClosedReason`,
`tenantSource` (`'fallback' | 'registry'`, diagnostic only — clients must not branch on
it for data).

> **Two branches have no auth at all and every evaluator's phone fetches them: the config
> branch and `action=sessions`.** Neither payload may ever contain: `分析金鑰`/`ANALYSIS_KEY`,
> `ADMIN_KEY`, any spreadsheet ID, the record sheet name, registry row numbers,
> `registryWarning`, `assertRegistrySane_` reason strings, `檔案擁有者`, or file names.
> Assert this mechanically when changing **either** branch, and when adding a third.
> `docs/setup-三支apps-script.md` §3.1 驗證 item 2 is the only such check anyone actually
> runs, and it had no `action=sessions` item for the entire time that branch was live.

The whole branch is wrapped in try/catch returning
`{error:…, errorCode:'CONFIG_READ_FAILED'}`; it used to be bare, so a renamed sheet showed
evaluators a raw Apps Script HTML error page. `Start.dc.html`'s `loadConfig()`
correspondingly throws on `data.error` before `setState` — without that, an `{error}` 200
renders as a blank form with no codes and no items. `NO_RETRY_ERROR_CODES` marks the
tenant-routing codes as not worth retrying.

### Record spreadsheet (per-tenant `紀錄試算表ID`, fallback `RECORD_SPREADSHEET_ID`)

Sheet name is per-tenant (`t.recordSheet`, default `評核紀錄` /
`DEFAULT_RECORD_SHEET_NAME`). `appendSubmission_(body, t)` appends one row per answered
question, matching columns **by header text** via `findHeaderCol_`. Missing optional
columns are silently skipped, which is how both the old 7-column shape and today's
6-column shape work without code changes.

| Role | Columns |
|---|---|
| Required | `問題ID` (or `評核題號`), `分數`, `人員代號`, `送出時間` |
| Optional (pre-existing) | `演習名稱`, `項目名稱`, `情境階段`, `演練單元`, `指標代號` |
| Optional (**new**) | `觀察紀錄`, `醫院代號`, `演習代號`, `測試情境`, `評核潛能`, `4S 元素`, `評核題目` |

Alias arrays: `RECORD_COMMENT_ALIASES_`, `RECORD_TENANT_ALIASES_`,
`RECORD_EXERCISEID_ALIASES_`, `RECORD_GOAL_ALIASES_`, `RECORD_POTENTIAL_ALIASES_`,
`RECORD_S4_ALIASES_`, `RECORD_QUESTION_ALIASES_`. Notes:

- `RECORD_GOAL_ALIASES_` is a **separate constant** from the config-side
  `GOAL_HEADER_ALIASES_` even though the values currently match — one is a source column,
  the other a snapshot column; don't share the variable.
- `評核題目` and `評核題號` don't collide: `findHeaderCol_` runs a complete exact pass over
  all columns before any prefix matching, and neither string prefixes the other.
- `RECORD_INDICATOR_ALIASES_` was **not** extended. What's new is that `buildAnalysis_`
  now *reads* `指標代號` back; nothing read it before.
- All new text columns are added to the `textColIndexes` `'@'` number-format list — a
  value like `2026-01` in `演習代號` is precisely the Sheets auto-date hazard.
- `readIndicatorFull_` is called lazily, only when at least one of the
  `評核潛能`/`4S 元素`/`評核題目` columns resolves to `!== -1`.
- `觀察紀錄` is the only free-text column, which is why `sanitizeCell_`'s formula-prefix
  escaping matters there most.

**Label snapshotting** (defect D3): when the five snapshot columns are present, the labels
are frozen at submit time, so editing the config sheet for the next drill no longer
rewrites the previous drill's already-issued report.

**Idempotency**: the client sends one `submissionId` per submit attempt, reused across its
3 retries; `CacheService` (6h) + `LockService` dedup. The cache key is
`'sub_' + t.hid + '/' + t.exid + '_' + id` in registry mode and **exactly `'sub_' + id`**
in fallback mode — unprefixed, byte-identical to before, so a retry straddling the deploy
still dedups. `getScriptCache()` is one namespace for the whole project, which is why the
registry-mode prefix exists at all.

**POST payload**: `{ submissionId, fillerCode, itemName, answers: [{ id, score, comment }],
tenant, exercise }`, `Content-Type: text/plain;charset=utf-8` (avoids a CORS preflight
Apps Script can't answer). Keep this in sync between `Start.dc.html`'s `submitScores()`
and `appendSubmission_`. Responses are unchanged in shape:
`{ok:true, rows, duplicate}` / `{ok:false, error, errorCode}` (`errorCode` is new and
additive).

### Analysis endpoint (`doGet?action=analysis&key=…`)

The key is compared against the **resolved row's** `分析金鑰` (in fallback mode, the
`ANALYSIS_KEY` constant), so rotating a key is a one-cell edit with no redeploy.

`buildAnalysis_(t)` reads every row in the tenant's record sheet, keeping the **last** row
per dedup key, and joins each `問題ID` against `對應指標` and `項目與問題`. Dedup key is
`(醫院代號, 演習代號, 問題ID)` — the first two components come from the record row's own
columns when those columns exist, and are empty strings otherwise, so for today's 6-column
sheet it degenerates to exactly the previous `(問題ID)`-with-last-write-wins behaviour.
Per-tenant record files are what make a full-table read correct rather than merely
tolerable.

**Label precedence** — pin this exactly; the naive version changes today's numbers:

- `stage`, `itemName`: **unchanged** — `stageIndex` first, record column only as fallback.
  `情境階段`/`演練單元` already exist on the live sheet, so flipping their precedence would
  move today's output.
- `goal`, `potential`, `s4`, `indicator`, `question`: **snapshot-first** — use the record
  column when present and non-blank (`labelSource:'snapshot'`), else the join
  (`'join'`), else `''` (`'none'`).

Per-row fields: `{ questionId, stage, itemName, goal, potential, s4, indicator, question,
scores:[{code,score}], mean, sd }` plus the new `exerciseId`,
`comments:[{code,comment}]` (non-empty only, sorted by code), `labelSource`, and
`untriggered` (count of scores equal to 1 on that row).

Rows split into `analysisRows` (potential `回應`/`監測`/`預期`), `coverageRows` (potential
containing `覆蓋率`) and `learningRows` (`學習`). `learningRows` are excluded from `stats`
but still returned; the on-screen 排序視圖 panel and the report's opt-in R7 section are the
only places they surface.

`meta` keeps `orgName`/`exerciseName`/`exerciseTopic`/`exerciseCategory`/`exerciseDate`/
`exerciseDesc`/`generatedAt`/`evaluatorCodes` and adds `tenant`, `exercise`, `displayName`,
`scenePrefix`, `tenantSource`, `configFileName`, `recordFileName`, `recordSheetName`,
`recordRowCount` (raw rows before dedup), `commentCount`, and `labelSourceSummary`
(`{snapshot, join, none}` tallied over the three row arrays only — rows that never reach a
chart aren't counted, so the report's disclosure line matches what the reader sees).
File **names** are allowed here (this branch is key-protected) and feed 附錄C; spreadsheet
**IDs** never are.

`stats` keeps all seven existing keys with identical computation — `overall`, `potentials`,
`s4`, `coverage`, `icc2k` (Shrout–Fleiss ICC(2,k) over the evaluator intersection common to
every row; `null` with <2 common raters or <2 questions — and that is *not* an edge case:
one single-rater question nulls the whole dataset), `within1` (fraction of same-question
evaluator pairs differing by ≤1, computed per row so it doesn't need a rectangular matrix),
`potentialByS4` (cross-tab feeding the iso-3D chart). Both consistency figures are computed
over `analysisRows + coverageRows` (`consistencyRows`). Three keys are **added**:

- `untriggered: {n, total, rate}` — share of individual scores equal to 1 over
  `consistencyRows` (the 1 = 「劇本未走到」 problem: it was being averaged in with 2–5).
- `missingQuestions: [{questionId, stage, itemName, goal}]` — every question id in
  `readItems_` with zero scores. Blank question ids (owner separator rows) are skipped.
- `byEvaluator: [{code, n, mean, deviation}]` — 寬嚴傾向; `deviation` is that code's mean
  minus the mean of the row-means of the rows *they* scored, so scoring only hard questions
  doesn't read as strictness. Must be renderable anonymised.

### Admin / listing endpoints

| action | auth | returns |
|---|---|---|
| `selftest` | `?adminKey=` exact match against `ADMIN_KEY`. **Shipped value `''` = disabled**: returns `ADMIN_DISABLED` and touches no spreadsheet | `{ok, tenant, exercise, displayName, tenantSource, registry:{configured, readable, sheetFound, rowCount, validRowCount, invalidRows:[{rowNumber,reasons}], warning}, config:{…counts…}, record:{readable, writable, fileName, sheetName, headerColumns, rowCount, missingRequired, presentOptional, absentOptional}, messages:[zh-TW]}`. **File names, sheet names, header names and counts only** — no IDs, no keys, no 人員代號, no 問題ID, no scores, no cell contents. The write probe is `addDeveloperMetadata` + remove: it never appends a row and never sets a cell. This is the **only** place registry invalid-row reasons and the fallback-case-(ii) warning are ever visible |
| `exercises` | `?t=` + `?key=`, authorized iff the key matches the `分析金鑰` of at least one valid row with that `醫院代號` (sanity rule 3 is what makes this safe). Fallback mode ignores `t` and compares against `ANALYSIS_KEY` | `{tenant, exercises:[{exercise, displayName, exerciseName, exerciseDate, enabled, isDefault}]}` sorted by `演習代號`. **Includes `啟用=N` rows** with `enabled:false` — that's what a 過去演習 picker needs. Never returns IDs, sheet names, keys or 檔案擁有者. A row whose config file won't open contributes `''` names rather than failing the list |
| `sessions` | **none — no key of any kind.** `?t=` required (`NO_TENANT_CODE` without it, and the registry isn't even read). The second unauthenticated branch after the config branch; the trade-off it accepts (演習代號 becomes enumerable per hospital) is recorded in "The `action=sessions` exposure" above | `{tenant, sessions:[{exercise, label, status, statusText, openFromText, openToText, isDefault}]}` — only that `醫院代號`'s valid rows, including `啟用=N` ones as `status:'past'`. `label` is `顯示名稱`, falling back to the bare `演習代號`. `status` is `open`/`future`/`past`, derived from `submitWindowState_` so it can't disagree with `doPost`. Sorted server-side (open → future → past; 預設演習 first among open). Reads only the cached registry and **opens no spreadsheet**. Errors: `BAD_CODE`, `NO_TENANT`, `ROW_INVALID`, and `REGISTRY_OFF` (registry unset or unusable — the client's cue to fall back silently) |
| `flush` | same as `selftest` | `{ok:true, flushed:['reg:v2']}`. Scoped to the registry cache key **only** — it must never clear `sub_*`, or an in-flight retry would append duplicate rows |

`ADMIN_KEY` must not equal `ANALYSIS_KEY` and must appear in neither shipped HTML file.

## Analysis.html UI structure

All rendering is plain DOM string-building off one in-memory `DATA` object (the
`action=analysis` payload) assigned once on load — no framework, no React (unlike
`Start.dc.html`/`support.js`). Each tab has a `render*()` called from `init()`; there's no
reactive binding, so any update after `DATA` changes needs its `render*()` re-invoked.

`init()` also sets `document.title` and `#orgTitle` from
`meta.displayName || meta.orgName || '演習評核'` (Chrome's "Save as PDF" filename comes
from `document.title`), and the CSV filename from the same expression. `shortScene()` is
built from `meta.scenePrefix` (escaped) and is the one function all three code-using
places share.

### Tabs (five buttons)

- **綜合評比 (`#overview`)** — `kpis` grid: 主題/說明 (from `meta.exerciseTopic`/
  `exerciseDesc`, falling back to `—`; the header pill above the tabs uses the separate
  `exerciseCategory`), 評核官人數, 評核總數 (`analysisRows + coverageRows + learningRows`).
  Below that, one card holds three aligned sections in a `1fr 140px 1fr` title row +
  content row: 綜合能力柱狀圖 (isometric 3D potential × 4S bars, `svgIso3D`/`renderIso3D`),
  演習覆蓋率 (gauge, `svgCoverageGauge`), and 4S整備表現直方圖 (`barsSVG` — the simple
  non-stacked 4S average, *not* the 4S 分析 tab's stacked chart).
- **4S 分析 (`#s4`)** — `stackedHBarsSVG`: one horizontal bar per 4S category, stacked by
  演練單元/SCENE short code, segments in natural code order (`A1 < A2 < B < … < F`), colors
  from an HSL spectrum (hue 0–300° across the sorted list) so adjacent codes read as
  adjacent hues. Bar **length** is the real 4S average (`stats.s4[s4].mean`, ~1–5), not a
  sum; each segment's **width** is that scenario's share of the sum of per-scenario means,
  while its label (`D2 3.7`) shows the scenario's actual average. Bars sorted by total,
  descending. The sibling card is `情境編號對照表` (`#s4ScenarioTable`), mapping each short
  code to its full `goal` text (or raw `itemName`), with a matching color swatch per row.
- **三項潛能雷達圖 (`#radars`)** — one `svgRadar` per potential (回應/監測/預期), axes sorted
  clockwise lowest→highest (sorting happens inside `svgRadar()`, so every caller gets it).
  Each radar card is followed by a **separate** card (not nested, so chart height stays
  fixed regardless of table length) holding a `radarTable()` — 情境編號 / 指標 /
  具體評核題目 / 分數, ascending by score.
- **演習覆蓋率 (`#coverage`)** — coverage radar plus a `radarTable()` in the 覆蓋率指標摘要 card.
- **統計方法 (`#method`)** — static prose, not data-driven; update by hand if the stats
  computation changes.

### Panels with no tab button

- **`#ranking` (排序視圖)** — 依潛能分類 and 表現優劣排序 tables; the only place
  `learningRows` appear. Rendered on load, unreachable from the tab bar, and shown in the
  report only behind the `#includeRanking` opt-in.
- **`#detail` (評核官明細)** — per-question identified table with scope/evaluator filters,
  CSV export, and the `ICC(2,k)` badge (`#iccBadge`). Rendered on load, unreachable.

> **Do not add tab buttons for these two.** Commit `54b33dd` hid them deliberately:
> `#detail` is the per-assessor identified-score table plus CSV export, and in a
> ten-person quality department 人員代號 is at best a pseudonym. Re-exposing it should be
> its own decision with its own consent mechanism, not a side effect of another change.
> `#detail` is additionally force-hidden in report mode and in print
> (`body.reportMode #detail{display:none!important}` and the same inside `@media print`)
> so a future `.panel{display:block}` rule can't resurrect it.

### Report view (`body.reportMode`)

Entered by the 產生報告 button (`#reportBtn`, enabled only after `init()` succeeds) or by
`?view=report`. Exited by `#backBtn`. **Reuse is by CSS, never by cloning** — cloning would
duplicate the `covGrad`/`covClip` SVG ids and break one copy's gradient and clip-path, and
moving nodes would break the second toggle. `init()` populates every panel first; report
mode only changes visibility and reveals pre-placed `[data-reportonly]` wrappers, which sit
in the markup in document order so section order == DOM order.

Sections: R0 封面 `#reportCover` (with five `contenteditable` fields — 報告版次/文件編號/
製表/審核/核定 — persisted **nowhere**), R1 列印設定提示卡 `#reportHint` (screen-only;
holds the two checkboxes), R2 報告摘要 `#reportSummary` (new code: 總平均, three potentials,
覆蓋率, ICC(2,k), **within1 — rendered here for the first time anywhere**, 未觸發率,
優勢前三/待改善前三), R3–R6 reuse `#overview`/`#s4`/`#radars`/`#coverage` as-is, R7 reuses
`#ranking` **only when `#includeRanking` is checked (default off)**, R8 觀察紀錄彙整
`#reportComments`, R9 資料品質 `#reportQuality` (missingQuestions, untriggered,
recordRowCount vs deduped count, and a one-line `labelSourceSummary` disclosure), R10
reuses `#method`, R11 附錄C `#reportAppendixC` (file names, sheet name, row count, tenant,
exercise, tenantSource, generatedAt — **no key, no spreadsheet ID, no URL**).

- **匿名模式 `#anonMode` is checked by default.** `anonCode()` maps each evaluator code to
  `評核官 N` by its index in the sorted `meta.evaluatorCodes`. Unchecking it requires a
  `window.confirm()` — the identified view is exactly what `54b33dd` hid, so re-exposing it
  through a report must be a deliberate, consented act.
- **Page numbers are impossible here.** Chrome implements no CSS paged-media margin boxes
  and offers no JS pagination hook, so the only page numbers available are Chrome's own
  header/footer — which also prints the document URL, i.e. the `?key=`. The mitigation:
  `enterReport()` calls `history.replaceState(null,'',location.pathname)` to strip the
  query string (`DATA` is already in memory, nothing re-fetches), and `#reportHint` states
  the consequence (a reload after that point needs the key again) and says plainly that a
  page-numbered, TOC'd, document-numbered PDF is 方案B territory, not this view.
- The file previously had **zero print styles**. The `@media print` block now fixes each
  concrete breakage: `.panel{display:none}` (only one tab would print), `.chartbox`
  min-heights, `.table-wrap{overflow:auto}` (clipped every row past the first viewport),
  sticky `th` (printed as a floating band), the teal header gradient, and the 3-column
  radar row. `-webkit-print-color-adjust:exact` is set, but Chrome's 「背景圖形」 checkbox
  still has to be ticked by the user or the iso3D cubes and HSL spectrum print white —
  `#reportHint` says so.

### 過去演習 button

`#viewPast` is enabled only when `meta.tenant` is non-empty (i.e. the backend actually
routed through the registry); it calls `action=exercises` and renders a list of
`?t=&ex=&key=` links in `#pastPanel`. In fallback mode it stays disabled, because there is
only ever one exercise to list.

## Report generator (方案B) — `apps-script/Report.gs` + `apps-script/ReportDialog.html`

The committee deliverable, as opposed to `Analysis.html`'s print view (方案A), which
`#reportHint` itself calls an internal review copy. Container-bound to the 演習評核_設定
spreadsheet; `onOpen()` builds a 演習評核報告 menu. **A container-bound script needs no
deployment** — paste, save, reload the sheet. That is the whole point: the owner cannot be
asked to redeploy a Web App (picking 「新增部署」 silently changes `/exec`), so the report
feature must not require editing `ConfigWithSubmit.gs` at all. It doesn't: the only coupling
is one `UrlFetchApp` GET to `action=analysis`.

> **Nobody has ever executed this code**, here or on the owner's machine — there is no way
> to run Apps Script from this repo. Every API that could not be confirmed from the outside
> is feature-detected and degrades rather than asserted. Treat the owner's first run as the
> test; `docs/owner-guide-多醫院多演習.md` §14.9 lists what to check and report back.

- **ES5 only in the `.gs`** (`var`, function declarations, no arrow/template-literal/`let`/
  `const`/`for…of`/spread) to match `ConfigWithSubmit.gs`. `ReportDialog.html` is browser JS
  and is not held to that.
- **No key in the file.** `PropertiesService.getScriptProperties()` supplies
  `REPORT_ANALYSIS_KEY` / `REPORT_API_URL` / `REPORT_TEMPLATE_DOC_ID` (required) and
  `REPORT_OUTPUT_FOLDER_ID` / `REPORT_TENANT` / `REPORT_EXERCISE` / `REPORT_TIME_BUDGET_MS`
  (optional); `REPORT_RUN_STATE` is program-maintained. This is the repo's **only** use of
  `PropertiesService` — net-new, and deliberate: `.gs` source gets copied, pasted and
  committed, and plan §6.6 is already paying for `ANALYSIS_KEY` being in git. `ADMIN_KEY` is
  deliberately absent: this script never calls `selftest` or `flush`.
- **The template Doc is a requirement, not a convenience.** `DocumentApp` has no page-number
  API at all, and page numbers are exactly why plan §3.1 ruled 方案A out as an archival
  record. Page numbers, header logo, fonts, margins, 標題1/2/3 named styles and the signature
  block live in an owner-owned template; the copy inherits them. The code only appends
  paragraphs with `setHeading(...)`.
- **Chapters are template data, not code.** Each `{{SEC_*}}` anchor paragraph is one chapter:
  deleting an anchor skips that chapter (and lists it in 附錄D), reordering anchors reorders
  the report. Six are required (摘要/基本資料/評核方法/資料品質/總體結果/附錄C) and a missing
  one refuses the whole run. An anchor must be a bare top-level body paragraph — inside a
  table cell, header/footer or list item, `body.getChildIndex` on the found `Text`'s parent
  silently inserts content in the wrong place, so `scanAnchors_` names each offender and the
  gate refuses.
- **Statistics come from the payload, never recomputed** — otherwise the Doc and the
  dashboard disagree and the owner has no way to tell which is right. The one exception is
  `verifyIcc_`, a local Shrout–Fleiss recomputation that also reports the included
  rater/question counts and, when `stats.icc2k` is `null`, names the questions that collapsed
  the intersection (one single-rater question nulls the whole dataset — plan §4.4).
- **Charts degrade, never fail.** `chartCapability_()` probes once per run on a hidden
  `_報告暫存` sheet: `Charts.ChartType['RADAR']` is bracket-accessed (passing `undefined` to
  `setChartType` throws unreadably), the generated PNG must exceed 1000 bytes (the known
  failure is a blank image, not an exception). Fallback chain per figure: native embedded
  chart → COLUMN/BAR redraw of the same numbers → a native Docs table of the same numbers →
  a paragraph naming the failure. Every degradation lands in `warnings[]`, the dialog, and
  附錄C. The iso-3D chart is deliberately not reproduced; it is `stats.potentialByS4`, and a
  grouped column chart carries the identical numbers.
- **Stepped execution.** Apps Script's 6-minute cap is handled by splitting across
  `google.script.run` calls (each gets its own quota), not by `try/finally` — a hard-limit
  kill doesn't run `finally`. Each call stops at `REPORT_TIME_BUDGET_MS` (240000 default) and
  returns `{runId, step, totalSteps, label, done, warnings, docUrl}`. A budget abort is
  **labelled in three places**: the draft banner in the Doc, the `（部分完成）` filename
  suffix, and the 報告狀態 column of 報告快照.
- **Double-click can't overwrite.** Four layers: `tryLock(0)`, the `REPORT_RUN_STATE`
  running check, 報告快照 being append-only — and the load-bearing one, **every run copies a
  brand-new Doc**, so the code never writes into an existing report file. Worst case is two
  independent reports, never half of one over a good one.
- **`報告快照` sheet** (on the config spreadsheet, append-only, all columns `'@'` text
  format) freezes this run's labels and aggregates before a single word is written to the
  Doc — directly closing D3, and the only possible data source for a future 與前次演習比較
  chapter. It records **no 人員代號, no per-evaluator score, no 觀察紀錄 text, ever, with no
  toggle.** The backend reads neither `報告快照` nor `_報告暫存`, so both sheets are
  zero-impact on the evaluator form and the dashboard.
- **Privacy follows `54b33dd`, which this must not become a back door around.** Anonymous is
  the pipeline default: evaluator codes render 評核官 1…N by index into the sorted
  `meta.evaluatorCodes`, the same rule as `Analysis.html`'s `anonCode()` so screen and paper
  name the same person. The code→number table is never printed. Identified output needs all
  three of a dialog checkbox, a `window.confirm()` spelling out the consequence, and a
  `{{SEC_評核官差異}}` anchor; choosing it marks the cover, 附錄C and `REPORT_RUN_STATE`.
  附錄B (per-question × per-evaluator matrix) is off by default even anonymised. 附錄C may
  print file **names** (it sits behind the key-protected payload) but never keys, spreadsheet
  IDs or the `/exec` URL — the same line the backend's `meta` already draws.
