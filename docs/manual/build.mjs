// Builds the CW Trainer user manual (English and Persian) as PDF.
//
//   node build.mjs en fa
//
// Content lives in content-<lang>.mjs; screenshots in shots/. The page is
// rendered by Chromium, then read back once to learn which page each heading
// landed on, then rendered again with those numbers in the contents list.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
// Fonts come from npm (@fontsource/inter, @fontsource/vazirmatn,
// @fontsource/jetbrains-mono), installed in this folder — see README.md.
const FONTS = path.join(HERE, 'node_modules/@fontsource');
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

const b64 = (p) => fs.readFileSync(p).toString('base64');
const font = (family, file, weight) =>
  `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${b64(file)}) format('woff2');}`;
const IMG = (name) => {
  const p = path.join(HERE, 'shots-jpg', name.replace(/\.png$/, '.jpg'));
  return `data:image/jpeg;base64,${b64(p)}`;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Inline markup: **bold**, `code`, _italic_ ; everything else escaped. */
const inline = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/`(.+?)`/g, '<code>$1</code>')
  .replace(/(^|[\s(])_(.+?)_(?=[\s.,;:)]|$)/g, '$1<i>$2</i>')
  .replace(/&lt;kbd&gt;(.+?)&lt;\/kbd&gt;/g, '<kbd>$1</kbd>');

function css(doc) {
  const rtl = doc.dir === 'rtl';
  const body = rtl ? "'Vazirmatn','Inter',sans-serif" : "'Inter','Vazirmatn',sans-serif";
  return `
${font('Inter', `${FONTS}/inter/files/inter-latin-400-normal.woff2`, 400)}
${font('Inter', `${FONTS}/inter/files/inter-latin-600-normal.woff2`, 600)}
${font('Inter', `${FONTS}/inter/files/inter-latin-700-normal.woff2`, 700)}
${font('Vazirmatn', `${FONTS}/vazirmatn/files/vazirmatn-arabic-400-normal.woff2`, 400)}
${font('Vazirmatn', `${FONTS}/vazirmatn/files/vazirmatn-arabic-500-normal.woff2`, 500)}
${font('Vazirmatn', `${FONTS}/vazirmatn/files/vazirmatn-arabic-700-normal.woff2`, 700)}
${font('Vazirmatn', `${FONTS}/vazirmatn/files/vazirmatn-latin-400-normal.woff2`, 400)}
${font('Vazirmatn', `${FONTS}/vazirmatn/files/vazirmatn-latin-700-normal.woff2`, 700)}
${font('JetBrains Mono', `${FONTS}/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2`, 400)}
:root{--amber:#c77d16;--amber-ink:#8a5200;--ink:#1c2027;--muted:#5a6270;--rule:#d7dbe2;--panel:#12161d;--paper:#fff;--tint:#f5f2ea;--warn:#b0342a;--good:#1f7a43;}
@page{size:A4;margin:22mm 18mm 22mm 18mm;}
@page cover{margin:0;}
*{box-sizing:border-box;}
html{font-size:10.6pt;}
body{margin:0;color:var(--ink);font-family:${body};line-height:1.55;direction:${doc.dir};text-align:start;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
code,.mono,pre{font-family:'JetBrains Mono','Vazirmatn',monospace;font-size:0.92em;}
code{background:#eef0f4;padding:0 .3em;border-radius:3px;direction:ltr;unicode-bidi:isolate;}
.ltr{direction:ltr;unicode-bidi:isolate;}
/* cover */
.cover{page:cover;height:297mm;width:210mm;background:var(--panel);color:#e8e6df;padding:28mm 22mm;display:flex;flex-direction:column;justify-content:space-between;break-after:page;position:relative;overflow:hidden;}
.cover .plate{border:1px solid #2a313c;border-radius:8px;padding:14mm 12mm;background:linear-gradient(180deg,#1a2028,#12161d);box-shadow:inset 0 1px 0 #2f3742;}
.cover h1{font-size:34pt;letter-spacing:.14em;margin:0 0 4mm;color:#fff;font-weight:700;text-transform:uppercase;}
.cover .sub{font-size:15pt;color:#c9c5ba;margin:0 0 10mm;}
.cover .vfd{display:inline-block;background:#050608;border-radius:6px;padding:6px 16px;color:#ffb545;font-family:'JetBrains Mono',monospace;font-size:20pt;box-shadow:inset 0 0 12px #000;letter-spacing:.06em;direction:ltr;}
.cover .meta{color:#9aa3b0;font-size:10.5pt;line-height:1.7;}
.cover .meta b{color:#e8e6df;font-weight:600;}
.cover .leds{display:flex;gap:10px;margin-top:8mm;flex-wrap:wrap;}
.cover .led{border:1px solid #2a313c;border-radius:999px;padding:3px 12px 3px 10px;font-size:9pt;color:#c9c5ba;letter-spacing:.08em;text-transform:uppercase;}
/* The halo is a radial gradient, not a box-shadow. A blurred box-shadow is
   a soft mask in PDF, and Preview and several mobile readers flatten it to
   an opaque rectangle — which put a yellow square over the first letter of
   every cover label. Gradients are shading patterns and render everywhere. */
.cover .led::before{content:'';display:inline-block;width:15px;height:15px;border-radius:50%;background:radial-gradient(circle,#ffb545 0,#ffb545 2.6px,rgba(255,181,69,.45) 3.4px,rgba(255,181,69,0) 7.5px);margin-inline-end:5px;margin-inline-start:-4px;vertical-align:middle;}
.cover img{width:100%;border-radius:6px;border:1px solid #2a313c;display:block;}
/* headings */
h1.ch{font-size:22pt;margin:0 0 6mm;padding-bottom:3mm;border-bottom:2px solid var(--amber);break-after:avoid;line-height:1.25;}
h1.ch .num{display:block;color:var(--amber);font-size:11pt;letter-spacing:.2em;text-transform:uppercase;font-weight:600;margin-bottom:2mm;}
h2{font-size:14pt;margin:8mm 0 2.5mm;break-after:avoid;color:var(--ink);}
h2 .n{color:var(--amber-ink);font-weight:600;margin-inline-end:.5em;font-variant-numeric:tabular-nums;}
h3{font-size:11.5pt;margin:5mm 0 1.5mm;break-after:avoid;}
h4{font-size:10.6pt;margin:4mm 0 1mm;break-after:avoid;color:var(--amber-ink);}
p{margin:0 0 2.6mm;orphans:3;widows:3;}
.chapter{break-before:page;}
.chapter:first-of-type{break-before:auto;}
/* notes */
.note{border-inline-start:3px solid var(--amber);background:var(--tint);padding:2.2mm 3.5mm;margin:3mm 0;border-radius:0 4px 4px 0;break-inside:avoid;}
.note.warn{border-color:var(--warn);background:#faf0ee;}
.note.good{border-color:var(--good);background:#eef6f0;}
.note .k{display:block;font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:var(--amber-ink);margin-bottom:.8mm;}
.note.warn .k{color:var(--warn);} .note.good .k{color:var(--good);}
.note p:last-child{margin-bottom:0;}
/* lists */
ol.steps,ul.bul{margin:0 0 3mm;padding-inline-start:6mm;}
ol.steps li,ul.bul li{margin-bottom:1.6mm;}
ol.steps li::marker{color:var(--amber-ink);font-weight:700;}
ul.bul li::marker{color:var(--amber);}
/* figures */
figure{margin:3.5mm 0 4.5mm;break-inside:avoid;text-align:center;}
figure img{max-width:100%;max-height:185mm;width:auto;border-radius:5px;border:1px solid #2a313c;background:var(--panel);display:inline-block;}
figure.phone img{max-height:150mm;}
figure.narrow img{max-width:60%;}
figure.tiny img{max-width:32%;}
figcaption{font-size:9pt;color:var(--muted);margin-top:1.6mm;line-height:1.45;}
figcaption b{color:var(--ink);font-weight:600;}
.figrow{display:flex;gap:4mm;align-items:flex-start;justify-content:center;break-inside:avoid;margin:3mm 0 4mm;}
.figrow figure{margin:0;flex:1;min-width:0;} .figrow figure img{max-height:120mm;}
/* tables */
table{border-collapse:collapse;width:100%;margin:2mm 0 4mm;font-size:9.6pt;break-inside:auto;}
thead{display:table-header-group;}
tr{break-inside:avoid;}
th,td{border-bottom:1px solid var(--rule);padding:1.4mm 2.2mm;vertical-align:top;text-align:start;}
th{background:var(--tint);font-weight:700;font-size:8.8pt;letter-spacing:.06em;text-transform:uppercase;color:var(--amber-ink);}
td.mono,td.code{font-family:'JetBrains Mono',monospace;white-space:nowrap;direction:ltr;text-align:start;}
td b{font-weight:700;}
/* morse grid */
.morse{display:grid;grid-template-columns:repeat(8,1fr);gap:1.5mm;margin:2mm 0 4mm;direction:ltr;}
.morse div{border:1px solid var(--rule);border-radius:4px;padding:1.2mm 0 1mm;text-align:center;background:#fafafa;}
.morse .c{font-weight:700;font-size:11pt;display:block;}
.morse .m{font-family:'JetBrains Mono',monospace;font-size:9pt;color:var(--amber-ink);letter-spacing:.06em;}
pre{background:var(--panel);color:#e8e6df;padding:3mm 4mm;border-radius:5px;font-size:8.8pt;line-height:1.5;white-space:pre-wrap;direction:ltr;text-align:left;margin:2mm 0 4mm;break-inside:avoid;}
pre .cm{color:#9aa3b0;}
${rtl ? 'pre .cm{display:block;direction:rtl;text-align:right;font-family:Vazirmatn,sans-serif;}' : ''}
dl{margin:0 0 3mm;} dt{font-weight:700;margin-top:2mm;} dd{margin:0;}
/* key-value */
.kv{display:grid;grid-template-columns:auto 1fr;gap:1mm 5mm;margin:2mm 0 3mm;font-size:9.8pt;}
.kv b{max-width:55mm;}
/* toc */
.toc{break-after:page;}
.toc h1.ch{margin-bottom:5mm;}
.toc ol{list-style:none;padding:0;margin:0;}
.toc li{display:flex;align-items:baseline;gap:2mm;margin:1.2mm 0;}
.toc li.l1{font-weight:700;margin-top:3.5mm;font-size:11pt;}
.toc li.l2{padding-inline-start:8mm;font-size:10pt;}
.toc .t{flex:none;} .toc .dots{flex:1;border-bottom:1px dotted #9aa3b0;transform:translateY(-3px);} .toc .pg{flex:none;font-variant-numeric:tabular-nums;color:var(--muted);}
.toc li.l1 .pg{color:var(--ink);}
.marker{position:absolute;color:#fff;font-size:1px;line-height:1px;font-family:monospace;direction:ltr;}
.small{font-size:9pt;color:var(--muted);}
kbd{font-family:'JetBrains Mono',monospace;border:1px solid #c7ccd4;border-bottom-width:2px;border-radius:3px;padding:0 .35em;font-size:.88em;background:#fafafa;direction:ltr;unicode-bidi:isolate;}
.badge{display:inline-block;border:1px solid var(--rule);border-radius:999px;padding:0 .6em;font-size:.85em;letter-spacing:.06em;text-transform:uppercase;color:var(--amber-ink);font-weight:600;}
`;
}

function renderBlock(b, ctx) {
  if (typeof b === 'string') return `<p>${inline(b)}</p>`;
  switch (b.t) {
    case 'p': return `<p>${inline(b.text)}</p>`;
    case 'h3': return `<h3>${inline(b.text)}</h3>`;
    case 'h4': return `<h4>${inline(b.text)}</h4>`;
    case 'note': return `<div class="note ${b.kind ?? ''}">${b.label ? `<span class="k">${esc(b.label)}</span>` : ''}${(Array.isArray(b.text) ? b.text : [b.text]).map((t) => `<p>${inline(t)}</p>`).join('')}</div>`;
    case 'steps': return `<ol class="steps">${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ol>`;
    case 'ul': return `<ul class="bul">${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
    case 'fig': return `<figure class="${b.cls ?? ''}"><img src="${IMG(b.src)}" alt=""><figcaption>${b.n ? `<b>${esc(ctx.figLabel)} ${b.n}.</b> ` : ''}${inline(b.caption ?? '')}</figcaption></figure>`;
    case 'figrow': return `<div class="figrow">${b.figs.map((f) => renderBlock({ t: 'fig', ...f }, ctx)).join('')}</div>`;
    case 'table': return `<table>${b.head ? `<thead><tr>${b.head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>` : ''}<tbody>${b.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${(b.mono ?? []).includes(i) ? 'mono' : ''}">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    case 'pre': return `<pre>${b.lines.map((l) => (l.startsWith('#') ? `<span class="cm">${esc(ctx.rtl ? l.slice(1).trim() : l.slice(1))}</span>` : esc(l))).join('\n')}</pre>`;
    case 'dl': return `<dl>${b.items.map(([k, v]) => `<dt>${inline(k)}</dt><dd>${inline(v)}</dd>`).join('')}</dl>`;
    case 'kv': return `<div class="kv">${b.items.map(([k, v]) => `<b>${inline(k)}</b><span>${inline(v)}</span>`).join('')}</div>`;
    case 'morse': return `<div class="morse">${Object.entries(b.map).map(([c, m]) => `<div><span class="c">${esc(b.label ? b.label(c) : c)}</span><span class="m">${esc(m.replace(/\./g, '·').replace(/-/g, '−'))}</span></div>`).join('')}</div>`;
    case 'html': return b.html;
    default: throw new Error(`unknown block ${JSON.stringify(b)}`);
  }
}

// `withMarkers` is pass 1 only. The markers are 1px white absolutely-positioned
// spans used to learn which page each heading lands on; they take no layout
// space, so leaving them out of pass 2 cannot move anything — and it keeps
// "mrk4d1end" out of the text a search engine extracts from the finished PDF.
// Verified: page counts and section placements identical with and without.
function renderDoc(doc, pages, withMarkers = false) {
  const ctx = { figLabel: doc.ui.figure, rtl: doc.dir === 'rtl' };
  let id = 0;
  const marker = (k) => (withMarkers ? `<span class="marker">mrk${k.replace('.', 'd')}end</span>` : '');
  const chapters = doc.chapters.map((ch, ci) => {
    const cn = ci + 1;
    const secs = ch.sections.map((s, si) => {
      const key = `${cn}.${si + 1}`;
      return `<section>${marker(key)}<h2 id="s${key}"><span class="n">${key}</span>${inline(s.title)}</h2>${s.blocks.map((b) => renderBlock(b, ctx)).join('\n')}</section>`;
    }).join('\n');
    return `<div class="chapter">${marker(String(cn))}<h1 class="ch"><span class="num">${esc(doc.ui.chapter)} ${cn}</span>${inline(ch.title)}</h1>${(ch.intro ?? []).map((b) => renderBlock(b, ctx)).join('')}${secs}</div>`;
  }).join('\n');

  const toc = `<div class="toc"><h1 class="ch">${esc(doc.ui.contents)}</h1><ol>${doc.chapters.map((ch, ci) => {
    const cn = ci + 1;
    const li = (cls, key, title) => `<li class="${cls}"><span class="t">${key} ${inline(title)}</span><span class="dots"></span><span class="pg">${pages[key] ?? ''}</span></li>`;
    return li('l1', String(cn), ch.title) + ch.sections.map((s, si) => li('l2', `${cn}.${si + 1}`, s.title)).join('');
  }).join('')}</ol></div>`;

  const cover = `<div class="cover"><div class="plate"><h1>${esc(doc.cover.title)}</h1><p class="sub">${esc(doc.cover.subtitle)}</p><span class="vfd">7 018.90 kHz</span><div class="leds">${doc.cover.leds.map((l) => `<span class="led">${esc(l)}</span>`).join('')}</div></div><img src="${IMG('air-top.png')}" alt=""><div class="meta">${doc.cover.meta.map((m) => `<div>${inline(m)}</div>`).join('')}</div></div>`;

  return `<!doctype html><html lang="${doc.lang}" dir="${doc.dir}"><head><meta charset="utf-8"><title>${esc(doc.docTitle ?? `${doc.cover.title} — ${doc.cover.subtitle}`)}</title><style>${css(doc)}</style></head><body>${cover}${toc}${chapters}</body></html>`;
}

async function build(lang) {
  const { default: doc } = await import(`./content-${lang}.mjs`);
  const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE });
  const page = await browser.newPage();
  const footFont = font('Vazirmatn', `${FONTS}/vazirmatn/files/vazirmatn-arabic-400-normal.woff2`, 400) + font('Vazirmatn', `${FONTS}/vazirmatn/files/vazirmatn-latin-400-normal.woff2`, 400);
  const footer = (d) => `<style>${footFont}</style><div style="width:100%;font-family:Vazirmatn,Arial,sans-serif;font-size:8pt;color:#6b7280;padding:0 18mm;display:flex;justify-content:space-between;direction:${d.dir};"><span>${esc(d.cover.title)} — ${esc(d.cover.subtitle)} · ${esc(d.ui.version)}</span><span>${esc(d.ui.page)} <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
  const pdfOpts = { format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer(doc), margin: { top: '22mm', bottom: '22mm', left: '18mm', right: '18mm' } };

  // pass 1: find page numbers from the markers
  let html = renderDoc(doc, {}, true);
  const tmpHtml = path.join(OUT, `${lang}.html`);
  fs.writeFileSync(tmpHtml, html);
  await page.goto(`file://${tmpHtml}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const pass1 = path.join(OUT, `${lang}-pass1.pdf`);
  await page.pdf({ ...pdfOpts, path: pass1 });
  const text = execFileSync('pdftotext', ['-layout', pass1, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const pages = {};
  text.split('\f').forEach((pg, i) => {
    const clean = pg.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
    for (const m of clean.matchAll(/mrk(\d+)(?:d(\d+))?end/g)) { const key = m[2] ? `${m[1]}.${m[2]}` : m[1]; if (pages[key] === undefined) pages[key] = i + 1; }
  });
  // pass 2
  html = renderDoc(doc, pages);
  fs.writeFileSync(tmpHtml, html);
  await page.goto(`file://${tmpHtml}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(OUT, doc.file);
  await page.pdf({ ...pdfOpts, path: out });
  await browser.close();
  fs.unlinkSync(pass1);
  const n = execFileSync('pdfinfo', [out], { encoding: 'utf8' }).match(/Pages:\s+(\d+)/)?.[1];
  console.log(`${out}: ${n} pages; sections placed: ${Object.keys(pages).length}`);
}

for (const lang of process.argv.slice(2)) await build(lang);
