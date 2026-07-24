#!/usr/bin/env node
/**
 * イジンデンラボ ビルドスクリプト(依存ゼロ・Node 18+)
 *
 * src/ 以下の分割ソースを結合し、従来と同一の単一HTML(dist/index.html)を生成する。
 * あわせて public/ の静的ファイル(カード画像・アイコン類)を dist/ へコピーする。
 *
 * 使い方:  node scripts/build.mjs
 * 出力:    dist/index.html            (Web公開用・従来と同じ全部入り単一HTML)
 *          dist/ijinden-deckmaker.html (index.htmlのコピー。配布/非常用)
 *          dist/images/ ほか public/ 一式
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

const read = (p) => readFileSync(join(SRC, p), 'utf-8');
const manifest = JSON.parse(read('build-manifest.json'));

// ---- 各ブロックを結合 ----
const css = manifest.cssOrder.map((f) => read(join('styles', f))).join('');
const appJs = manifest.jsOrder.map((f) => read(join('app', f))).join('');

// カードデータ: 弾ごとのJSONを1つの配列に結合(実行時形式は従来と同一)
const cards = manifest.cardSetOrder.flatMap((s) => JSON.parse(read(join('data/cards', `set-${s}.json`))));
const cardDataText = manifest.cardDataPrefix + JSON.stringify(cards) + manifest.cardDataSuffix;

// サムネ: 弾ごとのJSONオブジェクトをキー順を保ってマージ
const thumbs = {};
for (const s of manifest.thumbSetOrder) {
  Object.assign(thumbs, JSON.parse(read(join('data/card-thumbs', `set-${s}.json`))));
}
const thumbsText = manifest.thumbsPrefix + JSON.stringify(thumbs) + manifest.thumbsSuffix;

const logoText = manifest.logoPrefix + read('data/logo-assets.json') + manifest.logoSuffix;

// ---- テンプレートへ流し込み ----
let html = read('index.template.html');
const fill = (ph, text) => {
  if (!html.includes(ph)) throw new Error(`placeholder not found: ${ph}`);
  html = html.replace(ph, () => text); // 第2引数を関数にして$記号の特殊解釈を防ぐ
};
fill('{{STYLES}}', css);
fill('{{CARD_DATA}}', cardDataText);
fill('{{CARD_THUMBS}}', thumbsText);
fill('{{LOGO_ASSETS}}', logoText);
fill('{{LIB_QRCODE}}', read('lib/qrcode-generator.js'));
fill('{{LIB_JSQR}}', read('lib/jsqr.js'));
fill('{{APP_JS}}', appJs);

// ---- 出力 ----
// dist/は全消ししない(publicの静的ファイル、特に画像約250MBを毎回コピーし直さないため)。
// 画像等は「サイズが同じならスキップ」の差分コピーにする(環境によってはcpSyncが権限エラーになるため手動コピー)。
mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, 'index.html'), html);
writeFileSync(join(DIST, 'ijinden-deckmaker.html'), html);
function copyDir(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    if (name === '.DS_Store') continue;
    const s = join(srcDir, name);
    const d = join(destDir, name);
    const st = statSync(s);
    if (st.isDirectory()) { copyDir(s, d); continue; }
    if (existsSync(d) && statSync(d).size === st.size) continue; // 変更なしはスキップ
    copyFileSync(s, d);
  }
}
const PUBLIC = join(ROOT, 'public');
if (existsSync(PUBLIC)) copyDir(PUBLIC, DIST);

console.log(`build OK: dist/index.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB)`);
