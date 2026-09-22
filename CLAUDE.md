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

## Running / viewing

No build step for the page itself. Serve the folder and open `Start.dc.html` in a
browser (some browsers block the scripts over `file://`):

```
python3 -m http.server
```

Then open `http://localhost:8000/Start.dc.html`.

## Editing the mockup

- All app logic/state/content changes go inside the `<script type="text/x-dc" data-dc-script>`
  block in `Start.dc.html`: the `ITEM_NAMES`, `CRITERIA`, `QUESTIONS` constants and the
  `Component` class's `constructor`/`renderVals()`.
- Screen transitions are driven by `this.state.screen` (`'select' | 'criteria' | 'survey' | 'done'`)
  with `showSelect`/`showCriteria`/`showSurvey`/`showDone` booleans returned from `renderVals()`
  and consumed by `<sc-if>` blocks in the template.
- Template expressions (`{{ ... }}`) can only reference keys returned by `renderVals()` —
  there's no separate binding step, so any new template value must be added there.
- Inline `style="…"` strings carry the actual design tokens (colors like `#161512`,
  `#7a4e0f`, `#f7f5ee`; radii; spacing) — preserve exact values when adjusting layout.
