# Pesach 5786 Schedule Generator — Project Context

This file provides persistent context for Claude Code when working in this repository.
It is loaded at the start of every session; keep it accurate and up to date.

---

## Project Overview

A **Node.js CLI tool** that generates a polished, multi-page Microsoft Word (`.docx`) document
containing the complete Pesach (Passover) schedule for an Orthodox rabbi and congregation.

- **One page per day** across all 9 days: Bedikat Chametz → Erev Pesach → Yom Tov I–II →
  Shabbat Chol HaMoed → Chol HaMoed (3 weekdays) → Erev Shevi'i → Shevi'i shel Pesach →
  Acharon shel Pesach.
- Each page contains: z'manim (halachic times), davening/services schedule, complete Torah
  readings (aliyah-by-aliyah with chapter/verse, Maftir, Haftarah), tefila notes, and
  halachic guidance boxes.
- All body text is **English**. Hebrew terms (with full nikudot) appear **inline** within
  English sentences wherever a transliterated term would otherwise appear — not as
  standalone Hebrew paragraphs.
- Halachic content is calibrated for **Ashkenazic Orthodox** practice, Diaspora (8-day Pesach).
- Z'manim are approximated for **Pleasantville / Atlantic County, NJ (~39.4°N, 74.4°W)**,
  using standard GRA calculations.

---

## Repository Layout

```
pesach_5786_generator.js   # Main entry point — run this to produce the .docx
pesach_5786.docx           # Output file (git-ignored; regenerated on each run)
CLAUDE.md                  # This file
README.md                  # Setup and usage instructions (to be created)
```

Future structure to grow into:

```
src/
  helpers.js               # Shared docx primitives (run builders, table helpers)
  pages/
    bedikat.js             # Page 1: Bedikat Chametz
    erev.js                # Page 2: Erev Pesach
    yomtov1.js             # Page 3: Yom Tov I
    yomtov2.js             # Page 4: Yom Tov II
    shabbat.js             # Page 5: Shabbat Chol HaMoed
    cholhamoed.js          # Page 6: Chol HaMoed (3-day block)
    erev_shevii.js         # Page 7: Erev Shevi'i
    shevii.js              # Page 8: Shevi'i shel Pesach
    acharon.js             # Page 9: Acharon shel Pesach
  data/
    zmanim.js              # All z'manim times, keyed by date
    torahReadings.js       # All Torah reading details, keyed by day
    halacha.js             # Halachic note content blocks
output/
  pesach_5786.docx         # Generated output
```

---

## Tech Stack

| Concern | Tool |
|---|---|
| Runtime | Node.js (v18+) |
| Word generation | `docx` npm package (v9.x) |
| Hebrew font | David (embedded in Word; relies on system font on open) |
| Output format | `.docx` (Office Open XML) |

**Install dependencies:**
```bash
npm install docx
# or globally: npm install -g docx
```

**Run:**
```bash
node pesach_5786_generator.js
# → writes pesach_5786.docx in current directory
```

---

## Core Architecture Patterns

The generator is built from composable helper functions. **Always use these helpers —
never construct raw docx objects inline in page functions.**

### Run builders (smallest unit)
```js
e(text, opts)   // English TextRun — font: Calibri, LTR
h(text, opts)   // Hebrew TextRun — font: David, RTL, nikudot-capable
```
Both accept `opts`: `{ size, bold, italics, color }`.
Mix freely in arrays to build bilingual sentences:
```js
[e("Recite "), h("הַלֵּל"), e(" before "), h("מוּסָף"), e(".")]
```

**Alert-coloured variants** (use only inside `alertBox()`):
```js
wa(text)   // warn amber English run
wah(text)  // warn amber Hebrew run
ia(text)   // info blue English run
iah(text)  // info blue Hebrew run
```

### Layout helpers
```js
zmanRow(time, runs[])       // Two-column: bold blue time | content
serviceRow(time, runs[])    // Two-column: bold time | content
sectionLabel(text, bgColor) // Full-width tinted section header bar
spacer(afterPts)            // Empty paragraph for vertical spacing
```

### Content blocks
```js
halachaBox(titleRuns[], bodyRuns[], tintColor)
// Tinted bordered box. Both args are arrays of e()/h() runs.

torahBox(rows[], tintColor, maftirStr, haftarahStr)
// rows = [["1st", "Exodus 12:21–24 — description"], ...]
// Pass null for maftir or haftarah if not needed.
// Renders with a thick left border and alternating tint.

alertBox(runs[], type)
// type: 'warn' (amber) or 'info' (blue)
// Highlighted callout with thick left accent border.
```

### Day header banner
```js
dayHeader(badgeText, hebrewTitle, englishSubtitle, bgColor)
// Two-column: badge (English) | Hebrew title + English subtitle
// bgColor controls the full-width banner colour.
```

---

## Colour System

| Constant | Hex | Used for |
|---|---|---|
| `BLUE` | `1F5C99` | Yom Tov header backgrounds |
| `BLUE_LIGHT` | `D6E4F0` | Yom Tov section tints |
| `GREEN` | `1A6B3A` | Chol HaMoed header backgrounds |
| `GREEN_LIGHT` | `D6EDE1` | Chol HaMoed section tints |
| `AMBER` | `7B4F00` | Shabbat header backgrounds |
| `AMBER_LIGHT` | `FEF3D6` | Shabbat section tints |
| `GRAY` | `4A4A4A` | Pre-holiday / Erev headers |
| `GRAY_LIGHT` | `F0F0F0` | Pre-holiday section tints |
| `WHITE` | `FFFFFF` | Header text |

---

## Hebrew Text Guidelines

- **Font:** David (set via `HEB_FONT` constant). Do not use Arial or Times for Hebrew.
- **Always use nikudot** (vowel points) on Hebrew liturgical terms. Examples:
  `שַׁחֲרִית`, `הַלֵּל`, `חָמֵץ`, `צֵאת הַכּוֹכָבִים`, `בְּדִיקַת חָמֵץ`
- **RTL flag:** every Hebrew `TextRun` must have `rightToLeft: true`.
- **Inline only:** Hebrew runs are embedded within English paragraphs. There should be
  no standalone Hebrew-only paragraphs in the body (only the day header banner uses
  a dedicated Hebrew paragraph).
- **No transliteration** in the document body. Replace every transliterated term
  (e.g., "Shacharit", "Hallel", "chametz") with an `h()` run inline.

---

## Halachic Content Standards

When adding or editing halachic content, follow these conventions:

**Practice basis:** Ashkenazic Orthodox, Diaspora, following the GRA/Mishnah Berurah
as primary authorities, noting Sephardic divergences where relevant.

**Key halachic details already established in the document:**

- **Bitul chametz:** Both כָּל חֲמִירָא formulas are on the Bedikat page — first after
  the search (Tuesday night), second after burning (Wednesday morning before 10:58 AM).
  The full Aramaic text of each formula is included.
- **Taanit Bechorot:** Fast begins at עֲלוֹת הַשַּׁחַר (~5:30 AM); practically ends at
  the סִיּוּם after Shacharit. Include both times.
- **Candle lighting:** Listed on every applicable day with the rule about אֵשׁ קַיֶּמֶת
  (existing flame only) clearly noted for Yom Tov→Shabbat transitions.
- **Eruv Tavshilin:** Required because Yom Tov Day 2 (Fri April 3) flows into Shabbat.
  Must be set before Yom Tov begins Wednesday night.
- **Hallel:** Full on Days 1–2, Shabbat Chol HaMoed, and all 4 Chol HaMoed weekdays.
  Half on Shevi'i and Acharon shel Pesach. When half Hallel, specify which psalms
  are omitted: לֹא לָנוּ (Ps. 115:1–11) and אָהַבְתִּי (Ps. 116:1–11).
- **Havdalah on Motzei Shabbat Chol HaMoed:** Wine only — no בְּשָׂמִים, no candle.
  Text: הַמַּבְדִּיל בֵּין קֹדֶשׁ לְקֹדֶשׁ. This is a common error; always flag it.
- **Tefillin on Chol HaMoed:** Three-way divergence — Shulchan Aruch (not worn),
  Rama (worn without bracha), Vilna Gaon/most Ashkenazic today (not worn). Always
  note all three and instruct the congregation to follow community minhag consistently.
- **Tefillat Tal:** Recited at Musaf on Yom Tov I. Begin מוֹרִיד הַטַּל; cease
  מַשִּׁיב הָרוּחַ and וְתֵן טַל וּמָטָר until Shemini Atzeret.
- **Sefiras HaOmer:** Begins night of Yom Tov I (after Tzait), Night 1.

---

## Torah Reading Details (Pesach 5786)

This year (2026), Shabbat Chol HaMoed falls on **Saturday April 4 = 17 Nisan = Chol HaMoed Day 3**.
Because Shabbat occupied the Day 3 slot, the weekday Chol HaMoed reading sequence shifts:

| Date | Day of Pesach | Chol HaMoed Reading |
|---|---|---|
| Sun April 5 | Day 4 (18 Nisan) | CHM Day 1: Exodus 13:1–16 |
| Mon April 6 | Day 5 (19 Nisan) | CHM Day 2: Exodus 22:24–23:19 |
| Tue April 7 | Day 6 (20 Nisan) | CHM Day 4: Numbers 9:1–14 (Pesach Sheni) |
| Wed April 8 | Day 7 (21 Nisan) | Exodus 34:1–26 (Day 3 reading, read this day) |

All Chol HaMoed weekdays: 4 עוֹלִים only — 3 from Scroll 1, Maftir from Scroll 2
(Numbers 28:19–25 every day). No Kaddish between the two scrolls.

Yom Tov days use 5 עוֹלִים + Maftir. Shabbat Chol HaMoed uses 7 עוֹלִים + Maftir.

---

## Page-by-Page Content Summary

| Page | Date | Badge colour | Key halachic items |
|---|---|---|---|
| 1 Bedikat Chametz | Tue night March 31 | Gray | Search procedure; both Kol Chamira formulas |
| 2 Erev Pesach | Wed April 1 | Gray | Fast of Firstborn (5:30 AM–tzait); Mechiras chametz; Eruv tavshilin |
| 3 Yom Tov I | Thu April 2 | Blue | Tefillat Tal; Sefiras HaOmer begins |
| 4 Yom Tov II | Fri April 3 | Blue | Candles from existing flame; Yom Tov → Shabbat rules |
| 5 Shabbat CHM | Sat April 4 | Amber | Kiddush/Musaf nusach; Havdalah wine-only; tefillin note |
| 6 Chol HaMoed | Sun–Tue April 5–7 | Green | Tefillin minhag; Melacha rules; 3 separate Torah readings |
| 7 Erev Shevi'i | Wed April 8 | Green | Tikkun leil Shevi'i |
| 8 Shevi'i | Thu April 9 | Blue | Half Hallel explanation; Shirat HaYam chanting |
| 9 Acharon | Fri April 10 | Blue | Yizkor; Motzei Pesach chametz rules; Seudas Moshiach |

---

## Docx Library Rules

These constraints apply whenever writing or modifying docx generation code:

- **Never use `\n`** inside `TextRun` — use separate `Paragraph` elements.
- **Never use Unicode bullet characters** (•, ‣) — use `LevelFormat.BULLET` with a
  `numbering` config, or rephrase as prose with "•" only if inside an `e()` run where
  the character is intentional.
- **Page size:** always US Letter — `{ width: 12240, height: 15840 }` (DXA units).
  The library defaults to A4; override explicitly in every section's `properties`.
- **Tables need dual widths:** set `columnWidths` on the `Table` AND `width` on each
  `TableCell`. Both must be present and must sum correctly.
- **Always `WidthType.DXA`** for table widths — never `WidthType.PERCENTAGE`
  (breaks in Google Docs).
- **`ShadingType.CLEAR`** for all table cell shading — never `ShadingType.SOLID`
  (causes black backgrounds).
- **`PageBreak` must be inside a `Paragraph`** — standalone `PageBreak` creates
  invalid XML. Use `pageBreakBefore: true` on the first paragraph of each new page.
- **`TableLayoutType.FIXED`** on all tables for predictable column widths.
- **Cell margins:** always set `margins: { top, bottom, left, right }` on every
  `TableCell` — default margins are too tight.
- **Validate after every generation:**
  ```bash
  python3 /path/to/validate.py pesach_5786.docx
  ```
  All validations must pass before committing changes.

---

## Coding Conventions

- **Helper-first:** all docx primitives live in helpers. Page functions only call helpers —
  they never construct `new Table()`, `new TableRow()`, etc. directly.
- **Data separation:** z'manim times, Torah reading details, and halachic text belong in
  `data/` files, not hardcoded inside page functions. Each page function imports what it needs.
- **Named constants for all colours and font names** — no hex strings or font names
  inline in page functions.
- **No magic numbers** — DXA values should be named constants
  (e.g., `const TIME_COL = 1200; const CONTENT_COL = 8160;`).
- **One page per file** (once refactored into `src/pages/`).
- **Validate after every change** — do not leave an unvalidated `.docx` in the repo.
- **Comments in English only** — even when describing Hebrew liturgical content.

---

## What This Project Is Not

- Not a web app or API — it is a pure CLI document generator.
- Not a real-time z'manim calculator — times are hardcoded for Pesach 5786 /
  Pleasantville NJ. For other years or locations, times must be updated manually
  (or a z'manim library integrated).
- Not a general-purpose Jewish calendar tool — it covers only Pesach.

---

## Potential Extensions (not yet implemented)

- **Parameterise by year/location:** accept `--year` and `--lat`/`--lng` flags; pull
  live z'manim from the [Hebcal API](https://www.hebcal.com/home/195/jewish-calendar-rest-api)
  or the `kosher-zmanim` npm package.
- **Sukkot / Shavuot variants:** the helper architecture is generic enough to support
  other חגים with new page modules and data files.
- **PDF output:** pipe the `.docx` through LibreOffice headless (`soffice --convert-to pdf`)
  to produce a print-ready PDF alongside the Word file.
- **Congregation customisation:** accept a config file (`congregation.json`) with the
  shul's name, address, and minhag flags (Sephardic/Ashkenazic, tefillin on CHM, etc.)
  that adjust the generated halachic notes automatically.
- **Drasha topics page:** the rabbinical sermon topic recommendations discussed during
  design could be added as a 10th page or appendix.
