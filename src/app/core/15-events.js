/* ========================= 8. ビュー切替 / 全体イベント配線 ========================= */
function switchView(name) {
  App.currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  const highlightName = (name === 'deck' || name === 'sim') ? 'decks' : name;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === highlightName));
  if (name === 'browse') refreshBrowseView();
  if (name === 'deck') renderDeckEditor();
  if (name === 'sim') renderSimView();
  if (name === 'decks') renderDeckManager();
  if (name === 'packages') renderPackageManager();
  if (name === 'data') renderDataView();
}

function refreshAll() {
  renderFilterChips();
  refreshBrowseView();
  if (App.currentView === 'deck') renderDeckEditor();
  if (App.currentView === 'decks') renderDeckManager();
  if (App.currentView === 'packages') renderPackageManager();
  if (App.currentView === 'data') renderDataView();
}

function applyTheme() {
  const t = App.state.settings.theme || 'auto';
  if (t === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', t);
  }
}

function wireEvents() {
  // タブ切替
  document.getElementById('tabNav').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    const target = btn.dataset.view;
    // 「カード検索」タブはデッキ編集画面と同じworkingDeckを共有するため、確認なしで移動できる
    if (target === 'browse') { switchView(target); return; }
    confirmDiscardIfDirty(() => switchView(target));
  });

  // テーマ
  document.getElementById('themeToggle').addEventListener('click', () => {
    const cur = App.state.settings.theme || 'auto';
    const next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
    App.state.settings.theme = next;
    persist(); applyTheme();
    toast('テーマ: ' + ({ auto: '自動', light: 'ライト', dark: 'ダーク' }[next]));
  });

  // ---- カード検索フィルタ ----
  wireFilterInputs('f', applyFilters);

  // ---- モバイル用: 絞り込み/デッキパネルをオーバーレイのドロワーとして開閉 ----
  // (カード一覧の後ろに積み上げる方式だと、開くたびに大量スクロールが必要で使いにくいため、
  //  画面上に浮かせて表示し、カード一覧側のスクロール位置はそのまま維持されるようにする)
  const mobilePanelBackdrop = document.getElementById('mobilePanelBackdrop');
  const openMobilePanel = (el) => {
    const willOpen = !el.classList.contains('mobile-open');
    closeMobilePanels();
    if (willOpen) {
      el.classList.add('mobile-open');
      if (mobilePanelBackdrop) mobilePanelBackdrop.classList.add('show');
    }
  };
  document.getElementById('mobileFilterToggleBtn').addEventListener('click', () => {
    openMobilePanel(document.getElementById('fPanelHost'));
  });
  document.getElementById('mobileDeckToggleBtn').addEventListener('click', () => {
    openMobilePanel(document.getElementById('deckSidePanel'));
  });
  document.getElementById('deckSideInfoOpenBtn').addEventListener('click', () => {
    openMobilePanel(document.getElementById('deckEditorSide'));
  });
  document.getElementById('deckSideInfoCloseBtn').addEventListener('click', closeMobilePanels);
  if (mobilePanelBackdrop) mobilePanelBackdrop.addEventListener('click', closeMobilePanels);
  const filterPanelCloseBtn = document.getElementById('filterPanelCloseBtn');
  if (filterPanelCloseBtn) filterPanelCloseBtn.addEventListener('click', closeMobilePanels);
  const deckPanelCloseBtn = document.getElementById('deckPanelCloseBtn');
  if (deckPanelCloseBtn) deckPanelCloseBtn.addEventListener('click', closeMobilePanels);

  document.getElementById('viewModeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    App.viewMode = btn.dataset.mode;
    App.state.settings.viewMode = App.viewMode;
    persist();
    document.querySelectorAll('#viewModeSeg button').forEach(b => b.classList.toggle('on', b === btn));
    renderCardContainer();
  });
  document.getElementById('loadMoreBtn').addEventListener('click', () => {
    App.renderLimit += 60;
    renderCardContainer();
  });
  document.getElementById('addZoneSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-zone]');
    if (!btn) return;
    App.addZone = btn.dataset.zone;
    document.querySelectorAll('#addZoneSeg button').forEach(b => b.classList.toggle('on', b === btn));
    renderCardContainer();
  });
  document.getElementById('cardContainer').addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const cardId = actionEl.dataset.cardId;
    const action = actionEl.dataset.action;
    if (action === 'detail') { openCardDetail(cardId); return; }
    if (action === 'qtyset') return; // 数字入力欄は下のchangeイベントで処理する
    const deck = activeDeck();
    if (!deck) { toast('先にデッキを作成・選択してください', 'err'); return; }
    if (action === 'inc') deckAddCard(deck, cardId, App.addZone, 1);
    if (action === 'dec') deckAddCard(deck, cardId, App.addZone, -1);
    renderCardContainer(); renderDeckSidePanel();
  });
  // 数量欄に直接キーボードで数字を打ち込んだ場合の処理(スマホの＋−連打を避けたいという要望に対応)
  document.getElementById('cardContainer').addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-action="qtyset"]');
    if (!inp) return;
    const deck = activeDeck();
    if (!deck) { toast('先にデッキを作成・選択してください', 'err'); return; }
    let newVal = Math.max(0, Math.floor(Number(inp.value)) || 0);
    const cur = deckCardQty(deck, inp.dataset.cardId, App.addZone);
    deckAddCard(deck, inp.dataset.cardId, App.addZone, newVal - cur);
    renderCardContainer(); renderDeckSidePanel();
  });

  // ---- デッキサイドパネル ----
  document.getElementById('activeDeckSelect').addEventListener('change', (e) => {
    const newId = e.target.value;
    if (App.workingDeck && newId === App.workingDeck.id) return;
    const prevId = App.workingDeck ? App.workingDeck.id : null;
    confirmDiscardIfDirty(() => {
      loadWorkingDeck(newId);
      refreshBrowseView();
    });
    // キャンセル時にセレクトの表示を現在のworkingDeckへ戻す
    if (prevId) document.getElementById('activeDeckSelect').value = prevId;
  });
  document.getElementById('newDeckBtn').addEventListener('click', () => {
    confirmDiscardIfDirty(() => {
      startNewWorkingDeck('新しいデッキ');
      refreshBrowseView();
      toast('新規デッキを作成しました（保存ボタンを押すとデッキ一覧に登録されます）');
    });
  });
  document.getElementById('gotoDeckEditBtn').addEventListener('click', () => {
    if (!App.workingDeck) { toast('デッキがありません', 'err'); return; }
    switchView('deck');
  });
  document.getElementById('saveDeckBtn').addEventListener('click', () => {
    if (!App.workingDeck) { toast('デッキがありません。先に「＋ 新規デッキ」を作成してください', 'err'); return; }
    saveWorkingDeck();
    renderDeckSelect();
  });
  // デッキ編集画面自体からも保存できるようにする(従来はカード検索画面のサイドパネルからしか保存できなかった)
  document.getElementById('saveDeckFromEditorBtn').addEventListener('click', () => {
    if (!App.workingDeck) { toast('デッキがありません', 'err'); return; }
    saveWorkingDeck();
    renderDeckSelect();
  });
  // サイドチェンジ: 現在のメイン/サイド構成を「デフォルト」として保存しておき、後でワンボタンで戻せるようにする
  document.getElementById('setDefaultConfigBtn').addEventListener('click', () => {
    const d = App.workingDeck; if (!d) return;
    if (d.defaultMainCards && !confirm('既にデフォルト構成が設定されています。現在の内容で上書きしますか？')) return;
    d.defaultMainCards = JSON.parse(JSON.stringify(d.mainCards));
    d.defaultSideCards = JSON.parse(JSON.stringify(d.sideCards));
    markWorkingDirty();
    renderDeckEditor();
    toast('現在の構成をデフォルトとして設定しました');
  });
  document.getElementById('restoreDefaultConfigBtn').addEventListener('click', () => {
    const d = App.workingDeck; if (!d) return;
    if (!d.defaultMainCards) { toast('デフォルト構成がまだ設定されていません', 'err'); return; }
    if (!confirm('現在のメイン/サイドの内容を、設定済みのデフォルト構成で上書きします。よろしいですか？')) return;
    d.mainCards = JSON.parse(JSON.stringify(d.defaultMainCards));
    d.sideCards = JSON.parse(JSON.stringify(d.defaultSideCards));
    markWorkingDirty();
    renderDeckEditor();
    toast('デフォルトの構成に戻しました');
  });

  // ---- デッキ編集フォーム ----
  document.getElementById('backToDecksBtn').addEventListener('click', () => {
    confirmDiscardIfDirty(() => switchView('decks'));
  });
  document.getElementById('deckThumbChangeBtn').addEventListener('click', () => openThumbnailPicker());
  document.getElementById('deckThumbPreview').addEventListener('click', () => openThumbnailPicker());
  document.getElementById('addLeaderBtn').addEventListener('click', openLeaderPicker);
  document.getElementById('setTrumpBtn').addEventListener('click', openTrumpPicker);
  document.getElementById('deckLeaderList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const d = App.workingDeck; if (!d) return;
    if (btn.dataset.action === 'detail') { openCardDetail(btn.dataset.cardId); return; }
    if (btn.dataset.action === 'removeleader') {
      d.leaderCards = d.leaderCards.filter(id => id !== btn.dataset.cardId);
      markWorkingDirty();
      renderDeckEditor();
    }
  });
  document.getElementById('deckTrumpList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const d = App.workingDeck; if (!d) return;
    if (btn.dataset.action === 'detail') { openCardDetail(btn.dataset.cardId); return; }
    const reg = getRegulation(d.regulationId);
    const trumpMax = reg.trumpMaxCopies || 2;
    if (btn.dataset.action === 'trumpinc') {
      if (d.trumpQty < trumpMax) d.trumpQty++;
      else toast(`切り札は${trumpMax}枚までです`, 'err');
      markWorkingDirty();
      renderDeckEditor();
    }
    if (btn.dataset.action === 'trumpdec') {
      d.trumpQty--;
      if (d.trumpQty <= 0) { d.trumpCard = null; d.trumpQty = 0; }
      markWorkingDirty();
      renderDeckEditor();
    }
  });
  document.getElementById('deckTrumpList').addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-action="trumpset"]');
    if (!inp) return;
    const d = App.workingDeck; if (!d) return;
    const reg = getRegulation(d.regulationId);
    const trumpMax = reg.trumpMaxCopies || 2;
    let newVal = Math.max(0, Math.floor(Number(inp.value)) || 0);
    if (newVal > trumpMax) { newVal = trumpMax; toast(`切り札は${trumpMax}枚までです`, 'err'); }
    d.trumpQty = newVal;
    if (d.trumpQty <= 0) { d.trumpCard = null; d.trumpQty = 0; }
    markWorkingDirty();
    renderDeckEditor();
  });
  document.getElementById('deckViewModeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    App.deckViewMode = btn.dataset.mode;
    document.querySelectorAll('#deckViewModeSeg button').forEach(b => b.classList.toggle('on', b === btn));
    renderDeckEditor();
  });
  document.getElementById('deckSortField').addEventListener('change', (e) => {
    App.deckSort.field = e.target.value;
    renderDeckEditor();
  });
  document.getElementById('deckSortDirBtn').addEventListener('click', () => {
    App.deckSort.dir = App.deckSort.dir === 'desc' ? 'asc' : 'desc';
    document.getElementById('deckSortDirBtn').textContent = App.deckSort.dir === 'desc' ? '▼降順' : '▲昇順';
    renderDeckEditor();
  });
  document.getElementById('deckName').addEventListener('input', (e) => {
    const d = App.workingDeck; if (!d) return;
    d.name = e.target.value; markWorkingDirty();
  });
  document.getElementById('deckRegulation').addEventListener('change', (e) => {
    const d = App.workingDeck; if (!d) return;
    d.regulationId = e.target.value; markWorkingDirty();
    renderDeckEditor();
  });
  document.getElementById('deckMemo').addEventListener('input', (e) => {
    const d = App.workingDeck; if (!d) return;
    d.memo = e.target.value; markWorkingDirty();
  });
  document.getElementById('deckTypeInput').addEventListener('input', (e) => {
    const d = App.workingDeck; if (!d) return;
    d.deckType = e.target.value; markWorkingDirty();
  });
  document.getElementById('deckStrategy').addEventListener('change', (e) => {
    const d = App.workingDeck; if (!d) return;
    d.strategy = e.target.value; markWorkingDirty();
  });
  document.getElementById('deckDescription').addEventListener('input', (e) => {
    const d = App.workingDeck; if (!d) return;
    d.description = e.target.value; markWorkingDirty();
  });
  document.getElementById('deckTagRow').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tag]');
    if (!btn) return;
    const d = App.workingDeck; if (!d) return;
    d.tags = d.tags.filter(t => t !== btn.dataset.tag);
    markWorkingDirty(); renderTagChips(d);
  });
  document.getElementById('deckTagInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const val = e.target.value.trim();
    if (!val) return;
    const d = App.workingDeck; if (!d) return;
    // 上限チェック(件数・文字数)。正規化そのものは保存時(saveWorkingDeck)にも適用される
    if (val.length > TAG_MAX_LENGTH) { toast(`タグは${TAG_MAX_LENGTH}文字以内で入力してください`, 'err'); return; }
    if (!d.tags.includes(val) && d.tags.length >= TAG_MAX_COUNT) { toast(`タグは${TAG_MAX_COUNT}個までです`, 'err'); return; }
    if (!d.tags.includes(val)) d.tags.push(val);
    markWorkingDirty(); e.target.value = ''; renderTagChips(d);
  });
  ['deckMainList', 'deckSideZoneList'].forEach(id => {
    document.getElementById(id).addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const d = App.workingDeck; if (!d) return;
      if (actionEl.dataset.action === 'empty-open-search') {
        // メイン/サイドが空の時に表示される「＋」を、実際の「カードを検索して追加」ボタンと同じ動作にする
        App.addZone = actionEl.dataset.zone === 'side' ? 'side' : 'main';
        document.querySelectorAll('#addZoneSeg button').forEach(b => b.classList.toggle('on', b.dataset.zone === App.addZone));
        openCardSearchAddModal();
        return;
      }
      if (actionEl.dataset.action === 'detail') { openCardDetail(actionEl.dataset.cardId); return; }
      if (actionEl.dataset.action === 'deckset') return; // 数字入力欄は下のchangeイベントで処理する
      const zone = actionEl.dataset.zone;
      if (actionEl.dataset.action === 'movezone') {
        // サイドチェンジ用: メイン⇄サイドを1枚だけ直感的に移動する矢印ボタン
        const otherZone = zone === 'side' ? 'main' : 'side';
        deckAddCard(d, actionEl.dataset.cardId, zone, -1);
        deckAddCard(d, actionEl.dataset.cardId, otherZone, 1);
        renderDeckEditor();
        return;
      }
      if (actionEl.dataset.action === 'deckdel') {
        // このカードをゾーンから丸ごと削除する(枚数欄を0にするのと同じ処理)
        deckAddCard(d, actionEl.dataset.cardId, zone, -99999);
        renderDeckEditor();
        return;
      }
      const delta = actionEl.dataset.action === 'deckinc' ? 1 : -1;
      deckAddCard(d, actionEl.dataset.cardId, zone, delta);
      renderDeckEditor();
    });
    // 数量欄に直接キーボードで数字を打ち込んだ場合の処理
    document.getElementById(id).addEventListener('change', (e) => {
      const inp = e.target.closest('input[data-action="deckset"]');
      if (!inp) return;
      const d = App.workingDeck; if (!d) return;
      const zone = inp.dataset.zone;
      let newVal = Math.max(0, Math.floor(Number(inp.value)) || 0);
      const cur = deckCardQty(d, inp.dataset.cardId, zone);
      deckAddCard(d, inp.dataset.cardId, zone, newVal - cur);
      renderDeckEditor();
    });
  });
  document.getElementById('openPackagePicker').addEventListener('click', openPackagePicker);
  document.getElementById('openCardSearchAdd').addEventListener('click', openCardSearchAddModal);
  ['mainAddBtn', 'sideAddBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      // メイン/サイドの各見出しにある「＋追加」ボタン: そのゾーンを選択した状態でカード検索モーダルを開く
      App.addZone = btn.dataset.zone === 'side' ? 'side' : 'main';
      document.querySelectorAll('#addZoneSeg button').forEach(b => b.classList.toggle('on', b.dataset.zone === App.addZone));
      openCardSearchAddModal();
    });
  });
  document.getElementById('openSimBtn').addEventListener('click', () => {
    if (!App.workingDeck) return;
    switchView('sim');
  });

  // ---- 初動シミュレーション画面 ----
  document.getElementById('backFromSimBtn').addEventListener('click', () => switchView('deck'));
  document.getElementById('addSimStarterBtn').addEventListener('click', () => openSimStarterEditor(null));
  document.getElementById('simStarterList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const deck = App.workingDeck;
    if (!deck) return;
    if (btn.dataset.action === 'edit-sim-starter') openSimStarterEditor(btn.dataset.id);
    if (btn.dataset.action === 'del-sim-starter') {
      deck.simStarters = ensureSimStarters(deck).filter(s => s.id !== btn.dataset.id);
      markWorkingDirty();
      renderSimStarterList();
      toast('削除しました');
    }
  });
  ['simHandSize', 'simSecondDraw', 'simTrials'].forEach(id => {
    document.getElementById(id).addEventListener('change', (e) => {
      const sim = App.state.settings.sim;
      if (id === 'simHandSize') sim.handSize = Math.max(1, parseInt(e.target.value, 10) || 6);
      if (id === 'simSecondDraw') sim.secondDraw = Math.max(0, parseInt(e.target.value, 10) || 0);
      if (id === 'simTrials') sim.trials = Math.max(500, Math.min(200000, parseInt(e.target.value, 10) || 15000));
      e.target.value = id === 'simHandSize' ? sim.handSize : id === 'simSecondDraw' ? sim.secondDraw : sim.trials;
      persist();
    });
  });
  document.getElementById('simMulligan').addEventListener('change', (e) => {
    App.state.settings.sim.mulligan = e.target.checked;
    persist();
  });
  document.getElementById('simMainHieroToggle').addEventListener('change', (e) => {
    App.state.settings.sim.useHierosgamos = e.target.checked;
    persist();
  });
  document.getElementById('runSimBtn').addEventListener('click', () => {
    const deck = App.workingDeck;
    if (!deck) return;
    if (deckTotalQty(deck.mainCards) < (App.state.settings.sim.handSize || 6)) {
      toast('メインデッキの枚数が手札枚数より少ないため計算できません', 'err');
      return;
    }
    const result = runDeckSimulation(deck, App.state.settings.sim);
    App.lastSimResult = result;
    renderSimStarterResults(result);
    App.simLevelPhase = App.simLevelPhase || 'first';
    document.querySelectorAll('#simLevelTabSeg button').forEach(b => b.classList.toggle('on', b.dataset.phase === App.simLevelPhase));
    renderSimLevelMatrix(result, App.simLevelPhase);
    runAndRenderComboProgress();
    toast(`シミュレーション完了(${result.trials.toLocaleString()}回試行)`);
  });
  document.getElementById('simLevelTabSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-phase]');
    if (!btn) return;
    App.simLevelPhase = btn.dataset.phase;
    document.querySelectorAll('#simLevelTabSeg button').forEach(b => b.classList.toggle('on', b === btn));
    if (App.lastSimResult) renderSimLevelMatrix(App.lastSimResult, App.simLevelPhase);
  });
  document.getElementById('comboProgressStarterSelect').addEventListener('change', (e) => {
    App.comboProgressStarterId = e.target.value;
    runAndRenderComboProgress();
  });
  document.getElementById('hieroToggle').addEventListener('change', () => {
    runAndRenderComboProgress();
  });
  document.getElementById('comboProgressTabSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-phase]');
    if (!btn) return;
    App.comboProgressPhase = btn.dataset.phase;
    document.querySelectorAll('#comboProgressTabSeg button').forEach(b => b.classList.toggle('on', b === btn));
    if (App.lastComboProgressResult) renderComboProgressChart(App.lastComboProgressResult, App.comboProgressPhase);
  });
  document.getElementById('exportTextBtn').addEventListener('click', () => {
    const d = App.workingDeck; if (!d) return;
    const text = deckToText(d);
    const body = `<textarea readonly style="width:100%;height:300px;font-family:ui-monospace,monospace;font-size:12.5px;">${escapeHtml(text)}</textarea>`;
    Modal.open('デッキリスト（テキスト）', body, `<button class="btn" id="txtDownload">ファイルに保存</button><button class="btn primary" id="txtCopy">クリップボードにコピー</button>`);
    document.getElementById('txtCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); toast('コピーしました'); }
      catch { toast('コピーに失敗しました。手動で選択してください', 'err'); }
    });
    document.getElementById('txtDownload').addEventListener('click', () => downloadFile(d.name + '.txt', text, 'text/plain'));
  });
  document.getElementById('exportImageBtn').addEventListener('click', openDeckImageExportModal);
  document.getElementById('shareLinkBtn').addEventListener('click', async () => {
    const d = App.workingDeck; if (!d) return;
    toast('共有リンクを作成しています…');
    const code = await encodeDeckShareCode(d);
    const url = location.origin + location.pathname + '#dz=' + code;
    let qrImgHtml = '';
    let qrDataUrl = null;
    try {
      await ensureQREncodeLib();
      const qrCanvas = buildQRCanvasFit(url, 220);
      if (qrCanvas) {
        qrDataUrl = qrCanvas.toDataURL('image/png');
        // 表示サイズはcanvasの実寸のまま(拡大縮小するとモジュールがにじんで読み取れなくなるため)。
        // image-renderingはmax-widthで縮小表示になる環境向けの保険。
        qrImgHtml = `<div style="text-align:center;margin-top:10px;">
            <img id="shareQrImg" src="${qrDataUrl}" width="${qrCanvas.width}" height="${qrCanvas.height}" style="max-width:220px;width:auto;height:auto;image-rendering:pixelated;border:1px solid var(--border);border-radius:6px;background:#fff;">
            <div style="margin-top:6px;"><button class="btn small" id="shareQrDownload">QR画像を保存</button></div>
          </div>`;
      }
    } catch (e) {
      // オフライン等でQRライブラリを読み込めない場合はリンクのみ表示する(致命的ではない)
    }
    const body = `
      <div class="form-row"><label>共有リンク</label><input type="text" id="shareLinkInput" readonly value="${escapeHtml(url)}" style="width:100%;"></div>
      <div style="font-size:12px;color:var(--text-dim);">このリンクを開くと、このツール上でデッキ内容を読み込めます(相手も本ツールを使う必要があります)。「テキストからインポート」画面にこのリンクを貼り付けても読み込めます。QRコードを見せれば、相手が「デッキをインポート」画面から画像として読み込んで取り込むこともできます。</div>
      ${qrImgHtml}
    `;
    Modal.open('共有リンクを発行', body, `<button class="btn" id="shareLinkClose">閉じる</button><button class="btn primary" id="shareLinkCopy">コピー</button>`);
    document.getElementById('shareLinkClose').addEventListener('click', Modal.close);
    document.getElementById('shareLinkCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); toast('コピーしました'); }
      catch {
        const inp = document.getElementById('shareLinkInput');
        inp.select();
        toast('コピーに失敗しました。手動で選択してください', 'err');
      }
    });
    const qrDlBtn = document.getElementById('shareQrDownload');
    if (qrDlBtn) qrDlBtn.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = qrDataUrl; a.download = (d.name || 'deck') + '_qr.png';
      document.body.appendChild(a); a.click(); a.remove();
    });
  });
  document.getElementById('duplicateDeckBtn').addEventListener('click', () => {
    if (!App.workingDeck) return;
    confirmDiscardIfDirty(() => {
      const d = App.workingDeck;
      const copy = JSON.parse(JSON.stringify(d));
      copy.id = uid('deck'); copy.name = d.name + ' のコピー'; copy.createdAt = Date.now(); copy.updatedAt = Date.now();
      App.state.decks.push(copy); persist();
      loadWorkingDeck(copy.id);
      switchView('deck');
      toast('複製しました');
    });
  });
  document.getElementById('saveAsPackageBtn').addEventListener('click', () => {
    const d = App.workingDeck; if (!d) return;
    const p = newPackage(d.name + ' パッケージ');
    p.cards = JSON.parse(JSON.stringify(d.mainCards));
    p.tags = d.tags.slice();
    persist();
    toast('パッケージとして保存しました（「パッケージ」タブで確認できます）');
  });
  document.getElementById('deleteDeckBtn').addEventListener('click', () => {
    const d = App.workingDeck; if (!d) return;
    if (!confirm(`デッキ「${d.name}」を削除しますか？この操作は取り消せません。`)) return;
    App.state.decks = App.state.decks.filter(x => x.id !== d.id);
    if (App.state.activeDeckId === d.id) App.state.activeDeckId = App.state.decks[0]?.id || null;
    persist();
    App.workingDeck = null;
    App.workingDeckDirty = false;
    switchView('decks');
    toast('削除しました');
  });

  // ---- デッキ一覧 ----
  document.getElementById('deckSearchInput').addEventListener('input', debounce(renderDeckManager, 120));
  document.getElementById('deckRegFilter').addEventListener('change', renderDeckManager);
  document.getElementById('createDeckFromManagerBtn').addEventListener('click', () => {
    confirmDiscardIfDirty(() => {
      startNewWorkingDeck('新しいデッキ');
      switchView('deck');
    });
  });
  document.getElementById('importDeckTextBtn').addEventListener('click', openDeckImportModal);
  document.getElementById('importDeckQrBtn').addEventListener('click', openDeckQrImportModal);
  document.getElementById('deckManagerGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'open-deck' || btn.dataset.action === 'open-deck-card') {
      confirmDiscardIfDirty(() => openDeckEditor(id));
    }
    if (btn.dataset.action === 'open-sim') {
      confirmDiscardIfDirty(() => { loadWorkingDeck(id); switchView('sim'); });
    }
    if (btn.dataset.action === 'dup-deck') {
      const d = getDeck(id);
      const copy = JSON.parse(JSON.stringify(d));
      copy.id = uid('deck'); copy.name = d.name + ' のコピー'; copy.createdAt = Date.now(); copy.updatedAt = Date.now();
      App.state.decks.push(copy); persist(); renderDeckManager(); toast('複製しました');
    }
    if (btn.dataset.action === 'del-deck') {
      const d = getDeck(id);
      if (!confirm(`デッキ「${d.name}」を削除しますか？`)) return;
      App.state.decks = App.state.decks.filter(x => x.id !== id);
      if (App.state.activeDeckId === id) App.state.activeDeckId = App.state.decks[0]?.id || null;
      if (App.workingDeck && App.workingDeck.id === id) { App.workingDeck = null; App.workingDeckDirty = false; }
      persist(); renderDeckManager(); toast('削除しました');
    }
  });

  // ---- パッケージ一覧 ----
  document.getElementById('packageSearchInput').addEventListener('input', debounce(renderPackageManager, 120));
  document.getElementById('createPackageBtn').addEventListener('click', () => openPackageEditor(null));
  document.getElementById('importPackageTextBtn').addEventListener('click', openPackageTextImportModal);
  document.getElementById('importPackageQrBtn').addEventListener('click', openPackageQrImportModal);
  document.getElementById('packageManagerGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'edit-package' || btn.dataset.action === 'edit-package-card') openPackageEditor(id);
    if (btn.dataset.action === 'del-package') {
      const p = getPackage(id);
      if (!confirm(`パッケージ「${p.name}」を削除しますか？`)) return;
      App.state.packages = App.state.packages.filter(x => x.id !== id);
      persist(); renderPackageManager(); toast('削除しました');
    }
  });

  // ---- データ管理 ----
  wireDropzone('importDropzone', 'importFileInput', handleImportFile);
  wireDropzone('restoreDropzone', 'restoreFileInput', restoreBackup);
  document.getElementById('exportBackupBtn').addEventListener('click', exportBackup);
  document.getElementById('exportImageManifestBtn').addEventListener('click', exportImageManifest);
  document.getElementById('manualAddCardBtn').addEventListener('click', () => openCardEditForm(null));
  const manualResults = document.createElement('div');
  manualResults.id = 'manualCardResults';
  manualResults.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:220px;overflow-y:auto;';
  document.getElementById('manualCardSearch').insertAdjacentElement('afterend', manualResults);
  document.getElementById('manualCardSearch').addEventListener('input', debounce((e) => {
    const q = e.target.value.trim().toLowerCase();
    const results = q ? App.allCards.filter(c => searchableText(c).includes(q)).slice(0, 30) : [];
    manualResults.innerHTML = results.map(c => `<div class="mini-row"><span class="n">[${c.type}] ${escapeHtml(c.name)}</span>
        <button class="btn small" data-id="${c.id}">編集</button></div>`).join('');
  }, 150));
  manualResults.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (btn) openCardEditForm(btn.dataset.id);
  });
  document.getElementById('addRegulationBtn').addEventListener('click', openRegulationForm);
  document.getElementById('regulationManagerList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="del-regulation"]');
    if (!btn) return;
    App.state.regulations = App.state.regulations.filter(r => r.id !== btn.dataset.id);
    persist(); renderDataView();
  });
  document.getElementById('resetAllBtn').addEventListener('click', () => {
    if (!confirm('すべてのデッキ・パッケージ・追加カードデータを削除します。よろしいですか？この操作は取り消せません。')) return;
    if (!confirm('本当に初期化しますか？（最終確認）')) return;
    App.state = Store.defaults();
    App.workingDeck = null; App.workingDeckDirty = false;
    persist(); rebuildCardIndex(); refreshAll();
    toast('初期化しました');
  });

  // ---- モーダル共通 ----
  document.getElementById('modalClose').addEventListener('click', Modal.close);
  document.getElementById('modalBackdrop').addEventListener('click', (e) => { if (e.target.id === 'modalBackdrop') Modal.close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') Modal.close(); });
  document.getElementById('modalBox').addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (action === 'detail') { openCardDetail(actionEl.dataset.cardId); return; }
    if (action === 'edit-card') { openCardEditForm(actionEl.dataset.id); return; }
    if (action === 'inc' || action === 'dec') {
      const deck = activeDeck();
      if (!deck) { toast('先にデッキを作成・選択してください', 'err'); return; }
      const zone = actionEl.dataset.zone || App.addZone;
      deckAddCard(deck, actionEl.dataset.cardId, zone, action === 'inc' ? 1 : -1);
      // 同じカードの詳細を枚数変更後に再描画する。呼び出し元モーダルへの「戻る」ボタンが出ていた場合は、
      // その状態(Modal.detailOnBack)を引き継いで再描画後も消えないようにする。
      openCardDetail(actionEl.dataset.cardId, Modal.detailOnBack);
      if (App.currentView === 'deck') { renderDeckEditor(); } else { renderCardContainer(); renderDeckSidePanel(); }
    }
  });
}

function wireDropzone(zoneId, inputId, handler) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) handler(input.files[0]); input.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handler(f); });
}

