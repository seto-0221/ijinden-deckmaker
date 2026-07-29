/**
 * SSGカード個別ページ(scripts/lib/render-card-page.mjs renderCardPage())の
 * XSS回帰テスト。
 *
 * 経緯: build-card-pages.mjsのrenderCardPage()は、修正前は{{TITLE}}/{{DESCRIPTION}}/
 * {{OG_TITLE}}/{{H1}}等へカード由来データ(name/ruleText/illustrator等)を
 * escapeHtmlを一切通さず直接埋め込んでおり、Stored XSSとして実際に動作することを
 * /tmp/xss_poc配下のPoCビルドで確認していた(セキュリティ監査Part2 所見4-1)。
 * 本テストはその修正が正しく機能し続けることを保証する回帰テスト。
 *
 * 単なる文字列検索(includes/正規表現)だけに頼らず、jsdomでHTMLとして実際に
 * パースした上で、script/img/svg要素が想定外に生成されていないことを検証する。
 *
 * 実行: node tests/card-pages-xss.test.js
 * (build-card-pages.mjsが書き出す実際のdist/cards/配下は一切変更しない。
 *  このテストはrenderCardPage()を直接呼び出すだけで、ファイルの読み書きは
 *  テンプレート/CSS/site-config.jsonの読み込みのみ)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { renderCardPage } from '../scripts/lib/render-card-page.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const siteConfig = JSON.parse(readFileSync(join(SRC, 'site-config.json'), 'utf-8'));
const manifest = JSON.parse(readFileSync(join(SRC, 'build-manifest.json'), 'utf-8'));
const css = manifest.cssOrder.map((f) => readFileSync(join(SRC, 'styles', f), 'utf-8')).join('');
const template = readFileSync(join(SRC, 'card-page.template.html'), 'utf-8');

const ctx = {
  template,
  css,
  baseUrl: siteConfig.baseUrl,
  ssgImageBasePath: '../../images/',
  imageBaseAbs: `${siteConfig.baseUrl}images/`,
};

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

// 実在カードと同一のスキーマを持つ、正常なベースカード(set-1.json の1-1を模したもの)。
const BASE_CARD = {
  id: '1-1',
  no: '1',
  set: 1,
  source: '第1弾ブースター',
  name: '織田信長',
  rarity: 'SR',
  colors: ['赤'],
  type: 'イジン',
  level: 4,
  cost: null,
  power: 5000,
  trait: '特性テキスト',
  ruleText: '通常のルールテキスト。',
  igyouText: '-',
  illustrator: '木志田コテツ',
  unlimited: false,
};

const PAYLOADS = [
  { label: 'script/title閉じタグ', value: '</title><script>alert(1)</script>' },
  { label: '属性エスケープ+img onerror', value: '"><img src=x onerror=alert(1)>' },
  { label: 'svg onload', value: '<svg onload=alert(1)>' },
  { label: '既エンコード済みquot(二重エンコード確認用)', value: '&quot;' },
  { label: 'シングルクォート', value: "atest'value" },
  { label: 'アンパサンド単体', value: 'A&B' },
  { label: '改行を含む文字列', value: '1行目\n2行目\n3行目' },
  { label: '日本語と絵文字', value: '日本語テスト🀄🔥カード名' },
];

const FIELDS = ['name', 'ruleText', 'illustrator'];

function makeCard(field, payloadValue) {
  const c = { ...BASE_CARD, id: `xss-test-${field}` };
  c[field] = field === 'name' ? `${BASE_CARD.name}${payloadValue}` : payloadValue;
  return c;
}

function assertSafe(label, field, c) {
  const { html } = renderCardPage(c, ctx);
  const dom = new JSDOM(html); // JS無効(実行させず静的パースのみ)
  const d = dom.window.document;

  // ---- 構造的な健全性(壊れていないこと) ----
  check(`[${label}/${field}] <title>要素がちょうど1つ存在する`, d.querySelectorAll('title').length === 1);
  check(`[${label}/${field}] <h1>要素がちょうど1つ存在する`, d.querySelectorAll('h1').length === 1);
  check(`[${label}/${field}] meta descriptionが存在し空でない`, !!d.querySelector('meta[name="description"]')?.getAttribute('content'));
  check(`[${label}/${field}] og:title/og:descriptionが存在し空でない`,
    !!d.querySelector('meta[property="og:title"]')?.getAttribute('content') &&
    !!d.querySelector('meta[property="og:description"]')?.getAttribute('content'));
  check(`[${label}/${field}] link[rel=canonical]がちょうど1つ存在する`, d.querySelectorAll('link[rel="canonical"]').length === 1);

  // ---- 悪意ある要素が実体として生成されていないこと(文字列検索ではなくDOM構造で確認) ----
  check(`[${label}/${field}] <script>要素が1つも生成されていない`, d.querySelectorAll('script').length === 0);
  check(`[${label}/${field}] <svg>要素が1つも生成されていない`, d.querySelectorAll('svg').length === 0);
  check(`[${label}/${field}] <img>要素は正規のカード画像1枚のみ(注入によるimg要素の追加がない)`, d.querySelectorAll('img').length === 1);
  check(`[${label}/${field}] 唯一の<img>にonerror属性が付与されていない(SSGはenableJsFallback:false)`, !d.querySelector('img')?.hasAttribute('onerror'));
  check(`[${label}/${field}] 唯一の<img src>は正規の相対パス(../../images/)のまま`, /^\.\.\/\.\.\/images\//.test(d.querySelector('img')?.getAttribute('src') || ''));

  // ---- ペイロード自体は「無害なテキスト」として保持されていること(単なる削除・破壊ではない) ----
  const haystack = (field === 'name') ? d.title.textContent + d.querySelector('h1').textContent
    : (d.querySelector('meta[name="description"]')?.getAttribute('content') || '');
  if (field !== 'illustrator' || true) {
    // illustratorは本文(BODY)側にのみ現れるため、bodyのtextContentで確認する
    const bodyHaystack = d.body.textContent;
    const rawPayload = field === 'name' ? c.name.replace(BASE_CARD.name, '') : c[field];
    check(`[${label}/${field}] ペイロード文字列がテキストとして保持されている(削除ではなく無害化)`,
      bodyHaystack.includes(rawPayload) || haystack.includes(rawPayload));
  }

  // ---- 二重エスケープが起きていないこと ----
  // アンパサンド(&)自体を含むペイロードは、正しくエスケープされれば必ず"&amp;"を含む(それ自体は正しい)。
  // 二重エスケープ(既に"&amp;"となった文字列をもう一度エスケープして"&amp;amp;"になる)だけを検出する。
  check(`[${label}/${field}] "&amp;amp;"のような二重エンコードが発生していない`, !html.includes('&amp;amp;'));

  // ペイロードが「&で始まる既存のHTML実体参照に見える文字列」(例: "&quot;")である場合、
  // 正しい単一エスケープの結果は "&amp;quot;"(&だけがエスケープされ、quot;はただの文字列)になる。
  // これは二重エスケープではなく正しい動作のため、そのケースだけ専用の同値性チェックに置き換える。
  if (c[field] === '&quot;' || (field === 'name' && c.name.endsWith('&quot;'))) {
    const decodedTitle = d.title;
    check(`[${label}/${field}] リテラル"&quot;"はエスケープ→復号で完全に同一の文字列に戻る(1段階のみのエスケープ)`,
      decodedTitle.includes('&quot;') || d.body.textContent.includes('&quot;') ||
      (d.querySelector('meta[name="description"]')?.getAttribute('content') || '').includes('&quot;'));
  }

  return { html, d };
}

for (const field of FIELDS) {
  for (const { label, value } of PAYLOADS) {
    const c = makeCard(field, value);
    assertSafe(label, field, c);
  }
}

// ---- 通常の公式カードの出力が変わらないこと(既存挙動の非破壊確認) ----
{
  const { html } = renderCardPage(BASE_CARD, ctx);
  const dom = new JSDOM(html);
  const d = dom.window.document;
  check('正常系: titleにカード名がそのまま含まれる(エスケープ対象文字が無いため見た目は不変)', d.title.includes('織田信長'));
  check('正常系: h1がカード名と完全一致する', d.querySelector('h1').textContent === '織田信長');
  check('正常系: canonicalが期待通りのURL', d.querySelector('link[rel="canonical"]').getAttribute('href') === `${siteConfig.baseUrl}cards/1-1/`);
  check('正常系: <script>/<svg>要素は存在しない(通常時も0件であることの確認)', d.querySelectorAll('script').length === 0 && d.querySelectorAll('svg').length === 0);
  check('正常系: <img>はちょうど1つ', d.querySelectorAll('img').length === 1);
}

// ---- IDにURL上不正な文字が含まれる場合の防御(念のための境界ケース) ----
{
  const weirdIdCard = { ...BASE_CARD, id: '1-1/../../evil "><script>alert(1)</script>' };
  const { html, canonical } = renderCardPage(weirdIdCard, ctx);
  const dom = new JSDOM(html);
  const d = dom.window.document;
  check('カードIDに不正文字を含む場合でもcanonical URLが1セグメントにパーセントエンコードされる', !canonical.includes('/../') && !canonical.includes('<script>'));
  check('カードIDに不正文字を含む場合でも<script>要素が生成されない', d.querySelectorAll('script').length === 0);
  check('カードIDに不正文字を含む場合でもリンク先(#/cards/<ID>)がエスケープされている', (() => {
    const link = Array.from(d.querySelectorAll('a[href]')).find((a) => (a.getAttribute('href') || '').includes('#/cards/'));
    return !!link && !link.getAttribute('href').includes('<script>');
  })());
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
