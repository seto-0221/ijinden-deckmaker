/**
 * 新規レギュレーション「ノーマルスクール」「BO1」と、サイド上限0の不具合修正の回帰テスト。
 * 実行: node scripts/build.mjs && node tests/regulation-normal-bo1.test.js
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
  w.CompressionStream = globalThis.CompressionStream;
  w.DecompressionStream = globalThis.DecompressionStream;
  w.Response = globalThis.Response;
  w.TextEncoder = globalThis.TextEncoder;
  w.TextDecoder = globalThis.TextDecoder;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
  return w;
}

// 【本物の再読込テスト用】App.state = Store.load() は03-state.jsのトップレベルconstであり、
// DOMContentLoadedを待たずスクリプト実行と同時(= new JSDOM(...)のコンストラクタ実行中)に
// 一度だけ走る。そのため「window作成後にlocalStorageへ書き込んでからdispatchEventする」
// 方式では、Store.load()の呼び出しに間に合わず、本物の再読込を再現できない
// (常に空のlocalStorageに対してStore.load()が呼ばれてしまう)。
// jsdomのbeforeParseフック(HTML解析・スクリプト実行より前にwindowを触れる)を使い、
// アプリのスクリプトが実行される前にlocalStorageへ生JSON文字列をseedすることで、
// 「ブラウザを閉じて開き直す」実際の再読込に相当する状況を再現する。
function newWindowWithSeededStorage(storageKey, rawJsonString) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/',
    beforeParse(window) {
      if (rawJsonString !== undefined) window.localStorage.setItem(storageKey, rawJsonString);
    },
  });
  const w = dom.window;
  w.CompressionStream = globalThis.CompressionStream;
  w.DecompressionStream = globalThis.DecompressionStream;
  w.Response = globalThis.Response;
  w.TextEncoder = globalThis.TextEncoder;
  w.TextDecoder = globalThis.TextDecoder;
  // Store.load()自体はスクリプト実行(=ここより前)で既に完了しているため、この時点で
  // 追加でdispatchEventしてもApp.stateが再読込されるわけではない(既存initWindow()と同じ
  // 挙動に揃えるための呼び出しであり、他の画面描画等の副作用のためだけに行う)。
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
  return w;
}

const w = newWindow();
const evalJSON = (expr) => JSON.parse(w.eval(`JSON.stringify(${expr})`));

/* ==================================================================
   1. ノーマルスクール
   ================================================================== */
{
  const CONFIRMED_BANNED_IDS = ['1-48', '2-36', '2-9', '3-69', '4-59', '4-36', '3-59'];

  check('ノーマルスクール: 確定した禁止カードID7件がすべてbannedCardIdsに含まれる',
    evalJSON(`DEFAULT_REGULATIONS.find(r => r.id === 'normal-school').bannedCardIds`).sort().join(',') ===
    [...CONFIRMED_BANNED_IDS].sort().join(','));

  // 禁止対象外のNカードのみ40枚(10種×4枚)は許可レアリティのみで構成された正常系
  const okResult = evalJSON(`
    (function() {
      const banned = ${JSON.stringify(CONFIRMED_BANNED_IDS)};
      const nCards = App.allCards.filter(c => c.rarity === 'N' && !banned.includes(c.id)).slice(0, 10);
      const mainCards = nCards.map(c => ({ cardId: c.id, qty: 4 }));
      const deck = { id: 't1', name: 't', regulationId: 'normal-school', mainCards, sideCards: [],
        tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0 };
      return validateDeck(deck);
    })()
  `);
  check('ノーマルスクール: 禁止対象外のNカードのみ40枚ならOK', okResult.valid === true);

  // 以下3ケース(対象外レアリティ/禁止カードID/オブシディアン)は、いずれも「メイン40枚ちょうど」の
  // 構成で検証する: 禁止対象外のNカード9種×4枚=36枚 + 禁止対象外のNカード1種×3枚=3枚
  // + 検証対象の1枚(qty:1)=1枚 → 合計40枚。minMain違反(未満)や同名4枚超過が同時に発生しない
  // 構成にすることで、対象の理由(レアリティ・禁止カード)単独でNGになることを確認する。
  // violatorIdはウィンドウ内のJS式(App.allCards.find(...).id等)の文字列をそのまま埋め込む。
  function buildDeck40WithViolator(violatorIdExpr, extraFields) {
    return `
      (function() {
        const banned = ${JSON.stringify(CONFIRMED_BANNED_IDS)};
        const violatorId = ${violatorIdExpr};
        const okNCards = App.allCards.filter(c => c.rarity === 'N' && !banned.includes(c.id) && c.id !== violatorId);
        const nine = okNCards.slice(0, 9).map(c => ({ cardId: c.id, qty: 4 })); // 9種×4枚=36枚
        const tenth = { cardId: okNCards[9].id, qty: 3 }; // 1種×3枚=3枚
        const mainCards = nine.concat([tenth, { cardId: violatorId, qty: 1 }]); // +1枚=合計40枚
        const deck = { id: 'v1', name: 't', regulationId: 'normal-school', mainCards, sideCards: [],
          tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0 };
        const v = validateDeck(deck);
        return Object.assign({ valid: v.valid, mainTotal: v.mainTotal,
          hasMinMainMsg: v.messages.some(m => m.text.includes('未満')) }, (${extraFields})(v, violatorId));
      })()
    `;
  }

  // 対象外レアリティ(R/SR/PSR)を正確に1枚だけ含む、メイン40枚ちょうどの構成でNGになることの確認
  const ngRarity = evalJSON(buildDeck40WithViolator(
    `App.allCards.find(c => c.rarity !== 'N').id`,
    `(v) => ({ hasRarityMsg: v.messages.some(m => m.text.includes('レアリティ')) })`
  ));
  check('ノーマルスクール: メイン40枚ちょうどで対象外レアリティを正確に1枚だけ含む構成は、40枚に達している(前提確認)',
    ngRarity.mainTotal === 40);
  check('ノーマルスクール: メイン40枚ちょうどでもR/SR/PSRを1枚含めばNG(レアリティ理由単独)',
    ngRarity.valid === false && ngRarity.hasRarityMsg === true && ngRarity.hasMinMainMsg === false);

  // 確定した禁止カードID7件のうち1枚(カードデータ上レアリティN)を、メイン40枚ちょうどの構成で含める → NG
  const bannedResult = evalJSON(buildDeck40WithViolator(
    `${JSON.stringify(CONFIRMED_BANNED_IDS[0])}`,
    `(v, id) => { const c = App.allCards.find(x => x.id === id); return { rarity: c.rarity,
      hasBanMsg: v.messages.some(m => m.text.includes(c.name) && m.text.includes('使用禁止')) }; }`
  ));
  check('ノーマルスクール: 禁止カードID7件の対象はカードデータ上レアリティNである(前提確認)',
    bannedResult.rarity === 'N');
  check('ノーマルスクール: メイン40枚ちょうどで禁止カードIDのうち1件を含む構成は、40枚に達している(前提確認)',
    bannedResult.mainTotal === 40);
  check('ノーマルスクール: メイン40枚ちょうどでも禁止カードIDを1枚含めばNG(禁止カード理由単独)',
    bannedResult.valid === false && bannedResult.hasBanMsg === true && bannedResult.hasMinMainMsg === false);

  // オブシディアン: bannedCardIdsには含めず、メイン40枚ちょうどの構成でレアリティ判定だけでNGになることの確認
  const obsidianResult = evalJSON(buildDeck40WithViolator(
    `App.allCards.find(c => c.name === 'オブシディアン').id`,
    `(v, id) => {
      const c = App.allCards.find(x => x.id === id);
      const banned = DEFAULT_REGULATIONS.find(r => r.id === 'normal-school').bannedCardIds;
      return { rarity: c.rarity, isBanned: banned.includes(c.id),
        hasRarityMsg: v.messages.some(m => m.text.includes('レアリティ')),
        hasBanMsg: v.messages.some(m => m.text.includes('オブシディアン') && m.text.includes('使用禁止')) };
    }`
  ));
  check('オブシディアン: カードデータ上のレアリティはR(N表記の誤植ではない、前提確認)',
    obsidianResult.rarity === 'R');
  check('オブシディアン: メイン40枚ちょうどの構成は、40枚に達している(前提確認)',
    obsidianResult.mainTotal === 40);
  check('オブシディアン: bannedCardIdsには含まれない', obsidianResult.isBanned === false);
  check('オブシディアン: メイン40枚ちょうどでもレアリティ判定(allowedRarities)単独でNGになる',
    obsidianResult.valid === false && obsidianResult.hasRarityMsg === true &&
    obsidianResult.hasBanMsg === false && obsidianResult.hasMinMainMsg === false);

  check('ノーマルスクール: レギュレーション説明文に既定文言が含まれる',
    evalJSON(`DEFAULT_REGULATIONS.find(r => r.id === 'normal-school').note`).includes('Nのみ使用可能。一部禁止カードあり'));
}

/* ==================================================================
   2. BO1
   ================================================================== */
{
  const ok40 = evalJSON(`
    (function() {
      const cards = App.allCards.slice(0, 10);
      const mainCards = cards.map(c => ({ cardId: c.id, qty: 4 }));
      const deck = { id: 'b1', name: 't', regulationId: 'bo1', mainCards, sideCards: [],
        tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0 };
      return validateDeck(deck);
    })()
  `);
  check('BO1: メイン40枚・サイド0枚ならOK', ok40.valid === true);

  const ng39 = evalJSON(`
    (function() {
      const cards = App.allCards.slice(0, 10);
      const mainCards = cards.map((c, i) => ({ cardId: c.id, qty: i === 0 ? 3 : 4 }));
      const deck = { id: 'b2', name: 't', regulationId: 'bo1', mainCards, sideCards: [],
        tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0 };
      return validateDeck(deck);
    })()
  `);
  check('BO1: メイン39枚はNG', ng39.valid === false && ng39.mainTotal === 39);

  const bigMain = evalJSON(`
    (function() {
      const cards = App.allCards.slice(0, 60);
      const mainCards = cards.map(c => ({ cardId: c.id, qty: 4 })); // 240枚(旧standardのtotalMax:60を大幅に超える)
      const deck = { id: 'b3', name: 't', regulationId: 'bo1', mainCards, sideCards: [],
        tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0 };
      return validateDeck(deck);
    })()
  `);
  check('BO1: メインが通常の上限(60枚等)を超えても、内部安全上限(500件)以下ならOK',
    bigMain.valid === true && bigMain.mainTotal === 240);

  const ngSide = evalJSON(`
    (function() {
      const cards = App.allCards.slice(0, 10);
      const mainCards = cards.map(c => ({ cardId: c.id, qty: 4 }));
      const sideCards = [{ cardId: App.allCards[10].id, qty: 1 }];
      const deck = { id: 'b4', name: 't', regulationId: 'bo1', mainCards, sideCards,
        tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0 };
      return validateDeck(deck);
    })()
  `);
  check('BO1: サイド1枚はNG', ngSide.valid === false);

  check('BO1: レギュレーション説明文に既定文言が含まれる',
    evalJSON(`DEFAULT_REGULATIONS.find(r => r.id === 'bo1').note`).includes('サイドなし。メイン40枚以上、上限なし'));
}

/* ==================================================================
   3. 内部安全上限(DECK_ENTRIES_MAX)
   ================================================================== */
{
  const overCap = evalJSON(`
    (function() {
      const raw = [];
      for (let i = 0; i < 501; i++) raw.push(['Z' + String(i).padStart(19, '0'), 1]);
      return sanitizeCardEntries(raw);
    })()
  `);
  check('内部安全上限: DECK_ENTRIES_MAX(500件)を超えるエントリ配列はリスト全体が無効になる', overCap.length === 0);

  const underCap = evalJSON(`
    (function() {
      const raw = [];
      for (let i = 0; i < 500; i++) raw.push(['Z' + String(i).padStart(19, '0'), 1]);
      return sanitizeCardEntries(raw);
    })()
  `);
  check('内部安全上限: ちょうどDECK_ENTRIES_MAX(500件)は許可される(境界値)', underCap.length === 500);

  const rawGate = evalJSON(`
    (function() {
      const raw = [];
      for (let i = 0; i < 2001; i++) raw.push(['same-id', 1]); // 同一IDでマージされても、生配列の時点で弾かれることの確認
      return sanitizeCardEntries(raw);
    })()
  `);
  check('内部安全上限: マージ前の生配列がRAW_ENTRY_LIST_MAX(2000件)を超える場合は即座に無効になる', rawGate.length === 0);
}

/* ==================================================================
   4. サイド上限0の不具合修正
   ================================================================== */
{
  // 4-1. deckAddCard: サイド上限0のとき、side方向への追加イベントを実行してもsideCardsが増えない
  const addBlocked = evalJSON(`
    (function() {
      const deck = { id: 's1', name: 't', regulationId: 'bo1', mainCards: [], sideCards: [],
        tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0, updatedAt: 0 };
      deckAddCard(deck, App.allCards[0].id, 'side', 1);
      return deck.sideCards;
    })()
  `);
  check('サイド上限0: deckAddCard(zone:"side", delta:+1)を実行してもsideCardsが増えない', addBlocked.length === 0);

  // 4-2. movezone相当(main→side)も拒否されることの確認(isSideAdditionBlockedの直接確認)
  const blockedCheck = evalJSON(`
    (function() {
      const deck = { regulationId: 'bo1' };
      return { toSide: isSideAdditionBlocked(deck, 'side', 1), toMain: isSideAdditionBlocked(deck, 'main', 1) };
    })()
  `);
  check('サイド上限0: isSideAdditionBlockedはside方向のみ拒否し、main方向は拒否しない',
    blockedCheck.toSide === true && blockedCheck.toMain === false);

  // 4-3. サイドにカードがある状態でBO1へ変更 → mergeSideIntoMainIfNoSideでsideCardsが0になりmainCardsへ合算される
  const mergeResult = evalJSON(`
    (function() {
      const c1 = App.allCards[0], c2 = App.allCards[1];
      const deck = { id: 's2', name: 't', regulationId: 'standard',
        mainCards: [{ cardId: c1.id, qty: 2 }], sideCards: [{ cardId: c2.id, qty: 3 }],
        tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0 };
      deck.regulationId = 'bo1'; // レギュレーション変更(イベントハンドラが行うのと同じ代入)
      mergeSideIntoMainIfNoSide(deck);
      return { mainCards: deck.mainCards, sideCards: deck.sideCards, c1: c1.id, c2: c2.id };
    })()
  `);
  check('サイド上限0: BO1へ変更後、mergeSideIntoMainIfNoSideでsideCardsが0になる',
    mergeResult.sideCards.length === 0);
  check('サイド上限0: 元のサイドカードがmainCardsへ合算され、削除されずに残る',
    mergeResult.mainCards.some(e => e.cardId === mergeResult.c2 && e.qty === 3) &&
    mergeResult.mainCards.some(e => e.cardId === mergeResult.c1 && e.qty === 2));

  // 4-3b. 合算によりDECK_QTY_MAX(999)を超える場合でも、クランプして消える枚数があってはならない
  // (main側999枚+side側999枚のような、個別には正当な組み合わせで、合算後の一部が黙って
  // 消えないことを確認する。同名上限超過等のレギュレーション違反自体は別途validateDeckがNGにする)。
  const mergeNoLoss = evalJSON(`
    (function() {
      const c1 = App.allCards[0];
      const deck = { id: 's2b', name: 't', regulationId: 'bo1',
        mainCards: [{ cardId: c1.id, qty: 999 }], sideCards: [{ cardId: c1.id, qty: 999 }],
        tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0 };
      mergeSideIntoMainIfNoSide(deck);
      return deck.mainCards;
    })()
  `);
  check('サイド上限0: 合算がDECK_QTY_MAX(999)を超える場合でも、クランプでカードが消えない(999+999=1998枚残る)',
    mergeNoLoss.length === 1 && mergeNoLoss[0].qty === 1998);

  // 4-3c. mergeで1998枚になったカードをdeckAddCardで−1すると1997枚になる(999へ巻き戻らない)
  const mergeThenDec = evalJSON(`
    (function() {
      const c1 = App.allCards[0];
      const deck = { id: 's2c', name: 't', regulationId: 'bo1',
        mainCards: [{ cardId: c1.id, qty: 999 }], sideCards: [{ cardId: c1.id, qty: 999 }],
        tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0, updatedAt: 0 };
      mergeSideIntoMainIfNoSide(deck);
      deckAddCard(deck, c1.id, 'main', -1);
      return deck.mainCards.find(e => e.cardId === c1.id).qty;
    })()
  `);
  check('サイド上限0: mergeで1998枚になったカードをdeckAddCardで−1すると1997枚になる(999へ巻き戻らない)',
    mergeThenDec === 1997);

  // 4-3d. mergeで1998枚になったカードを+1した場合の仕様: それ以上増やさず1998枚のまま(消えない・仕様が明確)
  const mergeThenInc = evalJSON(`
    (function() {
      const c1 = App.allCards[0];
      const deck = { id: 's2d', name: 't', regulationId: 'bo1',
        mainCards: [{ cardId: c1.id, qty: 999 }], sideCards: [{ cardId: c1.id, qty: 999 }],
        tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0, updatedAt: 0 };
      mergeSideIntoMainIfNoSide(deck);
      deckAddCard(deck, c1.id, 'main', 1);
      return deck.mainCards.find(e => e.cardId === c1.id).qty;
    })()
  `);
  check('サイド上限0: mergeで1998枚になったカードを+1しても、999への巻き戻りやカード消失は起きない(1998枚のまま頭打ち)',
    mergeThenInc === 1998);

  // 4-3e. deckset相当(数量欄への直接入力、newVal-curのdeltaでdeckAddCardを呼ぶ経路)でも
  // 既存の1998枚が意図せず999へ落ちないことの確認(1998→1990の直接入力を模したケース)
  const mergeThenSet = evalJSON(`
    (function() {
      const c1 = App.allCards[0];
      const deck = { id: 's2e', name: 't', regulationId: 'bo1',
        mainCards: [{ cardId: c1.id, qty: 999 }], sideCards: [{ cardId: c1.id, qty: 999 }],
        tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0, updatedAt: 0 };
      mergeSideIntoMainIfNoSide(deck);
      const cur = deck.mainCards.find(e => e.cardId === c1.id).qty; // 1998
      const newVal = 1990;
      deckAddCard(deck, c1.id, 'main', newVal - cur); // 15-events.js/13-modals.jsのdeckset処理と同じ計算式
      return deck.mainCards.find(e => e.cardId === c1.id).qty;
    })()
  `);
  check('サイド上限0: deckset相当の経路(newVal-curのdelta)でも、既存枚数が意図せず999へ落ちない(1998→1990)',
    mergeThenSet === 1990);

  // 4-3f. 保存(saveWorkingDeck)→本物の再読込後も1998枚が保持される(mergeSideIntoMainIfNoSideの
  // 結果をsaveWorkingDeck自身が再クランプしていないこと、かつStore.load()が999超過を理由に
  // 削除してしまわないことの確認)。
  // 【設計】saveWorkingDeck→persist()は「保存」であり、Store.load()を経由する「読み込み」とは
  // 別の関数。この2つを同一window内で完結させず、実際に(1)保存で書き込まれたlocalStorageの
  // 生JSON文字列を取り出し、(2)新しいJSDOM window(独立したApp/localStorage)へbeforeParseで
  // 事前投入し、(3)そのwindow自身のスクリプト実行(=Store.load()呼び出し)を経由させることで、
  // 「ブラウザを閉じて開き直す」実際の再読込を再現する(旧バージョンは同一App.stateを
  // find()で読み返すだけで、localStorage/Store.load()/新しいwindowのいずれも経由していなかった)。
  const storageKey = w.eval('STORAGE_KEY');
  const savedInfo = evalJSON(`
    (function() {
      const c1 = App.allCards[0];
      App.workingDeck = { id: 's2f', name: 't', regulationId: 'bo1',
        mainCards: [{ cardId: c1.id, qty: 999 }], sideCards: [{ cardId: c1.id, qty: 999 }],
        tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0,
        thumbnailCardId: null, simStarters: [], createdAt: Date.now(), updatedAt: Date.now() };
      mergeSideIntoMainIfNoSide(App.workingDeck);
      App.workingDeckDirty = true;
      const saved = saveWorkingDeck(false); // 内部でpersist() = localStorage.setItem(STORAGE_KEY, ...)まで実行される
      return { id: saved.id, cardId: c1.id, savedQty: saved.mainCards.find(e => e.cardId === c1.id).qty };
    })()
  `);
  check('保存(saveWorkingDeck)時点では1998枚のまま(999へクランプされない)', savedInfo.savedQty === 1998);

  const rawStorageAfterSave = w.eval('localStorage.getItem(STORAGE_KEY)');
  const w2 = newWindowWithSeededStorage(storageKey, rawStorageAfterSave);
  const evalJSON2 = (expr) => JSON.parse(w2.eval(`JSON.stringify(${expr})`));
  const reloadedInfo = evalJSON2(`
    (function() {
      const d = App.state.decks.find(d => d.id === ${JSON.stringify(savedInfo.id)});
      return d ? { found: true, qty: d.mainCards.find(e => e.cardId === ${JSON.stringify(savedInfo.cardId)}).qty } : { found: false };
    })()
  `);
  check('本物の再読込(新しいJSDOM window+Store.load())でもデッキが見つかる', reloadedInfo.found === true);
  check('本物の再読込後も1998枚が保持される(Store.load()はqty>999を理由にエントリを消さない)',
    reloadedInfo.found && reloadedInfo.qty === 1998);

  // 4-4. 既にサイド対応レギュレーションのままなら何もしない(既存挙動への非干渉確認)
  const noopResult = evalJSON(`
    (function() {
      const c1 = App.allCards[0];
      const deck = { id: 's3', name: 't', regulationId: 'standard',
        mainCards: [], sideCards: [{ cardId: c1.id, qty: 2 }],
        tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0 };
      mergeSideIntoMainIfNoSide(deck);
      return deck.sideCards;
    })()
  `);
  check('サイド上限0: サイド対応レギュレーション(standard)のままならsideCardsは変化しない', noopResult.length === 1);

  // 4-5. 共有リンク/QR経路(sanitizeDeckPayload/deckFromSharePayload)での正規化確認
  const sharePayload = evalJSON(`
    (function() {
      const c1 = App.allCards[0], c2 = App.allCards[1];
      const payload = { n: 'share-bo1', r: 'bo1', m: [[c1.id, 4]], s: [[c2.id, 2]], l: [], t: null, tq: 0, tags: [] };
      const restored = deckFromSharePayload(payload);
      return { mainCards: restored.mainCards, sideCards: restored.sideCards };
    })()
  `);
  check('共有/QR経路: BO1+sideCards入りペイロードを読み込むと、正規化後sideCardsが0になる',
    sharePayload.sideCards.length === 0 && sharePayload.mainCards.some(e => e.qty === 2 || e.qty === 4));

  // 4-6. バックアップ復元経路(buildRestoredStateFromBackup)での正規化確認
  const backupResult = evalJSON(`
    (function() {
      const c1 = App.allCards[0], c2 = App.allCards[1];
      const state = buildRestoredStateFromBackup({
        decks: [
          { id: 'bk1', name: 'backup-bo1', regulationId: 'bo1',
            mainCards: [{ cardId: c1.id, qty: 4 }], sideCards: [{ cardId: c2.id, qty: 2 }],
            tags: [], leaderCards: [], trumpCard: null, trumpQty: 0, memo: '', createdAt: 1, updatedAt: 2 },
        ],
      }, App.state);
      return state.decks[0];
    })()
  `);
  check('バックアップ復元経路: BO1+sideCards入りデータを復元すると、正規化後sideCardsが0になる',
    backupResult.sideCards.length === 0 && backupResult.mainCards.length === 2);

  // 4-7. テキストインポート経路(finishDeckImport)での正規化確認
  const importResult = evalJSON(`
    (function() {
      const c1 = App.allCards[0];
      const deck = { id: 'imp1', name: 'text-import-bo1', regulationId: 'bo1',
        mainCards: [{ cardId: c1.id, qty: 4 }], sideCards: [{ cardId: c1.id, qty: 5 }],
        tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0,
        thumbnailCardId: null, simStarters: [], createdAt: Date.now(), updatedAt: Date.now() };
      finishDeckImport(deck, []);
      return { mainCards: App.workingDeck.mainCards, sideCards: App.workingDeck.sideCards };
    })()
  `);
  check('テキストインポート経路: finishDeckImportはBO1+sideCards入りデータをsideCards:0へ正規化する',
    importResult.sideCards.length === 0 && importResult.mainCards.some(e => e.qty === 4 + 5));

  // 4-8. 保存経路(saveWorkingDeck)での正規化確認(最終セーフティネット)
  const saveResult = evalJSON(`
    (function() {
      const c1 = App.allCards[0], c2 = App.allCards[1];
      App.workingDeck = { id: 'sv1', name: 'save-bo1', regulationId: 'bo1',
        mainCards: [{ cardId: c1.id, qty: 4 }], sideCards: [{ cardId: c2.id, qty: 2 }],
        tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0,
        thumbnailCardId: null, simStarters: [], createdAt: Date.now(), updatedAt: Date.now() };
      App.workingDeckDirty = true;
      const saved = saveWorkingDeck(false);
      return { mainCards: saved.mainCards, sideCards: saved.sideCards };
    })()
  `);
  check('保存経路: saveWorkingDeckはBO1+sideCards入りの作業中デッキをsideCards:0へ正規化する',
    saveResult.sideCards.length === 0 && saveResult.mainCards.some(e => e.qty === 2));

  /* ----------------------------------------------------------------
     4-9〜4-11. 信頼境界の確認: 「内部保存データ(このアプリ自身がStore.saveで書いたもの)は
     再読込で破壊しない」ことと「外部由来データ(共有リンク/QR/バックアップ復元)はqty>999を
     依然として拒否する」ことが両立していることを、それぞれの実際の経路で確認する。
     上の4-3fは前者(内部・保持)、以下4-9〜4-11は後者(外部・拒否)。
     ---------------------------------------------------------------- */

  // 4-9. 共有リンク/QR経路(deckFromSharePayload→sanitizeDeckPayload)は、外部由来データとして
  // qty:1998のエントリを(クランプせず)除外する。正当なエントリ(qty:4)は残る。
  const shareOverMax = evalJSON(`
    (function() {
      const c1 = App.allCards[0], c2 = App.allCards[1];
      const payload = { n: 'share-overmax', r: 'standard',
        m: [[c1.id, 1998], [c2.id, 4]], s: [], l: [], t: null, tq: 0, tags: [] };
      const restored = deckFromSharePayload(payload);
      return { mainCards: restored.mainCards, c1: c1.id, c2: c2.id };
    })()
  `);
  check('共有/QR経路(外部由来): qty:1998のエントリは除外される(クランプされて999になるのではなく消える)',
    !shareOverMax.mainCards.some(e => e.cardId === shareOverMax.c1));
  check('共有/QR経路(外部由来): qty:1998のエントリが除外されても、他の正当なエントリ(qty:4)は残る',
    shareOverMax.mainCards.some(e => e.cardId === shareOverMax.c2 && e.qty === 4));

  // 4-10. バックアップ復元経路(buildRestoredStateFromBackup→sanitizeRestoredDeck)も同様に、
  // 外部由来データとしてqty:1998のエントリを除外する。
  const backupOverMax = evalJSON(`
    (function() {
      const c1 = App.allCards[0], c2 = App.allCards[1];
      const state = buildRestoredStateFromBackup({
        decks: [
          { id: 'bk-overmax', name: 'backup-overmax', regulationId: 'standard',
            mainCards: [{ cardId: c1.id, qty: 1998 }, { cardId: c2.id, qty: 4 }], sideCards: [],
            tags: [], leaderCards: [], trumpCard: null, trumpQty: 0, memo: '', createdAt: 1, updatedAt: 2 },
        ],
      }, App.state);
      return { mainCards: state.decks.find(d => d.id === 'bk-overmax').mainCards, c1: c1.id, c2: c2.id };
    })()
  `);
  check('バックアップ復元経路(外部由来): qty:1998のエントリは除外される',
    !backupOverMax.mainCards.some(e => e.cardId === backupOverMax.c1));
  check('バックアップ復元経路(外部由来): qty:1998のエントリが除外されても、他の正当なエントリ(qty:4)は残る',
    backupOverMax.mainCards.some(e => e.cardId === backupOverMax.c2 && e.qty === 4));

  // 4-11. sanitizeCardEntries自体を「外部由来データ」を模した入力で直接呼び出しても、
  // qty:1998のエントリは除外される(共有/QR/バックアップ復元いずれの経路も内部的にはこの
  // 関数へ収束するため、ここでの直接確認が外部入力拒否の最終防衛ラインになる)。
  const directSanitize = evalJSON(`
    (function() {
      const c1 = App.allCards[0], c2 = App.allCards[1];
      const out = sanitizeCardEntries([{ cardId: c1.id, qty: 1998 }, { cardId: c2.id, qty: 4 }]);
      return { out, c1: c1.id, c2: c2.id };
    })()
  `);
  check('sanitizeCardEntries直接呼び出し(外部由来データを想定): qty:1998のエントリは除外される',
    !directSanitize.out.some(e => e.cardId === directSanitize.c1));
  check('sanitizeCardEntries直接呼び出し(外部由来データを想定): qty:1998のエントリが除外されても、正当なエントリ(qty:4)は残る',
    directSanitize.out.some(e => e.cardId === directSanitize.c2 && e.qty === 4));

  // 4-12〜4-14. テキストインポート(parseDeckText。自サイト形式・他サイト形式いずれも内部で
  // 経由する)でも、共有リンク/QR/バックアップ復元と同じ「拒否」方針(クランプではなく除外)で
  // qty:1998を扱う。
  // 【調査結果】旧版のaddEntry()(parseDeckText/parseOtherSiteDeckText共通のローカル関数)は
  // qtyの上限(DECK_QTY_MAX)を一切確認しておらず、qty:1998はもちろん、桁数が極端に多い数字列
  // (parseIntがInfinity等の非有限値を返す実装があるケース。ECMAScript仕様はparseIntの戻り値が
  // 具体的にInfinityになることまでは保証していないが、有限範囲を超えた場合に非有限値を返す
  // 実装は許容されている)も、そのまま素通りしていた(本ラウンドでdropEntriesOverQtyMax
  // (05-deck-logic.js)による合算後チェックと、行ごとのNumber.isFinite+上限チェックを追加して
  // 修正済み)。
  // 方針は「拒否」で統一する: 共有リンク/バックアップ復元が既にクランプせず除外する方針であり、
  // テキストインポートだけ「クランプ(999へ丸める)」にすると、同じ「999超のデータをどう扱うか」
  // という問いに経路ごとに異なる答えを出すことになり、ユーザーから見て「経路によって挙動が
  // 変わる」という分かりにくさを生む。実装上もクランプより除外の方が単純
  // (sanitizeCardEntriesの既存ロジックをそのまま流用できる)。
  // 【テスト方法についての注記】テキスト本文はNode側(このファイル)で通常のJS文字列結合
  // ('\n'/'\t'は単なる文字列エスケープ)として組み立て、JSON.stringifyで正しくエスケープして
  // からeval用テンプレート文字列へ埋め込む。テキスト本文を直接バッククォート文字列の中に
  // 書くと、外側(このテストファイル)のテンプレートリテラルが改行・タブを実際の制御文字へ
  // 変換してしまい、内側(evalされるコード)の文字列リテラルに生の改行が混入して構文エラーに
  // なるため、この組み立て方を避けている。
  const overMaxCards = evalJSON(`
    (function() {
      const c1 = App.allCards[0], c2 = App.allCards[1];
      return { c1: { id: c1.id, name: c1.name, type: c1.type }, c2: { id: c2.id, name: c2.name, type: c2.type } };
    })()
  `);

  // 4-12. 自サイト形式("Nx<TAB>カード名<TAB>[タイプ]"の行)
  const ownSiteText = '--- メインデッキ (2枚) ---\n' +
    '1998x\t' + overMaxCards.c1.name + '\t[' + overMaxCards.c1.type + ']\n' +
    '4x\t' + overMaxCards.c2.name + '\t[' + overMaxCards.c2.type + ']\n';
  const ownSiteOverMax = evalJSON(`
    (function() {
      const { deck, warnings } = parseDeckText(${JSON.stringify(ownSiteText)});
      return { mainCards: deck.mainCards, warnings };
    })()
  `);
  check('テキストインポート(自サイト形式): qty:1998の行は除外される(クランプされて999になるのではなく消える)',
    !ownSiteOverMax.mainCards.some(e => e.cardId === overMaxCards.c1.id));
  check('テキストインポート(自サイト形式): qty:1998の行が除外されても、他の正常な行(qty:4)は残る',
    ownSiteOverMax.mainCards.some(e => e.cardId === overMaxCards.c2.id && e.qty === 4));
  check('テキストインポート(自サイト形式): qty:1998の行が除外されたことを示す警告が出る',
    ownSiteOverMax.warnings.some(w => /上限/.test(w)));

  // 4-13. 他サイト形式("メインデッキ<TAB>枚数"ヘッダ + "カード名<TAB>枚数"の行)
  const otherSiteText = 'メインデッキ\t2\n' +
    overMaxCards.c1.name + '\t1998\n' +
    overMaxCards.c2.name + '\t4\n';
  const otherSiteOverMax = evalJSON(`
    (function() {
      const { deck, warnings } = parseDeckText(${JSON.stringify(otherSiteText)});
      return { mainCards: deck.mainCards, warnings };
    })()
  `);
  check('テキストインポート(他サイト形式): qty:1998の行は除外される(クランプされて999になるのではなく消える)',
    !otherSiteOverMax.mainCards.some(e => e.cardId === overMaxCards.c1.id));
  check('テキストインポート(他サイト形式): qty:1998の行が除外されても、他の正常な行(qty:4)は残る',
    otherSiteOverMax.mainCards.some(e => e.cardId === overMaxCards.c2.id && e.qty === 4));
  check('テキストインポート(他サイト形式): qty:1998の行が除外されたことを示す警告が出る',
    otherSiteOverMax.warnings.some(w => /上限/.test(w)));

  // 4-14. 同一カードが複数行に分かれて合計DECK_QTY_MAXを超えるケース(行単独では上限内)も、
  // 合算後チェック(dropEntriesOverQtyMax)で除外される。
  const ownSiteMergedText = '--- メインデッキ (3枚) ---\n' +
    '600x\t' + overMaxCards.c1.name + '\t[' + overMaxCards.c1.type + ']\n' +
    '600x\t' + overMaxCards.c1.name + '\t[' + overMaxCards.c1.type + ']\n' +
    '4x\t' + overMaxCards.c2.name + '\t[' + overMaxCards.c2.type + ']\n';
  const ownSiteMergedOverMax = evalJSON(`
    (function() {
      const { deck } = parseDeckText(${JSON.stringify(ownSiteMergedText)});
      return { mainCards: deck.mainCards };
    })()
  `);
  check('テキストインポート(自サイト形式): 行単独では上限内でも、合算後(600+600=1200)にDECK_QTY_MAXを超えると除外される',
    !ownSiteMergedOverMax.mainCards.some(e => e.cardId === overMaxCards.c1.id));
  check('テキストインポート(自サイト形式): 合算後上限超のカードが除外されても、他の正常なカード(qty:4)は残る',
    ownSiteMergedOverMax.mainCards.some(e => e.cardId === overMaxCards.c2.id && e.qty === 4));

  // 4-15. 桁数が極端に多い数字列(parseIntがInfinity等の非有限値を返す実装があるケース)も、
  // Number.isFiniteチェックで除外される(0以下・そもそも数字にならないケースは既存の
  // qty<=0チェックで、負数は正規表現が\d+(数字のみ)しか受け付けないため構造的に発生し得ない)。
  // 【注記】parseInt('9'.repeat(400),10)が具体的にInfinityを返すことはECMAScript仕様上
  // 保証されていない(現在のV8/Node実測ではInfinityになるが、有限の巨大値を返す実装も
  // 仕様違反ではない)。このテストはNumber.isFiniteによる非有限値の除外と、DECK_QTY_MAX超に
  // よる巨大な有限値の除外のどちらでも(いずれの実装でも)この行が除外されることを確認できる
  // ように書いている。
  const hugeDigits = '9'.repeat(400);
  const ownSiteInfinityText = '--- メインデッキ (2枚) ---\n' +
    hugeDigits + 'x\t' + overMaxCards.c1.name + '\t[' + overMaxCards.c1.type + ']\n' +
    '4x\t' + overMaxCards.c2.name + '\t[' + overMaxCards.c2.type + ']\n';
  const ownSiteInfinity = evalJSON(`
    (function() {
      const { deck, warnings } = parseDeckText(${JSON.stringify(ownSiteInfinityText)});
      return { mainCards: deck.mainCards, warnings };
    })()
  `);
  check('テキストインポート(自サイト形式): 桁数が極端に多い数字列の行は除外される',
    !ownSiteInfinity.mainCards.some(e => e.cardId === overMaxCards.c1.id));
  check('テキストインポート(自サイト形式): 巨大な枚数の行が除外されても、他の正常な行(qty:4)は残る',
    ownSiteInfinity.mainCards.some(e => e.cardId === overMaxCards.c2.id && e.qty === 4));

  // 4-16. qty:0の行は(枚数として無意味なため)従来通り無視される(エントリが作られない・
  // クラッシュしない)ことの確認。
  const ownSiteZeroText = '--- メインデッキ (2枚) ---\n' +
    '0x\t' + overMaxCards.c1.name + '\t[' + overMaxCards.c1.type + ']\n' +
    '4x\t' + overMaxCards.c2.name + '\t[' + overMaxCards.c2.type + ']\n';
  const ownSiteZero = evalJSON(`
    (function() {
      const { deck } = parseDeckText(${JSON.stringify(ownSiteZeroText)});
      return { mainCards: deck.mainCards };
    })()
  `);
  check('テキストインポート(自サイト形式): qty:0の行はエントリを作らない',
    !ownSiteZero.mainCards.some(e => e.cardId === overMaxCards.c1.id));
  check('テキストインポート(自サイト形式): qty:0の行があっても、他の正常な行(qty:4)は残る',
    ownSiteZero.mainCards.some(e => e.cardId === overMaxCards.c2.id && e.qty === 4));
}

/* ==================================================================
   5. 既存レギュレーションの回帰確認(挙動が変わっていないこと)
   ================================================================== */
{
  const existingRegs = ['standard', 'mininden', 'free', 'tournament', 'starter-only', 'leader'];
  const results = evalJSON(`
    (function() {
      const ids = ${JSON.stringify(existingRegs)};
      return ids.map(id => {
        const r = DEFAULT_REGULATIONS.find(x => x.id === id);
        return { id, sideMax: r.sideMax, minMain: r.minMain, maxMain: r.maxMain, maxCopies: r.maxCopies };
      });
    })()
  `);
  const expected = {
    standard: { sideMax: 10, minMain: 40, maxMain: null, maxCopies: 4 },
    mininden: { sideMax: 0, minMain: 20, maxMain: 20, maxCopies: 1 },
    free: { sideMax: null, minMain: 0, maxMain: null, maxCopies: null },
    tournament: { sideMax: 10, minMain: 40, maxMain: null, maxCopies: 4 },
    'starter-only': { sideMax: 10, minMain: 40, maxMain: null, maxCopies: 4 },
    leader: { sideMax: 15, minMain: undefined, maxMain: undefined, maxCopies: 2 },
  };
  let allMatch = true;
  for (const r of results) {
    const e = expected[r.id];
    if (e.sideMax !== r.sideMax || e.minMain !== r.minMain || e.maxMain !== r.maxMain || e.maxCopies !== r.maxCopies) {
      allMatch = false;
      console.log('  mismatch:', r.id, JSON.stringify(r), 'expected', JSON.stringify(e));
    }
  }
  check('既存レギュレーション(standard/mininden/free/tournament/starter-only/leader)の主要フィールドが変更されていない', allMatch);

  // 統領戦(leader)の既存の検証結果が変わっていないこと(禁止カード名判定を含む既存ロジックの回帰)
  const leaderCheck = evalJSON(`
    (function() {
      const sen = App.allCards.find(c => c.name === '千利休');
      if (!sen) return { skipped: true };
      const deck = { id: 'lg1', name: 't', regulationId: 'tournament', mainCards: [{ cardId: sen.id, qty: 2 }],
        sideCards: [], tags: [], memo: '', leaderCards: [], trumpCard: null, trumpQty: 0 };
      const v = validateDeck(deck);
      return { skipped: false, valid: v.valid };
    })()
  `);
  check('既存レギュレーション回帰: 大会レギュレーションの禁止カード判定(千利休)は変更前と同じくNGのまま',
    leaderCheck.skipped === true || leaderCheck.valid === false);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
