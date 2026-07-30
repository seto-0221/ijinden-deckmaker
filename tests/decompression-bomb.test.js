/**
 * 共有コード(#dz=/#share=/#pkg=、QRコード・テキスト貼り付け経由も含む)の
 * decompression bomb対策(圧縮前JSON・base64入力・圧縮バイト列・展開後データの
 * 4段階の上限)、および発行側(エンコード)と読込側(デコード)の対称性
 * (「発行に成功した共有コードは必ず対応するdecode関数で読める」)の回帰テスト。
 *
 * 対象: src/app/features/sim/06-sim-logic.js の
 *   assertShareJsonWithinLimit / assertShareCodeBodyWithinLimit / assertCompressedBytesWithinLimit /
 *   base64UrlToBytes / deflateCompress / deflateDecompress / encodeShareCodeFromPayload /
 *   encodeDeckShareCode / decodeDeckShareCodeV2 / decodeDeckShareCode /
 *   encodePackageShareCode / decodePackageShareCode
 *
 * 実行: node scripts/build.mjs && node tests/decompression-bomb.test.js
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf-8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

// disableCompression: trueの場合、CompressionStream/DecompressionStreamを
// windowへ供給せず、typeof CompressionStream === 'undefined' のフォールバック経路
// (圧縮なしbase64)を強制的に通す。
function newWindow(disableCompression) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
  const w = dom.window;
  const d = w.document;
  if (!disableCompression) {
    w.CompressionStream = globalThis.CompressionStream;
    w.DecompressionStream = globalThis.DecompressionStream;
  }
  w.Response = globalThis.Response;
  w.TextEncoder = globalThis.TextEncoder;
  w.TextDecoder = globalThis.TextDecoder;
  d.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
  return w;
}

// アプリと同じ規則(標準base64→URL-safe、パディング除去)でbase64url文字列を作る
// (テスト側でzlibを使って圧縮したバイト列を、アプリのbase64UrlToBytesへ渡すための変換)
function toBase64Url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const w = newWindow(false);

// アプリ内で定義されている上限定数を読み出す(テストとアプリで値が二重管理・食い違いに
// ならないよう、テスト側にハードコードせずアプリの実際の定数を参照する)
const LIMITS = JSON.parse(w.eval(`JSON.stringify({
  json: SHARE_JSON_MAX_BYTES,
  body: SHARE_CODE_BODY_MAX_LENGTH,
  compressed: SHARE_COMPRESSED_MAX_BYTES,
  decompressed: SHARE_DECOMPRESSED_MAX_BYTES,
})`));
check('上限定数が期待通りの型(すべて正の数値)で取得できる',
  [LIMITS.json, LIMITS.body, LIMITS.compressed, LIMITS.decompressed].every(v => typeof v === 'number' && v > 0));
check('前提: 圧縮前JSON(SHARE_JSON_MAX_BYTES)と展開後データ(SHARE_DECOMPRESSED_MAX_BYTES)は同じ値である' +
  '(値がズレると「自分で発行したコードを自分でデコードできない」事態が起きうるため、意図的に同じ値にしている)',
  LIMITS.json === LIMITS.decompressed);

/* ==================================================================
   段階1: 圧縮前JSON文字列(assertShareJsonWithinLimit) — UTF-8バイト数で判定。
   境界値・超過(直接呼び出し。now引数はUTF-8バイト数の数値)
   ================================================================== */
{
  const okAtLimit = w.eval(`
    (function() {
      try { assertShareJsonWithinLimit(${LIMITS.json}); return 'ok'; }
      catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('圧縮前JSON: 上限ちょうどのバイト数は許可される', okAtLimit === 'ok');

  const overLimit = w.eval(`
    (function() {
      try { assertShareJsonWithinLimit(${LIMITS.json} + 1); return 'ok'; }
      catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('圧縮前JSON: 上限+1バイトは例外になる', overLimit.startsWith('threw:'));
  check('圧縮前JSON: 例外メッセージに上限超過の内容が含まれる', overLimit.includes('大きすぎる'));
}

/* ==================================================================
   修正事項1の回帰テスト: 日本語・絵文字ではUTF-16コード単位数(文字列.length)と
   UTF-8バイト数(TextEncoder().encode(...).byteLength)が大きく異なる。
   「UTF-16文字数では上限内だが、実際のUTF-8バイト数は上限超過」というケースを
   実際に構築し、(1)この食い違いが実在すること、(2)encodeDeckShareCode/
   encodePackageShareCodeが正しくUTF-8バイト数で判定して例外にすることを確認する。
   ================================================================== */
{
  // 日本語(1文字=UTF-16 1コード単位・UTF-8 3バイト)を10万文字使う。
  // 文字列.length(旧実装が誤って使っていた基準)は上限(262144)以内だが、
  // 実際のUTF-8バイト数は上限を大きく超える。
  const nameLen = 100000;
  const probe = w.eval(`
    (function() {
      const name = 'あ'.repeat(${nameLen});
      const payload = { n: name, r: 'standard', m: [], s: [], l: [], t: null, tq: 0, tags: [] };
      const json = JSON.stringify(payload);
      return JSON.stringify({
        utf16Length: json.length,
        utf8ByteLength: new TextEncoder().encode(json).byteLength,
      });
    })()
  `);
  const p = JSON.parse(probe);
  check('日本語ケース前提: UTF-16文字数(旧実装の誤った基準)は上限(SHARE_JSON_MAX_BYTES)以内である' +
    '(=もし旧実装のまま.lengthで判定していたら誤って許可されていたはずのケース)',
    p.utf16Length <= LIMITS.json);
  check('日本語ケース前提: 実際のUTF-8バイト数は上限を超えている(=本来は拒否すべきケース)',
    p.utf8ByteLength > LIMITS.json);

  const result = await w.eval(`
    (async function() {
      const deck = { id: 'd1', name: 'あ'.repeat(${nameLen}), regulationId: 'standard',
        mainCards: [], sideCards: [], leaderCards: [], trumpCard: null, trumpQty: 0, tags: [] };
      try { const code = await encodeDeckShareCode(deck); return 'ok:' + code.length; }
      catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('修正確認: 日本語10万文字(UTF-16では上限内・UTF-8バイト数では上限超過)のデッキ名は、' +
    'encodeDeckShareCodeが正しく例外にする(UTF-8バイト数で判定しているため)',
    result.startsWith('threw:') && result.includes('大きすぎる'));
}
{
  // 絵文字(サロゲートペア。UTF-16 2コード単位・UTF-8 4バイトが多い)でも同様に確認する。
  const emojiCount = 80000; // 'あ'ケースと同様、UTF-8バイト数だけが上限超過になるよう調整
  const probe = w.eval(`
    (function() {
      const name = '🀄'.repeat(${emojiCount});
      const payload = { n: name, r: 'standard', c: [], tags: [] };
      const json = JSON.stringify(payload);
      return JSON.stringify({
        utf16Length: json.length,
        utf8ByteLength: new TextEncoder().encode(json).byteLength,
      });
    })()
  `);
  const p = JSON.parse(probe);
  check('絵文字ケース前提: UTF-16文字数は上限以内、UTF-8バイト数は上限超過である',
    p.utf16Length <= LIMITS.json && p.utf8ByteLength > LIMITS.json);

  const result = await w.eval(`
    (async function() {
      const pkg = { id: 'p1', name: '🀄'.repeat(${emojiCount}), cards: [], tags: [] };
      try { const code = await encodePackageShareCode(pkg); return 'ok:' + code.length; }
      catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('修正確認: 絵文字8万個(UTF-16では上限内・UTF-8バイト数では上限超過)のパッケージ名は、' +
    'encodePackageShareCodeが正しく例外にする',
    result.startsWith('threw:') && result.includes('大きすぎる'));
}

/* ==================================================================
   段階2: base64入力(assertShareCodeBodyWithinLimit) — 境界値・超過
   ================================================================== */
{
  const okAtLimit = w.eval(`
    (function() {
      try { assertShareCodeBodyWithinLimit('a'.repeat(${LIMITS.body})); return 'ok'; }
      catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('base64入力: 上限ちょうどの長さは許可される', okAtLimit === 'ok');

  const overLimit = w.eval(`
    (function() {
      try { assertShareCodeBodyWithinLimit('a'.repeat(${LIMITS.body} + 1)); return 'ok'; }
      catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('base64入力: 上限+1文字は例外になる', overLimit.startsWith('threw:'));
  check('base64入力: 例外メッセージに「長すぎ」の内容が含まれる', overLimit.includes('長すぎ'));
}

/* ==================================================================
   段階3: 圧縮バイト列(assertCompressedBytesWithinLimit / base64UrlToBytes) — 境界値・超過
   base64本文の文字数は上限内に収めつつ、デコード後のバイト数だけを境界にする
   ================================================================== */
{
  const okAtLimit = w.eval(`
    (function() {
      try { assertCompressedBytesWithinLimit(${LIMITS.compressed}); return 'ok'; }
      catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('圧縮バイト列: 上限ちょうどのバイト数は許可される(直接呼び出し)', okAtLimit === 'ok');
  const overDirectLimit = w.eval(`
    (function() {
      try { assertCompressedBytesWithinLimit(${LIMITS.compressed} + 1); return 'ok'; }
      catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('圧縮バイト列: 上限+1バイトは例外になる(直接呼び出し)', overDirectLimit.startsWith('threw:'));

  const atLimitBytes = Buffer.alloc(LIMITS.compressed, 0);
  const atLimitB64 = toBase64Url(atLimitBytes);
  check('圧縮バイト列テスト前提: 上限ちょうどのbase64本文長がbase64入力の上限以内である(テスト設計の健全性確認)',
    atLimitB64.length <= LIMITS.body);
  const okAtLimitB64 = w.eval(`
    (function() {
      try { const b = base64UrlToBytes(${JSON.stringify(atLimitB64)}); return 'ok:' + b.length; }
      catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('圧縮バイト列: 上限ちょうどのバイト数は許可される(base64UrlToBytes経由)', okAtLimitB64 === `ok:${LIMITS.compressed}`);

  const overLimitBytes = Buffer.alloc(LIMITS.compressed + 1, 0);
  const overLimitB64 = toBase64Url(overLimitBytes);
  const overLimit = w.eval(`
    (function() {
      try { const b = base64UrlToBytes(${JSON.stringify(overLimitB64)}); return 'ok:' + b.length; }
      catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('圧縮バイト列: 上限+1バイトは例外になる(base64UrlToBytes経由)', overLimit.startsWith('threw:'));
  check('圧縮バイト列: 例外メッセージに「圧縮データが大きすぎ」の内容が含まれる', overLimit.includes('圧縮データが大きすぎ'));
}

/* ==================================================================
   段階4(decompression bomb対策の中核): 展開後データ — 境界値・超過・実際の圧縮爆弾
   ================================================================== */
{
  const exact = Buffer.alloc(LIMITS.decompressed);
  for (let i = 0; i < exact.length; i++) exact[i] = (i * 2654435761) & 0xff; // 疑似ランダム
  const compressedExact = zlib.deflateRawSync(exact);
  const b64Exact = toBase64Url(compressedExact);
  check('展開後データテスト前提: 上限ちょうどケースの圧縮後base64が圧縮バイト列/base64入力の上限以内である',
    Buffer.from(b64Exact.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length <= LIMITS.compressed
    && b64Exact.length <= LIMITS.body);

  const resultExact = await w.eval(`
    (async function() {
      try {
        const bytes = base64UrlToBytes(${JSON.stringify(b64Exact)});
        const out = await deflateDecompress(bytes);
        return 'ok:' + out.length;
      } catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('展開後データ: 上限ちょうどのバイト数は許可される', resultExact === `ok:${LIMITS.decompressed}`);

  const over = Buffer.alloc(LIMITS.decompressed + 1);
  for (let i = 0; i < over.length; i++) over[i] = (i * 2654435761) & 0xff;
  const compressedOver = zlib.deflateRawSync(over);
  const b64Over = toBase64Url(compressedOver);
  const resultOver = await w.eval(`
    (async function() {
      try {
        const bytes = base64UrlToBytes(${JSON.stringify(b64Over)});
        const out = await deflateDecompress(bytes);
        return 'ok:' + out.length;
      } catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('展開後データ: 上限+1バイトは例外になる(全部読み切ってからではなく、超えた時点で中断される)',
    resultOver.startsWith('threw:'));
  check('展開後データ: 例外メッセージに「展開後サイズが上限」の内容が含まれる', resultOver.includes('展開後サイズが上限'));
}

/* ---- 極端な圧縮率(実際のdecompression bomb): 小さい圧縮データ→巨大な展開結果 ---- */
{
  const bombSize = 20 * 1024 * 1024;
  const bombBuf = Buffer.alloc(bombSize, 0x41);
  const compressedBomb = zlib.deflateRawSync(bombBuf);
  check('decompression bomb前提: 20MBのデータが極めて小さく圧縮される(圧縮爆弾として成立する。実測約20KB、圧縮率1000倍規模)',
    compressedBomb.length < 25000);
  const b64Bomb = toBase64Url(compressedBomb);
  check('decompression bomb前提: 圧縮後base64は圧縮バイト列/base64入力の上限以内(=上限チェックをすり抜けてdeflateDecompressまで到達する)',
    Buffer.from(b64Bomb.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length <= LIMITS.compressed
    && b64Bomb.length <= LIMITS.body);

  const t0 = Date.now();
  const bombResult = await w.eval(`
    (async function() {
      try {
        const bytes = base64UrlToBytes(${JSON.stringify(b64Bomb)});
        const out = await deflateDecompress(bytes);
        return 'ok:' + out.length;
      } catch (e) { return 'threw:' + e.message; }
    })()
  `);
  const elapsedMs = Date.now() - t0;
  check('decompression bomb: 20MBに展開されるデータは、全量を読み切る前に例外として中断される',
    bombResult.startsWith('threw:') && bombResult.includes('展開後サイズが上限'));
  check('decompression bomb: 中断処理が妥当な時間内(5秒以内)に完了する(無限に読み込み続けない)',
    elapsedMs < 5000);

  const viaDeck = await w.eval(`
    (async function() {
      try { const payload = await decodeDeckShareCodeV2('1' + ${JSON.stringify(b64Bomb)}); return 'ok'; }
      catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('decodeDeckShareCodeV2経由: decompression bombは例外としてrejectされる(クラッシュしない)',
    viaDeck.startsWith('threw:'));

  const viaPkg = await w.eval(`
    (async function() {
      try { const payload = await decodePackageShareCode('1' + ${JSON.stringify(b64Bomb)}); return 'ok'; }
      catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('decodePackageShareCode経由: decompression bombは例外としてrejectされる(クラッシュしない)',
    viaPkg.startsWith('threw:'));

  const viaTryDeck = await w.eval(`
    (async function() {
      const result = await tryDecodeShareTextToDeck('1' + ${JSON.stringify(b64Bomb)});
      return result === null ? 'null' : 'unexpected:' + JSON.stringify(result);
    })()
  `);
  check('tryDecodeShareTextToDeck経由: decompression bombはnullを返す(クラッシュせず、呼び出し元は既存の「読み取れませんでした」文言を表示できる)',
    viaTryDeck === 'null');
}

/* ==================================================================
   壊れたgzip(不正なdeflate-rawバイト列): クラッシュせず例外として捕捉できること
   ================================================================== */
{
  const garbage = toBase64Url(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 255, 254, 253, 252, 251, 250, 11, 22, 33]));
  const result = await w.eval(`
    (async function() {
      try {
        const bytes = base64UrlToBytes(${JSON.stringify(garbage)});
        const out = await deflateDecompress(bytes);
        return 'ok:' + out.length;
      } catch (e) { return 'threw:' + e.constructor.name + ':' + (e.message || '(no message)'); }
    })()
  `);
  check('壊れたgzip(不正なdeflate-rawバイト列): クラッシュせず例外としてrejectされる', result.startsWith('threw:'));

  const viaDeck = await w.eval(`
    (async function() {
      try { await decodeDeckShareCodeV2('1' + ${JSON.stringify(garbage)}); return 'ok'; }
      catch (e) { return 'threw'; }
    })()
  `);
  check('壊れたgzip: decodeDeckShareCodeV2経由でもクラッシュせず例外になる', viaDeck === 'threw');

  const viaTryDeck = await w.eval(`
    (async function() {
      const result = await tryDecodeShareTextToDeck('1' + ${JSON.stringify(garbage)});
      return result === null ? 'null' : 'unexpected';
    })()
  `);
  check('壊れたgzip: tryDecodeShareTextToDeck経由ではnullが返る(通常の「読み取れませんでした」表示になる)', viaTryDeck === 'null');
}

/* ==================================================================
   壊れたbase64(base64として不正な文字列): クラッシュせず例外として捕捉できること
   ================================================================== */
{
  const badB64 = '!!!not-valid-base64-@@@###';
  const result = await w.eval(`
    (function() {
      try { const b = base64UrlToBytes(${JSON.stringify(badB64)}); return 'ok:' + b.length; }
      catch (e) { return 'threw:' + e.constructor.name; }
    })()
  `);
  check('壊れたbase64: base64UrlToBytesはクラッシュせず例外になる', result.startsWith('threw:'));

  const viaDeckV2 = await w.eval(`
    (async function() {
      try { await decodeDeckShareCodeV2('1' + ${JSON.stringify(badB64)}); return 'ok'; }
      catch (e) { return 'threw'; }
    })()
  `);
  check('壊れたbase64: decodeDeckShareCodeV2(新形式)経由でも例外になる', viaDeckV2 === 'threw');

  const viaLegacy = w.eval(`
    (function() {
      try { decodeDeckShareCode(${JSON.stringify(badB64)}); return 'ok'; }
      catch (e) { return 'threw'; }
    })()
  `);
  check('壊れたbase64: decodeDeckShareCode(旧形式)経由でも例外になる', viaLegacy === 'threw');

  const viaPkg = await w.eval(`
    (async function() {
      try { await decodePackageShareCode('1' + ${JSON.stringify(badB64)}); return 'ok'; }
      catch (e) { return 'threw'; }
    })()
  `);
  check('壊れたbase64: decodePackageShareCode経由でも例外になる', viaPkg === 'threw');

  const viaTryDeck = await w.eval(`
    (async function() {
      const result = await tryDecodeShareTextToDeck('1' + ${JSON.stringify(badB64)});
      return result === null ? 'null' : 'unexpected';
    })()
  `);
  check('壊れたbase64: tryDecodeShareTextToDeck経由ではnullが返る(通常の「読み取れませんでした」表示になる)', viaTryDeck === 'null');
}

/* ==================================================================
   修正事項2の回帰テスト: エンコード側で「実際に生成した後の値」を検証する。
   圧縮率の低い(高エントロピーな)データについて、生成(エンコード)は成功するが
   デコード側の上限で拒否される、という非対称性が無いことを確認する。
   ================================================================== */

// 固定シードの疑似乱数(mulberry32相当のLCG)。Math.random()は実行のたびに結果が
// 変わり、テストの再現性が損なわれるため使わない。同じseedからは常に同じ数列を返す。
function makeSeededRandom(seed) {
  let s = seed >>> 0;
  return function() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
// 高エントロピーな(hex文字列の)[cardId, qty]エントリを、固定シードから決定的に生成する。
// probe(圧縮前サイズの事前確認)と実際のencodeテストで、生成し直すのではなく
// 同じ配列(このモジュールレベルの定数)をそのまま使い回す。
function buildHighEntropyEntries(count, seed) {
  const rand = makeSeededRandom(seed);
  const hexChars = 'abcdef0123456789';
  const out = [];
  for (let i = 0; i < count; i++) {
    let id = '';
    for (let j = 0; j < 20; j++) id += hexChars[Math.floor(rand() * 16)];
    out.push([id, (i % 999) + 1]);
  }
  return out;
}
// 圧縮前JSON(段階1、262144バイト)の上限には収まるが、乱数データのため圧縮率が低く、
// 圧縮後(段階3、32768バイト)の上限は超える件数(9000件)に調整してある。
const HIGH_ENTROPY_DECK_ENTRIES = buildHighEntropyEntries(9000, 0x1234);
const HIGH_ENTROPY_PKG_ENTRIES = buildHighEntropyEntries(9000, 0x5678);
// 対照(ポジティブコントロール)用: 圧縮後サイズが上限内に収まる件数(500件)
const HIGH_ENTROPY_CONTROL_ENTRIES = buildHighEntropyEntries(500, 0x9abc);

{
  // 高エントロピーな(ランダムhex文字列の)cardIdを大量に持つデッキ。実在するカードIDの
  // 形式検証(sanitizeDeckPayload)を経由しない、ローカルのdeck表現をそのままエンコードする
  // (encodeDeckShareCodeはユーザー自身の手元のデータをエンコードするだけで、
  // 形式検証は行わない設計のため、テストとしてこの形で問題ない)。
  // probe(下記)と実際のencodeテストは、固定シードから一度だけ生成した
  // HIGH_ENTROPY_DECK_ENTRIESを同じデータとしてそのまま埋め込んで使う。
  const probe = w.eval(`
    (function() {
      const m = ${JSON.stringify(HIGH_ENTROPY_DECK_ENTRIES)};
      const payload = { n: 'entropy-test', r: 'standard', m, s: [], l: [], t: null, tq: 0, tags: [] };
      const json = JSON.stringify(payload);
      return JSON.stringify({ byteLength: new TextEncoder().encode(json).byteLength });
    })()
  `);
  const p = JSON.parse(probe);
  check('高エントロピーテスト前提: 圧縮前JSONバイト数は段階1の上限(262144)以内である',
    p.byteLength <= LIMITS.json);

  const result = await w.eval(`
    (async function() {
      const m = ${JSON.stringify(HIGH_ENTROPY_DECK_ENTRIES)};
      const deck = { id: 'd1', name: 'entropy-test', regulationId: 'standard',
        mainCards: m.map(([cardId, qty]) => ({cardId, qty})), sideCards: [], leaderCards: [],
        trumpCard: null, trumpQty: 0, tags: [] };
      try { const code = await encodeDeckShareCode(deck); return 'ok:' + code.length; }
      catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('修正確認: 圧縮率の低い(高エントロピーな、固定データ)デッキは、圧縮後サイズが読込側の上限を超える場合、' +
    'encodeDeckShareCodeの時点で例外になる(「発行はできたがデコードできない」コードを生成しない)',
    result.startsWith('threw:') && result.includes('圧縮データが大きすぎ'));

  // パッケージでも同様(別の固定シードによる、別の固定データ)
  const resultPkg = await w.eval(`
    (async function() {
      const c = ${JSON.stringify(HIGH_ENTROPY_PKG_ENTRIES.map(([cardId, qty]) => ({ cardId, qty })))};
      const pkg = { id: 'p1', name: 'entropy-test', cards: c, tags: [] };
      try { const code = await encodePackageShareCode(pkg); return 'ok:' + code.length; }
      catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('修正確認: 圧縮率の低い(固定データの)パッケージも、encodePackageShareCodeの時点で同様に例外になる',
    resultPkg.startsWith('threw:') && resultPkg.includes('圧縮データが大きすぎ'));

  // 対照(ポジティブコントロール): 固定データのままエントリ数を減らし、圧縮後サイズが
  // 上限内に収まる場合は、今まで通り正常にエンコード・デコードできることを確認する。
  const controlFlow = await w.eval(`
    (async function() {
      const m = ${JSON.stringify(HIGH_ENTROPY_CONTROL_ENTRIES.map(([cardId, qty]) => ({ cardId, qty })))};
      const deck = { id: 'd1', name: 'entropy-control', regulationId: 'standard',
        mainCards: m, sideCards: [], leaderCards: [], trumpCard: null, trumpQty: 0, tags: [] };
      const code = await encodeDeckShareCode(deck);
      const payload = await decodeDeckShareCodeV2(code);
      return JSON.stringify({ mainCardsLen: payload.m.length, name: payload.n });
    })()
  `);
  const cf = JSON.parse(controlFlow);
  check('対照テスト: 圧縮後サイズが上限内に収まる高エントロピー(固定データ)は、今まで通りエンコード・デコードできる',
    cf.mainCardsLen === 500 && cf.name === 'entropy-control');
}

/* ==================================================================
   CompressionStream非対応時のフォールバック経路でも同じ保証が成立すること
   ================================================================== */
{
  const wNoComp = newWindow(true);
  const typeofCheck = wNoComp.eval(`typeof CompressionStream`);
  check('フォールバックテスト前提: このwindowではCompressionStreamが未定義になっている', typeofCheck === 'undefined');

  // (1) 通常サイズのデッキはフォールバック経由でも今まで通り往復できる
  const normalFlow = await wNoComp.eval(`
    (async function() {
      const deck = { id: 'd1', name: '通常デッキ(フォールバック)', regulationId: 'standard',
        mainCards: [{cardId: '1-1', qty: 4}, {cardId: '1-2', qty: 3}], sideCards: [],
        leaderCards: [], trumpCard: null, trumpQty: 0, tags: ['x'] };
      const code = await encodeDeckShareCode(deck);
      const payload = await decodeDeckShareCodeV2(code);
      const restored = deckFromSharePayload(payload);
      return JSON.stringify({ flag: code[0], mainCards: restored.mainCards, name: restored.name });
    })()
  `).then(JSON.parse);
  check('フォールバック: 先頭フラグが圧縮なし(\'0\')であることを確認(実際にフォールバック経路を通っている)',
    normalFlow.flag === '0');
  check('フォールバック: 通常サイズのデッキは今まで通り往復できる',
    normalFlow.mainCards.length === 2 && normalFlow.name === '通常デッキ(フォールバック)');

  // (2) 現実的な最大サイズ(実測約37KB、日本語含む)のデッキも、新しいSHARE_CODE_BODY_MAX_LENGTH
  //     (90000)の余裕により、フォールバック経由で問題なく往復できることを確認する
  //     (修正事項2: 圧縮なしフォールバックでも読込側の上限を満たすことの保証)
  const realisticFlow = await wNoComp.eval(`
    (async function() {
      // cardIdは(sanitizeDeckPayloadで同一IDが合算されて件数が変わらないよう)
      // インデックスを含めて重複しないようにする(全長20文字は維持する)
      const m = [], s = [];
      for (let i = 0; i < 300; i++) { m.push({cardId: 'M' + String(i).padStart(18, '0'), qty: 999}); }
      for (let i = 0; i < 300; i++) { s.push({cardId: 'S' + String(i).padStart(18, '0'), qty: 999}); }
      const deck = { id: 'd1', name: 'あ'.repeat(100), regulationId: 'standard',
        mainCards: m, sideCards: s, leaderCards: [], trumpCard: 'X'.repeat(20), trumpQty: 999,
        tags: Array.from({length:10}, () => 'あ'.repeat(20)) };
      try {
        const code = await encodeDeckShareCode(deck);
        const payload = await decodeDeckShareCodeV2(code);
        const restored = deckFromSharePayload(payload);
        return JSON.stringify({ ok: true, flag: code[0], codeLen: code.length,
          mainCardsLen: restored.mainCards.length, sideCardsLen: restored.sideCards.length });
      } catch (e) {
        return JSON.stringify({ ok: false, message: e.message });
      }
    })()
  `).then(JSON.parse);
  check('フォールバック: 現実的な最大サイズ(実測約37KB相当、日本語含む)のデッキも、' +
    '新しいSHARE_CODE_BODY_MAX_LENGTH(90000)の余裕により正常に往復できる(修正事項2の確認)',
    realisticFlow.ok === true && realisticFlow.flag === '0'
    && realisticFlow.mainCardsLen === 300 && realisticFlow.sideCardsLen === 300);

  // (3) フォールバック経由でbase64本文が上限(90000文字)を超えるほど大きい場合は、
  //     生成後の値で正しく例外になること(圧縮前JSON自体は段階1の上限=262144バイト以内に
  //     収まっているため、段階1のチェックだけではすり抜けてしまうケース)
  const oversizedProbe = w.eval(`
    (function() {
      const name = 'あ'.repeat(30000);
      const payload = { n: name, r: 'standard', m: [], s: [], l: [], t: null, tq: 0, tags: [] };
      const json = JSON.stringify(payload);
      return JSON.stringify({ byteLength: new TextEncoder().encode(json).byteLength });
    })()
  `);
  const op = JSON.parse(oversizedProbe);
  check('フォールバック超過テスト前提: 圧縮前JSONバイト数は段階1の上限(262144)以内である' +
    '(=段階1だけではこのケースを拒否できない)',
    op.byteLength <= LIMITS.json);

  const oversizedResult = await wNoComp.eval(`
    (async function() {
      const deck = { id: 'd1', name: 'あ'.repeat(30000), regulationId: 'standard',
        mainCards: [], sideCards: [], leaderCards: [], trumpCard: null, trumpQty: 0, tags: [] };
      try { const code = await encodeDeckShareCode(deck); return 'ok:' + code.length; }
      catch (e) { return 'threw:' + e.message; }
    })()
  `);
  check('フォールバック: base64本文が上限を超える場合は、生成後の値で正しく例外になる' +
    '(「発行はできたがデコードできない」コードを生成しない)',
    oversizedResult.startsWith('threw:') && oversizedResult.includes('長すぎ'));
}

/* ==================================================================
   発行に成功した全コードが必ず対応するdecode関数で読めること(往復保証の総合確認)。
   ASCII・日本語・絵文字・現実的な最大サイズなど、複数の形状で確認する。
   ================================================================== */
{
  const shapes = [
    { label: 'ASCII小規模', name: 'plain-ascii-name', tags: ['tag1', 'tag2'] },
    { label: '日本語', name: 'テスト用日本語デッキ名', tags: ['タグ1', 'タグ2'] },
    { label: '絵文字混在', name: '🀄🎴デッキ🀄', tags: ['🎴タグ'] },
    { label: '空文字/最小構成', name: '', tags: [] },
  ];
  for (const shape of shapes) {
    const flow = await w.eval(`
      (async function() {
        const deck = { id: 'd1', name: ${JSON.stringify(shape.name)}, regulationId: 'standard',
          mainCards: [{cardId: '1-1', qty: 2}], sideCards: [], leaderCards: [], trumpCard: null,
          trumpQty: 0, tags: ${JSON.stringify(shape.tags)} };
        const code = await encodeDeckShareCode(deck);
        const payload = await decodeDeckShareCodeV2(code);
        return JSON.stringify({ n: payload.n, tags: payload.tags });
      })()
    `).then(JSON.parse);
    check(`往復保証(${shape.label}): encodeDeckShareCodeで発行したコードがdecodeDeckShareCodeV2で正しく読める`,
      flow.n === shape.name && JSON.stringify(flow.tags) === JSON.stringify(shape.tags));
  }

  // 現実的な最大サイズ(圧縮あり経路)でも往復できることを確認
  const bigFlow = await w.eval(`
    (async function() {
      const m = [], s = [];
      for (let i = 0; i < 600; i++) { m.push({cardId: 'X'.repeat(20), qty: 999}); }
      for (let i = 0; i < 600; i++) { s.push({cardId: 'X'.repeat(20), qty: 999}); }
      const deck = { id: 'd1', name: 'あ'.repeat(100), regulationId: 'standard',
        mainCards: m, sideCards: s, leaderCards: [], trumpCard: 'X'.repeat(20), trumpQty: 999,
        tags: Array.from({length:10}, () => 'あ'.repeat(20)) };
      const code = await encodeDeckShareCode(deck);
      const payload = await decodeDeckShareCodeV2(code);
      return JSON.stringify({ mainCardsLen: payload.m.length, sideCardsLen: payload.s.length, flag: code[0] });
    })()
  `).then(JSON.parse);
  check('往復保証(現実的な最大サイズ、圧縮あり経路): mainCards/sideCards各600件でも正しく往復できる',
    bigFlow.mainCardsLen === 600 && bigFlow.sideCardsLen === 600 && bigFlow.flag === '1');
}

/* ==================================================================
   正常系(既存互換性): 通常サイズのデッキ/パッケージの共有コードは今まで通り
   発行・読み込みできること(4段階の上限を追加しても壊れていないことの確認)
   ================================================================== */
{
  const flow = await w.eval(`
    (async function() {
      const c1 = App.allCards[0], c2 = App.allCards[1], c3 = App.allCards[2];
      const deck = { id: uid('deck'), name: '通常デッキ', regulationId: 'standard',
        mainCards: [{cardId: c1.id, qty: 4}, {cardId: c2.id, qty: 3}, {cardId: c3.id, qty: 2}],
        sideCards: [{cardId: c1.id, qty: 1}],
        tags: ['tag1', 'tag2'], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0,
        createdAt: Date.now(), updatedAt: Date.now() };
      const code = await encodeDeckShareCode(deck);
      const payload = await decodeDeckShareCodeV2(code);
      const restored = deckFromSharePayload(payload);
      return JSON.stringify({ codeLen: code.length, mainCards: restored.mainCards, sideCards: restored.sideCards, name: restored.name });
    })()
  `);
  const r = JSON.parse(flow);
  check('正常系互換性: 通常サイズのデッキの共有コード往復は今まで通り成立する',
    r.mainCards.length === 3 && r.sideCards.length === 1 && r.name === '通常デッキ');
}
{
  const flow = await w.eval(`
    (async function() {
      const c1 = App.allCards[0], c2 = App.allCards[1];
      const pkg = { id: uid('pkg'), name: '通常パッケージ',
        cards: [{cardId: c1.id, qty: 2}, {cardId: c2.id, qty: 3}], tags: ['x'] };
      const code = await encodePackageShareCode(pkg);
      const payload = await decodePackageShareCode(code);
      const restored = packageFromSharePayload(payload);
      return JSON.stringify({ cards: restored.cards, name: restored.name });
    })()
  `);
  const r = JSON.parse(flow);
  check('正常系互換性: 通常サイズのパッケージの共有コード往復は今まで通り成立する',
    r.cards.length === 2 && r.name === '通常パッケージ');
}
{
  // 旧形式(圧縮なしbase64、#share=)の後方互換も壊れていないことを確認
  const flow = w.eval(`
    (function() {
      const payload = { n: '旧形式デッキ', r: 'standard', m: [[App.allCards[0].id, 2]], s: [], l: [], t: null, tq: 0, tags: [] };
      const json = JSON.stringify(payload);
      const legacyCode = b64EncodeUnicode(json).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      const decoded = decodeDeckShareCode(legacyCode);
      return JSON.stringify(decoded);
    })()
  `);
  const r = JSON.parse(flow);
  check('正常系互換性: 旧形式(圧縮なしbase64、#share=)の共有コードも今まで通り読み込める',
    r.n === '旧形式デッキ' && r.m.length === 1);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail > 0) process.exit(1);
