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
item's questions on the drill's own 評分標準 scale — 1–5 on older drills, 0–4 (0 = 不予評分)
since 2026-10-16, see "The score scale follows 評分標準" — (with an optional per-question
free-text 觀察紀錄), and submitting.

### Branch state — **this branch is the production release (2026-10-14)**

This is the `dev` → `master` promotion described in
`docs/build-from-scratch-從零建置.md` §4. Every constant on this branch is the
**production** value; the sandbox values live only on `dev` and are deliberately no longer
restated in the inline comments, because those comments ship to the production site with
the HTML. The rollback point is the branch **`一版`** (and `origin/master` before this push),
at `a7d1871`.

| constant | value on this branch | note |
|---|---|---|
| `CONFIG_SPREADSHEET_ID` | `1j3UCbdSKeOip4Nz-Ymek-mjAH3bGTqiZyI3G__-ubdQ` | in **both** `ConfigWithSubmit.gs` and `Config.gs` — they must stay equal |
| `RECORD_SPREADSHEET_ID` | `11HeRKAHkVt4N7T8A8BG6EwstPMNc5EL2FZUIDDatGJ8` | |
| `CONFIG_URL` / `RECORD_URL` | the `AKfycbxtcCix…` / `AKfycbzA5pE8…` deployments (the owner's own cloud account, since `abb1b2d`, 2026-10-14) | `Config` was **not** retired, so the two stay different values. The release's original `AKfycbyIEReG…` / `AKfycbzBiivE…` are no longer referenced by either page |
| `REGISTRY_SPREADSHEET_ID` | `1ZiluDuw…` (production 租戶註冊表, since `f813130`, 2026-10-14) | registry **on**: `?t=`/`?ex=` route, the session dropdown shows, and **`action=sessions` — no key of any kind — is live for a real hospital**. `f813130` flagged that this was the day the posture question had to be re-answered; `abb1b2d` then switched the frontend on after asserting **four** of the red-line items (no spreadsheet id, key, sheet name or row number — not 檔案擁有者, `registryWarning`, reason strings or file names). Nothing in the repo records the owner explicitly accepting the exposure. ⚠️ Also unverified: `abb1b2d`'s evidence used `wanfang-7f3a2c` / 2026a 萬芳醫地下空間 / 2026b 萬芳醫院急救站 — exactly the **sandbox** registry's rows (handover §4), the same hid `f813130` cited as proof a deployment was reading the sandbox. So no commit shows the live `RECORD_URL` deployment reading the *production* registry; resolve a production-only 醫院代號 before relying on it |
| `REPORT_URL` (`Analysis.html`) | `AKfycby3amN8…` (the owner's report Web App, since `abb1b2d`) | 產生 Google 文件 is **enabled**. `docEndpoint` appends `&key=`, so this line may only ever name a deployment the owner controls — never a personal or dev one. That deployment answers `BAD_ACTION` to a bare GET and to `action=analysis` (verified in `abb1b2d`): it has zero keyless branches |
| `ADMIN_KEY` | `''` | `action=selftest` / `action=flush` disabled |
| `ANALYSIS_KEY` | **unchanged** | see the warning below — still byte-identical to `dev`'s |

> ⚠️ **Pushing this branch deploys the frontend, but none of the production Apps Script
> projects are updated by it.** Three Web Apps have to be pasted by hand: `ConfigWithSubmit.gs`
> (behind `RECORD_URL`), `Config.gs` (behind `CONFIG_URL`) and `Report.gs` (the report Web
> App behind `REPORT_URL`) — plus `Report.gs`'s container-bound copy **only if one exists**:
> the file's header still describes two copies, but handover §0.1 says the sandbox's
> container-bound project is gone, and `abb1b2d` lists only those three production
> deployments. Apps Script has no deploy hook; each has to be pasted in by an account with
> edit rights on the owner's projects, and each Web App redeployed via **edit the existing
> deployment → New version** — a Web App keeps serving its pinned version until then, and
> picking 「新增部署」 instead mints a different `/exec` and silently breaks the URLs above. Until that paste
> happens the site runs **new frontend + old backend**, which `docs/build-from-scratch-從零建置.md`
> §4-2 identifies as the one intermediate state that loses data: evaluators see the
> 觀察紀錄 box (the old backend returns no `commentEnabled`, so the client shows it) and
> **anything typed into it is silently dropped**, because the old backend never writes that
> column. Close that window fast, and do it outside a live drill.

Verified live on 2026-10-06 against the sandbox: config branch returns 8 codes
(A01–A07 + TEST-USER); `doPost` writes; `action=analysis` returns
`analysisRows=16 / coverageRows=7 / learningRows=0`, 5 evaluator codes,
`icc2k≈0.5503`, `within1=0.750` over the record sheet's 101 rows.

**Those numbers have drifted — re-measured 2026-10-12:** `recordRowCount=122` (was 101),
**6** evaluator codes (was 5), `icc2k≈0.5412` (was 0.5503); `within1=0.750` and
`16 / 7 / 0` unchanged. Nothing is wrong — the record sheet simply got longer. Noted
because `smoke.sh` deliberately asserts **no** statistic, so a drift like this is invisible
to the regression suite and anyone comparing against the old baseline will think something
broke.

> ⚠️ **`ANALYSIS_KEY` is NOT in the table above, because `dev` and `master` hold the
> *same* 32-char key — verified byte-identical on 2026-10-12.** So the sandbox and
> production are **not** isolated at the key layer: rotating one rotates the other, and a
> sandbox tester holds production's analysis key. The key being public is by design (see
> the exposure section below — `Analysis.html` embeds it and the dashboard's access control
> *is* "unlisted URL + that key"); **the two branches sharing one key is not.** This is what
> makes plan §6.6 (key rotation) more urgent than that doc implies, and it is the one item
> that cuts against the owner's standing instruction 「不要跟正式混用」. The fix is the one
> already designed: one key per registry row, with the old constant demoted to the fallback
> tenant only.

### The 2026-10-12 renames (情境→場景, 回應→反應) and the two folding layers

The owner renamed two pieces of vocabulary on 2026-10-12. Both were done the same way:
**the new name is canonical, the old name stays accepted, and nothing in the spreadsheets
had to change on the same day.** That is why the sandbox still reads correctly while its
sheets still carry the old words — and it is also the single most confusing thing in the
codebase right now, so read this before writing any comparison against a potential value
or a column header.

**情境 → 場景** (display wording *and* spreadsheet column names). Handled by putting the
new name first in each alias array, keeping the old one behind it:

| constant | value |
|---|---|
| `RECORD_STAGE_ALIASES_` | `['地點', '場景階段', '情境階段']` |
| `RECORD_GOAL_ALIASES_` | `['場景說明', '測試場景與目標', '測試場景', '測試情境與目標', '測試情境']` |
| `GROUP_HEADER_ALIASES_` | `[['地點','場景階段','情境階段'], ['演練單元']]` |
| `GOAL_HEADER_ALIASES_` | `['場景說明', '測試場景與目標', '測試場景', '測試情境與目標', '測試情境']` |

> **Second rename, 2026-10-16: 層1 → 「地點」, the goal column → 「場景說明」.** Same pattern —
> the new name went *in front* of each of the four arrays above (and the `Config.gs` copies of
> `GROUP_HEADER_ALIASES_`/`GOAL_HEADER_ALIASES_`), every older name stays accepted. ⚠️ Unlike
> 10-12, the owner **renamed the sheet first**: 萬芳醫院急救站's 項目與問題 A1 already read
> 「地點」 when this landed, and every backend deployed before it throws 「項目與問題缺少欄位：
> 項目名稱 或 層1/…」 on that header (verified by running the HEAD `readItems_` on it), so that
> drill's form and dashboard stay broken until **both** `ConfigWithSubmit.gs` and `Config.gs`
> are repasted. Display labels followed: `Analysis.html`'s 階段/測試場景 headers and
> `Report.gs`'s 階段/測試場景與目標 table headers now say 地點/場景說明. **`SNAPSHOT_COLUMNS_`
> (報告快照) still says 階段 / 測試場景與目標 on purpose** — renaming a snapshot header makes
> every report run throw until someone edits the live sheet (handover §3's ⛔).

**Four** arrays, not three. `RECORD_GOAL_ALIASES_` (record side) and `GOAL_HEADER_ALIASES_`
(config side) now hold identical values but are still separate constants on purpose — this
file says elsewhere "don't share the variable", and listing only three is exactly the drift
that warning exists to prevent.

`層2` is **not** renamed — it is still `演練單元`. Only `層1` changed. **Five** residues of
「情境」 remained outside `Analysis.html` after 10-12; the 10-16 rename resolved three of them
(struck through below). Of the two left, the anchor is deliberate and must not be "tidied
up", and the registry alias is a **miss, and a dangerous one**:

- `Report.gs`'s chapter-9 anchor is still **`{{SEC_情境}}`**, because an anchor must match
  the字 the owner literally typed in their template Doc. Changing it here without changing
  the template on the same day makes `scanAnchors_` miss it and chapter 9 vanishes, leaving
  one line in 附錄D. (`{{SEC_場景}}` appears in that file only inside the comment explaining
  this.)
- ~~`action=selftest`'s column labels~~ — since 2026-10-16 they print 地點 / 場景說明.
- ~~The `throw` naming `層1/情境階段`~~ — since 2026-10-16 it names `層1/地點`, still
  byte-identical in `ConfigWithSubmit.gs` and `Config.gs`.
- ⚠️ **`REGISTRY_SCENEPREFIX_ALIASES_ = ['scenePrefix', '情境前綴']`**
  (`ConfigWithSubmit.gs:124`, duplicated at `Setup.gs:73`) — **there is no `場景前綴`
  alias.** This is a registry *column name*, so an owner who follows the new vocabulary and
  retitles that header to 「場景前綴」 gets `findHeaderCol_` → `-1`, `scenePrefix` silently
  falls back to `'SCENE'`, and every scene-code match for that whole hospital is wrong with
  nothing visibly broken on screen. This is the worst kind of miss: a silent, hospital-wide
  wrong answer triggered by doing what the rename told you to do.
- ~~`Setup.gs:82` `DEFAULT_RECORD_HEADER_`~~ — since 2026-10-16 it starts with `地點`.

**回應 → 反應** (potential value only — no column name). This one is *not* an alias array,
because the value lives in spreadsheet **cells**, not headers, and the owner's sheet was not
going to be edited. So there are **two folding layers**, and they are both load-bearing:

1. **`normPotential_(v)`** in `ConfigWithSubmit.gs` — strips a trailing 「潛能」 (since
   2026-10-16), then `return s === '回應' ? '反應' : s;`, applied at `readIndicatorFull_`
   and at `buildAnalysis_`'s snapshot read. This is why the analysis payload says 反應 while
   the sheet says 回應 — or 反應潛能: a 對應指標 sheet the owner sent on 2026-10-16 writes
   `反應潛能`/`監測潛能`/`預期潛能` (handover §4), which before that fold landed in **none**
   of the three row groups, so every radar, 4S and ability chart was empty with no warning.
   Layer 2 below does **not** fold 潛能 and cannot: an old backend never returns those rows
   in any group, so there is nothing client-side to rewrite.
2. **`normalisePotentials(DATA)`** in `Analysis.html` — it does **two** things, and the
   first is the load-bearing one: it rewrites `r.potential` on every row of
   `analysisRows`/`coverageRows`/`learningRows`, *then* folds the `stats.potentials` and
   `stats.potentialByS4` keys. `renderRadars()` and `renderRanking()` filter rows with
   `r.potential === p`, not via `stats`, so folding only the stats keys would still leave
   all three radars empty. Added because the frontend shipped before the backend was pasted
   and the 反應 radar was blank for a while; kept deliberately, because a half-deployed
   backend must not blank a chart.

> ⚠️ **The config spreadsheet's 對應指標 sheet still literally contains `回應`** (verified
> 2026-10-12). So the intuitive move — "the sheet says 回應, so compare against 回應" —
> produces code where the **反應** bucket silently vanishes — not all three. `normPotential_`
> only maps 回應→反應; 監測 and 預期 pass through untouched, and the `analysisRows` splitter
> ORs the three conditions. So two potentials keep working and one disappears, which is
> *harder* to notice than a total failure. Compare against **`反應`**.

### ⚠️ Open on `master`: Vercel serves the whole repo, backend source included

Vercel publishes **every** file in the repo as a static asset, not just the two HTML
pages. Verified against the live production site on 2026-10-08:

```
200  https://exercise-evaluation.vercel.app/apps-script/ConfigWithSubmit.gs
200  https://exercise-evaluation.vercel.app/apps-script/Config.gs
200  https://exercise-evaluation.vercel.app/CLAUDE.md
```

so the real `CONFIG_SPREADSHEET_ID`, `RECORD_SPREADSHEET_ID`, the full backend logic and
this file are readable by anyone who guesses the path. `ANALYSIS_KEY` is in there too, but
that one was already public by design — `Analysis.html` embeds it, and the dashboard's
access control *is* "unlisted URL + that key". Spreadsheet IDs grant no access on their
own, so this is information disclosure, not a breach; the repo is public anyway, which is
why the owner judged it non-urgent.

`dev` fixes it with a root **`.vercelignore`** (commit `c106885`) excluding `apps-script/`,
`docs/`, `*.md`, `*.tsv` and the scratch HTML. It uses `.gitignore` semantics and is
honoured on Git-connected deployments, so no `vercel.json` and no build step. The site
needs only `Start.dc.html`, `Analysis.html`, `support.js`, `vendor/`, `assets/`.

**The owner decided on 2026-10-08 to fix `dev` only and leave production as-is**, so the
exposure stayed live on production until the **2026-10-14 release carried `.vercelignore`
across to `master`** — it is additive, one file, and changes no code. The three URLs above
**do 404 on the production site — re-verified 2026-10-16** (`apps-script/ConfigWithSubmit.gs`,
`apps-script/Config.gs`, `CLAUDE.md` all `404`); keep re-verifying, because this is the kind
of claim that rots. The pre-release commit (branch `一版`) still has no
`.vercelignore`, so rolling back re-opens the exposure. **Adding any new backend file,
internal doc or scratch file means adding it to `.vercelignore` too.**

> ⚠️ **But `.vercelignore` is NOT "the entire public/non-public boundary" — this file said
> that, and it was wrong.** It governs only whether *the website* serves a file. The repo is
> public, so git is a second outward-facing interface: a file excluded here is still readable
> on GitHub. The git side is the root **`.gitignore`** (added 2026-10-12, commit `19145c9`).
> Two layers, and they are not equally recoverable — a Vercel setting takes effect on the
> next deploy, whereas **git history cannot be cleaned**. This nearly bit on 2026-10-12: two
> `.tsv` spreadsheet exports were already listed under `.vercelignore`'s 「暫存／草稿檔」,
> which looks safe but only means the site won't serve them. **Be precise about the delta,
> because the first version of this note overstated it:** 對應指標 is absent from `doGet`'s
> payload and only reachable via `action=analysis` — but that key is embedded verbatim in
> the public `Analysis.html`, and `action=analysis` returns `indicator`/`potential`/`s4`/
> `question` per row, i.e. that sheet's substantive content. So the *added* exposure is
> close to zero. Keeping them out of git is still right — version control is not a dumping
> ground for spreadsheet exports, and git history cannot be cleaned — but not because the
> content is otherwise secret.

### Branch policy

`master` **is** the production version. It was frozen at `a7d1871` until the 2026-10-14
release promoted `dev` onto it (see the Branch state section above); the pre-release commit
is preserved as the branch **`一版`**, which is the rollback target. The rule was that outside
a release every change lands on `dev` and "更新" means `dev`. **In practice `master` has
taken direct commits since the release** (`f813130`, `abb1b2d`, `2201f36`, `7b946ee`, and the
2026-10-16 multi-4S change, which the owner asked for directly on 正式版) while `dev` stayed at
`4782edf` — so `dev` is now *behind* production. Ask which branch before starting; don't
assume `dev`, and don't promote `dev` onto `master` without first bringing those across.
A second Vercel project (`exercise_evaluation_test` →
`exerciseevaluationtest.vercel.app`, same GitHub repo) has its Production Branch set to
`dev`, so pushing `dev` deploys the test site and pushing `master` deploys the hospital's.
That setting lives under **Settings → Environments → Production → Branch Tracking**, not
under Settings → Git where it used to be. Neither site has an `index.html`, so the root
path 404s — URLs must name the file (`/Start.dc.html?t=…`).

## Where each fact lives (single source of truth)

Five documents describe this system, and the same fact written in two of them has already
rotted twice — the chart-fallback layer count was wrong in four files at once, and this file
once claimed `.vercelignore` was "the entire public/non-public boundary". So: **when a fact
below has an owner, documents other than the owner should cite it, not restate it.**

| fact | owner | don't restate in |
|---|---|---|
| Column names, aliases, accepted potential values | the `*_ALIASES_` constants in `apps-script/ConfigWithSubmit.gs` | anywhere — quote the constant name and let the reader look. `README.md` got four alias cells wrong by copying from the `RECORD_*` arrays into an `INDICATOR_*` table |
| How a 4S cell is split, and which words map to which canonical 4S name (cell *values*, not headers — row 1 covers headers) | `S4_VALUE_ALIASES_` + `splitS4_` in `apps-script/ConfigWithSubmit.gs` | the clients — `Analysis.html` and `Report.gs` read `r.s4List` and must **never** split themselves. `README.md` restates the words for the owner, who can't read code, and names the constant as the authority |
| The score scale — which buttons exist, chart min/max, which level is 不予評分／未觸發, r_wg's σ_E² | each drill's own 評分標準 `分數` column, derived server-side by `scaleOf_` in `apps-script/ConfigWithSubmit.gs` (→ `meta.scale`) and, for the evaluator's buttons only, by `scoreScale()` in `Start.dc.html` from the same sheet. The one fixed point is code, not data: **0 is never averaged** (`NOT_RATED_SCORE_`) | the clients — `Analysis.html` and `Report.gs` read `meta.scale` and must never hardcode `5`, `1 = 未觸發` or `σ_E² = 2` again. `README.md` explains it to the owner. The owner's current levels are live spreadsheet state (next row) |
| Chapter count, chart-fallback layer count | `apps-script/Report.gs` (`REPORT_SECTIONS_`, `emitChart_`) | cite the line number; never repeat the number |
| Live spreadsheet state (column counts, the literal 評核潛能 values, the owner's 評分標準 levels, registry windows) | `docs/handover-筆電.md` §4 | this file and `README.md` should point at it |
| Apps Script script properties | `apps-script/README.md` | — |
| Per-branch constants and key state | the Branch state table in this file | — |

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
- `apps-script/Setup.gs` + `apps-script/SetupDialog.html` + `apps-script/QrLib.html` —
  **container-bound** 新增一場演習 wizard, pasted under the **租戶註冊表** spreadsheet
  (*not* the config spreadsheet — that's `Report.gs`'s home). Like `Report.gs` it needs no
  deployment: paste, save, reload the sheet, the 演習場次管理 menu appears. It exists
  because opening a drill by hand is five error-prone steps (copy the config spreadsheet,
  add a record tab, invent a key, fill 13 registry columns, hand-assemble two URLs) whose
  failure mode is a cryptic `ROW_INVALID` on drill morning. One dialog does all five, runs
  the five sanity rules **before writing anything**, and ends with the evaluator URL + QR.
  - Writes in the order copy-config → create-record-tab → append-registry-row, deliberately:
    the registry row is written last, so a failure never leaves a row pointing at a file
    that doesn't exist.
  - 開放送出起/迄 are **mandatory in the wizard** even though the registry treats them as
    optional. Blank means "open forever", so every past drill shows 開放中 in the
    evaluator's session list and can still be submitted into.
  - Mirrors `normSlug_`, `isSpreadsheetId_`, `findHeaderCol_`, `formatDateTime_` and all
    five sanity rules from `ConfigWithSubmit.gs`. **That duplication is the file's one
    hidden coupling** — change the backend's copy and this must change too. Verified by a
    differential harness: 43/43 identical outputs on the three helpers, and identical
    invalid-row sets on five registry scenarios.
  - 醫院代號 is generated as `<醫事機構代碼>-<6 hex>`, never the bare public institution
    code. The code is public government data, and `?t=` is the only barrier between a
    stranger and submitting scores that overwrite a real evaluator's.
  - 地點 is folded into 說明 because `readExerciseInfo_` has no 地點 label; giving it one
    means editing and redeploying two Apps Script projects.
- `apps-script/QrLib.html` — vendored verbatim from `kazuhikoarase/qrcode-generator`
  (`js/dist/qrcode.js`, MIT, SHA-256 `79ec86f8…f791c`), wrapped in `<script>` so
  `SetupDialog.html` can `<?!= include('QrLib') ?>` it. Don't hand-edit. Generates QR codes
  **entirely in the browser**: an online QR image service would hand every 醫院代號 to a
  third party and leave it in their logs, which is the one thing the `?t=` code must not do.
  Call `qrcode(0,'M')` → `addData(url)` → `make()` → `createSvgTag({scalable:true})`, which
  returns one `<rect>` background plus a single `<path>`. That matters for print: an SVG
  path is *content*, so it survives Chrome's 「背景圖形」 checkbox being unticked — the trap
  `Analysis.html`'s iso-3D chart already fell into. Verified at 72 bytes of URL: 33×33
  modules at ECC L, 37×37 at M, with all three finder patterns structurally correct.
  (nayuki/QR-Code-generator was the first choice and was **rejected**: that repo ships only
  `.ts` plus a `build.sh`, so vendoring it would mean adding a TypeScript compile step.)
  It lives in `apps-script/` rather than `vendor/` because only the Apps Script dialog uses
  it, and `apps-script/` is `.vercelignore`d — so the public site doesn't ship 56 KB nobody
  loads. It is **inlined** into the dialog rather than loaded as
  `<script src="https://…/vendor/qrcode.js">`, because that would make the dialog depend on
  the deployed site happening to carry the file, and it currently exists only on `dev`.
- `apps-script/Config.gs` — `doGet`-only backend (reads config, no `doPost`), deployed
  behind `CONFIG_URL`. **It has drifted** from `ConfigWithSubmit.gs`: it has no registry
  code and no `nullSafeSheet_`/`safeHeaderCol_` guards. Seven functions used to be
  byte-identical between the two files; they no longer are. `Start.dc.html` only hits
  `CONFIG_URL` when the page URL carries **no** `?t=`/`?ex=` — which is exactly why the
  rest of the drift is tolerable (see "Which deployment serves the config branch" below).
  The `啟用觀察紀錄`/`低分需說明門檻` labels **were** part of the drift and are now synced
  (2026-10-08): without them this file returned no `commentEnabled`, `Start.dc.html` read
  `undefined`, and its `config.commentEnabled !== false` test left the comment box showing.
  So one spreadsheet cell turned the box off for `?t=` links and silently did nothing for
  no-param links — two behaviours from one sheet, keyed on link shape, which nobody would
  think to check. Verified by a differential harness over 10 label combinations: both
  copies of `readExerciseInfo_` now return byte-identical objects. **Keep them in sync** —
  and note this needs the Config project redeployed separately from `RECORD_URL`'s.
- `apps-script/ConfigWithSubmit.gs` — the script deployed behind `RECORD_URL` and the one
  that gets edited. Serves the config branch, `action=analysis`, `action=selftest`,
  `action=exercises`, `action=sessions` (**no key** — see "Admin / listing endpoints"),
  `action=flush`, and `doPost`.
- `apps-script/Report.gs` — report generator (plan §3.1's 方案B). **One source, pasted into
  two projects, byte-identical** (the file's own header is the authority): (A) container-bound
  under the 演習評核_設定 spreadsheet, not deployed — save, reload the sheet, the 演習評核報告
  menu appears (handover §0.1: the sandbox's (A) no longer exists, and none is recorded for
  production); and (B) a standalone project deployed as the **report Web App** behind
  `Analysis.html`'s `REPORT_URL` (its `doGet` serves `reportCheck`/`reportStart`/
  `reportContinue`/`reportStatus`/`reportAbandon`; no container, so it resolves the config
  spreadsheet through the registry). Neither copy touches `ConfigWithSubmit.gs`. Reads
  `action=analysis` over `UrlFetchApp` and lays the numbers into a copy of an owner-owned
  template Doc, then exports a PDF. `REPORT_BUILD_` is the only way to tell from outside
  whether the two copies have drifted — **bump it on every edit**. See
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
- `scripts/smoke.sh` — the **only** automated regression this project has. There is no CI
  and Apps Script has no deploy hook, so "did the redeploy break anything" otherwise depends
  on someone remembering to retype a dozen curls. Read-only by default and safe to re-run or
  schedule; `--with-write` adds the write-isolation and idempotency checks. Exit code 0/1.
  Keys come from `EVAL_KEY_MAIN`/`EVAL_KEY_CLINIC` env vars, never the file; without them the
  key-dependent checks SKIP rather than fail. It is *meant* to refuse to run against the
  production `/exec` ids — ⚠️ **but `guard_production` (`smoke.sh:42-48`) still matches only
  the retired `AKfycbzBiivE*`/`AKfycbyIEReG*`**, so since `abb1b2d` it does **not** block the
  current production `RECORD_URL`/`CONFIG_URL`/`REPORT_URL` (`AKfycbzA5pE8…`/`AKfycbxtcCix…`/
  `AKfycby3amN8…`). The same stale pair is the stop condition in
  `docs/dispatch-e2e-manual.md` (紅線 row 2 and §5-0), whose forbidden-spreadsheet row also
  lacks the production registry `1ZiluDuw…`, and `docs/build-from-scratch-從零建置.md` §4-0
  still cites the guard as protection. Fix all three before pointing `--with-write` or a
  dispatched e2e agent at anything. **It automates the one check CLAUDE.md says nobody actually runs**:
  asserting the keyless `action=sessions` payload carries no spreadsheet ID, key, sheet name,
  row number or 檔案擁有者. It also derives which session is `future`/`past` from the live
  registry instead of hardcoding 演習代號, so editing the registry doesn't silently rot it.
  Listed in `.vercelignore` — `scripts/` must never be served.
- `docs/manual-test-checklist.md` — the complement: only what genuinely cannot be automated,
  with the reason stated for each (Apps Script's `SpreadsheetApp`/`DriveApp`/`DocumentApp`
  exist only inside Google's runtime — no external tool, cloud agent included, can drive
  them; and QR scanning / print layout need a real screen and camera). Covers the wizard's
  untried copy-template path, the 預設演習 auto-clear, `Report.gs`'s whole pipeline, the
  phone flow, and printing. Don't duplicate anything `smoke.sh` already covers into it.
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

The score buttons above it (`q.options`, laid out by `q.optionsGridStyle`) are **not** a
hardcoded 1–5 any more: they come from the same 評分標準 rows via `scoreScale()`. The rules
are in "The score scale follows 評分標準" — don't restate them here.

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
returns a tenant object of **20** keys — `{ hid, exid, displayName, configId, recordId,
recordSheet, analysisKey, enabled, isDefault, openFrom, openTo, openFromText, openToText,
scenePrefix, source, rowNumber, registryWarning, requestedHid, requestedExid, reasons }`.
This file listed only 14 for a long time; the six that were missing are all load-bearing,
not decoration: `isDefault` decides 預設演習 (`valid.filter(r => r.enabled && r.isDefault)`),
`openFromText`/`openToText` are what `windowText_` prints and what `action=sessions`
returns, `reasons` is what `action=selftest` reports per invalid row, and
`requestedHid`/`requestedExid` are the echo-back read as `t.hid || t.requestedHid` in the
config branch's **success** payload and in `action=selftest` — **not** in any error message.
Error messages use `resolveTenant_`'s local `hid`/`exid`, and when nothing resolves it
*throws*, so no tenant object exists for `errorOut_` to read. Their real job is fallback
mode: `hid`/`exid` are `''` there, and the payload still has to hand the caller's own
`?t=`/`?ex=` back to the client unchanged.

Resolution happens in exactly this order:

0. `hid` = `normSlug_(body.tenant)` || `normSlug_(e.parameter.t)` || `''`; `exid` likewise
   from `body.exercise` / `e.parameter.ex` (**POST body wins over query**). A code that is
   present but fails `normSlug_` is a hard `BAD_CODE` error, never silently blanked.
1. **`REGISTRY_SPREADSHEET_ID === ''`** (the shipped state of the 2026-10-14 release; `master`
   has had a registry since `f813130`) → `fallbackTenant_()`
   unconditionally, *even if `t`/`ex` were supplied*. Supplied codes are echoed back in
   the payload but have zero routing effect. Rationale: links may circulate with `?t=`
   before the registry exists, and failing them would take a live drill down.
2. **Registry configured but unusable** → splits on `reg.readable`, because the two halves
   have opposite consequences:
   - **`readable === false`** (openById threw — Drive hiccup, permissions changed) →
     `fallbackTenant_()` with `registryWarning`, same as before. Hard-failing here would
     take a live drill down over a transient fault that usually clears itself.
   - **`readable === true` but no usable rows** (header cell edited, tab renamed, every row
     invalid) and the caller **supplied a `?t=`** → **hard error `REGISTRY_BROKEN`**. This is
     a human having broken the sheet, and the caller named a specific hospital.
   - No `?t=` → fallback either way; that is what keeps already-distributed no-param links
     alive.

   > The split exists because of a real incident on 2026-10-09. A tester pasted over the
   > registry's `分析金鑰` header cell and then cleared it. `findHeaderCol_` stopped finding
   > the column, `readRegistry_` returned zero rows, and **every** `?t=` request fell through
   > to the fallback tenant — so for two minutes a `?t=clinic-9b4e1d` link served 萬芳's
   > questions and would have written scores into 萬芳's record sheet, with nothing visibly
   > wrong on screen. One header cell silently collapsed the whole tenancy boundary. The
   > tester only noticed because the *analysis* endpoint returned `unauthorized`; the
   > evaluator-facing path fails silently, which is the dangerous half. A visible outage beats
   > writing scores into the wrong hospital.

   `REGISTRY_BROKEN` is in `Start.dc.html`'s `NO_RETRY_ERROR_CODES`: retrying cannot help, a
   human has to edit the sheet, and the registry cache is 120 s on top of that.
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
| 1 | duplicate `醫院代號`+`演習代號` → **all rows in the group** invalid (not "first wins": identity must not depend on row order) | all rows |
| 2 | duplicate `紀錄試算表ID`+`紀錄分頁名稱` (blank sheet name substituted with the default) → all rows in the group invalid. This is the hard block on defect D1 | all rows |
| 3 | the same `分析金鑰` under two **different** `醫院代號` → all sharing rows invalid. Same key across two exercises of the *same* hospital is allowed. A row whose `醫院代號` is blank or unparsable is **skipped on both sides** — it is not "a second hospital", it is a row rule 4/5 already rejected | all rows (an archived key is still a live credential) |
| 4 | any required cell blank | that row |
| 5 | slug / spreadsheet-ID / datetime parse failure | that row |

An invalid row is **invisible to `resolveTenant_`** — a request matching it gets
`ROW_INVALID` with a generic message, never another row's data and never the fallback
tenant. The specific reason strings are returned **only** by `action=selftest`.

> **Rules 1 and 2 were `啟用=Y`-only until 2026-10-08.** The justification in the code was
> 「已封存（啟用=N）的列不可能被路由到」, and that was simply false about this file:
> `resolveTenant_`'s `valid`/`pair` filters never look at `enabled`, 啟用 is a
> *post*-resolution gate, and `action=analysis` deliberately exempts itself from it so a
> finished drill's report stays readable. So an archived row is fully routable, and
> `buildAnalysis_` reads its record sheet end to end.
>
> The consequence an adversarial audit found: an owner follows the guide, archives 2026a,
> copies the row to 2027a next year and forgets to change `紀錄分頁名稱`. Rule 2 stayed
> silent — and on a record sheet with no `演習代號` column (today's shape) `buildAnalysis_`'s
> dedup key collapses to the bare `問題ID`, so the new drill's score **overwrites** last
> year's. That is defect D1, the exact thing rule 2 exists to hard-block. Rule 1 had the
> twin failure: one `啟用=Y` and one `啟用=N` row sharing a `(醫院代號, 演習代號)` both
> stayed valid, `resolveTenant_` then threw `ROW_INVALID` for every link carrying that
> `?ex=`, and `action=selftest` reported `invalidRows: []` — the only diagnostic lying
> about the only state it exists to explain.
>
> `buildAnalysis_` additionally skips a record row whose own `醫院代號`/`演習代號` are
> non-blank and don't match the resolved tenant. That is defence in depth behind rule 2,
> not the primary guard. **Both `&&` conditions are load-bearing**: a blank value means
> "written before those columns existed" and must be kept, and a blank `t.hid`/`t.exid`
> means fallback mode, where there is no exercise identity to filter on. On the sandbox's
> **7-column** sheet (verified 2026-10-12: `A1:G123`) neither column exists, so both resolve
> to `-1` and this changes no current number.

### Which deployment serves the config branch

`Start.dc.html` keeps **both** constants. With neither `?t=` nor `?ex=` it fetches
`CONFIG_URL` exactly as before, byte-identical; with either param present it fetches
`RECORD_URL` instead, because `CONFIG_URL` points at the separate `apps-script/Config.gs`
project, which has no registry code and would silently serve the hardcoded tenant for any
`?t=`. Do not "simplify" this into one unconditional URL.

### The `action=sessions` exposure (accepted on `dev`; **live on `master` since 2026-10-14**)

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

> **This was the pre-merge posture question, and it is no longer hypothetical.** `f813130`
> set the production `REGISTRY_SPREADSHEET_ID` and `abb1b2d` pointed the frontend at it on
> 2026-10-14, so a real hospital's `?t=` holders can now enumerate that hospital's sessions.
> See the Branch state table for what is (and isn't) recorded about that decision. Nothing
> about the code changed at merge — this is a posture question, not a defect.

### Config spreadsheet (per-tenant `設定試算表ID`, fallback `CONFIG_SPREADSHEET_ID`) — read by `doGet`

| Sheet | Columns (header row) | Read as |
|---|---|---|
| `演習資訊` | key/value rows, no fixed header — `readExerciseInfo_` scans column A for `機構名稱`/`演習名稱`/`演習主題`(or `主題`)/`演習類別`/`演習日期`/`說明`, plus the two **new** optional labels `啟用觀察紀錄` and `低分需說明門檻`, reading column B of each | `orgName`, `exerciseName`, `exerciseTopic`, `exerciseCategory`, `exerciseDate`, `exerciseDesc: string` (all optional, `''` when absent), `commentEnabled: boolean` (default `true`; only a literal `N`/`n`/`否`/`關閉`/`false` turns it off), `commentRequiredBelow: number` (default `0` = never required). `exerciseTopic` and `exerciseCategory` are **separate fields**, not aliases — the sheet has both a `主題` row (long descriptive title) and a `演習類別` row (short category) at the same time; conflating them silently drops whichever comes later. `Analysis.html`'s header pill uses `exerciseCategory`, its 主題 KPI card uses `exerciseTopic`, its 說明 card uses `exerciseDesc` |
| `人員代號` | `代號` | `codes: { value, label }[]` (dropdown options, `value === label`) |
| `評分標準` | `分數`, `標籤`, `說明` | `criteria: { score, label, desc }[]`, one row per level, in sheet order (often high→low). Since 2026-10-16 the `分數` column is not just display text — it **is** the drill's scale: the evaluator's buttons and `meta.scale` both come from it. See "The score scale follows 評分標準"; the owner's current levels are in handover §4 |
| `項目與問題` | `層1`, `層2`, … (any number, in order; `層1` also accepts `地點`, `場景階段` or the older `情境階段`, `層2` accepts `演練單元`; every `層N` may also be written `層一`/`層１` — `levelHeaderCol_`, both backends, trimmed, since 2026-10-16, after the owner followed the old error text 「層1」 and typed 「層一」, which no backend then accepted) **or** `項目名稱` as a fallback single grouping column; plus `問題ID` (or `評核題號`), `問題內容` (or `評核題目`/`具體評核題目`), and an optional `測試場景與目標` column (older `測試場景`/`測試情境與目標`/`測試情境` still accepted — see `GOAL_HEADER_ALIASES_`) | `items`: a tree whose depth = however many `層N` columns exist. Each leaf also carries `goal` (first non-blank 測試場景與目標 under that leaf) |
| `對應指標` (`INDICATOR_SHEET_NAME`) | Matched by **alias**, never by literal name — see the warning below | Read-only lookup, **not** part of `doGet`'s payload — read by `readIndicatorMap_` (write path, first three columns) / `readIndicatorFull_` (analysis path, all five). Lives in the config spreadsheet because it is config, not a record of a submission |

> ⚠️ **This row used to list `問題ID`, `問題`, `問題所屬指標`, `評核潛能`, `4S 元素` as if
> those were the headers. Four of the five do not exist on the live sheet.** They are the
> *first* entry of each `INDICATOR_*_ALIASES_` array, and the sheet mostly uses the *second*
> — but not uniformly, so don't lean on that rule either: `INDICATOR_POTENTIAL_ALIASES_` has
> exactly **one** element (`['評核潛能']`), and the indicator header is the literal string
> `單一指標對應` + **a newline** + `(RAG / 覆蓋率)`, which resolves only through
> `findHeaderCol_`'s prefix pass, not an exact match. Verified 2026-10-12, the actual header
> row is: `情境階段`／`演練單元`／`評核題號`／`評核潛能`／`單一 4S 元素`／
> `單一指標對應⏎(RAG / 覆蓋率)`／`具體評核題目`. Only `評核潛能` matches what was written
> here. This is the same failure mode as the 6-column→7-column note above: an auditor who
> predicts the header from this file gets it wrong. **Read `INDICATOR_*_ALIASES_` in
> `ConfigWithSubmit.gs`, not this table, when you need to know what resolves.**

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

> **THREE branches have no auth at all and every evaluator's phone hits them: the config
> branch, `action=sessions`, and `doPost`.** No payload of any of the three may ever
> contain: `分析金鑰`/`ANALYSIS_KEY`, `ADMIN_KEY`, any spreadsheet ID, the record sheet
> name, registry row numbers, `registryWarning`, `assertRegistrySane_` reason strings,
> `檔案擁有者`, or file names. Assert this mechanically when changing **any** of them, and
> when adding a fourth. `docs/setup-三支apps-script.md` §3.1 驗證 item 2 is the only such
> check anyone actually runs, and it had no `action=sessions` item for the entire time that
> branch was live.
>
> `doPost` was missed for exactly this reason — it predates the rule, so nobody put it
> through the check. It returns `String(err.message)` verbatim, and `tenantSheetRecord_`
> used to throw `'找不到工作表：' + t.recordSheet`, so any holder of a `?t=` link could read
> the tenant's `紀錄分頁名稱` out of one failed POST (observed live on 2026-10-08:
> `找不到工作表：評核紀錄_clinic`). Fixed by making that message generic; `action=selftest`
> still reports the name via `record.sheetName`, which reads `t.recordSheet` directly rather
> than through the exception. **`appendSubmission_`'s and `nullSafeSheet_`/`safeHeaderCol_`'s
> messages were deliberately left alone** — they interpolate only hardcoded alias constants
> (`評核紀錄`, `演習資訊`, `人員代號`…), which are identical for every tenant and already
> published in `README.md`, so they carry no per-tenant information.

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
columns are silently skipped, which is how differently-shaped record sheets work without
code changes. **The sandbox sheet is 7 columns** — 情境階段／演練單元／評核題號／分數／
人員代號／送出時間／觀察紀錄 — since 觀察紀錄 was added on 2026-10-08. An earlier note
here said "today's 6-column shape"; that is stale, and on 2026-10-09 it led an audit to
predict the wrong header for sheets `Setup.gs` creates (it copies the header from the
first non-empty tab, so new tabs inherit all 7).

| Role | Columns |
|---|---|
| Required | `問題ID` (or `評核題號`), `分數`, `人員代號`, `送出時間` |
| Optional (pre-existing) | `演習名稱`, `項目名稱`, `情境階段`, `演練單元`, `指標代號` |
| Optional (**new**) | `觀察紀錄`, `醫院代號`, `演習代號`, `測試場景與目標` (older `測試情境` still accepted), `評核潛能`, `4S 元素`, `評核題目` |

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
columns when those columns exist, and are empty strings otherwise, so on the sandbox's
**7-column** sheet (which has neither 醫院代號 nor 演習代號) it degenerates to exactly the
previous `(問題ID)`-with-last-write-wins behaviour.
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
`comments:[{code,comment}]` (non-empty only, sorted by code), `labelSource`,
`untriggered` (count of scores equal to `meta.scale.lowValue` on that row — 1 on a legacy
1–5 drill, 0 on a 0–4 drill), `s4List` (2026-10-16 — what
`splitS4_` derives from `s4`: canonical 4S names, then any unrecognised pieces verbatim; see
"A 4S cell can name several elements"), and `ratedCount` (2026-10-16 — the number of non-0
scores). Since 2026-10-16 `scores` still lists every evaluator **including 0s**, but `mean`/`sd`
are over the non-0 scores only, so **`mean` is `null` when every score on the row is 0** (`sd`
is then `0`). `scores.length` is "how many people scored this", `ratedCount` "how many gave a
real rating"; a client on an old backend that lacks `ratedCount` treats it as `scores.length`.
See "The score scale follows 評分標準".

Rows split into `analysisRows` (potential `反應`/`監測`/`預期` — **see the rename note
below; the spreadsheet still literally says `回應`**), `coverageRows` (potential
containing `覆蓋率`) and `learningRows` (`學習`). `learningRows` are excluded from `stats`
but still returned; the on-screen 排序視圖 panel and the report's opt-in R7 section are the
only places they surface.

`meta` keeps `orgName`/`exerciseName`/`exerciseTopic`/`exerciseCategory`/`exerciseDate`/
`exerciseDesc`/`generatedAt`/`evaluatorCodes` and adds `tenant`, `exercise`, `displayName`,
`scenePrefix`, `tenantSource`, `configFileName`, `recordFileName`, `recordSheetName`,
`recordRowCount` (raw rows before dedup), `commentCount`, `labelSourceSummary`
(`{snapshot, join, none}` tallied over the three row arrays only — rows that never reach a
chart aren't counted, so the report's disclosure line matches what the reader sees), and
`scale` (2026-10-16 — the drill's score scale, see "The score scale follows 評分標準"), and
`stageOrder` (2026-10-16 — the distinct 層1／地點 values in 項目與問題 sheet order, i.e.
`readItems_`'s top-level node names; it is how `#notRatedCard` sorts by 地點 without depending
on the browser's collation, which in a zh-TW locale puts 「綜合 (All)」 before 「A 點」).
File **names** are allowed here (this branch is key-protected) and feed 附錄C; spreadsheet
**IDs** never are.

`stats` keeps all seven existing keys — `overall`, `potentials`,
`s4`, `coverage`, `icc2k` (Shrout–Fleiss ICC(2,k) over the evaluator intersection common to
every row; `null` with <2 common raters or <2 questions — and that is *not* an edge case:
one single-rater question nulls the whole dataset), `within1` (fraction of same-question
evaluator pairs differing by ≤1, computed per row so it doesn't need a rectangular matrix),
`potentialByS4` (cross-tab feeding the iso-3D chart). Five are computed exactly as before;
`s4` and `potentialByS4` group by `s4List` membership since 2026-10-16 (identical numbers on
canonically-spelled single-element cells). **Also since 2026-10-16, every one of the seven
drops score 0 (不予評分)**: `overall`/`potentials`/`s4`/`coverage`/`potentialByS4` summarise
non-0 scores only, so `n` counts real ratings and any of them — including a 潛能×4S cell or a
4S category that *has* questions, if they were all 0-ed — can be `{n:0, mean:null}`;
`icc2k` treats a 0 as "did not rate", which drops that evaluator from the common intersection
(one 0 anywhere is enough — expect `null` more often on 0–4 drills); `within1` never pairs a
0. On data with no 0 — every legacy drill — all seven are unchanged. Both consistency figures
are computed over `analysisRows + coverageRows` (`consistencyRows`). Keys **added** since:

- `untriggered: {n, total, rate, value, label, excluded}` — `n` counts scores equal to
  `meta.scale.lowValue` over `consistencyRows`; `total` counts every score **including 0s**.
  On a legacy 1–5 drill that is the old 「1 = 劇本未走到」 rate (1 was being averaged in with
  2–5, so it needed its own figure); on a 0–4 drill it is the 不予評分 rate, the **only**
  place a 0 is counted. `value`/`label`/`excluded` (2026-10-16) are `lowValue`/`lowLabel`/
  `lowExcluded`; an old backend sends none of them → treat as `1`/`''`/`false`. The UI label is
  `(label || '未觸發') + '率（' + value + ' 分占比）'`. When `excluded` is true, prose must say
  that level is in **no** average; when false the old prose (1 分＝劇本未走到，與 2–5 分一起平均)
  is still correct. The key keeps its old name so an un-repasted `Report.gs` doesn't lose it.
- `missingQuestions: [{questionId, stage, itemName, goal}]` — every question id in
  `readItems_` with zero scores. Blank question ids (owner separator rows) are skipped.
- `unratedQuestions: [{questionId, stage, itemName, goal}]` (2026-10-16) — questions that
  **were** scored but whose every score is 0 (`r.mean === null`), over all rows like
  `missingQuestions`. The two lists are disjoint, and without this one such a question is in
  neither and silently vanishes from every chart. Old backend → `[]`.
- `byEvaluator: [{code, n, mean, deviation}]` — 寬嚴傾向; `deviation` is that code's mean
  minus the mean of the row-means of the rows *they* scored, so scoring only hard questions
  doesn't read as strictness. Must be renderable anonymised. Since 2026-10-16 an
  evaluator's 0 is skipped on **both** sides (own score and that row's baseline), so `n` is
  their real ratings; a row they rated non-0 always has a non-null `r.mean`.
- `rwg: {mean, items, skipped, clamped, scalePoints, expectedVar}` (2026-10-13; replaced
  `icc2k` on screen) — per-question r<sub>wg</sub> = 1 − S<sub>x</sub>²/σ<sub>E</sub>²
  averaged; `skipped` = questions with < 2 **non-0** scores, `clamped` = negatives floored to
  0, `null` when no question qualifies. Since 2026-10-16 σ<sub>E</sub>² is
  `meta.scale.expectedVar` and `scalePoints` is `meta.scale.rated.length` (2 / 5 on 1–5,
  1.25 / 4 on 0–4); they used to be the hardcoded `RWG_SCALE_POINTS_ = 5`.

### A 4S cell can name several elements (2026-10-16)

The owner asked for one question to count under two 4S elements: a 對應指標 「4S 元素」 cell
reading `Staff / System`, scored 3, adds a 3 to **both** Staff and System — full weight in
each, **not** 1/k. Before this the cell was one opaque string, so on the owner's real sheet
(bare English, `Staff / System` *and* `System / Staff`, see handover §4) every combination
— each ordering separately — became its own 4S category.

- **One splitter, server-side only.** `splitS4_(v)` + `s4CanonicalOf_` in
  `ConfigWithSubmit.gs`, driven by `S4_VALUE_ALIASES_`/`S4_BLANK_VALUES_`, run once per row
  in `buildAnalysis_` *after* `pickLabel` — the one place snapshot and join values meet, so
  old record rows carrying a snapshot string are split too. The result rides on each row as
  the additive **`s4List`**; `r.s4` stays the raw cell text (what `#detail`, the CSV, 附錄A
  and 報告快照 print). The rules live in the comment above `splitS4_` — read them there.
- **Two design choices, each with a rejected alternative.** (1) It canonicalises
  rather than splitting on `/`: `'Staff / System'.split('/')` gives `Staff`/`System`, which
  are not the canonical `Staff (人員)`/`System (系統)` that `S4_PREFERRED_ORDER`, both
  `ABILITY_NOTES` copies and `S4_PREFERRED_ORDER_` use as keys. (2) A piece must *equal* a
  recognition word, not *contain* one: the first version used substring matching, and an
  adversarial pass showed `Stuff (物資，含人員防護裝備)` silently counted under Staff too,
  `Workspace` under Space, `組織結構` under Space — extra full-weight scores invisible on
  screen. Unrecognised text now becomes its own visible category instead.
- `stats.s4` and `stats.potentialByS4` group by **`s4List` membership**, so with
  multi-element cells Σn over the 4S categories can exceed the 三項潛能 score count, and a
  potential's row of `potentialByS4` can exceed `stats.potentials[p].n`. A blank cell gives
  `s4List: []` and joins no category, as before. `overall`, `potentials`, `coverage`,
  `icc2k`, `rwg`, `within1`, `untriggered`, `byEvaluator` and `missingQuestions` never look
  at 4S and did not move.
- **Clients never split.** `Analysis.html`'s `s4ListOf(r)` and `Report.gs`'s `s4ListOf_(r)`
  return `r.s4List`, or `[r.s4]` when the backend predates it. The only row-level 4S grouping
  in either client is the scene × 4S bucket (`renderS4`, `sceneS4Buckets_`); every other 4S
  figure reads `stats`. (That bucket is also why `Report.gs`'s header claim that statistics
  are never recomputed is not quite literal: both clients average the per-scene segments
  themselves.)
- **What moves on existing data.** Canonically-spelled single-element cells (the dev
  sandbox's shape) give byte-identical payloads — verified by a differential harness that runs
  the real `buildAnalysis_`, `renderS4` and `sceneS4Buckets_` at HEAD and after on mocked
  sheets (every canonical-data comparison passes; the only failing probes are ones written
  for the rejected substring version). What changes: any other
  spelling (`Staff`, `staff`, `Staff（人員）`, a trailing space) folds into the canonical
  category; a whitespace-only cell, `N/A`, `-` or `無` now joins no category (each used to be
  one); and a custom label containing a separator (`/ 、 , ; + &` or a line break) is split.
- **Deploy order: clients first, backend last.** New client + old backend gives the old
  *numbers* exactly (the `[r.s4]` fallback) — but the new caption sentences already say a
  multi-element cell counts under each element, which the old backend doesn't do yet, so keep
  that window short. New backend + old client is the broken half-state: `stats.s4` keys are
  canonical but the old `r.s4===s4` filters compare against the raw cell, so every row whose
  raw text isn't exactly a canonical name drops out of the 4S tab's stacked segments and the
  report's 各場景在各 4S 類別的平均; a category reached *only* through such rows draws as a
  zero-length bar there. So: push `master` → repaste `Report.gs` into the report Web App and
  edit its existing deployment → New version (and the container-bound copy, if one exists),
  confirming the new `REPORT_BUILD_` via 檢查設定 → repaste `ConfigWithSubmit.gs` and edit its
  existing deployment. `Config.gs` never reads 對應指標 and is untouched.
- **Don't let anyone "fix" the header 「單一 4S 元素」** now that 「單一」 reads wrong. Today it
  matches `INDICATOR_S4_ALIASES_` exactly; a renamed header resolves only if it *starts with*
  an alias (`findHeaderCol_`'s prefix pass), so `多重 4S 元素` fails. Then
  `readIndicatorFull_` throws, which fails `action=analysis` **and `doPost`** whenever the
  record sheet has any 評核潛能/4S 元素/評核題目 snapshot column (`appendSubmission_` calls it
  lazily). `README.md` tells the owner to leave it alone.
- **報告快照 freezes the raw 4S text, not the split.** If `S4_VALUE_ALIASES_` changes later, an
  issued report's 4S grouping can't be rebuilt from 報告快照. Add a split-result column the day
  a 與前次演習比較 chapter is built, not before (it would need the live header edited first —
  handover §3's ⛔).
- Adding a canonical name (or a fifth S) means editing `S4_VALUE_ALIASES_` **and**
  `S4_PREFERRED_ORDER`/`ABILITY_NOTES` in `Analysis.html` **and** `S4_PREFERRED_ORDER_`/
  `ABILITY_NOTES_` in `Report.gs`, in one commit. Nothing at runtime notices a mismatch.
  (`Analysis.html`'s `S4_COLORS` is defined but never read.)

### The score scale follows 評分標準; 0 = 不予評分 is never averaged (2026-10-16)

The owner changed the config spreadsheet's 評分標準 from 1–5 (1 = 未觸發「劇本未走到此條件」) to
0–4 with 0 = 不予評分 (levels and labels: handover §4). Until then the evaluator's buttons were
a hardcoded `[1, 2, 3, 4, 5]` and the backend assumed a 5-point scale with 1 as the "untriggered"
level, so the sheet change alone would have left 0 unpickable and 5 still offered. Two owner
decisions, both final:

1. **0 is not a rating.** It is excluded from every mean, SD, min/max, r<sub>wg</sub>,
   within1, ICC and 寬嚴傾向, and reported only as a count/rate (`stats.untriggered`,
   `stats.unratedQuestions`).
2. **The scale follows each drill's own 評分標準 automatically.** Old 1–5 drills keep
   rendering exactly as before; 0–4 drills chart on the rated levels 1–4.

- **One source, two derivations.** The sheet's `分數` column is the scale. Server-side,
  `buildAnalysis_` calls `scaleOf_(readCriteria_(configSs))` and returns it as `meta.scale`:
  `{values, rated, min, max, lowValue, lowLabel, lowExcluded, expectedVar, levels, source}` —
  read the comment above `scaleOf_` for each field rather than this list. On a 0–4 sheet that is
  values `[0..4]`, rated `[1..4]`, min 1, max 4, lowValue 0, lowExcluded true, expectedVar 1.25;
  on a legacy 1–5 sheet values/rated `[1..5]`, max 5, lowValue 1, lowExcluded false,
  expectedVar 2. A 評分標準 read failure must not take the dashboard down with it, so it falls
  back to 1–5 with `source:'error'` (`'default'` when the sheet simply lists no number).
  ⚠️ That fallback is **silent on screen**: `ConfigWithSubmit.gs`'s `readCriteria_` throws on
  any of the three headers (`標籤`/`說明` too, not just `分數`), so retitling one 說明 header
  quietly re-scales a 0–4 drill to 1–5 (max 5, 1 = 未達成 counted as 未觸發). `Analysis.html`
  never reads `source`; the only place it surfaces is `Report.gs`'s 檢查設定 「評分量尺」 row —
  which is pushed `ok: true` either way, so read its text, not its colour.
  Client-side, `scoreScale(criteria)` in `Start.dc.html` derives the buttons from the config
  payload's `criteria` — the same sheet. The two agree on: dedupe, ascending sort, skip a
  non-numeric `分數`, fall back to `[1, 2, 3, 4, 5]`. **Change one, change the other**; nothing
  at runtime compares them.
- **The 0 rule is code, not sheet data.** `NOT_RATED_SCORE_ = 0` + `ratedOnly_` exclude 0
  unconditionally, whether or not the drill's scale lists 0. Only 0: an owner who puts 不予評分
  on another number gets it averaged in. `lowValue` (what `untriggered` counts) is 0 when the
  scale has a 0, else the scale's minimum; `lowExcluded` is `lowValue === 0`.
- **Why legacy drills are byte-identical.** A 1–5 drill's records contain no 0 (the buttons
  were hardcoded 1–5), so `ratedOnly_` removes nothing; its scale gives `lowValue` 1 (the old
  `=== 1` count), `expectedVar` 2 (the old `(5²−1)/12`) and `scalePoints` 5. The only payload
  differences are the additive fields — `meta.scale`, `ratedCount`, `stats.unratedQuestions`,
  `untriggered.value/label/excluded`. **The one legacy behaviour change:** a blank `分數` cell is
  now skipped in `buildAnalysis_`'s record loop. It used to pass the `isNaN` check as
  `Number('') === 0`, so a cleared cell was averaged in as a 0 **and**, under last-write-wins
  dedup, overwrote that evaluator's earlier real score for the question. A record sheet with
  blank score cells will move; one without them won't. (This had to change: 0 now *means*
  something, and a blank must not impersonate it.) Byte-identical also assumes the old drill's
  評分標準 still says 1–5 — see the re-scaling hazard below.
- **What every client must handle** (the contract `Analysis.html`/`Report.gs` code against):
  `r.mean === null` (any `r.mean.toFixed`, sort comparator or radar value must guard it);
  `ratedCount` absent → `scores.length`; any `summarize_` stat as `{n:0, mean:null}`; no
  `meta.scale` (old backend) → `{values:[1,2,3,4,5], rated:[1,2,3,4,5], min:1, max:5,
  lowValue:1, lowLabel:'', lowExcluded:false, expectedVar:2, levels:[]}`, which makes a new
  client on an old backend render exactly as today. Hand-written prose that describes the scale
  (`Analysis.html`'s 統計方法 panel, `Report.gs`'s 評核方法 chapter) has to branch on
  `excluded`/`lowExcluded` — the 1–5 sentence is false on a 0–4 drill and vice versa.
- **`Start.dc.html`'s buttons.** `renderVals()` maps `scoreScale(criteriaList)` instead of the
  literal array, ascending. `optionsGridStyle` is `repeat(min(n, 6), minmax(0, 1fr))`, so five
  buttons give exactly the old inline style and a seventh wraps rather than shrinking below a
  tappable width on a 390-wide screen. The 1–5 fallback is mandatory, not cosmetic: zero
  buttons would make every question unanswerable. 0 already works downstream — every
  "answered" test is `!= null`, not truthiness, and the comment gate is `score <=
  commentRequiredBelow`, so on 0–4 a threshold of 1 requires a comment for 0 **and** 1, and
  no integer threshold requires one for 0 alone (threshold 0 means "never"; a fractional `0.5`
  does work — `Number()` keeps it — but the hint then reads 「評 0.5 分以下必填」). Both config
  backends — `Config.gs` (no-param links) and `ConfigWithSubmit.gs` (`?t=`/`?ex=`) — have always
  returned `criteria`, so **the buttons need no backend change**: the new page switches them
  the moment it deploys.
- **`doPost` still does not validate the score range — deliberately.** `appendSubmission_`
  writes `Number(a.score)` as received. Checking it would mean reading 評分標準 on every POST,
  and then one broken 評分標準 sheet (a renamed header, a mid-drill edit) would refuse every
  submission mid-drill — the same "a config slip must not cost scores" rule as the comment gate.
  The buttons are the only gate. Consequence: an out-of-scale value (a stale tab still showing
  5 on a 0–4 drill, a hand-crafted POST) is stored and averaged in; only 0 is filtered.
- **Deploy order: clients first, backend last** — push `master` (`Start.dc.html`,
  `Analysis.html`), repaste `Report.gs` into the report Web App and edit its existing
  deployment → New version, then repaste `ConfigWithSubmit.gs` and edit its existing
  deployment. The scale change itself needs nothing from `Config.gs` (it already returns
  `criteria`); any other `Config.gs` edit shipping in the same release still needs its own
  repaste and redeploy.
  - New clients + old backend: no `meta.scale`, so the dashboard renders as today. The new
    `Start.dc.html` already offers 0 on a 0–4 sheet, and the old backend averages those 0s in
    and counts 1s as 未觸發 — wrong numbers on screen, but the stored rows are right and the new
    backend re-reads them correctly. Display-only and self-healing.
  - **Old `Analysis.html` + new backend can throw**: its radar code calls `.toFixed(1)` on
    `r.mean` (`svgRadar` first, then `radarTable`; in `renderCoverage` too), and `r.mean` is
    `null` on any question everyone scored 0 — and its overview `barsSVG` does the same, earlier
    still, on a 4S category whose every score is 0. Legacy drills have no such row, so this
    bites only on a 0–4 drill — but then the throw escapes `init()` into `load()`'s `.catch`,
    which prints 「讀取失敗，請確認網路連線…」 (a network message for a render bug), leaves the
    panel that threw and every panel `init()` renders after it empty, and never enables
    產生報告. Even when nothing throws, the old page draws on a hardcoded 5-point axis and
    prints the 0 rate under 「未觸發率（1 分占比）」.
  - Old `Start.dc.html` on a 0–4 sheet is the worst of the three: 1–5 buttons, so evaluators
    can submit a 5 and never a 0. That is wrong **data**, which no later deploy repairs — so
    the evaluator page must not lag the sheet.
- **Re-scaling hazard.** The scale is read from the *current* 評分標準 every time the
  analysis is built; nothing freezes it per drill. Changing 評分標準 after a drill re-scales
  that drill's dashboard and report: 1–5 → 0–4 turns max 5 into 4 (old 5s sit above it), stops
  counting 1 as 未觸發 and changes σ<sub>E</sub>². Changing it mid-drill mixes two scales in one
  record sheet. A new scale belongs in a new config spreadsheet (the `Setup.gs` wizard copies
  one per drill). `README.md`'s 評分標準 section tells the owner this.

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

- **綜合評比 (`#overview`)** — **the four KPI cards are no longer in this panel.** They
  moved into `<header>` on 2026-10-12 (`.headKpis`, still `id="kpis"`, rendered as `.hkpi`
  translucent pills instead of `.card.kpi`): 主題/說明 (from `meta.exerciseTopic`/
  `exerciseDesc`, falling back to `—`; the header pill above the tabs uses the separate
  `exerciseCategory`), 評核官人數, 評核總數 (`analysisRows + coverageRows + learningRows`).
  `#overview` holds two cards. The first has three aligned sections in a `1fr 140px 1fr` title
  row + content row: 綜合能力柱狀圖 (isometric 3D potential × 4S bars, `svgIso3D`/`renderIso3D`),
  演習覆蓋率 (gauge, `svgCoverageGauge`), and 4S整備表現直方圖 (`barsSVG` — the simple
  non-stacked 4S average, *not* the 4S 分析 tab's stacked chart; sorted by mean, high to
  low, since `7b946ee`, ties broken by `S4_PREFERRED_ORDER` then code order since
  2026-10-16 — the same order as `Report.gs`'s `specS4Means_`). The second
  (`#abilityRankCard`, `renderAbilityRank()`, added 2026-10-13) is the full version of the
  report's 優勢前三項／待改善前三項: every 潛能×4S cell ranked high→low with the same
  `abilityCells()` + `rankedTop()` (ties share a rank), then the `n:0` cells — combinations
  with no questions in this drill — listed last with no rank and `—`, because "no questions"
  must not read as "lowest score". `#overview` is reused as report section R3, so it prints.
  Since 2026-10-16 that second card shares a 50/50 row (`.grid.halves`, which collapses to one
  column under 1050px and in print, like `.cols2`) with **`#notRatedCard` 「不予評分項目」**
  (`renderNotRated()`/`notRatedScenes()`, owner request): one row per scene where *any*
  evaluator gave a 0, columns 項次／地點／演練單元／場景說明, sorted by `meta.stageOrder` then
  natural 演練單元 order (fallback when `stageOrder` is absent: natural sort with an explicit
  `'en'` locale). All three row groups count, coverage and 學習 included — 0 is in no average,
  so this card is the on-screen place that shows where nothing was scored. It reads only
  `r.scores`/`stage`/`itemName`/`goal`, which an old backend also sends, so it needs no repaste
  to appear; on a 1–5 drill (no 0 level) it says so instead of showing an empty table.
- **4S 分析 (`#s4`)** — `stackedHBarsSVG`: one horizontal bar per 4S category, stacked by
  演練單元/SCENE short code, segments in natural code order (`A1 < A2 < B < … < F`), colors
  from an HSL spectrum (hue 0–300° across the sorted list) so adjacent codes read as
  adjacent hues. Bar **length** is the real 4S average (`stats.s4[s4].mean`, within the drill's rated range
  `meta.scale.min`–`max`: 1–5 on a legacy drill, 1–4 on a 0–4 one, 0 excluded), not a
  sum; each segment's **width** is that scenario's share of the sum of per-scenario means,
  while its label (`D2 3.7`) shows the scenario's actual average. Bars sorted by total,
  descending. The per-scene segments are the one place this page groups rows by 4S itself,
  via `s4ListOf(r)` — a multi-element row lands in every bar it names (see "A 4S cell can
  name several elements"). The sibling card is `場景編號對照表` (`#s4ScenarioTable`), mapping each short
  code to its full `goal` text (or raw `itemName`), with a matching color swatch per row.
- **三項潛能雷達圖 (`#radars`)** — one `svgRadar` per potential (反應/監測/預期), axes sorted
  clockwise lowest→highest (sorting happens inside `svgRadar()`, so every caller gets it).
  Each radar card is followed by a **separate** card (not nested, so chart height stays
  fixed regardless of table length) holding a `radarTable()` — 場景編號 / 指標 /
  具體評核題目 / 分數, ascending by score. A row with `mean === null` (every score 0) is left
  off the radar, said so under it by `unratedRadarNote()`, and listed last in the table with
  `—` (`cmpNullLast`); `#coverage` does the same.
- **演習覆蓋率 (`#coverage`)** — coverage radar plus a `radarTable()` in the 覆蓋率指標摘要 card.
- **統計方法 (`#method`)** — static prose, except item 4's r<sub>wg</sub> value: two spans
  (`#methodRwg`, `#methodRwgNote`) filled by `renderMethod()` from `rwgStat()`, the same
  value the report summary shows — plus, since 2026-10-16, three places that follow
  `meta.scale`: item 3's 不予評分 sentence (`#methodNotRated`, empty unless `lowExcluded`),
  item 4's σ<sub>E</sub>² (`#methodSigmaE`), and the right-hand 評分尺度 card
  (`renderMethodScale()`, from `meta.scale.levels`, restoring the hardcoded 1–5 text when there
  are none). Everything else is hand-written; update it by hand if the stats computation
  changes.

### Panels with no tab button

- **`#ranking` (排序視圖)** — 依潛能分類 and 表現優劣排序 tables; the only place
  `learningRows` appear. Rendered on load, unreachable from the tab bar, and shown in the
  report only behind the `#includeRanking` opt-in.
- **`#detail` (評核官明細)** — per-question identified table with scope/evaluator filters,
  CSV export, and the r<sub>wg</sub> badge (`#agreeBadge`; it was an `ICC(2,k)` `#iccBadge`
  before 2026-10-13). Rendered on load, unreachable.

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
優勢前三/待改善前三 — see the ability-table note below), R3–R6 reuse `#overview`/`#s4`/`#radars`/`#coverage` as-is, R7 reuses
`#ranking` **only when `#includeRanking` is checked (default off)**, R8 觀察紀錄彙整
`#reportComments`, R9 資料品質 `#reportQuality` (missingQuestions, untriggered,
recordRowCount vs deduped count, and a one-line `labelSourceSummary` disclosure), R10
reuses `#method`, R11 附錄C `#reportAppendixC` (file names, sheet name, row count, tenant,
exercise, tenantSource, generatedAt — **no key, no spreadsheet ID, no URL**).

#### 優勢前三項／待改善前三項 — the ability tables (2026-10-12)

`abilityCells()` reads **`DATA.stats.potentialByS4`** — the same cross-tab the iso-3D chart
draws, deliberately, so the table and the chart can never disagree. Cells with `n === 0`
are dropped. `abilityLabel(pot, s4)` names a cell — it regex-extracts the Chinese inside the parens and
joins with a space-x-space, so `('反應','Space (空間)')` returns **`反應 x 空間`**, not
`反應×Space (空間)`. The `×` belongs to `ABILITY_NOTES`' *key* format (`pot + '×' + s4`,
which keeps the full canonical 4S name) — two different strings, easy to conflate. Since
2026-10-16 the `s4` here is a `S4_VALUE_ALIASES_` canonical name whenever the cell was
recognised, so rewording the sheet (`人員`, `Staff`) no longer blanks the notes; renaming a
canonical name does (and an unrecognised piece never had a note).

- **`rankedTop(cells, n, asc)` is competition ranking and includes every tie.** Rank comes
  from the *score*, not the row index, so 1,1,1 / 1,2,2 / 1,2,3,3,3 all print in full —
  three is a cap on the *rank*, not on the number of rows. The owner asked for this
  explicitly: the naive "take the first three after sorting" silently truncated a
  fourth cell with an identical score, so the report would claim one ability was "top
  three" while another with the exact same number was absent, with no way for the reader to
  tell why. Verified over these 8 cases: three-way tie for first, 1-2-2, 1-2-3-3-3, no ties,
  all tied, fewer than three rows, empty list, and the ascending 待改善 direction. (Commit
  `88f5f88` says "9 種情況" and then lists 8 — the count is off by one in the commit
  message; there is no test file, so the ninth cannot be recovered.)
- **`ABILITY_NOTES` holds the owner's twelve sentences** keyed `潛能×4S` (second version,
  2026-10-13: the body text of each cell of the owner's 「韌性潛能與 4S 擴容元素整合矩陣表」
  Word file, copied verbatim without the numbered title; the owner's 預見 is this system's 預期).
  ⚠️ **There are two copies** — `Analysis.html` `ABILITY_NOTES` and `Report.gs`
  `ABILITY_NOTES_` — and they must change in the same commit; nothing at runtime notices a
  mismatch. Changing the `Report.gs` copy also means bumping `REPORT_BUILD_` and repasting
  the report Web App.
- The iso-3D chart's pale outline marks the **three globally lowest** cells (`weakSet`,
  `ee41ce0`), not the lowest of each row as it did before — and it includes ties the same
  way, by taking the third-lowest value as a cut and collecting everything `<= cut`.

#### Figure sizing for print (`--figW` / `--figH`)

`:root{--figW:10cm;--figH:14.5cm}` and one `@media print` rule pin every figure to the same
box, replacing the old per-chart `max-height:150mm`. **The orientation is literal and
unconfirmed**: 10 wide × 14.5 tall is what the owner wrote, and nobody has checked it
against a real print yet — swap those two values if it is wrong.

> ⚠️ **`#coverageGauge` is not covered by either selector.** The 演習覆蓋率 gauge in
> `#overview` sits in a plain `div` with no `.chartbox` class and is not named in the print
> rule, so it still prints at its native size. "Every figure is 10×14.5" is therefore not
> yet true.

`演習地點` was added to the cover's `contenteditable` fields (now six: 演習地點, 報告版次,
文件編號, 製表, 審核, 核定). Like the others it is **persisted nowhere** — the backend has no
such field and the cover says so.

#### 場景說明浮層 (`SCENE_GOALS`)

`buildSceneGoals()` indexes each scene short code to its `goal` text; `sceneCell()` renders
the code as a `.sceneBtn` **only when a real `goal` exists**, and `openScenePop()` opens a
window-centred `position:fixed` panel (closed by click-outside or Escape, both delegated to
`document`). The "only when a goal exists" condition matters: an earlier version fell back
to `itemName`, so clicking `D2` popped up a panel whose entire content was the text
「SCENE D2」 — a popover that tells you what you just clicked.

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

### 場次下拉 (`#exPicker`)

This one `<select>` has now replaced **two** things, in two separate rounds:

- the old 過去演習 button + `#pastPanel` link list (**gone** — `#viewPast`, `#pastPanel`
  and the `#pastList` CSS no longer exist anywhere in the file; stale notes may still
  describe them), and
- the **`當次演習` button** (`#viewCurrent`, removed 2026-10-12 in `6d79e7a`). Its
  `onclick` was literally `load` — the same function as the neighbouring 重新整理 — and the
  thing it was trying to express ("which session am I looking at") is a *state*, which a
  stateless button can never say. The dropdown is that answer. **Do not add it back.**

Two consequences worth knowing before you conclude something is broken:

- **產生報告 follows the dropdown with no extra plumbing.** `enterReport()` reads the
  in-memory `DATA`, and `DATA` is whatever `currentExid` fetched — so the report
  *structurally cannot* name a different session than the screen. No session parameter is
  passed to the report path, by design.
- **In fallback mode (no `?t=`) that row now has only three buttons**, because the picker
  is hidden and `當次演習` is gone. That is correct — a one-option dropdown is noise, not
  information — but it means a local `python3 -m http.server` test **must** use
  `?t=wanfang-7f3a2c` or it looks like the feature never shipped.

`load()` disables the picker while a fetch is in flight and re-enables it in `.finally`.
That closes a real pre-existing hole: switching twice quickly fired two `action=analysis`
requests, and the earlier one could easily arrive last, leaving the screen on a session
that is *not* the one shown in the dropdown — with nothing visibly wrong. The lock is
guarded by `exListLoaded` so it cannot fight `loadExercises()`'s own lock on first load,
and the re-enable sits in `.finally` because the most likely next action after a failed
read is "try another session".

`loadExercises()` is called automatically from `init()` the first time `meta.tenant` is
non-empty (guarded by `exListLoaded`, so refreshing the analysis doesn't re-fetch the
registry). It fills a `<select>` in the header with one `<option>` per `action=exercises`
row, labelled `顯示名稱｜日期` (since `2201f36`; the 代號／已結束／預設 tags were dropped
because they truncated the name at the picker's real width). Archived (`enabled:false`)
sessions stay selectable on purpose — the report is what a finished drill is for — but the
picker no longer says which ones are archived.

Two things to preserve:

- **Switching a session must not change the URL.** `currentExid` is a module-level
  variable that `load()` reads instead of `EX_PARAM`; `onchange` sets it and re-fetches in
  place. The old link-list navigated to `?t=&ex=&key=`, which wrote `ANALYSIS_KEY` into the
  address bar and browser history on every switch — the exact thing `enterReport()`'s
  `history.replaceState` exists to undo.
- **Every failure path is a silent degrade**: on error, or an empty list, or fallback mode,
  the `<select>` simply stays hidden and the dashboard works as before. The picker is a
  convenience; losing it must never cost the operator the current drill's report.

`init()` also copies `DATA.meta.exercise` back into `currentExid` before calling
`syncPickerSelection()`, because a `?t=`-only link resolves server-side to the 預設演習 —
the client would otherwise think it was viewing `''`.

In fallback mode (any link with no `?t=`) `meta.tenant` is empty, so
the picker never appears. That is correct: there is only one exercise to show.

## Report generator (方案B) — `apps-script/Report.gs` + `apps-script/ReportDialog.html`

The committee deliverable, as opposed to `Analysis.html`'s print view (方案A), which
`#reportHint` itself calls an internal review copy. Container-bound to the 演習評核_設定
spreadsheet; `onOpen()` builds a 演習評核報告 menu. **A container-bound script needs no
deployment** — paste, save, reload the sheet. That is the whole point: the owner cannot be
asked to redeploy a Web App (picking 「新增部署」 silently changes `/exec`), so the report
feature must not require editing `ConfigWithSubmit.gs` at all. It doesn't: the only coupling
is one `UrlFetchApp` GET to `action=analysis`.

> **First verified end-to-end run: 2026-10-09.** 檢查設定 passed all 14 items and
> 產生評核報告 completed 21/21 chapters plus appendices A–D, exported a 35-page PDF, and did
> **not** stop at 「（部分完成）」. The single most valuable result, because it cannot be
> predicted from outside: `chartCapability_()` reported **COLUMN and RADAR both available**,
> so figures are native Google Charts — the table and text fallbacks never engaged. The local
> ICC(2,k) recomputation agreed with `stats.icc2k`.
>
> Getting there took three wrong diagnoses, all now fixed in the error messages:
> - `showModalDialog` threw a `script.container.ui` permission error. `openDialog_`'s catch
>   appended 「請確認…ReportDialog 檔案」 to *every* failure, so an auth error sent the tester
>   to verify a file that was present all along.
> - The replacement hint said to run `onOpen` and approve. That cannot work: adding a menu is
>   permitted in the restricted auth mode and does not need `script.container.ui`, so Apps
>   Script never requests it for that function. Running **`showReportCheckDialog`** (which
>   actually calls the dialog API) is what triggers consent; declaring `oauthScopes` in
>   `appsscript.json` is the fallback.
> - `Setup.gs` got a guard asserting 「是獨立專案」, on a project that was correctly bound.
>
> **A wrong hint is worse than no hint** — each of these sent someone to check the one thing
> that wasn't broken. When the cause isn't provable from the message, list the candidates.
>
> The run also found two real defects, both fixed (see `leftoverTokens_` and
> `finalizeRun_` step 4b): the leftover-`{{` scan fired on the intentionally-unfilled
> `{{報告版次}}` on *every* report, and warnings raised during finalize could never reach
> 附錄C because that appendix is written earlier in the chapter pass.
>
> Re-verified 2026-10-09 after the fixes, by deliberately mistyping a template token: the
> warning named `{{機構名稱 }}`, did **not** name `{{報告版次}}`, and appeared under 附錄C 補記
> at the end of the document. Both fixes confirmed in the deliverable, not just the dialog.
>
> **Which drill a report covers is pinned by script properties, not chosen at run time.**
> `REPORT_TENANT`/`REPORT_EXERCISE` fix the tenant; a session created by the `Setup.gs` wizard
> therefore has **no way to produce a report** until someone edits those properties (and the
> matching `REPORT_ANALYSIS_KEY`, since the wizard mints a fresh key per row). That is a real
> product gap, not a bug: one container-bound script, one configured drill. Anyone testing the
> report generator is testing the mechanism, not the session they just created.
>
> **ICC(2,k) on a handful of questions is not a quality signal.** A two-evaluator, four-question
> run returned exactly `0.00` — arithmetically correct (between-question variance collapses to
> at or below the error term, and the statistic floors at 0), and meaningless. Do not read a low
> ICC from a smoke test as poor agreement.
>
> A third run on 2026-10-09 explained the duplicate token the second one reported. It was not
> a header, and not double-counting: **the report was warning about text it had just written
> itself.** 附錄C prints the warning list during the chapter pass, and one of those warnings
> was 「範本缺少封面 token：`{{機構名稱}}`」 — so a literal, well-formed token landed in the
> body, and finalize's leftover scan then found it. The operator could only ever find one
> occurrence in the template because the second one did not exist until the run created it.
> **Any warning that will be printed into 附錄C must not contain a complete `{{…}}`** — pass
> it through `plainToken_` first. Warnings added during finalize are exempt: step 4b runs
> after the step-4 scan, and every run copies a fresh document. Reordering those two steps
> re-opens this.
>
> Still unverified: the time-budget split across `reportContinue` calls (all runs finished in
> one pass), and every chart fallback path (none engaged). `docs/manual-test-checklist.md` M3
> is the checklist.

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
  failure is a blank image, not an exception). The chain is: native attempt → ① **COLUMN**
  redraw of the same numbers → ② **`legacyChartBlob_`, the older Charts service**
  (`:1611`/`:1680`) → ③ a native Docs table of the same numbers (`:1686`) → ④ a paragraph
  naming the failure (`:1701`). Layer ② is the one this file used to omit — and the code's
  own comment at `:1643` omits it too, while counting the native attempt as a layer, so
  "four" means two different things in the two places. Two precision notes: layer ① only
  exists for `RADAR` and `BAR` figures — `emitChart_` builds `order` at `:1654-1661`, and a
  figure whose own type is already `COLUMN` gets no redraw step; and the redraw target is
  always `COLUMN`, never `BAR` (`BAR` is only ever a figure's native type).
  **No run is known to have reached any of the four**, but that is weaker than it sounds:
  `chartCapability_` being green only rules out ①, whereas ②–④ fire per-figure when
  `tryChartBlob_` returns no blob (including the ≤1000-byte blank-PNG case) or the insert
  fails. What would actually prove it is an empty `warnings[]`/附錄C on those runs. Every degradation lands in `warnings[]`, the dialog, and
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
