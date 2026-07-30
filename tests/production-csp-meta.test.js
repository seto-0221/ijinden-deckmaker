/**
 * 第2段階(本番用meta CSP)のテスト。
 *
 * 検証範囲:
 *  1. dist/index.html・dist/ijinden-deckmaker.htmlの両方に、強制(Report-Onlyではない)の
 *     <meta http-equiv="Content-Security-Policy">が1つだけ存在すること
 *  2. そのmeta要素が、<head>内の他の一切のリソース関連タグ(favicon/manifest/style等)よりも
 *     前に配置されていること(CSP Level 3の「meta要素より前に書かれたリソースには適用されない」
 *     という制約への対応)
 *  3. script-srcのハッシュ値が、同じdist HTML内の実際のAPP_JS(data-app-js属性)のバイト列から
 *     計算したハッシュと一致すること
 *  4. meta配信では無視される report-uri / report-to / frame-ancestors / sandbox を含まないこと
 *     (含めても実害はないが、「効いているように見えて実は無視される」設定を書かない方針の確認)
 *  5. 想定した許可元(worker-src 'self'・'unsafe-eval'・Supabase/CDN2件・data:/blob: 等)が
 *     揃っていること
 *  6. ローカルReport-Only用ポリシーと本番meta用ポリシーが、scripts/lib/csp-policy.mjsという
 *     単一の情報源(共通ディレクティブ)から生成されており、報告用ディレクティブの有無以外は
 *     食い違わないこと
 *  7. SSGカードページ(dist/cards/**)には今回のmeta CSPを追加していないこと(スコープ外のまま)
 *
 * 実行: node tests/production-csp-meta.test.js (npm testにも組み込み済み)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractAppJs, sha256Base64 } from '../scripts/lib/csp-hash.mjs';
import { buildProductionCspContent, buildReportOnlyCspContent } from '../scripts/lib/csp-policy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

function extractCspMetaTags(html) {
  const re = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)">/g;
  return [...html.matchAll(re)];
}

function checkDistFile(relPath, label) {
  const html = readFileSync(join(ROOT, relPath), 'utf-8');

  // 1. meta CSPが1つだけ存在する
  const metaMatches = extractCspMetaTags(html);
  check(`${label}: 強制モードのmeta CSPが1つだけ存在する`, metaMatches.length === 1);
  if (metaMatches.length !== 1) return;
  const cspContent = metaMatches[0][1];
  const metaTagIndex = html.indexOf(metaMatches[0][0]);

  // 2. head内の他のリソース関連タグより前にあること
  const laterTagsToCheckAfterCsp = [
    ['<link rel="icon"', 'favicon <link>'],
    ['<link rel="manifest"', 'manifest <link>'],
    ['<style>', '<style>タグ'],
    ['<script', '<script>タグ(APP_JS本体含む)'],
  ];
  for (const [needle, label2] of laterTagsToCheckAfterCsp) {
    const idx = html.indexOf(needle);
    check(`${label}: meta CSPは${label2}より前に配置されている`, idx === -1 || metaTagIndex < idx);
  }
  // charset自体はCSPより前で問題ない(CSPの直前に置く仕様のため)。念のため、charsetの直後に
  // 位置していること(head先頭付近であること)も確認する。
  const charsetIndex = html.indexOf('<meta charset="UTF-8">');
  check(`${label}: meta CSPはcharset宣言の直後(head先頭付近)に配置されている`, charsetIndex !== -1 && metaTagIndex > charsetIndex && metaTagIndex - charsetIndex < 500);

  // 3. script-srcハッシュが実際のAPP_JSと一致する
  const appJs = extractAppJs(html, label);
  const actualHash = sha256Base64(appJs);
  check(`${label}: meta CSPのscript-srcハッシュが実際のAPP_JSバイト列と一致する`, cspContent.includes(`'sha256-${actualHash.digest}'`));

  // 4. meta配信で無視されるディレクティブを含まない
  check(`${label}: report-uriを含まない(meta配信では無視されるため)`, !cspContent.includes('report-uri'));
  check(`${label}: report-toを含まない(meta配信では無視されるため)`, !cspContent.includes('report-to'));
  check(`${label}: frame-ancestorsを含まない(meta配信では無視されるため)`, !cspContent.includes('frame-ancestors'));
  check(`${label}: sandboxディレクティブを含まない(meta配信では無視されるため)`, !/(^|;\s*)sandbox(\s|;|$)/.test(cspContent));

  // 5. 想定した許可元が揃っている
  check(`${label}: default-src 'self' を含む`, cspContent.includes("default-src 'self'"));
  check(`${label}: worker-src 'self' を含む(Service Worker登録を妨げない)`, cspContent.includes("worker-src 'self'"));
  check(`${label}: script-srcに'unsafe-eval'を含む(QRライブラリの遅延eval用)`, cspContent.includes("'unsafe-eval'"));
  check(`${label}: script-srcにSupabase SDK CDN(cdn.jsdelivr.net)を含む`, cspContent.includes('https://cdn.jsdelivr.net'));
  check(`${label}: script-srcにxlsx CDN(cdnjs.cloudflare.com)を含む`, cspContent.includes('https://cdnjs.cloudflare.com'));
  check(`${label}: connect-srcにSupabase APIドメインを含む`, cspContent.includes('https://cvmpaqwyohqoplfarscc.supabase.co'));
  check(`${label}: img-srcにdata:とblob:を含む(QR画像・サムネ用)`, cspContent.includes('img-src') && cspContent.includes('data:') && cspContent.includes('blob:'));
  check(`${label}: style-srcに'unsafe-inline'を含む(インラインstyle属性用)`, cspContent.includes("style-src 'self' 'unsafe-inline'"));
  check(`${label}: object-src 'none' を含む`, cspContent.includes("object-src 'none'"));
  check(`${label}: frame-src 'none' を含む`, cspContent.includes("frame-src 'none'"));
  check(`${label}: base-uri 'self' を含む`, cspContent.includes("base-uri 'self'"));
  check(`${label}: form-action 'self' を含む`, cspContent.includes("form-action 'self'"));

  return { cspContent, actualHash };
}

const web = checkDistFile('dist/index.html', 'dist/index.html(Web版)');
const offline = checkDistFile('dist/ijinden-deckmaker.html', 'dist/ijinden-deckmaker.html(オフライン版)');

// Web版・オフライン版でscript-srcハッシュが完全に一致すること(APP_JSが同一バイト列であるため)
if (web && offline) {
  check('Web版とオフライン版でmeta CSPのscript-srcハッシュが一致する', web.cspContent.match(/sha256-[^']+/)[0] === offline.cspContent.match(/sha256-[^']+/)[0]);
}

// 6. Report-Only用と本番meta用が、単一の情報源(csp-policy.mjs)から生成されており、
// 報告用ディレクティブ(report-uri/report-to)の有無以外は完全に一致すること
{
  const dummyHash = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const prod = buildProductionCspContent(dummyHash);
  const reportOnly = buildReportOnlyCspContent(dummyHash);
  check('本番用ポリシーはReport-Only用ポリシーの前方一致部分である(共通ディレクティブの単一情報源化)', reportOnly.startsWith(prod));
  check('Report-Only用ポリシーは本番用ポリシーに report-uri/report-to を追加しただけの差分である', reportOnly === `${prod}; report-uri /csp-report; report-to csp-endpoint`);
}

// 7. SSGカードページにはCSPを追加していない(スコープ外のまま)
{
  const sample = readFileSync(join(ROOT, 'dist/cards/1-1/index.html'), 'utf-8');
  check('SSGカードページにはContent-Security-Policyのmetaを追加していない(今回のスコープ外)', !sample.includes('Content-Security-Policy'));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
