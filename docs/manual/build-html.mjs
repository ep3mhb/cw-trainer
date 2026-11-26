// Builds the web edition of the CW Trainer user manual (RFD A59): the same
// content files as the PDFs, rendered as one HTML page per chapter, in
// English, Persian and Arabic, into public/manual/<lang>/.
//
//   node --experimental-strip-types build-html.mjs en fa ar
//
// Why a second renderer and not build.mjs itself: build.mjs makes one long
// print document and paginates it in Chromium; this makes many small pages a
// search engine can index and a phone can read. What they share is the
// *content* — content-<lang>.mjs and the tables imported from the
// application — so the two editions cannot say different things. The block
// renderer below mirrors build.mjs block for block, and throws on a block
// type it does not know, so a new type added for the PDF cannot slip past
// the web edition unnoticed.
//
// Figures come from shots-jpg/, as for the PDF (see README.md), and are
// copied to public/manual/img/. Fonts are the PDF's own, from node_modules,
// copied to public/manual/fonts/ — no font is fetched from anyone else.

import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PUBLIC = path.join(HERE, '../../public/manual');
const SHOTS = path.join(HERE, 'shots-jpg');
const FONTS = path.join(HERE, 'node_modules/@fontsource');
const ORIGIN = 'https://cw.mikroutik.com';
const LANGS = ['en', 'fa', 'ar'];

/** The words around the manual — everything on the page that is not the manual's own text. */
const CHROME = {
  en: {
    manual: 'User manual', start: 'Start reading', prev: 'Previous chapter', next: 'Next chapter',
    pdf: 'Download the PDF', app: 'Open the application', inChapter: 'In this chapter', skip: 'Skip to the text',
    name: 'English', pdfFile: 'CW-Trainer-User-Manual-EN.pdf',
  },
  fa: {
    manual: 'راهنمای کاربر', start: 'شروع مطالعه', prev: 'فصل قبل', next: 'فصل بعد',
    pdf: 'دریافت نسخهٔ PDF', app: 'باز کردن برنامه', inChapter: 'در این فصل', skip: 'رفتن به متن',
    name: 'فارسی', pdfFile: 'CW-Trainer-User-Manual-FA.pdf',
  },
  ar: {
    manual: 'دليل المستخدم', start: 'ابدأ القراءة', prev: 'الفصل السابق', next: 'الفصل التالي',
    pdf: 'تنزيل نسخة PDF', app: 'افتح التطبيق', inChapter: 'في هذا الفصل', skip: 'انتقل إلى النص',
    name: 'العربية', pdfFile: 'CW-Trainer-User-Manual-AR.pdf',
  },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Inline markup: **bold**, `code`, _italic_ ; everything else escaped. Same rules as build.mjs. */
const inline = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/`(.+?)`/g, '<code>$1</code>')
  .replace(/(^|[\s(])_(.+?)_(?=[\s.,;:)]|$)/g, '$1<i>$2</i>')
  .replace(/&lt;kbd&gt;(.+?)&lt;\/kbd&gt;/g, '<kbd>$1</kbd>');
/** Plain text of inline markup, for titles, descriptions and alt text. */
const plain = (s) => String(s).replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1')
  .replace(/(^|[\s(])_(.+?)_(?=[\s.,;:)]|$)/g, '$1$2').replace(/<\/?kbd>/g, '');

/** Width and height of a baseline or progressive JPEG, from its SOF marker. */
function jpegSize(file) {
  const b = fs.readFileSync(file);
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error(`no size in ${file}`);
}

const sizes = {};
function image(src) {
  const name = src.replace(/\.png$/, '.jpg');
  const from = path.join(SHOTS, name);
  if (!fs.existsSync(from)) throw new Error(`missing figure ${name} in shots-jpg/`);
  sizes[name] ??= jpegSize(from);
  return { url: `../img/${name}`, ...sizes[name] };
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
    case 'fig': {
      const img = image(b.src);
      const label = b.n ? `${ctx.figLabel} ${b.n}` : '';
      const alt = [label, plain(b.caption ?? '')].filter(Boolean).join(': ');
      return `<figure class="${b.cls ?? ''}"><a href="${img.url}"><img src="${img.url}" width="${img.w}" height="${img.h}" loading="lazy" decoding="async" alt="${esc(alt)}"></a><figcaption>${label ? `<b>${esc(label)}.</b> ` : ''}${inline(b.caption ?? '')}</figcaption></figure>`;
    }
    case 'figrow': return `<div class="figrow">${b.figs.map((f) => renderBlock({ t: 'fig', ...f }, ctx)).join('')}</div>`;
    case 'table': return `<div class="table-wrap"><table>${b.head ? `<thead><tr>${b.head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>` : ''}<tbody>${b.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${(b.mono ?? []).includes(i) ? 'mono' : ''}">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    case 'pre': return `<pre>${b.lines.map((l) => (l.startsWith('#') ? `<span class="cm">${esc(ctx.rtl ? l.slice(1).trim() : l.slice(1))}</span>` : esc(l))).join('\n')}</pre>`;
    case 'dl': return `<dl>${b.items.map(([k, v]) => `<dt>${inline(k)}</dt><dd>${inline(v)}</dd>`).join('')}</dl>`;
    case 'kv': return `<div class="kv">${b.items.map(([k, v]) => `<b>${inline(k)}</b><span>${inline(v)}</span>`).join('')}</div>`;
    case 'morse': return `<div class="morse">${Object.entries(b.map).map(([c, m]) => `<div><span class="c">${esc(b.label ? b.label(c) : c)}</span><span class="m">${esc(m.replace(/\./g, '·').replace(/-/g, '−'))}</span></div>`).join('')}</div>`;
    case 'html': return b.html;
    default: throw new Error(`unknown block ${JSON.stringify(b)}`);
  }
}

/** First sentence-sized run of plain text, for <meta name="description">: 155 characters at most, cut at a word. */
function description(blocks) {
  const text = blocks.map((b) => (typeof b === 'string' ? b : b.t === 'p' ? b.text : '')).filter(Boolean).map(plain).join(' ')
    .replace(/\s+/g, ' ').trim();
  if (text.length <= 155) return text;
  const cut = text.slice(0, 154);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

const pageName = (n) => (n === 0 ? '' : `chapter-${n}.html`);
const pageUrl = (lang, n) => `${ORIGIN}/manual/${lang}/${pageName(n)}`;

function head(doc, n, title, desc) {
  const alternates = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${pageUrl(l, n)}">`).join('')
    + `<link rel="alternate" hreflang="x-default" href="${pageUrl('en', n)}">`;
  return `<!doctype html>
<html lang="${doc.lang}" dir="${doc.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${pageUrl(doc.lang, n)}">
${alternates}
<link rel="icon" href="../../icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../manual.css">
</head>`;
}

function topBar(doc, n) {
  const ui = CHROME[doc.lang];
  const langs = LANGS.filter((l) => l !== doc.lang)
    .map((l) => `<a href="../${l}/${pageName(n)}" lang="${l}" hreflang="${l}"${l === 'en' ? ' dir="ltr"' : ' dir="rtl"'}>${esc(CHROME[l].name)}</a>`).join('');
  return `<a class="skip" href="#text">${esc(ui.skip)}</a>
<header class="plate">
  <a class="brand" href="./" aria-label="RESONIK CW Trainer — ${esc(ui.manual)}"><img src="../../brand/resonik-logo-reversed-tight.svg" alt="RESONIK" width="150" height="28"><span><bdi>CW Trainer</bdi> · ${esc(ui.manual)}</span></a>
  <nav class="langs" aria-label="Languages">${langs}</nav>
  <a class="btn primary" href="/">${esc(ui.app)}</a>
</header>`;
}

function contents(doc, current) {
  return `<ol class="toc">${doc.chapters.map((ch, ci) => {
    const n = ci + 1;
    return `<li${n === current ? ' aria-current="page"' : ''}><a href="${pageName(n)}"><span class="n">${n}</span>${inline(ch.title)}</a></li>`;
  }).join('')}</ol>`;
}

function footer(doc) {
  const ui = CHROME[doc.lang];
  return `<footer class="foot">
  <p>RESONIK <bdi>CW Trainer</bdi> — ${esc(doc.cover.subtitle)} · ${esc(doc.ui.version)}</p>
  <p>${doc.cover.meta.slice(2).map(inline).join(' · ')} · <a href="https://www.mikroutik.com" dir="ltr">mikroutik.com</a> · <a href="https://www.mikroutik.com/privacy.html" lang="en" dir="ltr">Privacy notice</a></p>
  <p><a href="../${ui.pdfFile}">${esc(ui.pdf)}</a></p>
</footer>`;
}

function chapterPage(doc, ci) {
  const ui = CHROME[doc.lang];
  const ctx = { figLabel: doc.ui.figure, rtl: doc.dir === 'rtl' };
  const ch = doc.chapters[ci];
  const n = ci + 1;
  const secs = ch.sections.map((s, si) => {
    const key = `${n}.${si + 1}`;
    return `<section><h2 id="s${key}"><a class="n" href="#s${key}">${key}</a>${inline(s.title)}</h2>${s.blocks.map((b) => renderBlock(b, ctx)).join('\n')}</section>`;
  }).join('\n');
  const inThis = ch.sections.length > 1
    ? `<nav class="inchapter" aria-label="${esc(ui.inChapter)}"><b>${esc(ui.inChapter)}</b><ol>${ch.sections.map((s, si) => `<li><a href="#s${n}.${si + 1}"><span class="n">${n}.${si + 1}</span>${inline(s.title)}</a></li>`).join('')}</ol></nav>`
    : '';
  const prev = ci > 0 ? `<a class="btn" rel="prev" href="${pageName(n - 1)}"><small>${esc(ui.prev)}</small>${inline(doc.chapters[ci - 1].title)}</a>` : `<a class="btn" rel="prev" href="./"><small>${esc(doc.ui.contents)}</small>${esc(ui.manual)}</a>`;
  const next = ci < doc.chapters.length - 1 ? `<a class="btn" rel="next" href="${pageName(n + 1)}"><small>${esc(ui.next)}</small>${inline(doc.chapters[ci + 1].title)}</a>` : '<span></span>';
  const title = `${doc.ui.chapter} ${n}: ${plain(ch.title)} — RESONIK CW Trainer · ${doc.cover.subtitle}`;
  const desc = description([...(ch.intro ?? []), ...(ch.sections[0]?.blocks ?? [])]);
  return `${head(doc, n, title, desc)}
<body>
${topBar(doc, n)}
<div class="layout">
<aside class="side"><nav aria-label="${esc(doc.ui.contents)}"><b>${esc(doc.ui.contents)}</b>${contents(doc, n)}</nav></aside>
<main id="text">
<details class="mobile-toc"><summary>${esc(doc.ui.contents)}</summary>${contents(doc, n)}</details>
<h1 class="ch"><span class="num">${esc(doc.ui.chapter)} ${n}</span>${inline(ch.title)}</h1>
${(ch.intro ?? []).map((b) => renderBlock(b, ctx)).join('\n')}
${inThis}
${secs}
<nav class="pager">${prev}${next}</nav>
</main>
</div>
${footer(doc)}
</body>
</html>
`;
}

function indexPage(doc) {
  const ui = CHROME[doc.lang];
  const cover = image('air-top.png');
  const title = `${doc.docTitle ?? `RESONIK CW Trainer — ${doc.cover.subtitle}`}`;
  const desc = description(doc.chapters[0].intro ?? []);
  const full = `<ol class="toc full">${doc.chapters.map((ch, ci) => {
    const n = ci + 1;
    return `<li><a href="${pageName(n)}"><span class="n">${n}</span>${inline(ch.title)}</a><ol>${ch.sections.map((s, si) => `<li><a href="${pageName(n)}#s${n}.${si + 1}"><span class="n">${n}.${si + 1}</span>${inline(s.title)}</a></li>`).join('')}</ol></li>`;
  }).join('')}</ol>`;
  return `${head(doc, 0, title, desc)}
<body>
${topBar(doc, 0)}
<main id="text" class="cover-page">
<section class="cover">
  <div>
    <h1><bdi>CW Trainer</bdi> <span>${esc(doc.cover.subtitle)}</span></h1>
    <div class="leds">${doc.cover.leds.map((l) => `<span class="led">${esc(l)}</span>`).join('')}</div>
    <div class="meta">${doc.cover.meta.map((m) => `<div>${inline(m)}</div>`).join('')}</div>
    <div class="keys"><a class="btn primary" href="${pageName(1)}">${esc(ui.start)}</a><a class="btn" href="../${ui.pdfFile}">${esc(ui.pdf)}</a><a class="btn" href="/">${esc(ui.app)}</a></div>
  </div>
  <img src="${cover.url}" width="${cover.w}" height="${cover.h}" alt="">
</section>
<h2>${esc(doc.ui.contents)}</h2>
${full}
</main>
${footer(doc)}
</body>
</html>
`;
}

const CSS = `/* Generated by docs/manual/build-html.mjs — do not edit. */
@font-face{font-family:Inter;font-weight:400;font-display:swap;src:url(fonts/inter-400.woff2) format('woff2');}
@font-face{font-family:Inter;font-weight:600;font-display:swap;src:url(fonts/inter-600.woff2) format('woff2');}
@font-face{font-family:Inter;font-weight:700;font-display:swap;src:url(fonts/inter-700.woff2) format('woff2');}
@font-face{font-family:Vazirmatn;font-weight:400;font-display:swap;src:url(fonts/vazirmatn-arabic-400.woff2) format('woff2');unicode-range:U+0600-06FF,U+0750-077F,U+200C-200F,U+FB50-FDFF,U+FE70-FEFF;}
@font-face{font-family:Vazirmatn;font-weight:700;font-display:swap;src:url(fonts/vazirmatn-arabic-700.woff2) format('woff2');unicode-range:U+0600-06FF,U+0750-077F,U+200C-200F,U+FB50-FDFF,U+FE70-FEFF;}
@font-face{font-family:'JetBrains Mono';font-weight:400;font-display:swap;src:url(fonts/jetbrains-mono-400.woff2) format('woff2');}
:root{--amber:#c77d16;--amber-ink:#8a5200;--ink:#1c2027;--muted:#5a6270;--rule:#d7dbe2;--panel:#12161d;--panel-2:#1a2028;--paper:#fff;--tint:#f5f2ea;--warn:#b0342a;--good:#1f7a43;}
*{box-sizing:border-box;}
html{font-size:17px;-webkit-text-size-adjust:100%;}
body{margin:0;color:var(--ink);background:#f3f4f6;font-family:Inter,Vazirmatn,system-ui,sans-serif;line-height:1.6;}
[dir=rtl] body{font-family:Vazirmatn,Inter,system-ui,sans-serif;line-height:1.85;}
a{color:var(--amber-ink);} a:hover{color:var(--amber);}
code,pre,kbd,.mono{font-family:'JetBrains Mono',Vazirmatn,ui-monospace,monospace;font-size:.9em;}
code{background:#eef0f4;padding:0 .3em;border-radius:3px;direction:ltr;unicode-bidi:isolate;}
kbd{border:1px solid #c7ccd4;border-bottom-width:2px;border-radius:3px;padding:0 .35em;background:#fafafa;direction:ltr;unicode-bidi:isolate;}
.skip{position:absolute;inset-inline-start:-999px;top:0;background:#fff;padding:.5rem 1rem;z-index:10;}
.skip:focus{inset-inline-start:0;}
/* the header plate, in the application's own panel colours */
.plate{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem 1rem;padding:.7rem 1.2rem;background:linear-gradient(180deg,var(--panel-2),var(--panel));color:#e8e6df;border-bottom:2px solid var(--amber);position:sticky;top:0;z-index:5;}
.plate .brand{display:flex;align-items:center;gap:.7rem;color:#e8e6df;text-decoration:none;font-weight:600;letter-spacing:.02em;margin-inline-end:auto;}
.plate .brand img{height:26px;width:auto;display:block;}
.plate .langs{display:flex;gap:.4rem;}
.plate .langs a{color:#ffb545;text-decoration:none;border:1px solid #3a4250;border-radius:6px;padding:.15rem .6rem;font-size:.9rem;}
.btn{display:inline-flex;flex-direction:column;justify-content:center;gap:.1rem;border:1px solid #c7ccd4;border-radius:8px;padding:.45rem .9rem;background:#fff;color:var(--ink);text-decoration:none;font-weight:600;font-size:.95rem;}
.btn.primary{background:linear-gradient(180deg,#ffc35c,#f0a020);border-color:#b7770f;color:#1c1407;}
.plate .btn{font-size:.85rem;padding:.3rem .8rem;}
.btn small{font-weight:400;color:var(--muted);font-size:.78rem;}
/* layout */
.layout{display:grid;grid-template-columns:17rem minmax(0,46rem);gap:2rem;justify-content:center;padding:1.5rem 1rem 0;}
.side nav{position:sticky;top:4.8rem;max-height:calc(100vh - 6rem);overflow:auto;background:#fff;border:1px solid var(--rule);border-radius:10px;padding:.6rem .8rem;}
.side b,.mobile-toc summary{font-weight:700;color:var(--amber-ink);font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;}
.mobile-toc{display:none;background:var(--tint);border-radius:8px;padding:.5rem .8rem;margin-bottom:1rem;}
.mobile-toc summary{cursor:pointer;}
main{background:var(--paper);border:1px solid var(--rule);border-radius:12px;padding:1.6rem 2rem 2rem;min-width:0;}
ol.toc{list-style:none;padding:0;margin:.4rem 0 0;}
ol.toc li{margin:.15rem 0;}
ol.toc a{display:flex;gap:.5rem;text-decoration:none;color:var(--ink);padding:.2rem .3rem;border-radius:5px;font-size:.92rem;}
ol.toc a:hover{background:var(--tint);}
ol.toc li[aria-current] > a{background:var(--tint);font-weight:700;}
ol.toc .n{color:var(--amber-ink);font-variant-numeric:tabular-nums;min-width:1.6rem;font-weight:600;}
ol.toc.full > li{margin:.8rem 0;} ol.toc.full > li > a{font-weight:700;font-size:1.02rem;}
ol.toc.full ol{list-style:none;padding-inline-start:2.1rem;margin:.1rem 0;}
ol.toc.full ol .n{min-width:2.4rem;font-weight:400;}
/* text */
h1.ch{font-size:1.9rem;line-height:1.25;margin:0 0 1rem;padding-bottom:.6rem;border-bottom:2px solid var(--amber);}
h1.ch .num{display:block;color:var(--amber);font-size:.8rem;letter-spacing:.2em;text-transform:uppercase;font-weight:600;margin-bottom:.3rem;}
h2{font-size:1.3rem;margin:2.2rem 0 .6rem;scroll-margin-top:5rem;}
h2 .n{color:var(--amber-ink);margin-inline-end:.55em;text-decoration:none;font-variant-numeric:tabular-nums;}
h3{font-size:1.08rem;margin:1.4rem 0 .4rem;} h4{font-size:1rem;margin:1.1rem 0 .3rem;color:var(--amber-ink);}
p{margin:0 0 .85rem;}
.note{border-inline-start:3px solid var(--amber);background:var(--tint);padding:.6rem .9rem;margin:1rem 0;border-start-end-radius:6px;border-end-end-radius:6px;}
.note.warn{border-color:var(--warn);background:#faf0ee;} .note.good{border-color:var(--good);background:#eef6f0;}
.note .k{display:block;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:var(--amber-ink);margin-bottom:.2rem;}
.note.warn .k{color:var(--warn);} .note.good .k{color:var(--good);}
.note p:last-child{margin-bottom:0;}
ol.steps,ul.bul{margin:0 0 1rem;padding-inline-start:1.6rem;} ol.steps li,ul.bul li{margin-bottom:.4rem;}
ol.steps li::marker{color:var(--amber-ink);font-weight:700;} ul.bul li::marker{color:var(--amber);}
figure{margin:1.2rem 0 1.5rem;text-align:center;}
figure img{max-width:100%;height:auto;border-radius:6px;border:1px solid #2a313c;background:var(--panel);}
figure.phone img{max-height:36rem;width:auto;} figure.narrow img{max-width:70%;} figure.tiny img{max-width:40%;}
figcaption{font-size:.85rem;color:var(--muted);margin-top:.4rem;}
figcaption b{color:var(--ink);}
.figrow{display:flex;gap:1rem;align-items:flex-start;justify-content:center;margin:1.2rem 0;}
.figrow figure{margin:0;flex:1;min-width:0;}
.table-wrap{overflow-x:auto;margin:.6rem 0 1.2rem;}
table{border-collapse:collapse;width:100%;font-size:.9rem;}
th,td{border-bottom:1px solid var(--rule);padding:.35rem .55rem;vertical-align:top;text-align:start;}
th{background:var(--tint);font-weight:700;font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;color:var(--amber-ink);}
td.mono{font-family:'JetBrains Mono',monospace;white-space:nowrap;direction:ltr;}
.morse{display:grid;grid-template-columns:repeat(auto-fill,minmax(4.2rem,1fr));gap:.4rem;margin:.6rem 0 1.2rem;direction:ltr;}
.morse div{border:1px solid var(--rule);border-radius:5px;padding:.3rem 0;text-align:center;background:#fafafa;}
.morse .c{font-weight:700;display:block;} .morse .m{font-family:'JetBrains Mono',monospace;font-size:.85rem;color:var(--amber-ink);}
pre{background:var(--panel);color:#e8e6df;padding:.8rem 1rem;border-radius:6px;font-size:.85rem;line-height:1.5;white-space:pre-wrap;direction:ltr;text-align:left;overflow-x:auto;}
pre .cm{color:#9aa3b0;}
[dir=rtl] pre .cm{display:block;direction:rtl;text-align:right;font-family:Vazirmatn,sans-serif;}
dl{margin:0 0 1rem;} dt{font-weight:700;margin-top:.5rem;} dd{margin:0;}
.kv{display:grid;grid-template-columns:auto 1fr;gap:.3rem 1.2rem;margin:.6rem 0 1rem;font-size:.95rem;}
.inchapter{background:var(--tint);border-radius:8px;padding:.7rem 1rem;margin:1.2rem 0;}
.inchapter b{font-size:.75rem;letter-spacing:.14em;text-transform:uppercase;color:var(--amber-ink);}
.inchapter ol{list-style:none;padding:0;margin:.3rem 0 0;columns:2;column-gap:1.5rem;}
.inchapter li{break-inside:avoid;margin:.1rem 0;} .inchapter a{text-decoration:none;color:var(--ink);font-size:.92rem;}
.inchapter .n{color:var(--amber-ink);margin-inline-end:.5em;font-variant-numeric:tabular-nums;}
.pager{display:flex;justify-content:space-between;gap:1rem;margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--rule);}
.pager .btn{max-width:48%;}
.pager [rel=next]{text-align:end;}
/* contents page */
.cover-page{max-width:60rem;margin:1.5rem auto 0;}
.cover{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;align-items:center;background:linear-gradient(180deg,var(--panel-2),var(--panel));color:#e8e6df;border-radius:10px;padding:1.6rem;margin-bottom:1.5rem;}
.cover h1{margin:0 0 .8rem;font-size:2.2rem;letter-spacing:.06em;color:#fff;line-height:1.2;}
.cover h1 span{display:block;font-size:1.1rem;letter-spacing:0;color:#c9c5ba;font-weight:400;margin-top:.3rem;}
.cover img{width:100%;height:auto;border-radius:6px;border:1px solid #2a313c;}
.cover .leds{display:flex;flex-wrap:wrap;gap:.4rem;margin:.6rem 0 1rem;}
.cover .led{border:1px solid #3a4250;border-radius:999px;padding:.1rem .7rem;font-size:.78rem;color:#c9c5ba;}
.cover .meta{color:#9aa3b0;font-size:.9rem;} .cover .meta b{color:#e8e6df;}
.cover .keys{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem;}
.foot{text-align:center;color:var(--muted);font-size:.85rem;padding:2rem 1rem 3rem;}
.foot p{margin:.25rem 0;}
@media (max-width:900px){
  .layout{grid-template-columns:minmax(0,1fr);gap:1rem;padding:1rem .6rem 0;}
  .side{display:none;}
  .mobile-toc{display:block;}
  main{padding:1.1rem 1rem 1.5rem;}
  .cover{grid-template-columns:1fr;}
  .inchapter ol{columns:1;}
  .figrow{flex-direction:column;}
  figure.narrow img,figure.tiny img{max-width:100%;}
}
@media print{.plate,.side,.pager{display:none;} body{background:#fff;} main{border:0;padding:0;}}
`;

function copyAssets() {
  fs.mkdirSync(path.join(PUBLIC, 'img'), { recursive: true });
  fs.mkdirSync(path.join(PUBLIC, 'fonts'), { recursive: true });
  for (const f of fs.readdirSync(SHOTS).filter((f) => f.endsWith('.jpg'))) {
    fs.copyFileSync(path.join(SHOTS, f), path.join(PUBLIC, 'img', f));
  }
  const fonts = {
    'inter-400.woff2': 'inter/files/inter-latin-400-normal.woff2',
    'inter-600.woff2': 'inter/files/inter-latin-600-normal.woff2',
    'inter-700.woff2': 'inter/files/inter-latin-700-normal.woff2',
    'vazirmatn-arabic-400.woff2': 'vazirmatn/files/vazirmatn-arabic-400-normal.woff2',
    'vazirmatn-arabic-700.woff2': 'vazirmatn/files/vazirmatn-arabic-700-normal.woff2',
    'jetbrains-mono-400.woff2': 'jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
  };
  for (const [to, from] of Object.entries(fonts)) fs.copyFileSync(path.join(FONTS, from), path.join(PUBLIC, 'fonts', to));
  fs.writeFileSync(path.join(PUBLIC, 'manual.css'), CSS);
}

const urls = [];
async function build(lang) {
  const { default: doc } = await import(`./content-${lang}.mjs`);
  const dir = path.join(PUBLIC, lang);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), indexPage(doc));
  urls.push(pageUrl(lang, 0));
  doc.chapters.forEach((_, ci) => {
    fs.writeFileSync(path.join(dir, pageName(ci + 1)), chapterPage(doc, ci));
    urls.push(pageUrl(lang, ci + 1));
  });
  console.log(`${lang}: index + ${doc.chapters.length} chapters → public/manual/${lang}/`);
}

copyAssets();
for (const lang of process.argv.slice(2)) await build(lang);
// The sitemap entries, for hosting/www-cw/sitemap.xml.
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'out', 'sitemap-urls.txt'), `${urls.join('\n')}\n`);
console.log(`${urls.length} pages; list in docs/manual/out/sitemap-urls.txt`);
