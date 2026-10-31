# Website Design QA Tool

Audit any web page against your design system. The tool:

1. ✅ **Detects sections** — hero, pricing, FAQ, footer, testimonials, features, contact, stats, process, CTA, … (heuristics on tags, ids, classes and heading text)
2. ✅ **Groups elements by section** — every unique text style (tag, role, size, weight, color, alignment …) with occurrence counts
3. ✅ **Screenshots each section** — one PNG per section, embedded in the report
4. ✅ **Exports the CSS properties** — `css-export.json` (structured) + `css-export.csv` (spreadsheet-ready)
5. ✅ **Compares against your design system** — a simple JSON spec per project (fonts, type scale, color tokens, weights, line-height ranges, spacing scale, per-role rules)
6. ✅ **Generates a developer-ready issue report** — `report.html` + `report.md`, issues ranked 🔴 high / 🟠 medium / 🟡 low with expected-vs-actual and the offending element

Built-in checks beyond the spec: WCAG AA contrast, duplicate HTML ids, single-H1 semantics, unstyled buttons (browser-default 13.33px), H2 consistency across sections, body-text color sprawl.

## Setup

```powershell
cd design-qa-auditor
npm install          # installs playwright (uses your installed Chrome, no browser download)
```

## Usage

```powershell
# Full audit against a design system
node audit.js https://example.com --ds design-systems/default.json

# Extraction only (no comparison) — useful for a first look at an unknown site
node audit.js https://example.com

# Multiple pages in one run, custom viewport, full-page shot too
node audit.js https://site.com/a https://site.com/b --ds design-systems/mysite.json --width 1280 --full-page

# Watch the browser while it runs
node audit.js https://site.com --headed
```

### Output (per page, in `runs/<slug>-<timestamp>/`)

| File | What it is |
|---|---|
| `report.html` | Visual report — issue table, per-section screenshots + style inventory |
| `report.md` | Same report in Markdown (paste into Jira/GitHub issues) |
| `css-export.json` | Full structured extraction (sections → styles) |
| `css-export.csv` | Flat style table for Excel/Sheets |
| `screenshots/NN-kind.png` | One screenshot per detected section |

## Defining your design system

Copy `design-systems/default.json`, rename it per project, and fill in the tokens. **Empty arrays skip that check**, so you can adopt it incrementally.

```jsonc
{
  "fontFamilies": ["Inter"],              // any other family = HIGH issue
  "typeScale": [12, 14, 16, 20, 24, 32],  // sizes off the scale = MEDIUM
  "fontWeights": [400, 600, 700],         // other weights = LOW
  "colors": {
    "text":   ["#111111", "#556677"],     // allowed text colors (non-token = MEDIUM)
    "accent": ["#0050CC", "#FFFFFF"],
    "onDark": ["#F8F9FF"]
  },
  "spacingScale": [40, 60, 80],           // allowed section paddings
  "roles": {                               // per-role rules (h1..h6, body, list, button, link, label)
    "h2":     { "sizes": [32], "weights": [600] },
    "body":   { "lineHeight": [1.4, 1.8] },
    "button": { "sizes": [15, 16], "weights": [600] }
  },
  "maxBodyTextColors": 2,                  // more distinct greys than this = MEDIUM
  "tolerance": { "fontSizePx": 0.5, "spacingPx": 1 },
  "checks": {                              // set any to false to disable
    "singleH1": true, "duplicateIds": true, "contrast": true,
    "headingConsistency": true, "colorSprawl": true, "sectionPadding": true
  }
}
```

## How section detection works

Top-level `header / nav / section / footer / main > div` elements (≥40px tall) are collected, de-nested (only outermost kept), then classified by keyword heuristics against their `id`, `class`, and first heading — e.g. `pricing|plans` → **pricing**, `faq|accordion` → **faq**, contains `<h1>` → **hero**, `<form>` + "contact" → **contact**. Unmatched sections fall back to `content`.

## Extending

- **New issue rule** → add a check in `lib/compare.js` (each issue = severity, section, category, message, expected, actual, sample).
- **New section type** → add a rule to the `rules` array in `lib/page-extract.js` → `classify()`.
- **More CSS properties** → add them to the style object in `lib/page-extract.js` and (optionally) the CSV/report columns in `lib/report.js`.
