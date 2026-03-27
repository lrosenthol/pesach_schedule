/**
 * pesach_5786_generator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates a 9-page Word (.docx) Pesach 5786 schedule for the rabbi.
 * One page per day: Bedikat Chametz → Erev Pesach → Yom Tov I–II →
 *   Shabbat Chol HaMoed → Chol HaMoed (3 days) → Erev Shevi'i →
 *   Shevi'i shel Pesach → Acharon shel Pesach.
 *
 * Each page includes: z'manim, davening/services, Torah reading (aliyot +
 *   maftir + haftarah), tefila notes, and halachic guidance boxes.
 * Hebrew terms (with nikudot) are embedded inline in English prose.
 *
 * Default z'manim are for Margate City, NJ (39.3287°N, 74.5003°W), calculated
 * via kosher-zmanim (GRA). Use --city to override for any other location.
 *
 * Prerequisites:
 *   npm install -g docx        (tested with docx 9.x)
 *
 * Usage:
 *   node pesach_5786_generator.js
 *   node pesach_5786_generator.js --city "Chicago" -o ./output
 *   node pesach_5786_generator.js --city "Jerusalem" --timezone Asia/Jerusalem
 *
 * Options:
 *   --city <name>      City name whose coordinates are used to recalculate all
 *                      z'manim via the Nominatim geocoding API + kosher-zmanim.
 *                      Default: hardcoded Pleasantville / Atlantic County NJ times.
 *   --timezone <tz>    IANA timezone string (e.g. America/Chicago, Asia/Jerusalem).
 *                      Inferred from longitude when omitted; override for non-US
 *                      cities where the inference may be wrong.
 *   -o <dir>           Output directory. Default: ./output
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';
const path  = require('path');
const https = require('https');
const fs    = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType,
  VerticalAlign, TableLayoutType
} = require('docx');

// ── CLI argument parsing ──────────────────────────────────────────────────────
function parseCliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--city' || a === '--timezone') && argv[i + 1]) {
      args[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--city=')) {
      args.city = a.slice(7);
    } else if (a.startsWith('--timezone=')) {
      args.timezone = a.slice(11);
    } else if (a === '-o' && argv[i + 1]) {
      args.o = argv[++i];
    }
  }
  return args;
}
const CLI = parseCliArgs(process.argv.slice(2));

// ── Default z'manim (Margate City, NJ — 39.3287°N, 74.5003°W, America/New_York)
// Calculated via kosher-zmanim for Pesach 5786 dates. Overridden by --city.
let Z = {
  bedikat:    { tzait: "8:01 PM" },
  erev:       { hanetz: "6:42 AM", sofBiur: "11:58 AM", plag: "6:02 PM",  shkiah: "7:21 PM", candleLighting: "7:21 PM", tzait: "8:02 PM" },
  yomtov1:    { hanetz: "6:40 AM", chatzot: "1:01 PM",  shkiah: "7:22 PM", candleLighting: "8:03 PM", tzait: "8:03 PM" },
  yomtov2:    { hanetz: "6:39 AM", candleLighting: "7:05 PM", shkiah: "7:23 PM", tzait: "8:04 PM" },
  shabbat:    { hanetz: "6:37 AM", minchaGedola: "1:33 PM", plag: "6:04 PM", shkiah: "7:24 PM", tzait: "8:05 PM" },
  cholhamoed: { hanetz: "6:36 AM", shkiah: "7:25 PM", tzait: "8:06 PM" },
  erevshevii: { hanetz: "6:31 AM", candleLighting: "7:10 PM", shkiah: "7:28 PM", tzait: "8:09 PM" },
  shevii:     { hanetz: "6:29 AM", shkiah: "7:29 PM", candleLighting: "8:10 PM", tzait: "8:10 PM" },
  acharon:    { hanetz: "6:28 AM", shkiah: "7:30 PM", tzait: "8:11 PM" },
};

// ── Timezone inference from longitude ─────────────────────────────────────────
function guessTimezone(lat, lon) {
  if (lon >= 34 && lon <= 36 && lat >= 29 && lat <= 34) return 'Asia/Jerusalem';
  if (lon >= -67 && lon < -52)  return 'America/Halifax';
  if (lon >= -87 && lon < -67)  return 'America/New_York';
  if (lon >= -104 && lon < -87) return 'America/Chicago';
  if (lon >= -115 && lon < -104)return 'America/Denver';
  if (lon < -115)               return 'America/Los_Angeles';
  if (lon >= -10 && lon < 2)    return 'Europe/London';
  if (lon >= 2  && lon < 16)    return 'Europe/Paris';
  if (lon >= 16 && lon < 34)    return 'Europe/Athens';
  const off = -Math.round(lon / 15);
  return `Etc/GMT${off >= 0 ? '+' : ''}${off}`;
}

// ── Geocode a city name via Nominatim (OpenStreetMap) ────────────────────────
function geocodeCity(name) {
  return new Promise((resolve, reject) => {
    const q   = encodeURIComponent(name);
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`;
    const req = https.get(url, { headers: { 'User-Agent': 'pesach-schedule-generator/1.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const results = JSON.parse(data);
          if (!results.length) return reject(new Error(`City not found: "${name}"`));
          const { lat, lon, display_name } = results[0];
          resolve({ lat: parseFloat(lat), lon: parseFloat(lon), displayName: display_name });
        } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
  });
}

// ── Compute z'manim for all Pesach dates from lat/lon/tz ─────────────────────
function calcZmanim(lat, lon, tz) {
  const KZ = require('kosher-zmanim');

  function getDay(y, m, d) {
    return KZ.getZmanimJson({ date: new Date(y, m - 1, d), latitude: lat, longitude: lon,
      timeZoneId: tz, elevation: 0 }).BasicZmanim;
  }

  function fmt(isoStr) {
    if (!isoStr) return '—';
    return new Date(isoStr).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz
    });
  }

  function parseDuration(iso) {
    const m = iso.match(/PT(\d+)H(\d+)M([\d.]+)S/);
    return (parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3])) * 1000;
  }

  function sofBiur(z) {
    const rise  = new Date(z.Sunrise).getTime();
    const shaah = parseDuration(z.ShaahZmanisGra);
    return fmt(new Date(rise + 5 * shaah).toISOString());
  }

  function candleLighting(z) {
    return fmt(new Date(new Date(z.Sunset).getTime() - 18 * 60000).toISOString());
  }

  const b  = getDay(2026, 3, 31);
  const ev = getDay(2026, 4,  1);
  const y1 = getDay(2026, 4,  2);
  const y2 = getDay(2026, 4,  3);
  const sh = getDay(2026, 4,  4);
  const ch = getDay(2026, 4,  5);
  const es = getDay(2026, 4,  8);
  const sv = getDay(2026, 4,  9);
  const ac = getDay(2026, 4, 10);

  return {
    bedikat:    { tzait: fmt(b.Tzais) },
    erev:       { hanetz: fmt(ev.Sunrise), sofBiur: sofBiur(ev), plag: fmt(ev.PlagHamincha),
                  shkiah: fmt(ev.Sunset), candleLighting: fmt(ev.Sunset), tzait: fmt(ev.Tzais) },
    yomtov1:    { hanetz: fmt(y1.Sunrise), chatzot: fmt(y1.Chatzos),
                  shkiah: fmt(y1.Sunset), candleLighting: fmt(y1.Tzais), tzait: fmt(y1.Tzais) },
    yomtov2:    { hanetz: fmt(y2.Sunrise), candleLighting: candleLighting(y2),
                  shkiah: fmt(y2.Sunset),  tzait: fmt(y2.Tzais) },
    shabbat:    { hanetz: fmt(sh.Sunrise), minchaGedola: fmt(sh.MinchaGedola),
                  plag:   fmt(sh.PlagHamincha), shkiah: fmt(sh.Sunset), tzait: fmt(sh.Tzais) },
    cholhamoed: { hanetz: fmt(ch.Sunrise), shkiah: fmt(ch.Sunset), tzait: fmt(ch.Tzais) },
    erevshevii: { hanetz: fmt(es.Sunrise), candleLighting: candleLighting(es),
                  shkiah: fmt(es.Sunset),  tzait: fmt(es.Tzais) },
    shevii:     { hanetz: fmt(sv.Sunrise), shkiah: fmt(sv.Sunset), candleLighting: fmt(sv.Tzais), tzait: fmt(sv.Tzais) },
    acharon:    { hanetz: fmt(ac.Sunrise), shkiah: fmt(ac.Sunset), tzait: fmt(ac.Tzais) },
  };
}

// ── Colours ──────────────────────────────────────────────────────────────────
const BLUE        = "1F5C99";
const BLUE_LIGHT  = "D6E4F0";
const GREEN       = "1A6B3A";
const GREEN_LIGHT = "D6EDE1";
const AMBER       = "7B4F00";
const AMBER_LIGHT = "FEF3D6";
const GRAY        = "4A4A4A";
const GRAY_LIGHT  = "F0F0F0";
const WHITE       = "FFFFFF";
const CANDLE_TINT = "FFFBEA";
const TORAH_TINT  = "EAF4FB";

const FONT     = "Calibri";
const HEB_FONT = "David";
const BODY_PT  = 20;

// ── Borders ───────────────────────────────────────────────────────────────────
const border0   = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: border0, bottom: border0, left: border0, right: border0 };
const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const allThin   = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

// ── Run builders ──────────────────────────────────────────────────────────────
function e(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: opts.size || BODY_PT,
    bold: opts.bold||false, italics: opts.italics||false, color: opts.color||"000000" });
}
function h(text, opts = {}) {
  return new TextRun({ text, font: HEB_FONT, size: opts.size || BODY_PT,
    bold: opts.bold||false, color: opts.color||"000000", rightToLeft: true });
}
function wa(text, opts={}) { return e(text, { ...opts, color:"856404" }); }
function ia(text, opts={}) { return e(text, { ...opts, color:"1A5276" }); }
function wah(text,opts={}) { return h(text, { ...opts, color:"856404" }); }
function iah(text,opts={}) { return h(text, { ...opts, color:"1A5276" }); }

// ── Paragraph builders ────────────────────────────────────────────────────────
function para(runs, opts={}) {
  return new Paragraph({ alignment: opts.align||AlignmentType.LEFT,
    spacing: opts.spacing||{ before:0, after:80 },
    children: Array.isArray(runs)?runs:[runs], indent: opts.indent });
}
function spacer(after=80) {
  return new Paragraph({ spacing:{ before:0, after }, children:[] });
}

// ── Section label bar ─────────────────────────────────────────────────────────
function sectionLabel(text, bgColor) {
  return new Table({
    width:{ size:9360, type:WidthType.DXA }, columnWidths:[9360], layout:TableLayoutType.FIXED,
    rows:[new TableRow({ children:[new TableCell({
      borders:noBorders, shading:{ fill:bgColor, type:ShadingType.CLEAR },
      margins:{ top:50, bottom:50, left:160, right:160 }, width:{ size:9360, type:WidthType.DXA },
      children:[para([e(text,{ size:17, bold:true, color:GRAY })],{ spacing:{ before:0, after:0 } })]
    })]})]
  });
}

// ── Day header banner ─────────────────────────────────────────────────────────
function dayHeader(badge, hebTitle, engSubtitle, bgColor) {
  const BW=1700, TW=7660;
  return new Table({
    width:{ size:9360, type:WidthType.DXA }, columnWidths:[BW,TW], layout:TableLayoutType.FIXED,
    rows:[new TableRow({ children:[
      new TableCell({ borders:noBorders, shading:{ fill:bgColor, type:ShadingType.CLEAR },
        margins:{ top:120, bottom:120, left:160, right:100 }, width:{ size:BW, type:WidthType.DXA },
        verticalAlign:VerticalAlign.CENTER,
        children:[para([e(badge,{ size:18, bold:true, color:WHITE })],{ spacing:{ before:0, after:0 } })] }),
      new TableCell({ borders:noBorders, shading:{ fill:bgColor, type:ShadingType.CLEAR },
        margins:{ top:90, bottom:90, left:140, right:160 }, width:{ size:TW, type:WidthType.DXA },
        verticalAlign:VerticalAlign.CENTER,
        children:[
          new Paragraph({ bidirectional:true, alignment:AlignmentType.RIGHT,
            spacing:{ before:0, after:0 }, children:[h(hebTitle,{ size:30, bold:true, color:WHITE })] }),
          new Paragraph({ alignment:AlignmentType.RIGHT,
            spacing:{ before:0, after:0 }, children:[e(engSubtitle,{ size:18, color:"E0E0E0" })] }),
        ] })
    ]})]
  });
}

// ── Two-column row (time | runs) ──────────────────────────────────────────────
function twoCol(time, runs, timeColor) {
  const T=1200, D=8160;
  const dr = Array.isArray(runs)?runs:[e(runs)];
  return new Table({
    width:{ size:9360, type:WidthType.DXA }, columnWidths:[T,D], layout:TableLayoutType.FIXED,
    rows:[new TableRow({ children:[
      new TableCell({ borders:noBorders, width:{ size:T, type:WidthType.DXA },
        margins:{ top:24, bottom:24, left:0, right:80 },
        children:[para([e(time,{ bold:true, color:timeColor||BLUE })],{ spacing:{ before:0, after:0 } })] }),
      new TableCell({ borders:noBorders, width:{ size:D, type:WidthType.DXA },
        margins:{ top:24, bottom:24, left:60, right:0 },
        children:[para(dr,{ spacing:{ before:0, after:0 } })] })
    ]})]
  });
}
const zmanRow    = (t,r) => twoCol(t, r, BLUE);
const serviceRow = (t,r) => twoCol(t, r, "000000");

// ── Info box ──────────────────────────────────────────────────────────────────
function infoBox(titleRuns, bodyRuns, tint) {
  const tr = Array.isArray(titleRuns)?titleRuns:[e(titleRuns,{ bold:true })];
  const br = Array.isArray(bodyRuns)?bodyRuns:[e(bodyRuns)];
  return new Table({
    width:{ size:9360, type:WidthType.DXA }, columnWidths:[9360], layout:TableLayoutType.FIXED,
    rows:[new TableRow({ children:[new TableCell({
      borders:allThin, shading:{ fill:tint, type:ShadingType.CLEAR },
      margins:{ top:100, bottom:100, left:160, right:160 }, width:{ size:9360, type:WidthType.DXA },
      children:[ para(tr,{ spacing:{ before:0, after:50 } }), para(br,{ spacing:{ before:0, after:0 } }) ]
    })]})]
  });
}

// ── Alert box ─────────────────────────────────────────────────────────────────
function alertBox(runs, type='warn') {
  const fill  = type==='warn' ? "FFF3CD" : "D6EAF8";
  const accent= type==='warn' ? "856404" : "1A5276";
  const ar = Array.isArray(runs)?runs:[e(runs,{ color:accent })];
  return new Table({
    width:{ size:9360, type:WidthType.DXA }, columnWidths:[9360], layout:TableLayoutType.FIXED,
    rows:[new TableRow({ children:[new TableCell({
      borders:{ top:{ style:BorderStyle.SINGLE, size:1, color:accent },
                bottom:{ style:BorderStyle.SINGLE, size:1, color:accent },
                left:{ style:BorderStyle.THICK, size:12, color:accent },
                right:{ style:BorderStyle.SINGLE, size:1, color:accent } },
      shading:{ fill, type:ShadingType.CLEAR },
      margins:{ top:80, bottom:80, left:160, right:160 }, width:{ size:9360, type:WidthType.DXA },
      children:[para(ar,{ spacing:{ before:0, after:0 } })]
    })]})]
  });
}

// ── Candle lighting box ───────────────────────────────────────────────────────
function candleBox(timeStr, noteText) {
  return infoBox(
    [e("Candle Lighting — ", { bold:true }), e(timeStr, { bold:true, color:BLUE })],
    [e(noteText)],
    CANDLE_TINT
  );
}

// ── Torah reading box ─────────────────────────────────────────────────────────
function torahBox(rows) {
  const children = [
    para([e("Torah Reading", { bold:true, size:19 })], { spacing:{ before:0, after:50 } }),
    ...rows.map(r => para([
      e(r.label + ":  ", { bold:true, size:18 }),
      e(r.text, { size:18 })
    ], { spacing:{ before:0, after:32 } }))
  ];
  return new Table({
    width:{ size:9360, type:WidthType.DXA }, columnWidths:[9360], layout:TableLayoutType.FIXED,
    rows:[new TableRow({ children:[new TableCell({
      borders:allThin, shading:{ fill:TORAH_TINT, type:ShadingType.CLEAR },
      margins:{ top:90, bottom:90, left:160, right:160 }, width:{ size:9360, type:WidthType.DXA },
      children
    })]})]
  });
}

// ════════════════════════════════════════════════════════════════════════════
// PAGES
// ════════════════════════════════════════════════════════════════════════════

function pageBedikat() {
  return [
    dayHeader("Pre-Pesach", "בְּדִיקַת חָמֵץ", "Tuesday night, March 31, 2026 / 13 Nisan 5786", GRAY),
    spacer(120),
    sectionLabel("Z'MANIM", GRAY_LIGHT),
    spacer(60),
    zmanRow(Z.bedikat.tzait, [e("Tzait ("), h("צֵאת הַכּוֹכָבִים"), e(") — begin "), h("בְּדִיקָה")]),
    spacer(120),
    sectionLabel("HALACHA", GRAY_LIGHT),
    spacer(60),
    infoBox(
      [h("בְּדִיקַת חָמֵץ"), e(" — Searching for Chametz", { bold:true })],
      [e("Performed after "), h("צֵאת הַכּוֹכָבִים"), e(" by candlelight (or LED flashlight, per many "), h("פּוֹסְקִים"), e("). Recite \""), h("עַל בִּיעוּר חָמֵץ"), e("\" before beginning; do not speak unnecessarily between the "), h("בְּרָכָה"), e(" and the start of the search. Use a candle, feather, and wooden spoon. Search all rooms that had "), h("חָמֵץ"), e(" — car, office, "), h("שַׁבָּת"), e(" coat pockets. After the search, recite the first "), h("כָּל חֲמִירָא"), e(" ("), h("בִּיטּוּל"), e(").")],
      GRAY_LIGHT
    ),
    spacer(80),
    infoBox(
      [h("בִּיטּוּל חָמֵץ"), e(" — Nullification of Chametz", { bold:true })],
      [e("Two separate "), h("בִּיטּוּל"), e(" declarations are required:"),
       e(""),
       e("1.  After tonight's search: recite "), h("כָּל חֲמִירָא דְּאִיכָּא בִרְשׁוּתִי"), e(" — nullifying all "), h("חָמֵץ"), e(" you did not find and do not know about."),
       e(""),
       e(`2.  After burning chametz tomorrow morning (April 1, before ${Z.erev.sofBiur}): a broader recitation nullifying `), e("all"), e(" remaining "), h("חָמֵץ"), e(", including what you found and burned. Recite this immediately after burning. Both declarations should be understood by the speaker — if saying the Aramaic, know its meaning.")],
      GRAY_LIGHT
    ),
  ];
}

function pageErevPesach() {
  return [
    dayHeader("Erev Pesach", "עֶרֶב פֶּסַח", "Wednesday, April 1, 2026 / 14 Nisan 5786 — Fast of the Firstborn / Burning Chametz", GRAY),
    spacer(120),
    sectionLabel("Z'MANIM", GRAY_LIGHT),
    spacer(60),
    zmanRow(Z.erev.hanetz, [e("Hanetz ("), h("הַנֵּץ הַחַמָּה"), e(") — sunrise; "), h("תַּעֲנִית בְּכוֹרוֹת"), e(" begins")]),
    zmanRow(Z.erev.sofBiur, [e("Latest "), h("בִּיעוּר חָמֵץ"), e(" — burn "), h("חָמֵץ"), e(" before this time; recite final "), h("בִּיטּוּל")]),
    zmanRow(Z.erev.plag,  [e("Plag "), h("הַמִּנְחָה")]),
    zmanRow(Z.erev.shkiah,         [e("Shkiah ("), h("שְׁקִיעָה"), e(") — Yom Tov begins")]),
    zmanRow(Z.erev.candleLighting, [e("Candle lighting")]),
    zmanRow(Z.erev.tzait,  [e("Tzait ("), h("צֵאת הַכּוֹכָבִים"), e(") — "), h("סֵדֶר"), e(" may begin")]),
    spacer(80),
    candleBox(Z.erev.shkiah,
      "Recite two brachot: \"l'hadlik ner shel Yom Tov\" and \"Shehecheyanu.\" A pre-existing flame is preferable (e.g., a yahrzeit candle lit before the holiday), though a match is permitted since Yom Tov has not yet begun at lighting time."),
    spacer(80),
    sectionLabel("DAVENING / SERVICES", GRAY_LIGHT),
    spacer(60),
    serviceRow("6:45 AM", [h("שַׁחֲרִית"), e(" — no "), h("תַּחֲנוּן"), e("; "), h("סִיּוּם"), e(" to release firstborns from "), h("תַּעֲנִית בְּכוֹרוֹת")]),
    serviceRow("7:15 PM", [h("מִנְחָה"), e(" — brief; light candles before "), h("שְׁקִיעָה")]),
    serviceRow(Z.erev.tzait, [h("מַעֲרִיב"), e(" / "), h("קִדּוּשׁ"), e(" / Seder Night 1 — begin after "), h("צֵאת הַכּוֹכָבִים")]),
    spacer(100),
    sectionLabel("HALACHA", GRAY_LIGHT),
    spacer(60),
    infoBox(
      [h("תַּעֲנִית בְּכוֹרוֹת"), e(" — Fast of the Firstborn", { bold:true })],
      [e(`The fast runs from sunrise (${Z.erev.hanetz}) until broken at the `), h("סִיּוּם"), e(" after "), h("שַׁחֲרִית"), e(". Only firstborn males are technically obligated (some communities include firstborn females). A "), h("סִיּוּם"), e(" — completion of a Talmudic tractate — creates a "), h("סְעוּדַת מִצְוָה"), e(" that overrides the fast. The rabbi must arrange a proper "), h("סִיּוּם"), e(" before the holiday. Parents of firstborn children too young to fast should fast on their behalf.")],
      GRAY_LIGHT
    ),
    spacer(80),
    infoBox(
      [e("Sale of "), h("חָמֵץ"), e(" ("), h("מְכִירַת חָמֵץ"), e(")", { bold:true })],
      [e(`Sale must be completed before ${Z.erev.sofBiur}. A `), h("שְׁטַר הַרְשָׁאָה"), e(" must be signed. "), h("חָמֵץ"), e(" owned by a Jew during Pesach is forbidden "), h("בַּהֲנָאָה"), e(" even "), h("בְּדִיעֲבַד"), e(". Sold "), h("חָמֵץ"), e(" must be locked and labeled. It reverts only after the rabbi formally concludes the sale after Yom Tov (Friday night, April 10).")],
      GRAY_LIGHT
    ),
    spacer(80),
    infoBox(
      [h("עֵרוּב תַּבְשִׁילִין"), e("", { bold:true })],
      [e("Set aside before Yom Tov tonight — a "), h("כַּבֵּיצָה"), e(" of cooked food plus a whole "), h("מַצָּה"), e(". Recite \""), h("עַל מִצְוַת עֵרוּב"), e("\" and the Aramaic declaration. The rabbi makes "), h("עֵרוּב"), e(" also on behalf of anyone who forgot. Required because Yom Tov Day 2 (Friday) flows directly into "), h("שַׁבָּת"), e(".")],
      GRAY_LIGHT
    ),
  ];
}

function pageYomTov1() {
  return [
    dayHeader("Yom Tov I", "יוֹם טוֹב רִאשׁוֹן שֶׁל פֶּסַח", "Thursday, April 2, 2026 / 15 Nisan 5786 — First Day Pesach", BLUE),
    spacer(120),
    sectionLabel("Z'MANIM", BLUE_LIGHT),
    spacer(60),
    zmanRow(Z.yomtov1.hanetz,  [e("Hanetz ("), h("הַנֵּץ הַחַמָּה"), e(") — sunrise")]),
    zmanRow(Z.yomtov1.chatzot, [e("Chatzot ("), h("חֲצוֹת"), e(") — halachic midday")]),
    zmanRow(Z.yomtov1.shkiah,  [e("Shkiah ("), h("שְׁקִיעָה"), e(") — sunset")]),
    zmanRow(Z.yomtov1.tzait,          [e("Tzait ("), h("צֵאת הַכּוֹכָבִים"), e(") — Yom Tov II begins")]),
    zmanRow(Z.yomtov1.candleLighting, [e("Candle lighting — from pre-existing flame only")]),
    spacer(80),
    candleBox(`${Z.yomtov1.tzait} — from pre-existing flame ONLY`,
      "For Day 2: light after tzait from a flame burning since before Yom Tov (yahrzeit candle, gas range). A match or lighter may NOT be used to create a new flame on Yom Tov. Recite \"l'hadlik ner shel Yom Tov\" only — no Shehecheyanu on the second night."),
    spacer(80),
    sectionLabel("DAVENING / SERVICES", BLUE_LIGHT),
    spacer(60),
    serviceRow("9:30 AM", [h("שַׁחֲרִית"), e(" — full "), h("הַלֵּל"), e("; "), h("מוּסָף"), e(" with "), h("תְּפִלַּת טַל"), e("; begin "), h("מוֹרִיד הַטַּל"), e("; cease "), h("מַשִּׁיב הָרוּחַ"), e(" and "), h("וְתֵן טַל וּמָטָר")]),
    serviceRow("6:45 PM", [h("מִנְחָה")]),
    serviceRow(Z.yomtov1.tzait, [h("מַעֲרִיב"), e(" / "), h("קִדּוּשׁ"), e(" / Seder Night 2")]),
    spacer(100),
    sectionLabel("TORAH READING & PRAYER NOTES", BLUE_LIGHT),
    spacer(60),
    torahBox([
      { label:"Main — Scroll 1 (5 aliyot)", text:"Exodus 12:21–51 — The Passover offering in Egypt; plague of the firstborn; \"On this very day, G-d took the Children of Israel out of Egypt\"" },
      { label:"Aliyot",          text:"1: Ex.12:21–28 · 2: 12:29–33 · 3: 12:34–37 · 4: 12:38–42 · 5: 12:43–51" },
      { label:"Maftir — Scroll 2", text:"Numbers 28:16–25 — Festival sacrifices brought on Passover" },
      { label:"Haftarah",        text:"Joshua 5:2–6:1, 6:27 — The first Passover observed in the Land of Israel at Gilgal" },
    ]),
    spacer(80),
    infoBox(
      [h("תְּפִלַּת גֶּשֶׁם"), e(" / "), h("טַל"), e(" — Key Prayer Changes at "), h("מוּסָף"), e("", { bold:true })],
      [e("Recite "), h("תְּפִלַּת טַל"), e(" and begin \""), h("מוֹרִיד הַטַּל"), e("\" in the second "), h("בְּרָכָה"), e(" of "), h("שְׁמוֹנֶה עֶשְׂרֵה"), e(". From this "), h("מוּסָף"), e(" through "), h("שְׁמִינִי עֲצֶרֶת"), e(": omit \""), h("מַשִּׁיב הָרוּחַ וּמוֹרִיד הַגֶּשֶׁם"), e("\" and \""), h("וְתֵן טַל וּמָטָר לִבְרָכָה"), e("\". Announce clearly before "), h("מוּסָף"), e(".")],
      BLUE_LIGHT
    ),
    spacer(80),
    infoBox(
      [h("סְפִירַת הָעֹמֶר"), e(" — Counting of the Omer begins tonight", { bold:true })],
      [e("Counting begins tonight after "), h("צֵאת"), e(` (~${Z.yomtov1.tzait}) — Night 1. Count aloud after `), h("מַעֲרִיב"), e(" each night throughout "), h("חוֹל הַמּוֹעֵד"), e(" and Yom Tov. A congregant who misses a night may continue without a "), h("בְּרָכָה"), e(".")],
      BLUE_LIGHT
    ),
  ];
}

function pageYomTov2() {
  return [
    dayHeader("Yom Tov II", "יוֹם טוֹב שֵׁנִי שֶׁל פֶּסַח", "Friday, April 3, 2026 / 16 Nisan 5786 — Yom Tov → Shabbat", BLUE),
    spacer(120),
    sectionLabel("Z'MANIM", BLUE_LIGHT),
    spacer(60),
    zmanRow(Z.yomtov2.hanetz, [e("Hanetz ("), h("הַנֵּץ הַחַמָּה"), e(") — sunrise")]),
    zmanRow(Z.yomtov2.candleLighting, [e("Candle lighting — 18 min before "), h("שְׁקִיעָה"), e("; from pre-existing flame only")]),
    zmanRow(Z.yomtov2.shkiah, [e("Shkiah ("), h("שְׁקִיעָה"), e(") — Yom Tov ends; "), h("שַׁבָּת"), e(" begins simultaneously")]),
    zmanRow(Z.yomtov2.tzait,  [e("Tzait ("), h("צֵאת הַכּוֹכָבִים"), e(")")]),
    spacer(80),
    candleBox(`${Z.yomtov2.candleLighting} — pre-existing flame ONLY`,
      "Yom Tov is still active at candle lighting time — a match or lighter absolutely may NOT be used. Light from a yahrzeit candle or gas range. Recite \"l'hadlik ner shel Shabbat v'Yom Tov.\" No Shehecheyanu when Yom Tov transitions into Shabbat."),
    spacer(80),
    sectionLabel("DAVENING / SERVICES", BLUE_LIGHT),
    spacer(60),
    serviceRow("9:30 AM", [h("שַׁחֲרִית"), e(" — full "), h("הַלֵּל"), e("; "), h("מוּסָף"), e(" (Yom Tov "), h("נֻסַּח"), e(")")]),
    serviceRow("6:45 PM", [h("מִנְחָה"), e(" — brief; Yom Tov transitioning into "), h("שַׁבָּת")]),
    serviceRow(Z.yomtov2.shkiah, [h("קַבָּלַת שַׁבָּת"), e(" / "), h("מַעֲרִיב"), e(" — "), h("שַׁבָּת"), e(" "), h("קִדּוּשׁ"), e(" (not weekday Yom Tov "), h("קִדּוּשׁ"), e(")")]),
    spacer(100),
    sectionLabel("TORAH READING & PRAYER NOTES", BLUE_LIGHT),
    spacer(60),
    torahBox([
      { label:"Main — Scroll 1 (5 aliyot)", text:"Leviticus 22:26–23:44 — The festival calendar: the appointed times (Pesach, Omer, Shavuot, Rosh Hashana, Yom Kippur, Sukkot); obligation of pilgrimage" },
      { label:"Aliyot",          text:"1: Lev.22:26–23:3 · 2: 23:4–14 · 3: 23:15–22 · 4: 23:23–32 · 5: 23:33–44" },
      { label:"Maftir — Scroll 2", text:"Numbers 28:16–25 — Festival sacrifices (same as Day 1)" },
      { label:"Haftarah",        text:"II Kings 23:1–9, 21–25 — King Josiah's national covenant renewal and great Passover celebration" },
    ]),
    spacer(80),
    alertBox(
      [wa("Critical: "), wah("שַׁבָּת חוֹל הַמּוֹעֵד"), wa(" begins tonight! Candles from existing flame only. "), wah("הַבְדָּלָה"), wa(" on "), wah("מוֹצָאֵי שַׁבָּת"), wa(": no "), wah("בְּשָׂמִים"), wa(", no candle — wine and "), wah("הַבְדָּלָה"), wa(" "), wah("בְּרָכָה"), wa(" only ("), wah("קֹדֶשׁ לְקֹדֶשׁ"), wa(").")],
      'warn'
    ),
  ];
}

function pageShabbat() {
  return [
    dayHeader("Shabbat Chol HaMoed", "שַׁבָּת חוֹל הַמּוֹעֵד", "Saturday, April 4, 2026 / 17 Nisan 5786 — Day 3 of Pesach", AMBER),
    spacer(120),
    sectionLabel("Z'MANIM", AMBER_LIGHT),
    spacer(60),
    zmanRow(Z.shabbat.hanetz,       [e("Hanetz ("), h("הַנֵּץ הַחַמָּה"), e(") — sunrise")]),
    zmanRow(Z.shabbat.minchaGedola, [h("מִנְחָה גְּדוֹלָה")]),
    zmanRow(Z.shabbat.plag,         [e("Plag "), h("הַמִּנְחָה")]),
    zmanRow(Z.shabbat.shkiah,       [e("Shkiah ("), h("שְׁקִיעָה"), e(") — sunset")]),
    zmanRow(Z.shabbat.tzait,        [e("Tzait ("), h("צֵאת הַכּוֹכָבִים"), e(") — "), h("שַׁבָּת"), e(" ends / "), h("חוֹל הַמּוֹעֵד"), e(" resumes")]),
    spacer(100),
    sectionLabel("DAVENING / SERVICES", AMBER_LIGHT),
    spacer(60),
    serviceRow("9:30 AM", [h("שַׁחֲרִית"), e(" — "), h("שַׁבָּת"), e(" "), h("נֻסַּח"), e("; full "), h("הַלֵּל"), e("; Torah reading; "), h("מוּסָף"), e(" ("), h("שַׁבָּת"), e(" + "), h("חוֹל הַמּוֹעֵד"), e(" combined); no "), h("יִזְכּוֹר")]),
    serviceRow("~1:00 PM", [h("סְעוּדָה שְׁלִישִׁית"), e(" — "), h("שִׁיר הַשִּׁירִים"), e(" reading customary")]),
    serviceRow("7:00 PM",  [h("מִנְחָה")]),
    serviceRow(Z.shabbat.tzait, [h("מַעֲרִיב"), e(" + "), h("הַבְדָּלָה"), e(" — wine only; no "), h("בְּשָׂמִים"), e(", no candle ("), h("קֹדֶשׁ לְקֹדֶשׁ"), e(")")]),
    spacer(100),
    sectionLabel("TORAH READING & PRAYER NOTES", AMBER_LIGHT),
    spacer(60),
    torahBox([
      { label:"Main — Scroll 1 (7 aliyot on Shabbat)", text:"Exodus 33:12–34:26 — Moses and the Thirteen Attributes of Mercy; covenant renewal; laws of the festivals" },
      { label:"Aliyot",          text:"1: Ex.33:12–16 · 2: 33:17–19 · 3: 33:20–23 · 4: 34:1–3 · 5: 34:4–10 · 6: 34:11–17 · 7: 34:18–26" },
      { label:"Maftir — Scroll 2", text:"Numbers 28:19–25 — Festival sacrifices" },
      { label:"Haftarah",        text:"Ezekiel 37:1–14 — The Valley of Dry Bones: national resurrection, ingathering of exiles, and future redemption" },
    ]),
    spacer(80),
    infoBox(
      [h("קִדּוּשׁ"), e(", "), h("מוּסָף"), e(" & "), h("סְעוּדָה שְׁלִישִׁית"), e(" Notes", { bold:true })],
      [e("Recite full "), h("שַׁבָּת"), e("-Pesach "), h("קִדּוּשׁ"), e(" (not weekday Yom Tov). "), h("מוּסָף"), e(" combines "), h("שַׁבָּת"), e(" and "), h("חוֹל הַמּוֹעֵד"), e(" text — mark the "), h("מַחְזוֹר"), e(" for the "), h("חַזָּן"), e(" in advance. "), h("סְעוּדָה שְׁלִישִׁית"), e(" is obligatory and may be fulfilled with "), h("מַצָּה"), e(" alone or fruit. Do not begin within the hour before "), h("מַעֲרִיב"), e(".")],
      AMBER_LIGHT
    ),
    spacer(80),
    alertBox(
      [wa("Common error — "), wah("הַבְדָּלָה"), wa(" on "), wah("מוֹצָאֵי שַׁבָּת חוֹל הַמּוֹעֵד"), wa(": because "), wah("שַׁבָּת"), wa(" flows into "), wah("חוֹל הַמּוֹעֵד"), wa(" (not a regular weekday), omit "), wah("בְּשָׂמִים"), wa(" and the candle entirely. Recite only wine + \""), wah("הַמַּבְדִּיל בֵּין קֹדֶשׁ לְקֹדֶשׁ"), wa("\". Announce this during "), wah("שַׁחֲרִית"), wa(".")],
      'warn'
    ),
  ];
}

function pageCholHamoed() {
  return [
    dayHeader("Chol HaMoed", "חוֹל הַמּוֹעֵד פֶּסַח", "Sunday–Tuesday, April 5–7, 2026 / 18–20 Nisan — Days 4–6 of Pesach", GREEN),
    spacer(120),
    sectionLabel("REPRESENTATIVE Z'MANIM (Sunday, April 5)", GREEN_LIGHT),
    spacer(60),
    zmanRow(Z.cholhamoed.hanetz, [e("Hanetz ("), h("הַנֵּץ הַחַמָּה"), e(") — sunrise")]),
    zmanRow(Z.cholhamoed.shkiah, [e("Shkiah ("), h("שְׁקִיעָה"), e(")")]),
    zmanRow(Z.cholhamoed.tzait,  [e("Tzait ("), h("צֵאת הַכּוֹכָבִים"), e(")")]),
    spacer(100),
    sectionLabel("DAILY SCHEDULE", GREEN_LIGHT),
    spacer(60),
    serviceRow("7:00 AM", [h("שַׁחֲרִית"), e(" — full "), h("הַלֵּל"), e("; Torah reading (4 "), h("עוֹלִים"), e(" only); no "), h("תַּחֲנוּן")]),
    serviceRow("7:00 PM", [h("מִנְחָה")]),
    serviceRow(Z.cholhamoed.tzait, [h("מַעֲרִיב"), e(" (after "), h("צֵאת"), e(") — "), h("סְפִירַת הָעֹמֶר"), e(" aloud")]),
    spacer(100),
    sectionLabel("TORAH READINGS — DAY BY DAY", GREEN_LIGHT),
    spacer(60),
    torahBox([
      { label:"Sunday, Apr 5 — Chol HaMoed Day 1",
        text:"Main: Exodus 13:1–16 — Sanctifying the firstborn; laws of Pesach and matzah; obligation to tell one's children the story of the Exodus. Maftir: Numbers 28:19–25" },
      { label:"Monday, Apr 6 — Chol HaMoed Day 2",
        text:"Main: Exodus 22:24–23:19 — Laws of lending and justice; the festival calendar; \"do not boil a kid in its mother's milk\" (source of meat-milk separation). Maftir: Numbers 28:19–25" },
      { label:"Tuesday, Apr 7 — Chol HaMoed Day 3",
        text:"Main: Exodus 34:1–26 — Moses receives the second tablets; G-d's Thirteen Attributes of Mercy; covenant renewal and festival laws. Maftir: Numbers 28:19–25" },
      { label:"Note", text:"On Chol HaMoed only 4 aliyot are called (vs. 5 on Yom Tov and 7 on Shabbat). No Kohen-Levi distinction for aliyot 3 and 4." },
    ]),
    spacer(80),
    infoBox(
      [e("Work ("), h("מְלָאכָה"), e(") on "), h("חוֹל הַמּוֹעֵד"), e("", { bold:true })],
      [e("Permitted: work for Yom Tov ("), h("אֹכֶל נֶפֶשׁ"), e("); preventing financial loss ("), h("דָּבָר הָאָבֵד"), e("); laborer with no other income. Forbidden: non-essential skilled labor, haircuts, laundry (some exceptions for young children's clothing). Consider preparing a "), h("הֲלָכָה"), e(" sheet for the congregation.")],
      GREEN_LIGHT
    ),
  ];
}

function pageErevShevii() {
  return [
    dayHeader("Chol HaMoed / Erev Yom Tov", "עֶרֶב שְׁבִיעִי שֶׁל פֶּסַח", "Wednesday, April 8, 2026 / 21 Nisan 5786 — Day 7 / Eve of the Seventh Day", GREEN),
    spacer(120),
    sectionLabel("Z'MANIM", GREEN_LIGHT),
    spacer(60),
    zmanRow(Z.erevshevii.hanetz,         [e("Hanetz ("), h("הַנֵּץ הַחַמָּה"), e(") — sunrise")]),
    zmanRow(Z.erevshevii.candleLighting, [e("Candle lighting — 18 min before "), h("שְׁקִיעָה")]),
    zmanRow(Z.erevshevii.shkiah,         [e("Shkiah ("), h("שְׁקִיעָה"), e(") — "), h("שְׁבִיעִי שֶׁל פֶּסַח"), e(" begins")]),
    zmanRow(Z.erevshevii.tzait,          [e("Tzait ("), h("צֵאת הַכּוֹכָבִים"), e(")")]),
    spacer(80),
    candleBox(Z.erevshevii.candleLighting,
      "Light before shkiah — Yom Tov has not yet begun, so a match or lighter is permitted. Recite \"l'hadlik ner shel Yom Tov\" and \"Shehecheyanu.\""),
    spacer(80),
    sectionLabel("DAVENING / SERVICES", GREEN_LIGHT),
    spacer(60),
    serviceRow("7:00 AM", [h("שַׁחֲרִית"), e(" — full "), h("הַלֵּל"), e("; Torah reading (4 "), h("עוֹלִים"), e(")")]),
    serviceRow("7:15 PM", [h("מִנְחָה")]),
    serviceRow(Z.erevshevii.tzait, [h("מַעֲרִיב"), e(" / "), h("קִדּוּשׁ"), e(" — "), h("שְׁבִיעִי שֶׁל פֶּסַח"), e(" begins")]),
    spacer(100),
    sectionLabel("TORAH READING", GREEN_LIGHT),
    spacer(60),
    torahBox([
      { label:"Main (4 aliyot)",   text:"Numbers 9:1–14 — Pesach Sheni: those who were ritually impure or on a distant journey may offer the Paschal lamb one month later, on 14 Iyyar. The principle: no Jew should ever be left without a way to participate in the national experience" },
      { label:"Maftir",            text:"Numbers 28:19–25 — Festival sacrifices" },
    ]),
    spacer(80),
    infoBox(
      [e("Tikkun Leil "), h("שְׁבִיעִי"), e(" — Night of Learning", { bold:true })],
      [e("The night of the 7th of "), h("נִיסָן"), e(" is associated with "), h("קְרִיעַת יַם סוּף"), e(". Many communities hold a "), h("תִּקּוּן"), e(" covering themes of "), h("גְּאֻלָּה"), e(" and "), h("שִׁירַת הַיָּם"), e(". A midnight shiur can be a memorable highlight — consider organizing one this year.")],
      GREEN_LIGHT
    ),
  ];
}

function pageShevii() {
  return [
    dayHeader("Yom Tov VII", "שְׁבִיעִי שֶׁל פֶּסַח", "Thursday, April 9, 2026 / 21 Nisan 5786 — Seventh Day of Pesach", BLUE),
    spacer(120),
    sectionLabel("Z'MANIM", BLUE_LIGHT),
    spacer(60),
    zmanRow(Z.shevii.hanetz, [e("Hanetz ("), h("הַנֵּץ הַחַמָּה"), e(") — sunrise")]),
    zmanRow(Z.shevii.shkiah, [e("Shkiah ("), h("שְׁקִיעָה"), e(")")]),
    zmanRow(Z.shevii.tzait,          [e("Tzait ("), h("צֵאת הַכּוֹכָבִים"), e(") — "), h("אַחֲרוֹן שֶׁל פֶּסַח"), e(" begins")]),
    zmanRow(Z.shevii.candleLighting, [e("Candle lighting — from pre-existing flame only")]),
    spacer(80),
    candleBox(`${Z.shevii.tzait} — pre-existing flame ONLY`,
      "Yom Tov VIII begins at tzait. Candles must be lit from a pre-existing flame. Recite \"l'hadlik ner shel Yom Tov.\" No Shehecheyanu between the seventh and eighth days."),
    spacer(80),
    sectionLabel("DAVENING / SERVICES", BLUE_LIGHT),
    spacer(60),
    serviceRow("9:30 AM", [h("שַׁחֲרִית"), e(" — half "), h("הַלֵּל"), e("; Torah reading; "), h("מוּסָף")]),
    serviceRow("7:00 PM",  [h("מִנְחָה")]),
    serviceRow(Z.shevii.tzait, [h("מַעֲרִיב"), e(" / "), h("קִדּוּשׁ"), e(" — "), h("אַחֲרוֹן שֶׁל פֶּסַח"), e(" begins")]),
    spacer(100),
    sectionLabel("TORAH READING & PRAYER NOTES", BLUE_LIGHT),
    spacer(60),
    torahBox([
      { label:"Main — Scroll 1 (5 aliyot)", text:"Exodus 13:17–15:26 — Israel's journey from Egypt; Pharaoh's pursuit; the splitting of the sea; Shirat HaYam (Song of the Sea, Ex. 15:1–21); Miriam's song" },
      { label:"Aliyot",          text:"1: Ex.13:17–14:8 · 2: 14:9–14 · 3: 14:15–25 · 4: 14:26–15:19 (includes the Shira — stand while it is chanted) · 5: 15:20–26" },
      { label:"Maftir — Scroll 2", text:"Numbers 28:19–25 — Festival sacrifices" },
      { label:"Haftarah",        text:"II Samuel 22:1–51 — David's Song of Deliverance, closely parallel to the Shirat HaYam in themes of miraculous salvation" },
      { label:"Note",            text:"The Shira (Ex. 15) is written in a unique ariach al gabei levena (brick-and-mortar) layout and chanted with special trope. The congregation traditionally stands and chants aloud together. Designate a skilled baal keriah well in advance." },
    ]),
    spacer(80),
    infoBox(
      [e("Half "), h("הַלֵּל"), e(" — Why?", { bold:true })],
      [e("On the 7th and 8th days we recite half "), h("הַלֵּל"), e(". The Gemara ("), h("מְגִלָּה"), e(" 10b; "), h("סַנְהֶדְרִין"), e(" 39b): when the Egyptians were drowning, the angels wished to sing — Hashem said, \"My creatures are drowning and you recite song?!\" We celebrate the miracle but temper our joy. Explain this to the congregation before "), h("הַלֵּל"), e(".")],
      BLUE_LIGHT
    ),
  ];
}

function pageAcharon() {
  return [
    dayHeader("Yom Tov VIII", "אַחֲרוֹן שֶׁל פֶּסַח", "Friday, April 10, 2026 / 22 Nisan 5786 — Last Day of Pesach / Yizkor", BLUE),
    spacer(120),
    sectionLabel("Z'MANIM", BLUE_LIGHT),
    spacer(60),
    zmanRow(Z.acharon.hanetz, [e("Hanetz ("), h("הַנֵּץ הַחַמָּה"), e(") — sunrise")]),
    zmanRow(Z.acharon.shkiah, [e("Shkiah ("), h("שְׁקִיעָה"), e(") — Pesach ends (outside Israel)")]),
    zmanRow(Z.acharon.tzait,  [e("Tzait ("), h("צֵאת הַכּוֹכָבִים"), e(") — full "), h("הַבְדָּלָה"), e("; "), h("חָמֵץ"), e(" permitted")]),
    spacer(100),
    sectionLabel("DAVENING / SERVICES", BLUE_LIGHT),
    spacer(60),
    serviceRow("9:30 AM", [h("שַׁחֲרִית"), e(" — half "), h("הַלֵּל"), e("; Torah reading; "), h("יִזְכּוֹר"), e(" after Torah")]),
    serviceRow("11:00 AM", [h("מוּסָף"), e(" — last day Yom Tov "), h("נֻסַּח")]),
    serviceRow("7:00 PM",  [h("מִנְחָה")]),
    serviceRow(Z.acharon.tzait, [h("מַעֲרִיב"), e(" + full "), h("הַבְדָּלָה"), e(" (wine, "), h("בְּשָׂמִים"), e(", candle)")]),
    spacer(100),
    sectionLabel("TORAH READING & PRAYER NOTES", BLUE_LIGHT),
    spacer(60),
    torahBox([
      { label:"Main — Scroll 1 (5 aliyot)", text:"Deuteronomy 15:19–16:17 — Sanctifying firstborn animals; the three pilgrimage festivals (Pesach, Shavuot, Sukkot) and their observances and sacrifices" },
      { label:"Aliyot",          text:"1: Deut.15:19–23 · 2: 16:1–3 · 3: 16:4–8 · 4: 16:9–12 · 5: 16:13–17" },
      { label:"Maftir — Scroll 2", text:"Numbers 28:19–25 — Festival sacrifices" },
      { label:"Haftarah",        text:"Isaiah 10:32–12:6 — The messianic ingathering; universal peace; \"You shall draw water with joy from the wellsprings of salvation\"" },
    ]),
    spacer(80),
    infoBox(
      [h("יִזְכּוֹר"), e("", { bold:true })],
      [h("יִזְכּוֹר"), e(" is recited after the Torah reading. Those whose both parents are alive leave per Ashkenazic custom (some permit them to stay). Announce service time publicly; pledge cards prepared before Yom Tov. "), h("יִזְכּוֹר"), e(" drasha: brief (8–12 min), warm, moving toward comfort — \""), h("בְּכָל דּוֹר וָדוֹר"), e("\" extends to those no longer with us.")],
      BLUE_LIGHT
    ),
    spacer(80),
    infoBox(
      [h("מוֹצָאֵי פֶּסַח"), e(" — Chametz After the Holiday", { bold:true })],
      [h("חָמֵץ"), e(` is permitted after `), h("צֵאת"), e(` (~${Z.acharon.tzait}). However, `), h("חָמֵץ שֶׁעָבַר עָלָיו הַפֶּסַח"), e(" — owned by a Jew during Pesach — is permanently forbidden "), h("בַּהֲנָאָה"), e(". Until Jewish-owned stores verify their sale was properly executed, caution is warranted. Announce the specific time the rabbi formally concludes "), h("מְכִירַת חָמֵץ"), e(".")],
      BLUE_LIGHT
    ),
    spacer(80),
    alertBox(
      [ia("Seudas Moshiach (Baal Shem Tov tradition): on the afternoon of "), iah("אַחֲרוֹן שֶׁל פֶּסַח"), ia(", the light of the future redemption shines with particular intensity. Consider a brief afternoon gathering with "), iah("דִּבְרֵי תּוֹרָה"), ia(" and l'chaim.")],
      'info'
    ),
  ];
}

// ════════════════════════════════════════════════════════════════════════════
// ASSEMBLE
// ════════════════════════════════════════════════════════════════════════════

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const outputDir = CLI.o || './output';

  if (CLI.city) {
    console.log(`Geocoding "${CLI.city}"…`);
    const { lat, lon, displayName } = await geocodeCity(CLI.city);
    const tz = CLI.timezone || guessTimezone(lat, lon);
    console.log(`  ${displayName}`);
    console.log(`  Coordinates: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    console.log(`  Timezone: ${tz}`);
    console.log('Calculating z\'manim…');
    Z = calcZmanim(lat, lon, tz);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'pesach_5786.docx');

  const pages = [
    pageBedikat(), pageErevPesach(), pageYomTov1(), pageYomTov2(),
    pageShabbat(), pageCholHamoed(), pageErevShevii(), pageShevii(), pageAcharon(),
  ];

  const allChildren = [];
  pages.forEach((page, i) => {
    if (i > 0) allChildren.push(new Paragraph({
      pageBreakBefore: true, spacing:{ before:0, after:0 }, children:[]
    }));
    page.forEach(el => allChildren.push(el));
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: BODY_PT } } } },
    sections: [{
      properties: { page: {
        size: { width:12240, height:15840 },
        margin: { top:900, right:1080, bottom:900, left:1080 }
      }},
      children: allChildren,
    }],
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buf);
  console.log(`Written → ${outputPath}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
