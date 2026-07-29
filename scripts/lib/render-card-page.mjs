'use strict';
/**
 * カード個別静的ページ(SSG)のHTML組み立てロジック(純粋関数のみ、ファイルI/Oなし)。
 *
 * scripts/build-card-pages.mjs から実際のビルドで呼ばれるほか、
 * tests/card-pages-xss.test.js から「悪意あるカードデータを渡した場合の
 * エスケープ結果」を直接検証するためにも同じ関数を利用する
 * (テスト専用の再実装を作らず、本番と全く同じコードパスを検証するため)。
 *
 * ---- テンプレート挿入時のエスケープ方針 ----
 * escapeHtml(src/shared/card-detail-html.mjs)は & < > " ' の5文字すべてをエンティティ化するため、
 * HTMLテキストノード・二重引用符属性値・単一引用符属性値のいずれの文脈に挿入しても安全に機能する。
 * card-page.template.htmlの属性は常に二重引用符で統一されているため、実体としてはescapeHtml 1つで
 * 両文脈をカバーできるが、「どの文脈への埋め込みか」を呼び出し側で見て分かるようにするため、
 * 用途別の名前(escapeHtmlText / escapeHtmlAttribute)を付けて使い分ける
 * (意図の明示・将来の実装変更に対する保険)。
 *
 * {{...}}プレースホルダーごとの埋め込み文脈と適用エスケープの対応(2026-07 SSG XSS修正時点):
 *   {{STYLES}}      <style>タグ内のCSSテキスト     : ビルド内部のCSSファイルのみが原資でカード由来データを含まないためエスケープ対象外
 *   {{TITLE}}       <title>テキストノード          : escapeHtmlText
 *   {{DESCRIPTION}} meta content=""属性値(3箇所)   : escapeHtmlAttribute
 *   {{CANONICAL}}   href=""/content=""属性値(URL)  : encodePathSegment(ID部分) → escapeHtmlAttribute(URL全体)
 *   {{OG_TITLE}}    content=""属性値(2箇所)         : escapeHtmlAttribute
 *   {{OG_IMAGE}}    content=""属性値(URL, 2箇所)    : makeOgImageUrl内でencodePathSegment → escapeHtmlAttribute(URL全体)
 *   {{H1}}          <h1>テキストノード             : escapeHtmlText
 *   {{ID}}          href=""属性値内のURLフラグメント: encodePathSegment → escapeHtmlAttribute
 *   {{BODY}}        cardDetailBodyHtml()の出力      : 同関数内で既にescapeHtmlを一貫適用済み(本修正の対象外。
 *                                                      type/colorsをCSSクラス名へ使う箇所は既存の列挙値制約に
 *                                                      より別途Low/Informationalとして監査済み・今回未変更)
 */
import { cardDetailBodyHtml, officialImageFilename, escapeHtml } from '../../src/shared/card-detail-html.mjs';

// constエイリアスではなく明示的なラッパー関数にしている理由:
//   - 将来どちらか一方の文脈だけ挙動を変える必要が生じても、呼び出し側を変更せずに
//     関数本体だけを差し替えられる(constエイリアスは常に同一の関数オブジェクトを指すため、
//     片方だけの挙動を変えることが構造的にできない)。
//   - 関数の.nameがそれぞれの名前になるため、スタックトレース・デバッガでの可読性が上がる
//     (constエイリアスの場合、.nameは常に元のescapeHtmlのままになる)。
// 現時点では挙動は完全に同一(escapeHtmlへの単純な委譲)。
export function escapeHtmlText(value) {
  // <title>・<h1>等、HTMLテキストノードへの埋め込み用
  return escapeHtml(value);
}
export function escapeHtmlAttribute(value) {
  // content="..."・href="..."等、HTML属性値への埋め込み用
  return escapeHtml(value);
}

// URLのパスセグメント(canonical URLや#/cards/<id>のカードID部分)は、
// HTMLエスケープではなく本来の意味であるURLパーセントエンコードで安全化する。
// (HTMLエスケープはあくまで「HTML構文として解釈されないようにする」対策であり、
//  URLとして正しい/安全な文字列にする対策ではないため、両方を独立に適用する)
export function encodePathSegment(s) {
  return encodeURIComponent(String(s ?? ''));
}

export function truncate(s, max) {
  const str = String(s || '');
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

export function buildDescription(c) {
  const colorsStr = (c.colors || []).join('/');
  const levelPart = c.level !== null && c.level !== undefined ? `レベル${c.level}` : '';
  const head = [c.name, c.source, [colorsStr, c.type, levelPart].filter(Boolean).join('・')].filter(Boolean).join(' / ');
  const ruleSnippet = String(c.ruleText || '').replace(/\s+/g, ' ').trim();
  let desc = ruleSnippet ? `${head}。${ruleSnippet}` : `${head}。`;
  desc = truncate(desc, 110);
  desc += ' イジンデンの非公式カードデータベース「イジンデンラボ」。';
  return truncate(desc, 160);
}

// imageBaseAbs: OGP画像の絶対URLの基点(例 `${siteConfig.baseUrl}images/`)。仕様上OGP画像は絶対URLが必須。
export function makeOgImageUrl(c, imageBaseAbs) {
  const official = officialImageFilename(c);
  // official(officialImageFilename内部の正規表現で英数字のみに限定済み)以外の場合のフォールバックは
  // c.idを直接連結するため、URLパスとして安全にするためencodePathSegmentを通す。
  return official ? `${imageBaseAbs}${official}` : `${imageBaseAbs}${encodePathSegment(c.id)}.png`;
}

/**
 * カード個別ページのHTML全文を組み立てる。
 * ctx: {
 *   template: string,        // card-page.template.htmlの内容
 *   css: string,             // <style>{{STYLES}}</style>へ埋め込む結合済みCSS(カード由来データではないためエスケープ対象外)
 *   baseUrl: string,         // site-config.jsonのbaseUrl
 *   ssgImageBasePath: string,// カード画像の相対パス基点(例 '../../images/')
 *   imageBaseAbs: string,    // OGP画像の絶対URL基点(例 `${baseUrl}images/`)
 * }
 */
export function renderCardPage(c, ctx) {
  const { template, css, baseUrl, ssgImageBasePath, imageBaseAbs } = ctx;
  const idSeg = encodePathSegment(c.id);
  const canonical = `${baseUrl}cards/${idSeg}/`;
  const titleText = `${c.name}｜イジンデン カード情報 - イジンデンラボ`;
  const descriptionText = buildDescription(c); // プレーンテキストとして完成させ、ここではエスケープしない(二重エスケープ防止)
  const body = cardDetailBodyHtml(c, { imageBasePath: ssgImageBasePath, enableJsFallback: false });
  let html = template;
  // 第2引数を関数にして$記号の特殊解釈を防ぐ({{STYLES}}にはCSSをそのまま埋め込む)
  html = html.replace('{{STYLES}}', () => css);
  html = html.replace('{{TITLE}}', () => escapeHtmlText(titleText));
  html = html.replace(/\{\{DESCRIPTION\}\}/g, () => escapeHtmlAttribute(descriptionText));
  html = html.replace(/\{\{CANONICAL\}\}/g, () => escapeHtmlAttribute(canonical));
  html = html.replace(/\{\{OG_TITLE\}\}/g, () => escapeHtmlAttribute(titleText));
  html = html.replace(/\{\{OG_IMAGE\}\}/g, () => escapeHtmlAttribute(makeOgImageUrl(c, imageBaseAbs)));
  html = html.replace('{{H1}}', () => escapeHtmlText(c.name));
  html = html.replace(/\{\{ID\}\}/g, () => escapeHtmlAttribute(idSeg));
  html = html.replace('{{BODY}}', () => body);
  return { html, canonical };
}
