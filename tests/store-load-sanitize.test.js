/**
 * Store.load()(src/app/core/02-storage.js)のprototype pollution対策のテスト。
 *
 * 経緯: セキュリティ監査(所見16-1)で、Store.load()がObject.assign(this.defaults(), data)
 * という形で外部由来(localStorage)のデータを一括マージしており、dataが"__proto__"という
 * 名前のown data property(JSON.parseはこれを例外的なアクセサではなく普通のプロパティとして
 * 生成する)を持っていた場合、マージ先オブジェクトのプロトタイプが書き換わってしまう
 * 可能性があることが分かっていた。本修正では、許可キー方式による新しいオブジェクトへの
 * 明示的コピー(pickAllowedFields)に置き換えた。本テストはその回帰防止。
 *
 * 実行: node scripts/build.mjs && node tests/store-load-sanitize.test.js
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf-8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

function newWindow() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
  const w = dom.window;
  const d = w.document;
  // 共有コードのエンコードに使うAPIをNodeのグローバルから供給(既存テストと同じ流儀)
  w.CompressionStream = globalThis.CompressionStream;
  w.DecompressionStream = globalThis.DecompressionStream;
  w.Response = globalThis.Response;
  w.TextEncoder = globalThis.TextEncoder;
  w.TextDecoder = globalThis.TextDecoder;
  d.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
  return w;
}

// localStorageへ生のJSON文字列を直接セットし、Store.load()を呼んで結果を取得するヘルパー。
// 戻り値はJSON往復済みなので、Function型やDate型などは失われるが、プロトタイプ汚染の
// 有無自体はwindow内で直接評価して確認する(下記のisPollutedヘルパー参照)。
function loadWithRawStorage(w, rawJsonString) {
  w.eval(`localStorage.setItem(STORAGE_KEY, ${JSON.stringify(rawJsonString)})`);
  return w.eval(`JSON.stringify(Store.load())`);
}

// Store.load()の戻り値そのもの、およびそのsettings/settings.simのプロトタイプが
// 汚染されていないか(Object.prototypeのままか)をwindow内で直接確認するヘルパー。
// (JSON往復した後の値ではプロトタイプ情報が失われるため、windowコンテキスト内で直接見る)
function checkNoPollutionInWindow(w) {
  return w.eval(`
    (function () {
      const result = Store.load();
      const topOk = Object.getPrototypeOf(result) === Object.prototype;
      const settingsOk = Object.getPrototypeOf(result.settings) === Object.prototype;
      const simOk = Object.getPrototypeOf(result.settings.sim) === Object.prototype;
      // グローバルなObject.prototype自体が汚染されていないことも確認する(最も重要な確認)。
      const globalOk = ({}).polluted === undefined && ({}).injectedByProto === undefined;
      return JSON.stringify({ topOk, settingsOk, simOk, globalOk });
    })()
  `);
}

// ==================================================================
// 異常系: __proto__ / constructor / prototype を含む悪意ある入力
// ==================================================================
{
  const w = newWindow();
  const malicious = '{"__proto__":{"polluted":"yes"},"decks":[],"settings":{"theme":"dark"}}';
  loadWithRawStorage(w, malicious);
  const res = JSON.parse(checkNoPollutionInWindow(w));
  check('トップレベル__proto__: 戻り値のプロトタイプがObject.prototypeのまま', res.topOk);
  check('トップレベル__proto__: settingsのプロトタイプがObject.prototypeのまま', res.settingsOk);
  check('トップレベル__proto__: settings.simのプロトタイプがObject.prototypeのまま', res.simOk);
  check('トップレベル__proto__: グローバルなObject.prototypeが汚染されていない', res.globalOk);
  // 正常なキー(settings.theme)は引き続き正しく読み込まれることも確認(機能そのものが壊れていないこと)
  const loaded = JSON.parse(w.eval(`JSON.stringify(Store.load())`));
  check('トップレベル__proto__と同時に指定した正常なsettings.themeは反映される', loaded.settings.theme === 'dark');
  check('__proto__キー自体はdecks等の通常フィールドとして持ち込まれていない', !('polluted' in loaded));
}

{
  const w = newWindow();
  const malicious = '{"settings":{"__proto__":{"polluted":"yes"},"theme":"light"}}';
  loadWithRawStorage(w, malicious);
  const res = JSON.parse(checkNoPollutionInWindow(w));
  check('settings内__proto__: settingsのプロトタイプがObject.prototypeのまま', res.settingsOk);
  check('settings内__proto__: グローバルなObject.prototypeが汚染されていない', res.globalOk);
  const loaded = JSON.parse(w.eval(`JSON.stringify(Store.load())`));
  check('settings内__proto__と同時に指定した正常なthemeは反映される', loaded.settings.theme === 'light');
}

{
  const w = newWindow();
  const malicious = '{"settings":{"sim":{"__proto__":{"polluted":"yes"},"trials":12345}}}';
  loadWithRawStorage(w, malicious);
  const res = JSON.parse(checkNoPollutionInWindow(w));
  check('settings.sim内__proto__: simのプロトタイプがObject.prototypeのまま', res.simOk);
  check('settings.sim内__proto__: グローバルなObject.prototypeが汚染されていない', res.globalOk);
  const loaded = JSON.parse(w.eval(`JSON.stringify(Store.load())`));
  check('settings.sim内__proto__と同時に指定した正常なtrialsは反映される', loaded.settings.sim.trials === 12345);
}

{
  const w = newWindow();
  const malicious = '{"constructor":{"polluted":"yes"},"decks":[]}';
  loadWithRawStorage(w, malicious);
  const res = JSON.parse(checkNoPollutionInWindow(w));
  check('トップレベルconstructor: プロトタイプが汚染されない', res.topOk && res.globalOk);
  const loaded = JSON.parse(w.eval(`JSON.stringify(Store.load())`));
  check('constructorキー自体は通常フィールドとして持ち込まれていない', !('polluted' in loaded));
}

{
  const w = newWindow();
  const malicious = '{"prototype":{"polluted":"yes"},"decks":[]}';
  loadWithRawStorage(w, malicious);
  const res = JSON.parse(checkNoPollutionInWindow(w));
  check('トップレベルprototype: プロトタイプが汚染されない', res.topOk && res.globalOk);
  const loaded = JSON.parse(w.eval(`JSON.stringify(Store.load())`));
  check('prototypeキー自体は通常フィールドとして持ち込まれていない', !('polluted' in loaded));
}

{
  // __proto__ / constructor / prototype を同時に複数箇所(トップレベル・settings・sim)に
  // 混在させた、より悪質な複合ケース。
  const w = newWindow();
  // 注意: オブジェクトリテラルの `__proto__: value` はプロトタイプ設定の特殊構文として
  // 扱われ、own property にはならないため JSON.stringify で出力されない。
  // 実際に "__proto__" というown propertyを持つJSONを作るため、computed property
  // (['__proto__']: value) を使う。
  const malicious = JSON.stringify({
    ['__proto__']: { top: 'x' },
    constructor: { top2: 'x' },
    settings: { ['__proto__']: { s: 'x' }, prototype: { s2: 'x' }, theme: 'dark',
      sim: { ['__proto__']: { sim1: 'x' }, constructor: { sim2: 'x' }, trials: 777 } },
    decks: [],
  });
  loadWithRawStorage(w, malicious);
  const res = JSON.parse(checkNoPollutionInWindow(w));
  check('複合汚染ケース: トップレベル・settings・simいずれもプロトタイプ汚染なし', res.topOk && res.settingsOk && res.simOk && res.globalOk);
  const loaded = JSON.parse(w.eval(`JSON.stringify(Store.load())`));
  check('複合汚染ケース: 正常なtheme/trialsは反映される', loaded.settings.theme === 'dark' && loaded.settings.sim.trials === 777);
}

// ==================================================================
// 許可キー方式そのものの確認: 未知のトップレベルキーは捨てられる
// ==================================================================
{
  const w = newWindow();
  const withUnknownKeys = '{"decks":[],"unknownTopLevelKey":"should be dropped","settings":{"unknownSettingKey":"drop me","theme":"dark"}}';
  loadWithRawStorage(w, withUnknownKeys);
  const loaded = JSON.parse(w.eval(`JSON.stringify(Store.load())`));
  check('未知のトップレベルキーは戻り値に含まれない', !('unknownTopLevelKey' in loaded));
  check('未知のsettingsキーは戻り値に含まれない', !('unknownSettingKey' in loaded.settings));
  check('許可されたキー(theme)は正しく反映される', loaded.settings.theme === 'dark');
}

// ==================================================================
// 正常系(既存データとの互換性): 通常の保存データがこれまで通り読み込めること
// ==================================================================
{
  const w = newWindow();
  const normalState = {
    schemaVersion: 2,
    customCards: [{ id: 'custom-1', name: 'テストカスタムカード' }],
    removedCardIds: ['1-1'],
    decks: [{ id: 'deck-1', name: 'テストデッキ', mainCards: [{ cardId: '1-2', qty: 4 }] }],
    packages: [{ id: 'pkg-1', name: 'テストパッケージ' }],
    regulations: [{ id: 'custom-reg', name: 'カスタムレギュレーション' }],
    settings: { theme: 'dark', viewMode: 'list', sim: { handSize: 5, secondDraw: 2, mulligan: false, trials: 20000, useHierosgamos: true } },
    activeDeckId: 'deck-1',
    seenDefaultPackageIds: ['default-1'],
  };
  loadWithRawStorage(w, JSON.stringify(normalState));
  const loaded = JSON.parse(w.eval(`JSON.stringify(Store.load())`));
  check('正常系: schemaVersionが保持される', loaded.schemaVersion === 2);
  check('正常系: customCardsが保持される', loaded.customCards.length === 1 && loaded.customCards[0].id === 'custom-1');
  check('正常系: removedCardIdsが保持される', JSON.stringify(loaded.removedCardIds) === JSON.stringify(['1-1']));
  check('正常系: decksが保持される', loaded.decks.length === 1 && loaded.decks[0].mainCards[0].qty === 4);
  check('正常系: packagesが保持される', loaded.packages.length === 1 && loaded.packages[0].id === 'pkg-1');
  check('正常系: regulationsが保持される', loaded.regulations.length === 1 && loaded.regulations[0].id === 'custom-reg');
  check('正常系: settings全体が保持される', loaded.settings.theme === 'dark' && loaded.settings.viewMode === 'list');
  check('正常系: settings.simが保持される', loaded.settings.sim.handSize === 5 && loaded.settings.sim.trials === 20000 && loaded.settings.sim.useHierosgamos === true);
  check('正常系: activeDeckIdが保持される', loaded.activeDeckId === 'deck-1');
  check('正常系: seenDefaultPackageIdsが保持される', JSON.stringify(loaded.seenDefaultPackageIds) === JSON.stringify(['default-1']));
}

// ==================================================================
// 正常系(旧バージョンのデータとの互換性): 一部キーが無い旧形式データの補完
// ==================================================================
{
  const w = newWindow();
  // schemaVersion・regulations・seenDefaultPackageIds・settings.sim.useHierosgamos が無い、
  // より古い形式の保存データを模擬する。
  const oldState = {
    decks: [{ id: 'old-deck', name: '旧デッキ' }],
    settings: { theme: 'auto', sim: { handSize: 6, trials: 15000 } },
  };
  loadWithRawStorage(w, JSON.stringify(oldState));
  const loaded = JSON.parse(w.eval(`JSON.stringify(Store.load())`));
  check('旧形式互換性: 無いキー(schemaVersion)はdefaultsで補完される', loaded.schemaVersion === 2);
  check('旧形式互換性: 無いキー(regulations)は空配列で補完される', Array.isArray(loaded.regulations) && loaded.regulations.length === 0);
  check('旧形式互換性: 無いキー(seenDefaultPackageIds)は空配列で補完される', Array.isArray(loaded.seenDefaultPackageIds) && loaded.seenDefaultPackageIds.length === 0);
  check('旧形式互換性: settings.sim内の無いキー(useHierosgamos)はdefaultsで補完される', loaded.settings.sim.useHierosgamos === false);
  check('旧形式互換性: settings.sim内の無いキー(secondDraw/mulligan)はdefaultsで補完される', loaded.settings.sim.secondDraw === 1 && loaded.settings.sim.mulligan === true);
  check('旧形式互換性: 存在するキー(decks/theme/handSize/trials)は保持される',
    loaded.decks.length === 1 && loaded.decks[0].id === 'old-deck' && loaded.settings.theme === 'auto' &&
    loaded.settings.sim.handSize === 6 && loaded.settings.sim.trials === 15000);
}

// ==================================================================
// 正常系: localStorageに何も無い場合はdefaults()が返る(既存動作)
// ==================================================================
{
  const w = newWindow();
  w.eval(`localStorage.removeItem(STORAGE_KEY)`);
  const loaded = JSON.parse(w.eval(`JSON.stringify(Store.load())`));
  check('localStorage未設定時: defaults()相当の値が返る(decksが空配列)', Array.isArray(loaded.decks) && loaded.decks.length === 0);
  check('localStorage未設定時: settings.themeが既定値', loaded.settings.theme === 'auto');
}

// ==================================================================
// 正常系: 壊れたJSON(構文エラー)でもクラッシュせずdefaults()にフォールバックする(既存動作の回帰確認)
// ==================================================================
{
  const w = newWindow();
  w.eval(`localStorage.setItem(STORAGE_KEY, '{not valid json!!!')`);
  let threw = false;
  let loaded = null;
  try {
    loaded = JSON.parse(w.eval(`JSON.stringify(Store.load())`));
  } catch (e) {
    threw = true;
  }
  check('壊れたJSON: Store.load()自体は例外を投げずdefaultsへフォールバックする', !threw && loaded && Array.isArray(loaded.decks) && loaded.decks.length === 0);
}

// ==================================================================
// 正常系: data自体が配列やnull等、オブジェクトでない場合の安全な扱い
// ==================================================================
{
  const w = newWindow();
  w.eval(`localStorage.setItem(STORAGE_KEY, '[1,2,3]')`);
  const loaded = JSON.parse(w.eval(`JSON.stringify(Store.load())`));
  // 配列はtypeof 'object'だがdefaults()相当にフォールバックすることを期待する
  check('data自体が配列の場合でもdecksが配列のまま安全に扱われる', Array.isArray(loaded.decks));
}
{
  const w = newWindow();
  w.eval(`localStorage.setItem(STORAGE_KEY, 'null')`);
  const loaded = JSON.parse(w.eval(`JSON.stringify(Store.load())`));
  check('data自体がnullの場合はdefaults()が返る', Array.isArray(loaded.decks) && loaded.decks.length === 0);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
