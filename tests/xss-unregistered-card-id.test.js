/**
 * DOM-based XSS回帰テスト(所見1: 未登録カードIDの未エスケープ)。
 *
 * 背景: 共有リンク/QRコード/バックアップ復元経由で取り込んだデッキ・パッケージ・
 * 初動シミュレーションのコンボ定義は、カードID(cardId)の型・長さのみをsanitizeCardEntries等で
 * 検証しており、内容(HTMLタグを含むかどうか)は検証していない。「カードDBに存在しないカードID
 * (未登録カード)」を表示する際、以下の3箇所でcardIdがescapeHtml()を通さずテンプレートリテラルへ
 * 埋め込まれ、innerHTML経由でDOMへ挿入されていたため、実証済みペイロード <svg onload=alert()>
 * (ちょうどCARD_ID_MAX_LENGTH=20文字)を使うと、生きたonload属性付き<svg>要素がDOMに生成されていた。
 *   - src/app/features/deck-editor/10-view.js (renderDeckCardList: デッキ編集の未登録カード表示)
 *   - src/app/ui/13-modals.js (renderPackageEditorModal: パッケージ編集モーダル)
 *   - src/app/features/sim/12-view.js (openSimStarterEditor/renderSimStarterList: 初動シミュレーションのカスタムコンボ)
 *
 * 修正: 上記のカードID表示箇所すべてにescapeHtml()を適用した(登録済みカードの表示・HTML構造・
 * CSS・挙動は変更していない。登録済みカードIDは元々安全な文字列のため、escapeHtml()を通しても
 * 見た目・動作に変化はない)。
 *
 * このテストは、ビルド済みdist/index.htmlをjsdomへ実際にロードし(runScripts: 'dangerously')、
 * 各画面の実描画関数を直接呼び出して、(1) svg[onload]等の実行可能な要素がDOMに存在しないこと、
 * (2) 表示文字列としては元のcardId(タグ文字列そのもの)がテキストとして残っていること、の両方を
 * 確認する(単なる文字列除去ではなく、正しくHTMLエスケープされていることの確認)。
 *
 * 実行: node scripts/build.mjs && node tests/xss-unregistered-card-id.test.js (npm testにも組み込み済み)
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

// 実証済みペイロード(所見1の報告で使用したものと同一、20文字ちょうどでCARD_ID_MAX_LENGTHの範囲内)
const PAYLOAD = '<svg onload=alert()>';

const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
const { window } = dom;
const { document } = window;

await new Promise((resolve) => {
  if (window.document.readyState === 'complete') resolve();
  else window.addEventListener('load', () => resolve());
});
// DOMContentLoaded後の非同期初期化(initAuth等)の猶予を少し待つ
await new Promise((r) => setTimeout(r, 300));

function assertNoLiveMarkup(container, label) {
  check(`${label}: svg[onload]要素が存在しない(実行可能なマークアップになっていない)`, container.querySelector('svg[onload]') === null);
  check(`${label}: onload属性を持つ要素が一切存在しない`, container.querySelectorAll('[onload]').length === 0);
  check(`${label}: <svg>要素そのものが存在しない(タグとして解釈されていない)`, container.querySelectorAll('svg').length === 0);
}
function assertPayloadShownAsText(container, label) {
  // textContentには「タグとして解釈されなかった元の文字列」がそのまま含まれているべき
  // (escapeHtmlは文字を除去するのではなく、&lt;等に変換してテキストとして表示させる方式のため)
  check(`${label}: 元のcardId文字列がテキストとして画面に残っている(黙って消されていない)`, container.textContent.includes(PAYLOAD));
  // 補足: data-card-id等の属性値としてペイロードが渡っている場合、HTML仕様上、属性値の
  // シリアライズは"<"/">"の実体参照化を必須としない(属性値は元々HTMLとして解釈されないため)。
  // そのため「innerHTML文字列に&lt;svgが含まれるか」という判定は属性値については意味を持たない。
  // 属性値については、代わりにgetAttribute()で取得した実際の値が(パース後も)ペイロード文字列
  // そのままであり、実行可能な別要素・別属性を生成していないことを確認する(下のassertNoLiveMarkupと
  // 組み合わせて、"文字列としては残るが、一切実行可能な形にはならない"ことを保証する)。
}

// ---- 経路1: デッキ編集の未登録カード表示(renderDeckCardList) ----
{
  const deck = {
    id: 'test-deck-1', name: 'XSSテスト用デッキ', regulationId: 'standard',
    mainCards: [{ cardId: PAYLOAD, qty: 1 }], sideCards: [],
    leaderCards: [], trumpCard: null, trumpQty: 0, tags: [], memo: '',
    deckType: '', strategy: '', description: '', thumbnailCardId: null, simStarters: [],
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  window.App.deckViewMode = 'list'; // 既定値と同じ(list)であることを明示
  window.renderDeckCardList('deckMainList', deck.mainCards, deck, 'main');
  const container = document.getElementById('deckMainList');
  assertNoLiveMarkup(container, '経路1(デッキ編集・未登録カード)');
  assertPayloadShownAsText(container, '経路1(デッキ編集・未登録カード)');
}

// ---- 経路2: パッケージ編集モーダル(renderPackageEditorModal) ----
{
  const pkg = {
    id: 'test-pkg-1', name: 'XSSテスト用パッケージ', tags: [], memo: '',
    cards: [{ cardId: PAYLOAD, qty: 1 }], thumbnailCardId: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  window.renderPackageEditorModal(pkg);
  const container = document.getElementById('pkgCardList');
  assertNoLiveMarkup(container, '経路2(パッケージ編集モーダル)');
  assertPayloadShownAsText(container, '経路2(パッケージ編集モーダル)');
  const qtyBtn = container.querySelector('[data-action="pkgdec"]');
  check('経路2(パッケージ編集モーダル): data-card-id属性は実行可能な別要素を作らず、ペイロード文字列そのものを保持する(属性値として無害)', !!qtyBtn && qtyBtn.getAttribute('data-card-id') === PAYLOAD);
}

// ---- 経路3: 初動シミュレーションのカスタムコンボ編集(openSimStarterEditor) ----
{
  const starter = {
    id: 'test-starter-1', name: 'XSSテスト用コンボ', type: 'custom',
    comboCards: [{ cardId: PAYLOAD, qty: 1 }],
  };
  const deck = {
    id: 'test-deck-2', name: 'XSSテスト用デッキ2', regulationId: 'standard',
    mainCards: [], sideCards: [], leaderCards: [], trumpCard: null, trumpQty: 0, tags: [], memo: '',
    deckType: '', strategy: '', description: '', thumbnailCardId: null,
    simStarters: [starter], createdAt: Date.now(), updatedAt: Date.now(),
  };
  window.App.workingDeck = deck;
  window.openSimStarterEditor(starter.id);
  const container = document.getElementById('simStCardList');
  assertNoLiveMarkup(container, '経路3(初動シミュレーション・カスタムコンボ編集)');
  assertPayloadShownAsText(container, '経路3(初動シミュレーション・カスタムコンボ編集)');
  const qtyBtn = container.querySelector('[data-action="simdec"]');
  check('経路3(初動シミュレーション・カスタムコンボ編集): data-card-id属性は実行可能な別要素を作らず、ペイロード文字列そのものを保持する(属性値として無害)', !!qtyBtn && qtyBtn.getAttribute('data-card-id') === PAYLOAD);
}

// ---- 経路3b: 初動シミュレーションの一覧サマリー表示(renderSimStarterList) ----
// openSimStarterEditorとは別関数(一覧画面)。同じ脆弱パターンが存在していたため、あわせて確認する。
{
  const starter = {
    id: 'test-starter-2', name: 'XSSテスト用コンボ2', type: 'custom',
    comboCards: [{ cardId: PAYLOAD, qty: 1 }],
  };
  const deck = {
    id: 'test-deck-3', name: 'XSSテスト用デッキ3', regulationId: 'standard',
    mainCards: [], sideCards: [], leaderCards: [], trumpCard: null, trumpQty: 0, tags: [], memo: '',
    deckType: '', strategy: '', description: '', thumbnailCardId: null,
    simStarters: [starter], createdAt: Date.now(), updatedAt: Date.now(),
  };
  window.App.workingDeck = deck;
  window.renderSimStarterList();
  const container = document.getElementById('simStarterList');
  assertNoLiveMarkup(container, '経路3b(初動シミュレーション・一覧サマリー)');
  assertPayloadShownAsText(container, '経路3b(初動シミュレーション・一覧サマリー)');
}

// ---- 回帰確認: 登録済みカードの表示は今まで通り(escapeHtml(c.name)のまま、影響なし) ----
{
  const realCard = window.App.allCards[0];
  check('登録済みカードが少なくとも1件存在する(回帰確認の前提)', !!realCard);
  if (realCard) {
    const deck = {
      id: 'test-deck-4', name: '登録済みカード確認用', regulationId: 'standard',
      mainCards: [{ cardId: realCard.id, qty: 1 }], sideCards: [],
      leaderCards: [], trumpCard: null, trumpQty: 0, tags: [], memo: '',
      deckType: '', strategy: '', description: '', thumbnailCardId: null, simStarters: [],
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    window.App.deckViewMode = 'list';
    window.renderDeckCardList('deckMainList', deck.mainCards, deck, 'main');
    const container = document.getElementById('deckMainList');
    check('登録済みカード: カード名がそのまま表示される(今回の修正で影響を受けていない)', container.textContent.includes(realCard.name));
    check('登録済みカード: qtyボタンのdata-card-id属性が正しく実IDを保持している', container.querySelector(`[data-action="deckinc"][data-card-id="${realCard.id}"]`) !== null);
  }
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
