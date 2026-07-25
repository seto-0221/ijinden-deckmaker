#!/usr/bin/env node
/**
 * カード個別の静的HTML(dist/cards/<id>/index.html)とsitemap.xmlを生成する。
 *
 * カードデータはbuild.mjsと全く同じsrc/data/cards/set-N.jsonを読み込む(データの二重管理をしない)。
 * カード詳細のマークアップはsrc/shared/card-detail-html.mjsのcardDetailBodyHtml()を、
 * ブラウザ側のカード詳細モーダルと共通で利用する(ロジックの二重実装をしない)。
 *
 * 使い方:  node scripts/build.mjs && node scripts/build-card-pages.mjs
 * (dist/ 以下にbuild.mjsが作った index.html・public/一式が存在している前提)
 * 出力:
 *   dist/cards/<id>/index.html   カード1件につき1ページ(現在576件)
 *   dist/sitemap.xml             トップページ1件 + カードページ全件
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardDetailBodyHtml, officialImageFilename, imageCandidates } from '../src/shared/card-detail-html.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

const read = (p) => readFileSync(join(SRC, p), 'utf-8');
const manifest = JSON.parse(read('build-manifest.json'));
const siteConfig = JSON.parse(read('site-config.json'));
const css = manifest.cssOrder.map((f) => read(join('styles', f))).join('');
const template = read('card-page.template.html');

const cards = manifest.cardSetOrder.flatMap((s) => JSON.parse(read(join('data/cards', `set-${s}.json`))));

// カード個別ページからの画像参照は images/ から2階層下(cards/<id>/)にあるため相対パスの深さが異なる。
// cardDetailBodyHtml/imageCandidatesはoptions.imageBasePathを明示的に受け取る設計のため、
// 「images/」という文字列置換ではなく、そもそも異なる基点パスをここで渡すだけで正しく解決する。
const SSG_IMAGE_BASE_PATH = '../../images/';
const APP_IMAGE_BASE_PATH_ABS = `${siteConfig.baseUrl}images/`; // OGP画像は仕様上、絶対URLが必須

function truncate(s, max) {
  const str = String(s || '');
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

function buildDescription(c) {
  const colorsStr = (c.colors || []).join('/');
  const levelPart = c.level !== null && c.level !== undefined ? `レベル${c.level}` : '';
  const head = [c.name, c.source, [colorsStr, c.type, levelPart].filter(Boolean).join('・')].filter(Boolean).join(' / ');
  const ruleSnippet = String(c.ruleText || '').replace(/\s+/g, ' ').trim();
  let desc = ruleSnippet ? `${head}。${ruleSnippet}` : `${head}。`;
  desc = truncate(desc, 110);
  desc += ' イジンデンの非公式カードデータベース「イジンデンラボ」。';
  return truncate(desc, 160);
}

function ogImageUrl(c) {
  const official = officialImageFilename(c);
  return official ? `${APP_IMAGE_BASE_PATH_ABS}${official}` : `${APP_IMAGE_BASE_PATH_ABS}${c.id}.png`;
}

function renderCardPage(c) {
  const canonical = `${siteConfig.baseUrl}cards/${c.id}/`;
  const title = `${c.name}｜イジンデン カード情報 - イジンデンラボ`;
  const description = buildDescription(c);
  const body = cardDetailBodyHtml(c, { imageBasePath: SSG_IMAGE_BASE_PATH, enableJsFallback: false });
  let html = template;
  // 第2引数を関数にして$記号の特殊解釈を防ぐ({{STYLES}}にはCSSをそのまま埋め込む)
  html = html.replace('{{STYLES}}', () => css);
  html = html.replace('{{TITLE}}', () => title);
  html = html.replace(/\{\{DESCRIPTION\}\}/g, () => description);
  html = html.replace(/\{\{CANONICAL\}\}/g, () => canonical);
  html = html.replace(/\{\{OG_TITLE\}\}/g, () => title);
  html = html.replace(/\{\{OG_IMAGE\}\}/g, () => ogImageUrl(c));
  html = html.replace('{{H1}}', () => c.name);
  html = html.replace(/\{\{ID\}\}/g, () => c.id);
  html = html.replace('{{BODY}}', () => body);
  return { html, canonical };
}

mkdirSync(join(DIST, 'cards'), { recursive: true });
const sitemapUrls = [];
sitemapUrls.push({ loc: siteConfig.baseUrl }); // トップページ(lastmodは信頼できる更新日時が無いため省略)

let generated = 0;
for (const c of cards) {
  const { html, canonical } = renderCardPage(c);
  const dir = join(DIST, 'cards', c.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
  sitemapUrls.push({ loc: canonical }); // カードページもlastmodは省略(内容未変更時の無意味な更新扱いを避けるため)
  generated++;
}

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls
  .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n  </url>`)
  .join('\n')}\n</urlset>\n`;
writeFileSync(join(DIST, 'sitemap.xml'), sitemapXml);

console.log(`build-card-pages OK: dist/cards/ に${generated}件生成 / dist/sitemap.xml に${sitemapUrls.length}件(トップ1+カード${generated})`);
