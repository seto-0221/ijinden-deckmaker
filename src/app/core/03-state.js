/* ========================= 3. 状態管理 ========================= */
const App = {
  state: Store.load(),
  cardsById: new Map(),
  allCards: [],
  filtered: [],
  renderLimit: 60,
  currentView: 'browse',
  workingDeck: null,       // 現在ブラウズ/編集中のデッキの作業用コピー(App.state.decksとは別物)
  workingDeckDirty: false, // workingDeckに未保存の変更があるか
  editingPackageId: null,
  viewMode: 'grid',
  addZone: 'main',         // カード検索画面での+/-ボタンがメイン/サイドどちらに作用するか
  deckViewMode: 'list',    // デッキ編集画面のメイン/サイドリスト表示(list/grid)
  deckSort: { field: 'name', dir: 'asc' }, // メイン/サイドカードリストの並び替え設定
};

function persist() {
  Store.save(App.state);
}

function cloneDeck(d) { return JSON.parse(JSON.stringify(d)); }

// 現在の保存状態バッジ(デッキ編集画面/カード検索画面双方で使用)を更新する
function updateSaveStatusBadge() {
  const badge = document.getElementById('deckSaveStatus');
  if (!badge) return;
  if (!App.workingDeck) {
    badge.textContent = '';
    badge.classList.remove('ok', 'dirty');
    badge.classList.add('neutral');
    return;
  }
  if (App.workingDeckDirty) {
    badge.textContent = '● 未保存の変更があります';
    badge.classList.remove('ok', 'neutral');
    badge.classList.add('dirty');
  } else {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    badge.textContent = `✓ ${hh}:${mm}:${ss} に保存しました`;
    badge.classList.remove('neutral', 'dirty');
    badge.classList.add('ok');
  }
}

// workingDeckを指定した保存済みデッキの内容で(再)初期化する
function loadWorkingDeck(id) {
  const d = getDeck(id);
  if (!d) {
    App.workingDeck = null;
    App.state.activeDeckId = null;
    App.workingDeckDirty = false;
    updateSaveStatusBadge();
    return null;
  }
  App.workingDeck = cloneDeck(d);
  ensureSimStarters(App.workingDeck);
  ensureLeaderFields(App.workingDeck);
  // メタデータ(deckType/strategy/description等)の補完はクローン(workingDeck)側にだけ行う。
  // App.state.decks内の元データはユーザーが保存するまで旧形式のまま維持される(段階的移行)。
  ensureDeckMeta(App.workingDeck);
  App.state.activeDeckId = id;
  App.workingDeckDirty = false;
  updateSaveStatusBadge();
  return App.workingDeck;
}

// 保存されていない新規デッキをworkingDeckとして開始する(保存ボタンを押すまでApp.state.decksには入らない)
function startNewWorkingDeck(name) {
  const d = {
    id: uid('deck'),
    name: name || '無題のデッキ',
    regulationId: 'standard',
    mainCards: [],
    sideCards: [],
    tags: [],
    memo: '',
    deckType: '',
    strategy: '',
    description: '',
    thumbnailCardId: null,
    simStarters: [],
    leaderCards: [],
    trumpCard: null,
    trumpQty: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  App.workingDeck = d;
  App.state.activeDeckId = null;
  App.workingDeckDirty = true;
  updateSaveStatusBadge();
  return d;
}

// workingDeckへの変更をApp.state.decksへ書き込み、localStorageへ保存する(明示的な保存ボタン用)
function saveWorkingDeck(showToast) {
  if (!App.workingDeck) return null;
  const snapshot = cloneDeck(App.workingDeck);
  // 保存時にメタデータの補完とタグの正規化(前後空白除去/空タグ除外/完全一致の重複除去/上限適用)を行う。
  // 旧形式デッキが新形式で保存されるのはこのタイミングのみ(読み込み時にはlocalStorageを書き換えない)。
  ensureDeckMeta(snapshot);
  snapshot.tags = normalizeTags(snapshot.tags);
  snapshot.updatedAt = Date.now();
  const idx = App.state.decks.findIndex(x => x.id === snapshot.id);
  if (idx >= 0) App.state.decks[idx] = snapshot; else App.state.decks.push(snapshot);
  App.state.activeDeckId = snapshot.id;
  persist();
  App.workingDeck = cloneDeck(snapshot);
  App.workingDeckDirty = false;
  updateSaveStatusBadge();
  if (showToast !== false) toast(`「${snapshot.name}」を保存しました`);
  return snapshot;
}

// workingDeckを保存済みの状態(または未保存なら空)まで巻き戻す
function discardWorkingDeck() {
  if (App.state.activeDeckId && getDeck(App.state.activeDeckId)) {
    loadWorkingDeck(App.state.activeDeckId);
  } else {
    App.workingDeck = null;
    App.workingDeckDirty = false;
    updateSaveStatusBadge();
  }
}

function markWorkingDirty() {
  if (!App.workingDeck) return;
  App.workingDeck.updatedAt = Date.now();
  App.workingDeckDirty = true;
  updateSaveStatusBadge();
}

// workingDeckに未保存の変更がある場合、続行前に確認モーダルを出す。なければ即座にnextを実行。
function confirmDiscardIfDirty(next) {
  if (!App.workingDeckDirty) { next(); return; }
  const body = `<div style="padding:2px 0 4px;">「${escapeHtml(App.workingDeck.name)}」に保存されていない変更があります。続ける前に保存しますか？</div>`;
  Modal.open('未保存の変更があります', body,
    `<button class="btn" id="ucCancel">キャンセル</button>
     <button class="btn danger" id="ucDiscard">保存せず続ける</button>
     <button class="btn primary" id="ucSave">保存して続ける</button>`);
  document.getElementById('ucCancel').addEventListener('click', () => Modal.close());
  document.getElementById('ucDiscard').addEventListener('click', () => { discardWorkingDeck(); Modal.close(); next(); });
  document.getElementById('ucSave').addEventListener('click', () => { saveWorkingDeck(false); Modal.close(); next(); });
}

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, kind) {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = 'toast';
  if (kind === 'err') el.style.background = 'var(--danger)';
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; }, 2200);
  setTimeout(() => el.remove(), 2500);
}

