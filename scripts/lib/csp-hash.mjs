'use strict';
/**
 * dist/index.html・dist/ijinden-deckmaker.html内の、APP_JS本体
 * (Service Worker登録処理も統合済み)を専用マーカー属性`data-app-js`で明示的に特定し、
 * そのtextContentから改行やインデントを一切正規化せず、生成された実際のUTF-8バイト列
 * そのままでSHA-256ハッシュを計算する。scripts/compute-csp-hash.mjs(CLIレポート表示用)と
 * scripts/csp-report-only-server.mjs(Report-Onlyヘッダー生成用)の両方から共有される。
 *
 * 「属性なしのscript要素が1つしかない」という消極的な前提(将来nonceやtype="module"等を
 * 追加すると壊れる)に頼るのではなく、src/index.template.html側で
 * `<script data-app-js>{{APP_JS}}</script>` のように専用属性を明示することで、
 * 「これがAPP_JSである」という意味そのものをHTML/コード上で表現している。
 */
import { createHash } from 'node:crypto';

// data-app-js属性は「他の属性がない」ことを期待するのではなく、あくまで
// 「data-app-jsという属性を持つ<script>要素である」ことだけを識別条件にする。
// そのため、開始タグ内のどこにdata-app-js属性が現れても(例: <script defer data-app-js>、
// <script data-app-js nonce="...">、将来のtype="module"追加など、属性の追加・順序変更があっても)
// 一致するよう、開始タグ全体(<script ... >)の中に単語境界付きで"data-app-js"が
// 含まれるかどうかで判定する(\bで、例えば"data-app-js2"のような別属性への誤爆を防ぐ)。
//
// アプリJSソース(src/app/**、src/shared/*.mjs)にリテラルな"</script>"文字列が
// 含まれないことは確認済み(2026-07時点)。含まれる場合はこの単純な正規表現による抽出が
// 壊れるため、抽出結果が1件でなければ例外にして安全側に倒す。
export function extractAppJs(html, label = 'html') {
  const re = /<script\b[^>]*\bdata-app-js\b[^>]*>([\s\S]*?)<\/script>/g;
  const matches = [...html.matchAll(re)];
  if (matches.length !== 1) {
    throw new Error(
      `${label}: data-app-js属性付きの<script>要素が${matches.length}件見つかりました(期待値: 1件)。` +
      `APP_JSの一意な抽出ができないため中断します。`
    );
  }
  return matches[0][1];
}

export function sha256Base64(text) {
  const bytes = Buffer.from(text, 'utf-8');
  const digest = createHash('sha256').update(bytes).digest('base64');
  return { bytes: bytes.length, digest };
}

export function computeAppJsHash(html, label) {
  const appJs = extractAppJs(html, label);
  return sha256Base64(appJs);
}
