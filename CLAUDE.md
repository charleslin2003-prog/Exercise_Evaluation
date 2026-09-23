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
  has both `doGet` (same config-reading logic as `Config.gs`) and `doPost` (writes
  submitted scores). Edit this when changing what data is loaded or how submissions
  are recorded. See "Backend / data architecture" below.

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

## Backend / data architecture

Two deployed Apps Script `/exec` URLs are hardcoded as `const`s near the top of the
`<script data-dc-script>` block. Neither is a secret (both are shipped client-side in
`Start.dc.html` already):

```
const CONFIG_URL = 'https://script.google.com/macros/s/AKfycbwNkZFG97TRdrB1NKqWFWasuMOMYn-Hf6b4M6UOZFK59mwM9DO0-qnWYa96n9ZPhiVuwA/exec';
const RECORD_URL = 'https://script.google.com/macros/s/AKfycbwIoR80BmRBvRWM2-dRrUcN0R6gEL_In1Ko4sBqbCBaixdgl_EDwOYgg5C-0Aft-yYx/exec';
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
| `演習資訊` | key/value rows, no fixed header — code scans column A for a `演習名稱` row and reads column B of that row | `exerciseName: string` |
| `人員代號` | `代號` | `codes: { value, label }[]` (dropdown options, `value === label`) |
| `評分標準` | `分數`, `標籤`, `說明` | `criteria: { score: number, label: string, desc: string }[]`, one row per score (1–5) |
| `項目與問題` | `項目名稱`, `問題ID`, `問題內容` | `items: { name: string, questions: { id, text }[] }[]`, rows grouped/ordered by first appearance of `項目名稱` |

`doGet` merges all four into one JSON payload: `{ exerciseName, codes, criteria, items }`.

### Record spreadsheet (`RECORD_SPREADSHEET_ID`) — read/written by `doPost`

| Sheet | Columns (header row, `RECORD_HEADERS`/`INDICATOR_HEADERS`) | Role |
|---|---|---|
| `評核紀錄` (`RECORD_SHEET_NAME`) | `演習名稱`, `項目名稱`, `問題ID`, `指標代號`, `分數`, `人員代號`, `送出時間` | Write target — `appendSubmission_` appends one row per answered question per submission (columns matched by header text via `indexOf`, not fixed position, so header order can change freely) |
| `指標` (`INDICATOR_SHEET_NAME`) | `問題ID`, `問題`, `問題所屬指標` | Read-only lookup — maps each `問題ID` to its `問題所屬指標`, used to fill `指標代號` when writing to `評核紀錄` |

`doPost` (`appendSubmission_`) is idempotent: the client sends a `submissionId`
generated once per submit attempt (`Start.dc.html`'s `submissionId` state), cached via
`CacheService` for 6h and guarded by `LockService`, so client-side retries after a
timeout don't create duplicate rows.

If sheet/column names change on the spreadsheet side, update the matching constants at
the top of `ConfigWithSubmit.gs` (`RECORD_SHEET_NAME`, `RECORD_HEADERS`,
`INDICATOR_SHEET_NAME`, `INDICATOR_HEADERS`, etc.) — don't hand-parse by position. Keep
the POST payload shape (`submissionId`, `fillerCode`, `itemName`, `answers: [{ id, score }]`)
in sync between `Start.dc.html`'s `submitScores()` and `ConfigWithSubmit.gs`'s
`appendSubmission_` if either side changes.
