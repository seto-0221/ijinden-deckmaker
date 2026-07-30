'use strict';
/**
 * イジンデンラボのCSPディレクティブ定義(単一の情報源)。
 *
 * ローカルReport-Only検証サーバー(scripts/csp-report-only-server.mjs、ヘッダー配信)と、
 * 本番ビルド(scripts/build.mjs、meta http-equiv配信)の両方が、script-srcのハッシュ値以外の
 * ディレクティブをこのファイルから共通で取得する。ディレクティブ一覧を2箇所に書き写すと、
 * 将来どちらか一方だけを更新して食い違う("Report-Onlyでは通ったのに本番では壊れる"、または
 * その逆)事故につながるため、必ずここを唯一の定義元とする。
 *
 * report-uri/report-to(違反レポート送信先)は、Content-Security-Policyをmeta要素で配信する場合
 * ブラウザに無視される(CSP Level 3仕様上、meta配信ではreport-uri/report-to/frame-ancestors/
 * sandboxが機能しない)。そのため本番用meta CSP(buildProductionCspContent)には含めず、
 * ヘッダー配信であるローカルReport-Onlyサーバー側(buildReportOnlyCspContent)にのみ付与する。
 */

// script-srcのハッシュ値(実測されたAPP_JSのSHA-256、base64)を除く、共通のディレクティブ本体。
// 配列の並び順はそのまま出力順になる(可読性のため、影響範囲が広いものから順に並べている)。
function commonDirectives(scriptHashB64) {
  return [
    "default-src 'self'",
    `script-src 'self' 'sha256-${scriptHashB64}' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://cvmpaqwyohqoplfarscc.supabase.co",
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
}

// 本番へ実際に導入するmeta http-equiv="Content-Security-Policy"のcontent値(強制モード)。
// meta配信では無視される report-uri/report-to/frame-ancestors/sandbox は含めない
// (含めても実害はないが、「効いているように見えて実は無視される」設定はコードの誤読を招くため書かない)。
export function buildProductionCspContent(scriptHashB64) {
  return commonDirectives(scriptHashB64).join('; ');
}

// ローカルReport-Only検証サーバー用のcontent値。上記と同じ許可元設定に、
// ヘッダー配信でのみ機能するreport-uri(旧方式)・report-to(新Reporting API方式)を追加する。
export function buildReportOnlyCspContent(scriptHashB64) {
  return [
    ...commonDirectives(scriptHashB64),
    'report-uri /csp-report',
    'report-to csp-endpoint',
  ].join('; ');
}
