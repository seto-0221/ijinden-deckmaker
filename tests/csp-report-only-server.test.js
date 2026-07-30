/**
 * 第1段階(ローカルReport-Only検証環境)のテスト。
 *
 * 検証範囲:
 *  1. index.template.htmlから独立したService Worker登録scriptが消えている
 *     (実行可能なインラインscriptがAPP_JSの1本だけになっている。APP_JSは`data-app-js`属性で
 *     明示的に識別され、属性なしscriptが1つしかないという消極的な前提には依存しない)
 *  2. APP_JS(src/app/core/18-service-worker.js)内に登録処理が1回だけ存在し、
 *     元の4条件(file:判定/load後登録/存在確認/失敗握りつぶし)が維持されている
 *  3. 生成済みdist/index.html・dist/ijinden-deckmaker.htmlそれぞれで、
 *     実行可能な<script>要素が1つだけであること、登録呼び出しが1回だけ出現すること
 *  4. ローカルReport-Onlyサーバーが実際に付与するCSPヘッダーのscript-srcハッシュが、
 *     dist/index.htmlの実際のAPP_JSバイト列から計算したハッシュと一致すること
 *  5. POST /csp-report が 正常JSON・application/csp-report・application/reports+json・
 *     壊れたJSON・過大リクエスト のいずれでもクラッシュせず安全に応答すること
 *  6. 静的ファイル配信が ../ によるパストラバーサルを拒否すること
 *
 * 実行: node tests/csp-report-only-server.test.js (npm testにも組み込み済み)
 * 注意: このテストはlocalhost上でサーバーを実際にlisten(ポート0=OS割当の空きポート)させて
 * 検証する。外部ネットワークへは一切アクセスしない。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, getPolicy } from '../scripts/csp-report-only-server.mjs';
import { computeAppJsHash, extractAppJs } from '../scripts/lib/csp-hash.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

// ---- 1. テンプレートソース側の確認(統合前の独立scriptが残っていないか) ----
const templateSrc = readFileSync(join(ROOT, 'src/index.template.html'), 'utf-8');
{
  // APP_JSは"属性なしのscriptが1つしかない"という消極的な前提ではなく、
  // data-app-js専用属性で明示的に識別する(将来nonce/type="module"等を追加しても壊れない)。
  // テスト独自に正規表現を再実装せず、本番と同じextractAppJs()自体を使って検証する
  // (テスト側とライブラリ側の正規表現が将来ズレて、片方だけ壊れることを防ぐため)。
  let templateExtractError = null;
  try {
    extractAppJs(templateSrc, 'src/index.template.html');
  } catch (e) {
    templateExtractError = e;
  }
  check('index.template.html内でextractAppJs()がdata-app-js属性から例外なく{{APP_JS}}用の1件を抽出できる', templateExtractError === null);
  check('index.template.html内の{{APP_JS}}プレースホルダーが残っている', templateSrc.includes('{{APP_JS}}'));
  check(
    'index.template.htmlにnavigator.serviceWorker.registerの直書きが残っていない(APP_JS側へ移設済み)',
    !templateSrc.includes("navigator.serviceWorker.register('sw.js')")
  );
}

// ---- 2. 移設先ソース(src/app/core/18-service-worker.js)の条件確認 ----
const swSrc = readFileSync(join(ROOT, 'src/app/core/18-service-worker.js'), 'utf-8');
{
  const registerCount = (swSrc.match(/navigator\.serviceWorker\.register\(/g) || []).length;
  check('src/app/core/18-service-worker.js内の登録呼び出しは1回だけ', registerCount === 1);
  check("file://判定(location.protocol !== 'file:')が維持されている", swSrc.includes("location.protocol !== 'file:'"));
  check("windowのload後に登録する条件が維持されている", swSrc.includes("window.addEventListener('load'") && swSrc.includes("navigator.serviceWorker.register"));
  check("navigator.serviceWorkerの存在確認が維持されている", swSrc.includes("'serviceWorker' in navigator"));
  check('登録失敗を握りつぶすcatch(() => {})が維持されている', swSrc.includes(".catch(() => {})"));

  const manifest = JSON.parse(readFileSync(join(ROOT, 'src/build-manifest.json'), 'utf-8'));
  check('build-manifest.jsonのjsOrderに18-service-worker.jsが登録されている', manifest.jsOrder.includes('core/18-service-worker.js'));
  check('18-service-worker.jsはjsOrderの末尾にある(APP_JSの最後で実行される)', manifest.jsOrder[manifest.jsOrder.length - 1] === 'core/18-service-worker.js');
}

// ---- 2.5. extractAppJs(): data-app-js属性の属性追加・順序変更に対する頑健性 ----
// 「属性なしのscriptが1つしかない」という消極的な前提ではなく、data-app-js属性の"有無"だけを
// 識別条件にしているため、他の属性(defer/nonce等)が前後に付いても、順序が変わっても
// 正しく1件だけ抽出できる必要がある。実際のdist出力ではなく、意図的に構成した最小HTML片で
// 直接extractAppJs()を検証する。
{
  const cases = [
    {
      label: 'data-app-jsのみ',
      html: '<html><body><script data-app-js>const x = 1;</script></body></html>',
      expected: 'const x = 1;',
    },
    {
      label: 'defer + data-app-js(他属性が前に付く)',
      html: '<html><body><script defer data-app-js>const x = 2;</script></body></html>',
      expected: 'const x = 2;',
    },
    {
      label: 'data-app-js + nonce(他属性が後に付く)',
      html: '<html><body><script data-app-js nonce="abc123">const x = 3;</script></body></html>',
      expected: 'const x = 3;',
    },
    {
      label: 'defer + data-app-js + nonce(前後両方に他属性)',
      html: '<html><body><script defer data-app-js nonce="xyz789">const x = 4;</script></body></html>',
      expected: 'const x = 4;',
    },
  ];
  for (const c of cases) {
    let extracted = null;
    let err = null;
    try {
      extracted = extractAppJs(c.html, `synthetic:${c.label}`);
    } catch (e) {
      err = e;
    }
    check(`extractAppJs(): ${c.label} の場合でも例外なく抽出できる`, err === null);
    check(`extractAppJs(): ${c.label} の場合、抽出内容が期待どおり`, extracted === c.expected);
  }

  // 誤検出しないことの確認: "data-app-js"という文字列を含む別属性名(例: data-app-js2)を
  // data-app-js属性そのものと誤認しないこと(単語境界\bが機能していることの確認)。
  const decoyHtml = '<html><body><script data-app-js2="x">const y = 1;</script><script data-app-js>const y = 2;</script></body></html>';
  let decoyExtracted = null;
  let decoyErr = null;
  try {
    decoyExtracted = extractAppJs(decoyHtml, 'synthetic:decoy');
  } catch (e) {
    decoyErr = e;
  }
  check('extractAppJs(): data-app-js2のような紛らわしい別属性名を誤って一致させない', decoyErr === null && decoyExtracted === 'const y = 2;');
}

// ---- 3. ビルド成果物(dist)側の確認: 実行可能scriptが1本だけ・登録呼び出しが1回だけ ----
function checkDistFile(relPath, label) {
  const html = readFileSync(join(ROOT, relPath), 'utf-8');
  // extractAppJs()は「data-app-js属性付き<script>が1件だけ存在する」ことを前提に例外を投げるため、
  // これが正常に(例外を投げずに)呼べること自体が「APP_JSを一意に特定できる」ことの検証になる。
  let extracted = null;
  let extractError = null;
  try {
    extracted = extractAppJs(html, label);
  } catch (e) {
    extractError = e;
  }
  check(`${label}: extractAppJs()がdata-app-js属性から例外なくAPP_JSを一意抽出できる`, extractError === null && typeof extracted === 'string' && extracted.length > 0);

  const registerCount = (html.match(/navigator\.serviceWorker\.register\(/g) || []).length;
  check(`${label}: navigator.serviceWorker.register呼び出しは1回だけ`, registerCount === 1);
  // 統合前に存在した「独立したSW登録用の説明コメント」がbody末尾に単独で残っていないこと
  // (統合後はAPP_JS内の18-service-worker.js由来のコメントとして1回だけ現れる想定)
  const standaloneScriptCount = (html.match(/<script>\s*\nif \('serviceWorker' in navigator/g) || []).length;
  check(`${label}: SW登録だけの独立した<script>ブロックが存在しない`, standaloneScriptCount === 0);
}
checkDistFile('dist/index.html', 'dist/index.html(Web版)');
checkDistFile('dist/ijinden-deckmaker.html', 'dist/ijinden-deckmaker.html(オフライン版)');

// ---- 4〜6. 実際にローカルReport-Onlyサーバーを起動してのHTTP統合テスト ----
async function runServerTests() {
  const server = createApp();
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 4. Report-OnlyヘッダーのハッシュがdistのAPP_JSと一致する
    const homeRes = await fetch(`${base}/`);
    check('GET / が200を返す', homeRes.status === 200);
    const cspHeader = homeRes.headers.get('content-security-policy-report-only') || '';
    check('Content-Security-Policy-Report-Onlyヘッダーが付与されている', cspHeader.length > 0);
    check("worker-src 'self' が含まれる(Service Worker登録を妨げない)", cspHeader.includes("worker-src 'self'"));
    check("script-src に 'unsafe-eval' が含まれる(QRライブラリの遅延eval用)", cspHeader.includes("'unsafe-eval'"));

    const distIndexHtml = readFileSync(join(ROOT, 'dist/index.html'), 'utf-8');
    const expectedHash = computeAppJsHash(distIndexHtml, 'dist/index.html');
    const hashMatch = cspHeader.includes(`'sha256-${expectedHash.digest}'`);
    check('CSPヘッダーのscript-srcハッシュが実際のdist/index.htmlのAPP_JSバイト列と一致する', hashMatch);

    check('Reporting-Endpointsヘッダーが付与されている(新Reporting API方式)', (homeRes.headers.get('reporting-endpoints') || '').includes('/csp-report'));
    check('Referrer-Policyヘッダーがstrict-origin-when-cross-originである(参考確認用)', homeRes.headers.get('referrer-policy') === 'strict-origin-when-cross-origin');

    // オフライン版も同じサーバーから配信でき、同一ハッシュがマッチすること
    const offlineRes = await fetch(`${base}/ijinden-deckmaker.html`);
    check('GET /ijinden-deckmaker.html が200を返す', offlineRes.status === 200);
    const offlineCsp = offlineRes.headers.get('content-security-policy-report-only') || '';
    check('オフライン版でも同一のscript-srcハッシュが付与される(APP_JSがWeb版と同一のため)', offlineCsp.includes(`'sha256-${expectedHash.digest}'`));

    // 5. POST /csp-report の各パターン
    const r1 = await fetch(`${base}/csp-report`, {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({ 'csp-report': { 'blocked-uri': 'inline', 'violated-directive': 'script-src-elem' } }),
    });
    check('POST /csp-report: application/csp-report(正常JSON)は204を返す', r1.status === 204);

    const r2 = await fetch(`${base}/csp-report`, {
      method: 'POST',
      headers: { 'content-type': 'application/reports+json' },
      body: JSON.stringify([{ type: 'csp-violation', body: { blockedURL: 'inline' } }]),
    });
    check('POST /csp-report: application/reports+json(正常JSON)は204を返す', r2.status === 204);

    const r3 = await fetch(`${base}/csp-report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ some: 'valid json body' }),
    });
    check('POST /csp-report: 素のapplication/json(正常JSON)は204を返す', r3.status === 204);

    const r4 = await fetch(`${base}/csp-report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{this is not valid json',
    });
    check('POST /csp-report: 壊れたJSONでもクラッシュせず204を返す(内容はログのみ)', r4.status === 204);

    const oversized = 'a'.repeat(200 * 1024); // 200KB > 64KB上限
    const r5 = await fetch(`${base}/csp-report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: oversized,
    });
    check('POST /csp-report: 過大なリクエストボディ(200KB)は413で拒否される', r5.status === 413);

    // サーバープロセス自体が生きていること(クラッシュしていないこと)の確認
    const stillAlive = await fetch(`${base}/`);
    check('過大リクエスト・壊れたJSONの後もサーバープロセスは生存している', stillAlive.status === 200);

    // 6. パストラバーサル拒否
    const t1 = await fetch(`${base}/..%2f..%2f..%2fetc%2fpasswd`);
    check('パストラバーサル(エンコード済み../)は400または404で拒否される(200にならない)', t1.status === 400 || t1.status === 404);

    const t2 = await fetch(`${base}/../../../../../../etc/passwd`);
    check('パストラバーサル(生の../、Node httpモジュールにより正規化される)は200にならない', t2.status !== 200);

    // MIMEタイプの簡易確認
    const manifestRes = await fetch(`${base}/manifest.json`);
    check('manifest.jsonがapplication/jsonで返る', (manifestRes.headers.get('content-type') || '').includes('application/json'));

    const notFound = await fetch(`${base}/this-file-does-not-exist.html`);
    check('存在しないパスは404を返す', notFound.status === 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

await runServerTests();

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
