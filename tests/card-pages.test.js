/**
 * カード個別静的ページ(dist/cards/<id>/index.html)とsitemap.xmlのテスト。
 * JS無効(Googlebotの初期取得相当)を想定し、JSDOMは runScripts なしで生の静的HTMLとして検証する。
 * 実行: node scripts/build.mjs && node scripts/build-card-pages.mjs && node tests/card-pages.test.js
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SRC = join(ROOT, 'src');
const BASE_URL = JSON.parse(readFileSync(join(SRC, 'site-config.json'), 'utf-8')).baseUrl;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

const manifest = JSON.parse(readFileSync(join(SRC, 'build-manifest.json'), 'utf-8'));
const cards = manifest.cardSetOrder.flatMap((s) => JSON.parse(readFileSync(join(SRC, 'data/cards', `set-${s}.json`), 'utf-8')));

// ---- 全件: ディレクトリ・ファイルの網羅性 ----
const cardsDir = join(DIST, 'cards');
const generatedDirs = existsSync(cardsDir) ? readdirSync(cardsDir).sort() : [];
const expectedIds = cards.map((c) => c.id).sort();
check(`カード数(${cards.length}件)と同数のページが生成される`, generatedDirs.length === cards.length);
check('生成されたディレクトリ名の集合がカードIDの集合と完全一致する(欠損・余剰なし)', JSON.stringify(generatedDirs) === JSON.stringify(expectedIds));
check('index.htmlの欠損なし(全件)', cards.every((c) => existsSync(join(cardsDir, c.id, 'index.html'))));

// ---- サンプル数件の詳細チェック(先頭/中間/末尾+特殊ケースを含める) ----
const sampleCards = [
  cards[0],
  cards[Math.floor(cards.length / 2)],
  cards[cards.length - 1],
  cards.find((c) => c.igyouText && c.igyouText !== '-') || cards[1],
  cards.find((c) => !c.ruleText) || cards[2],
].filter(Boolean);

for (const c of sampleCards) {
  const htmlPath = join(cardsDir, c.id, 'index.html');
  const html = readFileSync(htmlPath, 'utf-8');
  const dom = new JSDOM(html); // JS無効(Googlebotの初期取得相当)
  const d = dom.window.document;
  const expectedCanonical = `${BASE_URL}cards/${c.id}/`;

  check(`[${c.id}] titleにカード名を含む`, d.title.includes(c.name));
  check(`[${c.id}] meta descriptionが存在し空でない`, !!d.querySelector('meta[name="description"]')?.getAttribute('content'));
  check(`[${c.id}] canonicalが正しいURL`, d.querySelector('link[rel="canonical"]')?.getAttribute('href') === expectedCanonical);
  check(`[${c.id}] og:title/og:description/og:image/og:urlが存在する`,
    !!d.querySelector('meta[property="og:title"]')?.getAttribute('content') &&
    !!d.querySelector('meta[property="og:description"]')?.getAttribute('content') &&
    !!d.querySelector('meta[property="og:image"]')?.getAttribute('content') &&
    d.querySelector('meta[property="og:url"]')?.getAttribute('content') === expectedCanonical);
  check(`[${c.id}] twitter:cardがsummary_large_image`, d.querySelector('meta[name="twitter:card"]')?.getAttribute('content') === 'summary_large_image');
  check(`[${c.id}] h1がちょうど1つでカード名を含む`, d.querySelectorAll('h1').length === 1 && d.querySelector('h1').textContent.includes(c.name));
  check(`[${c.id}] 本文にカード種類・色・レベル・収録情報が含まれる`, (() => {
    const bodyText = d.body.textContent;
    const hasLevel = c.level === null || c.level === undefined || bodyText.includes(String(c.level));
    return bodyText.includes(c.type) && bodyText.includes(c.source || '') && hasLevel;
  })());
  if (c.ruleText) check(`[${c.id}] ルールテキストが本文に含まれる`, d.body.textContent.includes(c.ruleText));
  check(`[${c.id}] 画像はJS無しでも<img src>が存在し、../../images/ からの相対パス`, (() => {
    const img = d.querySelector('.card-detail-img img');
    return !!img && /^\.\.\/\.\.\/images\//.test(img.getAttribute('src') || '');
  })());
  check(`[${c.id}] 画像のonerror属性(JS前提のフォールバック)は付与しない`, !d.querySelector('.card-detail-img img')?.hasAttribute('onerror'));
  check(`[${c.id}] トップ・カード検索へのクロール可能なa[href]が存在する`, (() => {
    const hrefs = Array.from(d.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));
    return hrefs.includes('../../') && hrefs.includes('../../#/browse');
  })());
  check(`[${c.id}] 「イジンデン」非公式であることの説明文がある`, d.body.textContent.includes('非公式'));
  check(`[${c.id}] noindexが付与されていない`, !d.querySelector('meta[name="robots"][content*="noindex"]'));
}

// ---- sitemap.xml ----
const sitemapPath = join(DIST, 'sitemap.xml');
const sitemapExists = existsSync(sitemapPath);
check('sitemap.xmlが生成される', sitemapExists);
if (sitemapExists) {
  const xml = readFileSync(sitemapPath, 'utf-8');
  const locs = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
  check('sitemap.xmlのURL数がトップ1+カード全件と一致する', locs.length === cards.length + 1);
  check('sitemap.xmlにトップページが含まれる', locs.includes(BASE_URL));
  check('sitemap.xmlの各カードURLが対応ページのcanonicalと完全一致する(全件)', cards.every((c) => locs.includes(`${BASE_URL}cards/${c.id}/`)));
  check('sitemap.xmlはXMLとして整形されている(urlsetタグで開閉)', xml.trim().startsWith('<?xml') && xml.includes('<urlset') && xml.trim().endsWith('</urlset>'));
  check('カードページのlastmodは信頼できる更新日時が無いため省略している', !xml.includes('<lastmod>'));
}

// ---- 既存ビルドへの影響がないこと ----
check('public/sitemap.xmlの手書きファイルは廃止され、distには生成版のみが存在する', existsSync(sitemapPath));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
