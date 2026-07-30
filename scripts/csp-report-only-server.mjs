#!/usr/bin/env node
/**
 * イジンデンラボ: ローカルCSP Report-Only検証サーバー(Node標準ライブラリのみ)
 *
 * 目的: GitHub Pagesは利用者が任意のレスポンスヘッダーを設定できないため、
 * 本物のContent-Security-Policy-Report-Onlyヘッダーや、meta要素では配信不可能な
 * report-uri/report-to系のCSP違反レポートは、GitHub Pages上では一切検証できない。
 * このスクリプトはビルド済みdist/を配信するだけの、本番デプロイには含めない
 * 開発者ローカル専用の検証サーバーで、実際のHTTPレスポンスヘッダーを付与できる
 * 環境を用意し、将来本番へ導入するmeta CSP(ハッシュ方式)の内容を、実ブラウザで
 * 事前に安全に検証できるようにする。
 *
 * 起動: npm run csp:report-only (内部で `node scripts/csp-report-only-server.mjs` を実行)
 *       ポートを変えたい場合: PORT=8790 npm run csp:report-only
 *
 * 提供するもの:
 *   - dist/ 以下の静的ファイル配信(MIMEタイプを拡張子から判定、../パストラバーサル対策あり)
 *   - すべてのHTMLレスポンスに Content-Security-Policy-Report-Only ヘッダーを付与
 *     (script-srcのハッシュ値は起動時にdist/index.htmlから実測して自動算出する。
 *      手動でハッシュ文字列を書き写す必要がなく、ビルド内容とヘッダー内容の食い違いを防ぐ)
 *   - 新方式(Reporting API)向けに Reporting-Endpoints ヘッダーも付与し、CSPのreport-to
 *     ディレクティブと対応付ける。加えて、より広くブラウザ互換性のある(非推奨だが現役の)
 *     report-uriディレクティブも併用し、どちらの方式でレポートが飛んできても
 *     同じ POST /csp-report で受け取れるようにする
 *   - POST /csp-report: 受信した違反レポートを人間が読みやすい形にして標準出力へ表示する。
 *     application/csp-report(旧方式)・application/reports+json(新方式)・
 *     素のapplication/json のいずれでも受理し、壊れたJSONや過大なリクエストボディは
 *     クラッシュせず安全に400/413で拒否する
 *
 * 重要な注意(オフライン版・file://についての検証範囲の限定):
 *   dist/ijinden-deckmaker.html(オフライン/単一HTML版)も、動作確認の利便性のため
 *   このサーバーはhttp://経由で配信し、同じReport-Onlyヘッダーを付与する。
 *   ただし、これはあくまで「オフライン版のHTML内容自体(APP_JSやCSPの許可元設定)が
 *   Report-Onlyポリシーに違反しないか」を確認するための代替手段であり、
 *   利用者が実際に行う「ダウンロードしたHTMLファイルをfile://で直接開く」という
 *   利用形態そのものを再現するものではない。file://で開いた場合はブラウザに
 *   一切のHTTPレスポンスヘッダーが渡らないため、Content-Security-Policy-Report-Only
 *   ヘッダーによる検証は原理的に不可能であり、この検証範囲には含まれない
 *   (file://での確認方法は別途、実装報告の「手動確認チェックリスト」に記載する)。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractAppJs, sha256Base64 } from './lib/csp-hash.mjs';
import { buildReportOnlyCspContent } from './lib/csp-policy.mjs';

const ROOT = join(dirnameOf(import.meta.url), '..');
const DIST = join(ROOT, 'dist');
const HOST = '127.0.0.1'; // localhost限定(外部ネットワークからは一切待ち受けない)
const PORT = Number(process.env.PORT) || 8787;
const MAX_REPORT_BODY_BYTES = 64 * 1024; // CSP違反レポートは通常数百バイト~数KB。64KBを超える場合は不正/DoS目的とみなし拒否する

function dirnameOf(metaUrl) {
  return fileURLToPath(new URL('.', metaUrl));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const DEFAULT_MIME = 'application/octet-stream';

// ---- 起動時にdist/index.htmlからAPP_JSの実ハッシュを算出し、Report-OnlyポリシーへUsersのハッシュとして埋め込む ----
// ディレクティブ本体(script-src等)はscripts/lib/csp-policy.mjsを唯一の情報源とする
// (本番用meta CSP(scripts/build.mjs)と定義を共有し、書き写しによる食い違いを防ぐため)。
function buildReportOnlyPolicy(scriptHashB64) {
  return buildReportOnlyCspContent(scriptHashB64);
}

const REPORTING_ENDPOINTS_HEADER = 'csp-endpoint="/csp-report"';

let cachedPolicy = null;
let cachedHashInfo = null;

async function getPolicy() {
  if (cachedPolicy) return cachedPolicy;
  const html = await readFile(join(DIST, 'index.html'), 'utf-8');
  const appJs = extractAppJs(html, 'dist/index.html');
  const hash = sha256Base64(appJs);
  cachedHashInfo = hash;
  cachedPolicy = buildReportOnlyPolicy(hash.digest);
  return cachedPolicy;
}

// ---- パストラバーサル対策付き静的ファイル配信 ----
// scripts/lib/build-card-id.mjsのresolveSafeCardOutputDir()と同じ考え方(resolve()ベースの
// 境界判定)へ統一する。resolve()は常に絶対パスへ確定させた上で境界比較できるため、
// 判定方式をプロジェクト全体で揃える。
// 「resolved !== DIST かつ resolved.startsWith(DIST + sep) でない」場合はDIST配下から
// 外れている(またはDISTディレクトリそのものを指す特殊ケース以外で境界外)とみなして拒否する。
// sepはpath.sepを使うため、Windows("\\")でも正しく判定できる。
function resolveSafePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null; // 不正なパーセントエンコーディング
  }
  if (decoded.includes('\0')) return null; // NULバイト注入対策
  let rel = decoded.replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  const resolved = resolve(DIST, rel);
  if (resolved !== DIST && !resolved.startsWith(DIST + sep)) {
    return null; // DISTディレクトリの外(またはその境界)へ抜けようとしている
  }
  return resolved;
}

async function serveStatic(req, res) {
  const safePath = resolveSafePath(req.url || '/');
  if (!safePath) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad Request: invalid path');
    return;
  }
  let filePath = safePath;
  try {
    const st = await stat(filePath);
    if (st.isDirectory()) {
      filePath = join(filePath, 'index.html');
    }
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  let body;
  try {
    body = await readFile(filePath);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || DEFAULT_MIME;
  const headers = {
    'content-type': mime,
    'content-length': body.length,
  };
  if (mime.startsWith('text/html')) {
    const policy = await getPolicy();
    headers['content-security-policy-report-only'] = policy;
    headers['reporting-endpoints'] = REPORTING_ENDPOINTS_HEADER;
    // 本番導入予定のReferrer-Policyも、Report-Only検証と合わせてここで確認できるようにしておく
    // (本番へは今回addしないが、ローカル検証では実ヘッダーとして一緒に確認できると効率が良いため)
    headers['referrer-policy'] = 'strict-origin-when-cross-origin';
  }
  res.writeHead(200, headers);
  res.end(body);
}

// ---- CSP違反レポート受信 ----
// 上限超過を検出した時点で即座にソケットを破棄(destroy)すると、レスポンスヘッダーを
// 送る前に接続が切れてクライアント側が「応答なし(接続リセット)」として扱ってしまう。
// これを避けるため、上限超過時は先に413レスポンスを書き切ってから接続を閉じる。
// (呼び出し側であるhandleCspReportは、戻り値のtooLarge/errorを見てそれ以上何もしない)
function readBodyWithLimit(req, res, maxBytes) {
  return new Promise((resolve) => {
    let total = 0;
    const chunks = [];
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        try {
          res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
          res.end('Payload Too Large');
        } catch {
          /* レスポンス送出自体に失敗しても無視する */
        }
        req.destroy();
        finish({ tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish({ body: Buffer.concat(chunks) }));
    req.on('error', () => finish({ error: true }));
    req.on('aborted', () => finish({ error: true }));
  });
}

function formatReportForLog(contentType, parsed) {
  const ts = new Date().toISOString();
  return [
    '',
    `[csp-report] ${ts} content-type=${contentType || '(none)'}`,
    JSON.stringify(parsed, null, 2),
    '',
  ].join('\n');
}

async function handleCspReport(req, res) {
  const result = await readBodyWithLimit(req, res, MAX_REPORT_BODY_BYTES);
  if (result.tooLarge) {
    return; // 413は既にreadBodyWithLimit内で送出済み
  }
  if (result.error) {
    // クライアント側切断など。ここでプロセスを落とさないことが重要。
    try {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
    } catch {
      /* レスポンス送出自体に失敗しても無視する(接続は既に切れている) */
    }
    return;
  }
  const raw = result.body;

  const contentType = req.headers['content-type'] || '';
  const text = raw.toString('utf-8');
  let parsed;
  if (text.trim() === '') {
    parsed = null;
  } else {
    try {
      parsed = JSON.parse(text);
    } catch {
      // 壊れたJSON: クラッシュさせず、受信自体は200で応答しつつ、生テキストをそのままログに残す
      console.warn(formatReportForLog(contentType, { parseError: true, rawText: text.slice(0, 2000) }));
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // application/csp-report(旧形式: { "csp-report": {...} })と
  // application/reports+json(新形式: [{ type: "csp-violation", body: {...} }, ...])の
  // 両方をそのままログへ出す(形式ごとに無理に統一しない。実際に届いた生の形を確認できることを優先する)。
  console.log(formatReportForLog(contentType, parsed));
  res.writeHead(204); // レポート受信のレスポンスは本文なしの204が一般的
  res.end();
}

// createApp(): テスト(tests/csp-report-only-server.test.js)から、実際にポートを
// listenさせた上でHTTPリクエストを送って検証できるように、サーバー生成部分を関数化しておく。
// CLIとして直接実行された場合のみ、下部のif文で自動的にlistenする。
export function createApp() {
  const server = createServer(async (req, res) => {
    try {
      const url = req.url || '/';
      const pathname = url.split('?')[0];
      if (req.method === 'POST' && pathname === '/csp-report') {
        await handleCspReport(req, res);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD, POST' });
        res.end('Method Not Allowed');
        return;
      }
      await serveStatic(req, res);
    } catch (e) {
      // 予期しない例外でプロセス全体を落とさない(既存のdeflateCompress等と同じ「安全に失敗する」方針)
      console.error('[csp-report-only-server] unexpected error', e);
      try {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
      } catch {
        /* ignore */
      }
    }
  });

  server.on('clientError', (err, socket) => {
    // 不正なHTTPリクエストでプロセスがクラッシュしないようにする(Node標準の推奨パターン)
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  return server;
}

// テスト・他スクリプトから直接使えるようにexportする(単体テスト用)
export { resolveSafePath, buildReportOnlyPolicy, getPolicy, MIME_TYPES, DIST, HOST, PORT };

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const server = createApp();
  getPolicy().then((policy) => {
    server.listen(PORT, HOST, () => {
      console.log('=== イジンデンラボ CSP Report-Only 検証サーバー ===');
      console.log(`起動: http://${HOST}:${PORT}/  (Web版トップ: /index.html)`);
      console.log(`オフライン版(参考、file://の代替にはならない): http://${HOST}:${PORT}/ijinden-deckmaker.html`);
      console.log(`APP_JSハッシュ: sha256-${cachedHashInfo.digest} (${cachedHashInfo.bytes} bytes)`);
      console.log('付与するContent-Security-Policy-Report-Only:');
      console.log('  ' + policy);
      console.log('違反レポート受信: POST /csp-report (ブラウザの開発者ツール Console/Network でも確認可能)');
      console.log('終了するには Ctrl+C');
    });
  }).catch((e) => {
    console.error('起動に失敗しました(distが未ビルドの可能性があります。先に npm run build 等でdist/を生成してください):', e.message);
    process.exit(1);
  });
}
