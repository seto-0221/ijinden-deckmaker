/* ========================= 9. 初期化 ========================= */
// DEFAULT_PACKAGESのうち未追加のものだけを補完する(id固定なので、ユーザーが個別に削除したものは復活させない
// 一方、アプリの更新で新しく増えたデフォルトパッケージは既存ユーザーにも反映される)。
function seedDefaultPackages() {
  const existingIds = new Set(App.state.packages.map(p => p.id));
  const seenDefaultIds = new Set(App.state.seenDefaultPackageIds || []);
  let added = 0;
  for (const def of DEFAULT_PACKAGES) {
    if (existingIds.has(def.id) || seenDefaultIds.has(def.id)) continue;
    App.state.packages.push({
      id: def.id,
      name: def.name,
      tags: def.tags.slice(),
      memo: '',
      cards: def.cards.map(e => ({ cardId: e.cardId, qty: e.qty })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    seenDefaultIds.add(def.id);
    added++;
  }
  App.state.seenDefaultPackageIds = Array.from(seenDefaultIds);
  if (added > 0) persist();
  return added;
}

function init() {
  rebuildCardIndex();
  applyTheme();
  // ヘッダーのロゴ画像(ライト/ダーク)を設定する。CSS側でテーマに応じてどちらか一方だけ表示する
  if (LOGO_ASSETS.headerLight) document.getElementById('brandLogoLight').src = LOGO_ASSETS.headerLight;
  if (LOGO_ASSETS.headerDark) document.getElementById('brandLogoDark').src = LOGO_ASSETS.headerDark;
  App.viewMode = App.state.settings.viewMode || 'grid';
  document.querySelectorAll('#viewModeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === App.viewMode));
  document.getElementById('fPanelHost').innerHTML =
    '<button class="btn small mobile-only-btn panel-close-btn" type="button" id="filterPanelCloseBtn" style="align-self:flex-end;">✕ 閉じる</button>' +
    filterPanelHtml('f');
  renderFilterChips();
  if (!App.state.decks.length) {
    const d = newDeck('マイデッキ1');
    App.state.activeDeckId = d.id;
  }
  seedDefaultPackages();
  if (App.state.activeDeckId && getDeck(App.state.activeDeckId)) {
    loadWorkingDeck(App.state.activeDeckId);
  } else if (App.state.decks.length) {
    loadWorkingDeck(App.state.decks[0].id);
  }
  wireEvents();
  switchView('browse');
  tryImportShareLinkFromUrl();
  // サイト概要のリンク等から#/browseなどのハッシュ付きで開かれた場合、対応する画面を開く。
  // (#dz=等の共有リンクはtryImportShareLinkFromUrlが先に処理・除去するため衝突しない)
  applyViewFromHash();
  window.addEventListener('hashchange', applyViewFromHash);
}

// #/browse・#/decks・#/packages・#/data のハッシュを対応するビューに反映する(それ以外のハッシュは無視)。
// フェーズ1で本格的なルーターを導入する際は、この関数がルート定義に置き換わる想定の受け皿。
function applyViewFromHash() {
  const m = location.hash.match(/^#\/(browse|decks|packages|data)$/);
  if (!m) return;
  if (App.currentView === m[1]) return;
  // タブクリック時(tabNavのリスナー)と完全に同じ確認フロー:
  // カード検索(browse)は確認なし、それ以外は未保存変更の確認を挟む
  if (m[1] === 'browse') { switchView('browse'); return; }
  confirmDiscardIfDirty(() => switchView(m[1]));
}

// ページを開いたURLに #dz=...(新形式・圧縮) または #share=...(旧形式、後方互換) が付いていれば、
// 共有されたデッキとして読み込む。読み込み後はURLからハッシュを除去し(リロード時の再インポートを防ぐ)、
// 内容確認・保存を促す。
async function tryImportShareLinkFromUrl() {
  const mPkg = location.hash.match(/[#&]pkg=([A-Za-z0-9\-_]+)/);
  if (mPkg) {
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const payload = await decodePackageShareCode(mPkg[1]);
      const pkg = packageFromSharePayload(payload);
      App.state.packages.push(pkg);
      persist();
      switchView('packages');
      toast(`共有リンクからパッケージ「${pkg.name}」を取り込みました`);
    } catch (e) {
      toast('共有リンクを読み込めませんでした(壊れているか、対応していない形式です)', 'err');
    }
    return;
  }
  const mNew = location.hash.match(/[#&]dz=([A-Za-z0-9\-_]+)/);
  const mOld = !mNew && location.hash.match(/[#&]share=([A-Za-z0-9\-_]+)/);
  const m = mNew || mOld;
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const payload = mNew ? await decodeDeckShareCodeV2(m[1]) : decodeDeckShareCode(m[1]);
    const deck = deckFromSharePayload(payload);
    confirmDiscardIfDirty(() => {
      App.workingDeck = deck;
      App.state.activeDeckId = null;
      App.workingDeckDirty = true;
      switchView('deck');
      updateSaveStatusBadge();
      toast('共有リンクからデッキを読み込みました。内容を確認して保存ボタンを押してください');
    });
  } catch (e) {
    toast('共有リンクを読み込めませんでした(壊れているか、対応していない形式です)', 'err');
  }
}

document.addEventListener('DOMContentLoaded', init);

// 未保存の変更がある状態でタブを閉じる/リロードする場合は確認ダイアログを出す
window.addEventListener('beforeunload', (e) => {
  if (App.workingDeckDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// デバッグ用（コンソールから状態を確認したい場合に使用）
window.App = App;
window.Store = Store;
window.CARD_THUMB_B64 = CARD_THUMB_B64;

