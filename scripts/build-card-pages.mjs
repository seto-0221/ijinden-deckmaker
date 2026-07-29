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
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCardPage } from './lib/render-card-page.mjs';
import { assertValidBuildCardId, resolveSafeCardOutputDir } from './lib/build-card-id.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

const read = (p) => readFileSync(join(SRC, p), 'utf-8');
const manifest = JSON.parse(read('build-manifest.json'));
const siteConfig = JSON.parse(read('site-config.json'));
const css = manifest.cssOrder.map((f) => read(join('styles', f))).join('');
const template = read('card-page.template.html');

// ビルド時だけ、各カードに読み込み元セットファイル名を付随させる(検証エラー時の
// メッセージに使うためだけの一時的な内部情報。生成HTML・sitemap等の公開データへは
// 一切混入させない。元のカードオブジェクト自体は変更しない)。
const cardsWithSource = manifest.cardSetOrder.flatMap((s) => {
  const sourceFile = `data/cards/set-${s}.json`;
  const list = JSON.parse(read(join('data/cards', `set-${s}.json`)));
  return list.map((card) => ({ card, sourceFile }));
});

// ---- ビルド専用カードID検証(fail closed) ----
// ここで検証するのはsrc/data/cards/*.json(公式カードデータ)のidのみ。
// ユーザー入力・外部ツール由来のカード識別子(共有コード/CSV/QR/customCards/バックアップ等)は
// 対象外であり、既存の共通サニタイズ層(05-deck-logic.js)がそれらの責務を担う
// (scripts/lib/build-card-id.mjs冒頭のコメントも参照)。
// 不正ID・重複IDは1件で即座に失敗させず、全件列挙してからまとめてビルドを失敗させる
// (複数の問題を1回のビルド失敗で洗い出せるようにするため。件数が多くても処理自体は
//  軽量なため、実装が複雑になる心配はない)。
const idErrors = [];
const seenIds = new Map(); // key: 小文字化したid → 大文字小文字だけが異なるIDも衝突として扱う(理由は下記コメント)
// 大文字小文字だけが異なるカードID(例 "1-b1" と "1-B1")を衝突として扱う理由:
//   - dist/cards/<id>/ はcase-insensitiveなファイルシステム(macOS/Windowsの既定設定)では
//     同一ディレクトリとして扱われ、一方のカードページがもう一方を無言で上書きし得る。
//   - GitHub Actionsのビルド自体はLinux(case-sensitive)上で動くため、CI上では偶然
//     問題が起きなくても、開発者のローカル環境(macOS/Windows)では再現するという
//     環境依存の不整合を生みやすい。
//   - 現状の576件には大文字小文字だけが異なるIDの重複は存在しない(実データ調査で確認済み)ため、
//     厳しくしても正当なデータを拒否することはない。
for (const { card, sourceFile } of cardsWithSource) {
  try {
    assertValidBuildCardId(card.id, { cardName: card.name, sourceFile });
  } catch (e) {
    idErrors.push(e.message);
    continue;
  }
  const key = card.id.toLowerCase();
  if (seenIds.has(key)) {
    const prev = seenIds.get(key);
    idErrors.push(
      `重複カードID: "${card.id}" (大文字小文字を区別せず比較) / ` +
      `先に出現: ${prev.card.name} (${prev.sourceFile}) / ` +
      `後に出現: ${card.name} (${sourceFile})`
    );
  } else {
    seenIds.set(key, { card, sourceFile });
  }
}
if (idErrors.length > 0) {
  console.error(`build-card-pages: カードID検証で${idErrors.length}件の問題を検出したため、ビルドを中止します。`);
  for (const msg of idErrors) console.error(' - ' + msg);
  process.exit(1);
}

// カード個別ページからの画像参照は images/ から2階層下(cards/<id>/)にあるため相対パスの深さが異なる。
// cardDetailBodyHtml/imageCandidatesはoptions.imageBasePathを明示的に受け取る設計のため、
// 「images/」という文字列置換ではなく、そもそも異なる基点パスをここで渡すだけで正しく解決する。
const SSG_IMAGE_BASE_PATH = '../../images/';
const APP_IMAGE_BASE_PATH_ABS = `${siteConfig.baseUrl}images/`; // OGP画像は仕様上、絶対URLが必須

// HTML組み立て自体(エスケープ含む)はscripts/lib/render-card-page.mjsに抽出済み。
// build-card-pages.mjs / tests/card-pages-xss.test.js の両方から同じ関数を呼び、
// テストが本番と別のロジックを検証してしまう(=乖離が生じる)ことを防ぐ。
function renderPage(c) {
  return renderCardPage(c, {
    template,
    css,
    baseUrl: siteConfig.baseUrl,
    ssgImageBasePath: SSG_IMAGE_BASE_PATH,
    imageBaseAbs: APP_IMAGE_BASE_PATH_ABS,
  });
}

const cardsRoot = resolve(DIST, 'cards');
mkdirSync(cardsRoot, { recursive: true });
const sitemapUrls = [];
sitemapUrls.push({ loc: siteConfig.baseUrl }); // トップページ(lastmodは信頼できる更新日時が無いため省略)

let generated = 0;
for (const { card: c } of cardsWithSource) {
  // assertValidBuildCardIdによる形式検証(既に上で全件通過済み)とは独立した、
  // 実際のパス解決による二重の境界確認。正規表現の不備があってもこちらが最終防衛線になる。
  const outputDir = resolveSafeCardOutputDir(cardsRoot, c.id);
  const { html, canonical } = renderPage(c);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'index.html'), html);
  sitemapUrls.push({ loc: canonical }); // カードページもlastmodは省略(内容未変更時の無意味な更新扱いを避けるため)
  generated++;
}

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls
  .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n  </url>`)
  .join('\n')}\n</urlset>\n`;
writeFileSync(join(DIST, 'sitemap.xml'), sitemapXml);

console.log(`build-card-pages OK: dist/cards/ に${generated}件生成 / dist/sitemap.xml に${sitemapUrls.length}件(トップ1+カード${generated})`);
