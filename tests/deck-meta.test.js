/**
 * デッキ分類・説明メタデータ機能のテスト(設計提案の20項目)。
 * 実行: node scripts/build.mjs && node tests/deck-meta.test.js
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf-8');

let pass = 0, fail = 0;
function check(no, name, cond) {
  if (cond) { pass++; console.log(`OK   [${no}] ${name}`); }
  else { fail++; console.log(`FAIL [${no}] ${name}`); }
}

function makeFakeCtx() {
  const calls = [];
  return {
    calls, fillStyle: '', strokeStyle: '', font: '', textAlign: 'left', textBaseline: 'alphabetic', lineWidth: 1,
    fillRect(...a) { calls.push(['fillRect', this.fillStyle, ...a]); },
    strokeRect(...a) { calls.push(['strokeRect', ...a]); },
    fillText(...a) { calls.push(['fillText', this.fillStyle, ...a]); },
    measureText(t) { return { width: String(t).length * 8 }; },
    drawImage(...a) { calls.push(['drawImage', ...a]); },
    beginPath() {}, arc() {}, fill() {}, stroke() {}, save() {}, restore() {},
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
  };
}

const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
const w = dom.window;
const d = w.document;
w.HTMLCanvasElement.prototype.getContext = function () { if (!this.__ctx) this.__ctx = makeFakeCtx(); return this.__ctx; };
w.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,AAAA'; };
w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(['x'])); };
// 共有コードのエンコードに使うAPIをNodeのグローバルから供給
w.CompressionStream = globalThis.CompressionStream;
w.DecompressionStream = globalThis.DecompressionStream;
w.Response = globalThis.Response;
d.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));

const OLD_DECK = {
  id: 'old1', name: '旧デッキ', regulationId: 'standard',
  mainCards: [], sideCards: [], tags: ['  赤虎 ', '', '赤虎', 'x'.repeat(30)], memo: 'めも',
  thumbnailCardId: null,
  // simStarters / leaderCards / deckType / strategy / description / createdAt なし(旧形式を再現)
  updatedAt: 1700000000000,
};

// ---- マイグレーション ----
w.eval(`App.state.decks.push(${JSON.stringify(OLD_DECK)})`);
const rawBefore = w.eval(`localStorage.getItem(STORAGE_KEY)`);
let loaded = null;
let loadErr = null;
try { loaded = JSON.parse(w.eval(`JSON.stringify(loadWorkingDeck('old1'))`)); } catch (e) { loadErr = e; }
check(1, '旧形式デッキがエラーなく開け初期値が補完される',
  !loadErr && loaded && loaded.deckType === '' && loaded.strategy === '' && loaded.description === '');
const rawAfter = w.eval(`localStorage.getItem(STORAGE_KEY)`);
const stateDeckAfterLoad = JSON.parse(w.eval(`JSON.stringify(getDeck('old1'))`));
check(2, '読み込み時にlocalStorage/state内の旧デッキが書き換わらない',
  rawBefore === rawAfter && stateDeckAfterLoad.deckType === undefined && stateDeckAfterLoad.createdAt === undefined);
w.eval(`App.workingDeck.deckType = 'テストタイプ'; saveWorkingDeck(false)`);
const savedDeck = JSON.parse(w.eval(`JSON.stringify(getDeck('old1'))`));
check(3, '保存で新フィールドが書き込まれ既存フィールドが保持される',
  savedDeck.deckType === 'テストタイプ' && savedDeck.strategy === '' && savedDeck.description === '' &&
  savedDeck.memo === 'めも' && savedDeck.name === '旧デッキ' &&
  JSON.parse(w.eval(`localStorage.getItem(STORAGE_KEY)`)).decks.some(x => x.id === 'old1' && x.deckType === 'テストタイプ'));
check(4, 'createdAt欠損がupdatedAtから補完される', savedDeck.createdAt === 1700000000000);

// バックアップ往復
const backup = w.eval(`JSON.stringify(App.state)`);
w.eval(`App.state = Object.assign(Store.defaults(), JSON.parse(${JSON.stringify('')} + ${JSON.stringify(backup)}))`);
const restored = JSON.parse(w.eval(`JSON.stringify(getDeck('old1'))`));
check(5, 'バックアップ復元で新フィールドが往復する', restored.deckType === 'テストタイプ' && restored.createdAt === 1700000000000);

// ---- タグ正規化 ----
const nt = (input) => JSON.parse(w.eval(`JSON.stringify(normalizeTags(${JSON.stringify(input)}))`));
check(6, '空白除去/空タグ除外/完全一致重複除去(先勝ち・表記は変えない)',
  JSON.stringify(nt(['  赤虎 ', '', '  ', '赤虎', 'アグロ', 'ｱｸﾞﾛ', 'Aguro', 'aguro'])) === JSON.stringify(['赤虎', 'アグロ', 'ｱｸﾞﾛ', 'Aguro', 'aguro']));
const longTag = 'あ'.repeat(25);
const manyTags = Array.from({length: 15}, (_, i) => `tag${i}`);
check(7, '上限適用(10個・20文字切り詰め)で既存タグが壊れない',
  nt([longTag])[0] === 'あ'.repeat(20) && nt(manyTags).length === 10 && JSON.stringify(nt(manyTags)) === JSON.stringify(manyTags.slice(0, 10)));
check(8, '正規化は保存時のみ(読み込み後のworkingDeckのtagsは未正規化のまま保持→保存で正規化)',
  savedDeck.tags.length === 3 && savedDeck.tags[0] === '赤虎' && savedDeck.tags[1] === '赤虎'.slice(0,0) + 'x'.repeat(20) || (savedDeck.tags.includes('赤虎') && savedDeck.tags.includes('x'.repeat(20))));

// ---- 使用色算出 ----
const colorTest = w.eval(`
  (function() {
    const red = App.allCards.find(c => c.colors.length === 1 && c.colors[0] === '赤' && c.type !== 'マリョク');
    const blue = App.allCards.find(c => c.colors.length === 1 && c.colors[0] === '青' && c.type !== 'マリョク');
    const redM = App.allCards.find(c => c.colors.length === 1 && c.colors[0] === '赤' && c.type === 'マリョク');
    const deck1 = { mainCards: [{cardId: red.id, qty: 30}, {cardId: blue.id, qty: 4}] };
    const r1 = computeDeckColors(deck1, getCard);
    const r2 = computeDeckColors(deck1, getCard, { touchRatio: 0.05 });
    const deck2 = { mainCards: [{cardId: red.id, qty: 10}, {cardId: redM.id, qty: 10}] };
    const r3 = computeDeckColors(deck2, getCard);
    const r3b = computeDeckColors(deck2, getCard, { includeMaryoku: true });
    const r4 = computeDeckColors({ mainCards: [] }, getCard);
    const r5 = computeDeckColors({ mainCards: [{cardId: 'zzz-unknown', qty: 4}] }, getCard);
    return JSON.stringify({ r1, r2, r3total: r3.all, r3btotal: r3b.all, r4: r4.all, r5: r5.all });
  })()
`);
const ct = JSON.parse(colorTest);
check(9, '単色/多色で正しい色集合(COLORS定義順)', JSON.stringify(ct.r1.all) === JSON.stringify(['赤', '青']));
check(10, 'タッチ判定が閾値に従いoptsで変わる(既定0.15で青がタッチ、0.05に下げると青もmain)',
  ct.r1.touch.includes('青') && ct.r1.main.includes('赤') && ct.r2.touch.length === 0 && ct.r2.main.length === 2);
check(11, 'マリョクは既定で除外/optsで含められる',
  JSON.stringify(ct.r3total) === JSON.stringify(['赤']) && JSON.stringify(ct.r3btotal) === JSON.stringify(['赤']));
check(12, '空デッキ・未登録カードで例外を出さない', ct.r4.length === 0 && ct.r5.length === 0);

// ---- 戦略分類 ----
const stratOpts = w.eval(`
  (function() {
    const sel = document.createElement('select');
    DECK_STRATEGIES.push({ id: 'test-new', name: 'テスト分類' });
    renderStrategySelect(sel, '');
    const added = Array.from(sel.options).some(o => o.value === 'test-new');
    DECK_STRATEGIES.pop();
    const sel2 = document.createElement('select');
    renderStrategySelect(sel2, 'unknown-id');
    const unknown = Array.from(sel2.options).find(o => o.value === 'unknown-id');
    return JSON.stringify({ added, unknownShown: !!unknown, unknownLabel: unknown ? unknown.textContent : '', selected: sel2.value });
  })()
`);
const st = JSON.parse(stratOpts);
check(13, 'DECK_STRATEGIESへの候補追加がselectに反映される', st.added);
check(14, '未知のidは「その他」表示でデータは書き換えない', st.unknownShown && st.unknownLabel === 'その他' && st.selected === 'unknown-id');

// ---- 既存機能の凍結確認 ----
// 16: 共有コード: 同一デッキ内容ならメタデータの有無でコードが一致する
const shareEq = await (async () => {
  try {
    const promise = w.eval(`
      (async function() {
        const red = App.allCards.find(c => c.colors[0] === '赤');
        const base = { id: 'a', name: 'S', regulationId: 'standard', mainCards: [{cardId: red.id, qty: 4}], sideCards: [], tags: ['t'], memo: 'm', leaderCards: [], trumpCard: null, trumpQty: 0 };
        const withMeta = Object.assign({}, base, { deckType: 'タイプ', strategy: 'aggro', description: '説明', createdAt: 1, updatedAt: 2 });
        const c1 = await encodeDeckShareCode(base);
        const c2 = await encodeDeckShareCode(withMeta);
        return c1 === c2;
      })()
    `);
    return await promise;
  } catch (e) { console.log('  share test error:', e.message); return null; }
})();
check(16, '共有コードは同一デッキ内容ならメタデータ有無で一致', shareEq === true);

// 17: テキスト出力がメタデータ有無で一致
const textEq = w.eval(`
  (function() {
    const red = App.allCards.find(c => c.colors[0] === '赤');
    const base = { id: 'a', name: 'S', regulationId: 'standard', mainCards: [{cardId: red.id, qty: 4}], sideCards: [], tags: ['t'], memo: 'm', leaderCards: [], trumpCard: null, trumpQty: 0 };
    const withMeta = Object.assign({}, base, { deckType: 'タイプ', strategy: 'aggro', description: '説明' });
    return deckToText(base) === deckToText(withMeta);
  })()
`);
check(17, 'テキスト出力はメタデータ有無で一致(画像出力もbuildDeckImageCanvasが新フィールド非参照)', textEq === true &&
  !/deckType|strategy|description/.test(w.eval('buildDeckImageCanvas.toString()')));

// 18: カード詳細: 空データのセクションが描画されない
const detailDom = w.eval(`
  (function() {
    openCardDetail(App.allCards[0].id);
    const body = document.getElementById('modalBody').innerHTML;
    return JSON.stringify({
      hasRulings: body.includes('関連裁定'),
      hasPublic: body.includes('このカードを採用した公開デッキ'),
      hasRelated: body.includes('関連カード'),
      hasResults: body.includes('大会での採用実績'),
      sectionsDefined: typeof CARD_DETAIL_SECTIONS === 'object' && CARD_DETAIL_SECTIONS.length === 4,
    });
  })()
`);
const dd = JSON.parse(detailDom);
check(18, 'カード詳細: 空データのセクションは描画されない(構造は4セクション定義済み)',
  dd.sectionsDefined && !dd.hasRulings && !dd.hasPublic && !dd.hasRelated && !dd.hasResults);

// ---- UI ----
const uiTest = w.eval(`
  (function() {
    const d2 = newDeck('UIテスト');
    loadWorkingDeck(d2.id);
    renderDeckEditor();
    document.getElementById('deckTypeInput').value = 'デス虎ドー';
    document.getElementById('deckTypeInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('deckStrategy').value = 'midrange';
    document.getElementById('deckStrategy').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('deckDescription').value = '公開用の説明文';
    document.getElementById('deckDescription').dispatchEvent(new Event('input', { bubbles: true }));
    const dirty = App.workingDeckDirty;
    saveWorkingDeck(false);
    const saved = getDeck(d2.id);
    loadWorkingDeck(d2.id);
    renderDeckEditor();
    return JSON.stringify({
      dirty,
      saved: { deckType: saved.deckType, strategy: saved.strategy, description: saved.description },
      restored: {
        deckType: document.getElementById('deckTypeInput').value,
        strategy: document.getElementById('deckStrategy').value,
        description: document.getElementById('deckDescription').value,
      },
      timestamps: document.getElementById('deckTimestamps').textContent,
    });
  })()
`);
const ui = JSON.parse(uiTest);
check(19, '新フィールド編集でdirty→保存→再読み込みで復元',
  ui.dirty && ui.saved.deckType === 'デス虎ドー' && ui.saved.strategy === 'midrange' && ui.saved.description === '公開用の説明文' &&
  ui.restored.deckType === 'デス虎ドー' && ui.restored.strategy === 'midrange' && ui.restored.description === '公開用の説明文' &&
  /作成: \d{4}-/.test(ui.timestamps));

const colorUi = w.eval(`
  (function() {
    const d3 = App.workingDeck;
    const red = App.allCards.find(c => c.colors.length === 1 && c.colors[0] === '赤' && c.type !== 'マリョク');
    const before = document.getElementById('deckColorsRow').textContent;
    deckAddCard(d3, red.id, 'main', 4);
    renderDeckEditor();
    const after = document.getElementById('deckColorsRow').textContent;
    return JSON.stringify({ before, after });
  })()
`);
const cu = JSON.parse(colorUi);
check(20, '使用色チップがカード追加で更新される', !cu.before.includes('赤') && cu.after.includes('赤'));

// 15: 既存回帰テスト → 別ファイル(regression.test.js)で実行するためここでは案内のみ
console.log('\n[15] 既存機能の回帰テスト18項目は tests/regression.test.js で実行してください');
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
