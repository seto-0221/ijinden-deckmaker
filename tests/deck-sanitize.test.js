/**
 * 外部由来データ(共有リンク/QRコード/バックアップ復元)の共通サニタイズ層のテスト。
 * 「マイナス枚のカードを追加できる」問題の検証レポートで見つかったPoC(負数・NaN・Infinity・
 * 重複cardId・正負混在)がすべて無効化されることを確認する。
 * 実行: node scripts/build.mjs && node tests/deck-sanitize.test.js
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

const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
const w = dom.window;
const d = w.document;
w.CompressionStream = globalThis.CompressionStream;
w.DecompressionStream = globalThis.DecompressionStream;
w.Response = globalThis.Response;
w.TextEncoder = globalThis.TextEncoder;
w.TextDecoder = globalThis.TextDecoder;
d.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));

const evalJSON = (expr) => JSON.parse(w.eval(`JSON.stringify(${expr})`));

/* ---- 1. sanitizeCardEntries: 個別ケース ---- */

check('負のqtyは除外される(qty:-3)',
  JSON.stringify(evalJSON(`sanitizeCardEntries([['1-1', -3]])`)) === '[]');

check('NaNになるqtyは除外される(qty:"abc")',
  JSON.stringify(evalJSON(`sanitizeCardEntries([['1-1', 'abc']])`)) === '[]');

check('Infinityは除外される',
  JSON.stringify(evalJSON(`sanitizeCardEntries([['1-1', Infinity]])`)) === '[]' &&
  JSON.stringify(evalJSON(`sanitizeCardEntries([['1-1', -Infinity]])`)) === '[]');

check('0は除外される(0以下は無効)',
  JSON.stringify(evalJSON(`sanitizeCardEntries([['1-1', 0]])`)) === '[]');

check('小数はfloorされる(2.9→2)',
  JSON.stringify(evalJSON(`sanitizeCardEntries([['1-1', 2.9]])`)) === '[{"cardId":"1-1","qty":2}]');

check('999は許可される(境界値)',
  JSON.stringify(evalJSON(`sanitizeCardEntries([['1-1', 999]])`)) === '[{"cardId":"1-1","qty":999}]');

check('1000はクランプでなく除外される(境界値)',
  JSON.stringify(evalJSON(`sanitizeCardEntries([['1-1', 1000]])`)) === '[]');

check('null/オブジェクト型のqtyは除外される',
  JSON.stringify(evalJSON(`sanitizeCardEntries([['1-1', null], ['1-2', {}]])`)) === '[]');

check('cardIdが文字列でない場合は除外される',
  JSON.stringify(evalJSON(`sanitizeCardEntries([[123, 4], [null, 4]])`)) === '[]');

check('cardIdが21文字以上は除外される(長さ上限)',
  JSON.stringify(evalJSON(`sanitizeCardEntries([['${'x'.repeat(21)}', 4]])`)) === '[]' &&
  JSON.stringify(evalJSON(`sanitizeCardEntries([['${'x'.repeat(20)}', 4]])`)) === `[{"cardId":"${'x'.repeat(20)}","qty":4}]`);

check('配列でないリストは空配列になる',
  JSON.stringify(evalJSON(`sanitizeCardEntries("not-an-array")`)) === '[]' &&
  JSON.stringify(evalJSON(`sanitizeCardEntries(null)`)) === '[]');

check('{cardId,qty}オブジェクト形式も受け付ける(バックアップ由来の内部形式)',
  JSON.stringify(evalJSON(`sanitizeCardEntries([{cardId:'1-1', qty:4}])`)) === '[{"cardId":"1-1","qty":4}]');

/* ---- 2. 同一cardIdの合算・相殺不可の確認(本命のPoC) ---- */

check('同一cardIdの正の値同士は合算される',
  JSON.stringify(evalJSON(`sanitizeCardEntries([['1-1', 3], ['1-1', 4]])`)) === '[{"cardId":"1-1","qty":7}]');

check('PoC: 正負混在(qty:10とqty:-6)は相殺されず、負の側が完全に無視されてqty:10のまま残る',
  JSON.stringify(evalJSON(`sanitizeCardEntries([['1-1', 10], ['1-1', -6]])`)) === '[{"cardId":"1-1","qty":10}]');

check('合算後に999を超える場合はクランプせず、そのcardId自体を除外する',
  JSON.stringify(evalJSON(`sanitizeCardEntries([['1-1', 600], ['1-1', 600]])`)) === '[]');

/* ---- 3. sanitizeDeckPayload: デッキ全体としての検証(検証レポートのPoCペイロードそのもの) ---- */

const pocPayload = { n: 'PoC-negative-qty', r: 'standard', m: [['1-1', -3], ['1-2', 10]], s: [], l: [], t: null, tq: 0, tags: [] };
const pocClean = evalJSON(`sanitizeDeckPayload(${JSON.stringify(pocPayload)})`);
check('検証レポートのPoCペイロード: mainCardsから負のエントリ(1-1)が消え、正のエントリ(1-2)だけが残る',
  JSON.stringify(pocClean.mainCards) === '[{"cardId":"1-2","qty":10}]');

check('leaderCardsは配列以外なら空配列になる(文字列を渡した場合)',
  JSON.stringify(evalJSON(`sanitizeDeckPayload({leaderCards:'not-array'})`).leaderCards) === '[]');

{
  const r = evalJSON(`sanitizeDeckPayload({mainCards:'x', sideCards:123})`);
  check('mainCards/sideCardsは配列以外なら空配列になる', r.mainCards.length === 0 && r.sideCards.length === 0);
}

check('trumpQtyは整数化され、範囲外・切り札なしなら0になる',
  evalJSON(`sanitizeDeckPayload({t:null, tq:5})`).trumpQty === 0 &&
  evalJSON(`sanitizeDeckPayload({t:'3-1', tq:-9})`).trumpQty === 0 &&
  evalJSON(`sanitizeDeckPayload({t:'3-1', tq:2.9})`).trumpQty === 2);

check('tagsは文字列以外を除外する',
  JSON.stringify(evalJSON(`sanitizeDeckPayload({tags:['ok', 123, null, 'ok2']})`).tags) === '["ok","ok2"]');

/* ---- 4. deckFromSharePayload / packageFromSharePayload 経由でも同じ検証が効く(実際の入口) ---- */

const deckFromShare = evalJSON(`deckFromSharePayload(${JSON.stringify(pocPayload)})`);
check('deckFromSharePayload経由でもPoCのマイナスqtyが除外される',
  JSON.stringify(deckFromShare.mainCards) === '[{"cardId":"1-2","qty":10}]');

const pkgPoc = { n: 'pkg-poc', c: [['1-1', -5], ['1-2', 4]], tags: [] };
const pkgFromShare = evalJSON(`packageFromSharePayload(${JSON.stringify(pkgPoc)})`);
check('packageFromSharePayload経由でもマイナスqtyが除外される',
  JSON.stringify(pkgFromShare.cards) === '[{"cardId":"1-2","qty":4}]');

/* ---- 5. 実際の共有リンクデコード〜インポートの一連の流れ(正常系の回帰確認) ---- */

const legitFlow = await w.eval(`
  (async function() {
    const c1 = App.allCards[0], c2 = App.allCards[1];
    const deck = { id: uid('deck'), name: 'legit', regulationId: 'standard',
      mainCards: [{cardId: c1.id, qty: 4}, {cardId: c2.id, qty: 2}], sideCards: [],
      tags: ['x'], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0,
      createdAt: Date.now(), updatedAt: Date.now() };
    const code = await encodeDeckShareCode(deck);
    const payload = await decodeDeckShareCodeV2(code);
    const restored = deckFromSharePayload(payload);
    return JSON.stringify({ mainCards: restored.mainCards, name: restored.name });
  })()
`);
const legit = JSON.parse(legitFlow);
check('正常な(圧縮形式の)共有リンクの往復は今まで通り成立する(枚数が壊れない)',
  legit.mainCards.length === 2 && legit.mainCards.every(e => e.qty === 4 || e.qty === 2) && legit.name === 'legit');

/* ---- 6. sanitizeSimStarters: simStartersのcomboCards(初動シミュレーションのコンボ定義) ---- */
/* 共有リンクには含まれないが、バックアップ復元ではdeck全体が外部入力になるため同じ規則を適用する */

check('simStarters: 配列以外は空配列になる',
  JSON.stringify(evalJSON(`sanitizeSimStarters('not-array')`)) === '[]' &&
  JSON.stringify(evalJSON(`sanitizeSimStarters(null)`)) === '[]');

check('simStarters: comboCardsの負数は除外される',
  evalJSON(`sanitizeSimStarters([{id:'s1', type:'custom', comboCards:[{cardId:'1-1', qty:-4}]}])`)[0].comboCards.length === 0);

check('simStarters: comboCardsのqty:"abc"は除外される',
  evalJSON(`sanitizeSimStarters([{id:'s1', type:'custom', comboCards:[{cardId:'1-1', qty:'abc'}]}])`)[0].comboCards.length === 0);

check('simStarters: comboCardsのNaN相当(qty: 0/0)は除外される',
  evalJSON(`sanitizeSimStarters([{id:'s1', type:'custom', comboCards:[{cardId:'1-1', qty: 0/0}]}])`)[0].comboCards.length === 0);

check('simStarters: comboCardsのInfinity相当は除外される',
  evalJSON(`sanitizeSimStarters([{id:'s1', type:'custom', comboCards:[{cardId:'1-1', qty: Infinity}, {cardId:'1-2', qty: -Infinity}]}])`)[0].comboCards.length === 0);

check('simStarters: comboCardsのqty999超は除外される',
  evalJSON(`sanitizeSimStarters([{id:'s1', type:'custom', comboCards:[{cardId:'1-1', qty: 1000}]}])`)[0].comboCards.length === 0);

check('simStarters: comboCardsの重複cardId(正負混在)は相殺されずマージされる(qty:10のみ残る)',
  JSON.stringify(evalJSON(`sanitizeSimStarters([{id:'s1', type:'custom', comboCards:[{cardId:'1-1', qty:10}, {cardId:'1-1', qty:-6}]}])`)[0].comboCards) === '[{"cardId":"1-1","qty":10}]');

check('simStarters: comboCardsのcardId不正(非文字列・21文字以上)は除外される',
  evalJSON(`sanitizeSimStarters([{id:'s1', type:'custom', comboCards:[{cardId:123, qty:2}, {cardId:'${'x'.repeat(21)}', qty:2}]}])`)[0].comboCards.length === 0);

check('simStarters: 正常なcomboCardsは残る(回帰確認)',
  JSON.stringify(evalJSON(`sanitizeSimStarters([{id:'s1', type:'custom', name:'コンボA', comboCards:[{cardId:'1-1', qty:2}]}])`)[0].comboCards) === '[{"cardId":"1-1","qty":2}]');

check('simStarters: 未知のtypeは丸ごと除外される',
  JSON.stringify(evalJSON(`sanitizeSimStarters([{id:'s1', type:'evil-type', comboCards:[{cardId:'1-1', qty:2}]}])`)) === '[]');

check('simStarters: anyN型のneedCountはInfinity/NaNなら1にフォールバックする',
  evalJSON(`sanitizeSimStarters([{id:'s1', type:'anyN', cardIds:['1-1'], needCount: Infinity}])`)[0].needCount === 1 &&
  evalJSON(`sanitizeSimStarters([{id:'s1', type:'anyN', cardIds:['1-1'], needCount: 'abc'}])`)[0].needCount === 1);

/* ---- 7. restoreBackup: buildRestoredStateFromBackup ---- */

const restoreResult = evalJSON(`
  buildRestoredStateFromBackup({
    decks: [
      { id: 'd1', name: '正常デッキ', regulationId: 'standard',
        mainCards: [{cardId:'1-1', qty: 4}, {cardId:'1-1', qty: -100}], sideCards: [],
        tags: [], leaderCards: [], trumpCard: null, trumpQty: 0, memo: 'm', createdAt: 1, updatedAt: 2,
        simStarters: [
          { id: 'sim1', type: 'custom', name: '悪意のあるコンボ', comboCards: [{cardId:'1-1', qty:5}, {cardId:'1-1', qty:-999}] },
          { id: 'sim2', type: 'custom', name: '正常なコンボ', comboCards: [{cardId:'1-2', qty:2}] },
        ] },
    ],
    packages: [
      { id: 'p1', name: 'PKG', cards: [{cardId:'1-2', qty: -1}], tags: [] },
    ],
    settings: { theme: 'dark', evilTopLevelKey: 'inject-me', sim: { trials: 999999999, handSize: -5, evilSimKey: 'inject-me-too' } },
    activeDeckId: 'd1',
    seenDefaultPackageIds: ['default-mono-red'],
    customCards: [{ id: 'evil-card', unlimited: true, name: 'evil' }],
    regulations: [{ id: 'evil-reg', maxCopies: 999999 }],
  }, App.state)
`);

check('restoreBackup: デッキ内のマイナスqty(相殺目的の-100)も無効化され、正常な4枚だけ残る',
  JSON.stringify(restoreResult.decks[0].mainCards) === '[{"cardId":"1-1","qty":4}]');

check('restoreBackup: デッキ内のsimStarters comboCardsの正負相殺(qty:5とqty:-999)も無効化され、正常なコンボは残る',
  JSON.stringify(restoreResult.decks[0].simStarters[0].comboCards) === '[{"cardId":"1-1","qty":5}]' &&
  JSON.stringify(restoreResult.decks[0].simStarters[1].comboCards) === '[{"cardId":"1-2","qty":2}]');

check('restoreBackup: settingsの未知キー(トップレベル・sim内部とも)は捨てられる',
  !('evilTopLevelKey' in restoreResult.settings) && !('evilSimKey' in restoreResult.settings.sim) &&
  Object.keys(restoreResult.settings).sort().join(',') === 'sim,theme,viewMode' &&
  Object.keys(restoreResult.settings.sim).sort().join(',') === 'handSize,mulligan,secondDraw,trials,useHierosgamos');

check('restoreBackup: パッケージ内のマイナスqtyも無効化される',
  JSON.stringify(restoreResult.packages[0].cards) === '[]');

check('restoreBackup: settingsの異常値(trials上限超・handSize負値)がクランプされる',
  restoreResult.settings.sim.trials === 200000 && restoreResult.settings.sim.handSize === 1 && restoreResult.settings.theme === 'dark');

check('restoreBackup: customCards/regulationsはバックアップ内容で置き換わらない(現在の状態を維持する)',
  JSON.stringify(restoreResult.customCards) === JSON.stringify(evalJSON('App.state.customCards')) &&
  JSON.stringify(restoreResult.regulations) === JSON.stringify(evalJSON('App.state.regulations')) &&
  !restoreResult.customCards.some(c => c.id === 'evil-card') &&
  !restoreResult.regulations.some(r => r.id === 'evil-reg'));

check('restoreBackup: activeDeckIdは復元後のdecksに実在する場合のみ引き継がれる',
  restoreResult.activeDeckId === 'd1');

const restoreResult2 = evalJSON(`
  buildRestoredStateFromBackup({
    decks: [],
    activeDeckId: 'not-exist',
  }, App.state)
`);
check('restoreBackup: activeDeckIdが復元後のdecksに存在しない場合はnullにリセットされる',
  restoreResult2.activeDeckId === null);

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
