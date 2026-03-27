# Pesach 5786 Schedule Generator

A Node.js CLI tool that generates a polished, multi-page Microsoft Word (`.docx`) document
containing the complete Pesach (Passover) schedule for an Orthodox rabbi and congregation.

## Features

- One page per day across all 9 days of Pesach 5786 (April 1–10, 2026)
- Z'manim (halachic times) calculated via `kosher-zmanim` (GRA method)
- Complete Torah readings with aliyah-by-aliyah citations
- Davening/services schedule with tefila notes
- Halachic guidance boxes calibrated for Ashkenazic Orthodox, Diaspora practice
- Inline Hebrew text (with full nikudot) using the David font

## Days Covered

| Page | Date | Day |
|------|------|-----|
| 1 | Tue night Mar 31 | Bedikat Chametz |
| 2 | Wed Apr 1 | Erev Pesach |
| 3 | Thu Apr 2 | Yom Tov I |
| 4 | Fri Apr 3 | Yom Tov II |
| 5 | Sat Apr 4 | Shabbat Chol HaMoed |
| 6 | Sun–Tue Apr 5–7 | Chol HaMoed (3 weekdays) |
| 7 | Wed Apr 8 | Erev Shevi'i shel Pesach |
| 8 | Thu Apr 9 | Shevi'i shel Pesach |
| 9 | Fri Apr 10 | Acharon shel Pesach |

## Requirements

- Node.js v18+

## Installation

```bash
npm install
```

## Usage

```bash
node pesach_5786_generator.js
```

Writes `pesach_5786.docx` to the current directory.

### Options

| Flag | Description |
|------|-------------|
| `--city <name>` | Override the default location (default: Margate City, NJ) |

## Default Location

Z'manim default to **Margate City, NJ** (39.3287°N, 74.5003°W, `America/New_York`).

## Tech Stack

- [docx](https://www.npmjs.com/package/docx) v9.x — Word document generation
- [kosher-zmanim](https://www.npmjs.com/package/kosher-zmanim) — halachic time calculations

## License

MIT — see [LICENSE](LICENSE).
