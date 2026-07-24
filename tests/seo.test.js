/**
 * SEOテスト: Googlebotが最初に取得する「JavaScript実行前の初期HTML」だけで、
 * title / description / h1 / サイト説明文 / 主要リンク / canonical が存在することを検証する。
 * (JSDOMをrunScripts無効=スクリプト非実行で読み込むことで、JSなしのクローラ視点を再現)
 * あわせてrobots.txt / sitemap.xml / noindex等の阻害要因もチェックする。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf-8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

// スクリプトを一切実行しない = Googlebotの初期HTML取得を再現
const dom = new JSDOM(html); // runScripts未指定 → 実行されない
const d = dom.window.document;

// ---- title / description / canonical ----
check('title が最適化済み', d.title === 'イジンデンラボ｜イジンデン デッキメーカー・カード検索');
const desc = d.querySelector('meta[name="description"]')?.getAttribute('content') || '';
check('description にデッキ作成・カード検索・デッキ管理・非公式が自然に含まれる',
  desc.includes('デッキ作成') && desc.includes('カード検索') && desc.includes('デッキ管理') && desc.includes('非公式'));
check('description が極端に長くない(180文字以内)', desc.length > 50 && desc.length <= 180);
const canonical = d.querySelector('link[rel="canonical"]')?.getAttribute('href');
check('canonical が正しい公開URL', canonical === 'https://seto-0221.github.io/ijinden-deckmaker/');

// ---- h1 ----
const h1s = d.querySelectorAll('h1');
check('h1 がちょうど1つ', h1s.length === 1);
const h1Alt = h1s[0]?.querySelector('img')?.getAttribute('alt') || h1s[0]?.textContent || '';
check('h1 にサイト名と主要用途が含まれる', h1Alt.includes('イジンデンラボ') && h1Alt.includes('デッキメーカー') && h1Alt.includes('カード検索'));

// ---- 説明本文(JSなしで存在する実テキスト) ----
const intro = d.querySelector('.site-intro');
const introText = intro ? intro.textContent : '';
check('サイト説明文がJSなしの初期HTMLに存在する', !!intro);
check('説明文に主要キーワードが文章として含まれる',
  introText.includes('イジンデン') && introText.includes('デッキメーカー') && introText.includes('カード検索') && introText.includes('デッキ作成') && introText.includes('非公式'));
check('隠しテキストにしていない(style属性やhiddenで非表示にしていない)',
  !intro.hasAttribute('hidden') && !/display:\s*none|visibility:\s*hidden|font-size:\s*0/.test(intro.getAttribute('style') || ''));

// ---- 主要機能へのa[href]リンク ----
const links = Array.from(d.querySelectorAll('.site-intro a[href]'));
check('主要機能へのa[href]リンクが4つ以上ある', links.length >= 4);
check('リンクにカード検索/デッキ関連のアンカーテキストがある',
  links.some(a => a.textContent.includes('カード検索')) && links.some(a => a.textContent.includes('デッキ')));

// ---- インデックス阻害要因 ----
check('meta robots noindex が無い', !d.querySelector('meta[name="robots"][content*="noindex"]'));
check('meta googlebot noindex が無い', !d.querySelector('meta[name="googlebot"][content*="noindex"]'));

// ---- robots.txt / sitemap.xml ----
const robotsPath = join(ROOT, 'dist/robots.txt');
const sitemapPath = join(ROOT, 'dist/sitemap.xml');
check('robots.txt がdistに存在する', existsSync(robotsPath));
if (existsSync(robotsPath)) {
  const robots = readFileSync(robotsPath, 'utf-8');
  check('robots.txt が全クローラ許可でDisallowなし', /Allow: \//.test(robots) && !/Disallow: \/\S/.test(robots));
  check('robots.txt にSitemap行がある', robots.includes('Sitemap: https://seto-0221.github.io/ijinden-deckmaker/sitemap.xml'));
}
check('sitemap.xml がdistに存在しcanonical URLを含む',
  existsSync(sitemapPath) && readFileSync(sitemapPath, 'utf-8').includes('<loc>https://seto-0221.github.io/ijinden-deckmaker/</loc>'));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
