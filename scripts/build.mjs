#!/usr/bin/env node
/**
 * イジンデンラボ ビルドスクリプト(依存ゼロ・Node 18+)
 *
 * src/ 以下の分割ソースを結合し、2種類のHTMLを生成する。
 * あわせて public/ の静的ファイル(カード画像・アイコン類・Service Worker)を dist/ へコピーする。
 *
 * 使い方:  node scripts/build.mjs
 * 出力:
 *   dist/index.html            (Web公開用・軽量版。カードサムネのBase64埋め込みなし。
 *                                images/配下の外部ファイルを実行時に取得する)
 *   dist/ijinden-deckmaker.html (オフライン/配布用・従来通りの全部入り単一HTML。
 *                                カードサムネをBase64で埋め込み済みなので、file://でも
 *                                images/フォルダなしで動く)
 *   dist/sw.js                  (Service Worker本体。CACHE_VERSIONをビルド内容のハッシュに
 *                                置換して書き出す。新しいビルドを公開するたびに値が変わり、
 *                                古いキャッシュがactivate時に確実に破棄される)
 *   dist/images/ ほか public/ 一式
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

const read = (p) => readFileSync(join(SRC, p), 'utf-8');
const manifest = JSON.parse(read('build-manifest.json'));

// ---- 各ブロックを結合(Web版・オフライン版で共通) ----
const css = manifest.cssOrder.map((f) => read(join('styles', f))).join('');

// src/shared/ 配下は、ブラウザ(このアプリ本体)とNode.js(scripts/build-card-pages.mjs)の両方から
// 同じロジックを使うための共有ESモジュール。Node側は通常のimportでそのまま使う一方、
// このアプリ本体は従来通り「全ファイルを結合して1つの<script>にする」単一HTML方式を維持するため、
// 結合時に限り先頭の`export `だけを機械的に取り除く(named exportの`export function`/`export const`
// 以外の構文は共有モジュール側で使わない、という制約とセットの単純な変換)。
const stripExportKeyword = (src) => src.replace(/^export\s+/gm, '');
const sharedJs = (manifest.sharedJsOrder || []).map((f) => stripExportKeyword(read(f))).join('');

const appJs = sharedJs + manifest.jsOrder.map((f) => read(join('app', f))).join('');

// カードデータ: 弾ごとのJSONを1つの配列に結合(実行時形式は従来と同一)
const cards = manifest.cardSetOrder.flatMap((s) => JSON.parse(read(join('data/cards', `set-${s}.json`))));
const cardDataText = manifest.cardDataPrefix + JSON.stringify(cards) + manifest.cardDataSuffix;

// サムネ: 弾ごとのJSONオブジェクトをキー順を保ってマージ(オフライン版でのみ使う)
const thumbs = {};
for (const s of manifest.thumbSetOrder) {
  Object.assign(thumbs, JSON.parse(read(join('data/card-thumbs', `set-${s}.json`))));
}
// Web版: サムネは埋め込まない(空オブジェクト)。これだけでloadCardThumbImage()の
// 「base64があれば使う→無ければimages/を外部fetch」という既存の分岐が、コード変更なしで
// 外部画像経路に切り替わる(カード一覧側はもともと外部images/参照のため無関係)。
const thumbsTextWeb = manifest.thumbsPrefix + '{}' + manifest.thumbsSuffix;
const thumbsTextOffline = manifest.thumbsPrefix + JSON.stringify(thumbs) + manifest.thumbsSuffix;

const logoText = manifest.logoPrefix + read('data/logo-assets.json') + manifest.logoSuffix;

const qrcodeLib = read('lib/qrcode-generator.js');
const jsqrLib = read('lib/jsqr.js');
const templateRaw = read('index.template.html');

// ---- テンプレートへ流し込み(呼ぶたびにtemplateRawから作り直すので、Web版/オフライン版で干渉しない) ----
function renderTemplate(thumbsText) {
  let html = templateRaw;
  const fill = (ph, text) => {
    if (!html.includes(ph)) throw new Error(`placeholder not found: ${ph}`);
    html = html.replace(ph, () => text); // 第2引数を関数にして$記号の特殊解釈を防ぐ
  };
  fill('{{STYLES}}', css);
  fill('{{CARD_DATA}}', cardDataText);
  fill('{{CARD_THUMBS}}', thumbsText);
  fill('{{LOGO_ASSETS}}', logoText);
  fill('{{LIB_QRCODE}}', qrcodeLib);
  fill('{{LIB_JSQR}}', jsqrLib);
  fill('{{APP_JS}}', appJs);
  return html;
}

const htmlWeb = renderTemplate(thumbsTextWeb);
const htmlOffline = renderTemplate(thumbsTextOffline);

// ---- 出力 ----
// dist/は全消ししない(publicの静的ファイル、特に画像約250MBを毎回コピーし直さないため)。
// 画像等は「サイズが同じならスキップ」の差分コピーにする(環境によってはcpSyncが権限エラーになるため手動コピー)。
mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, 'index.html'), htmlWeb);
writeFileSync(join(DIST, 'ijinden-deckmaker.html'), htmlOffline);

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

// ---- Service Workerのキャッシュバージョンを注入 ----
// Web版HTML(アプリ本体・カードデータ・CSS等、すべての実質的な中身)の内容ハッシュを使うため、
// 中身が1バイトも変わっていなければ同じバージョンになり、変わっていれば必ず異なる値になる。
// これによりactivate時の「古いキャッシュの確実な破棄」が、ビルドのたびに機械的に効く。
const swPath = join(DIST, 'sw.js');
if (existsSync(swPath)) {
  const cacheVersion = createHash('sha256').update(htmlWeb).digest('hex').slice(0, 12);
  const swSrc = readFileSync(swPath, 'utf-8').replace('__CACHE_VERSION__', cacheVersion);
  writeFileSync(swPath, swSrc);
}

const mb = (buf) => (Buffer.byteLength(buf) / 1024 / 1024).toFixed(2);
console.log(`build OK: dist/index.html (Web版, ${mb(htmlWeb)} MB) / dist/ijinden-deckmaker.html (オフライン版, ${mb(htmlOffline)} MB)`);
