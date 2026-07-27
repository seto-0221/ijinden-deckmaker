/* ========================= 7e. 初動シミュレーション画面 ========================= */
function renderSimView() {
  const deck = App.workingDeck;
  const label = document.getElementById('simDeckNameLabel');
  if (!deck) { label.textContent = 'デッキが選択されていません'; return; }
  label.textContent = deck.name;
  const sim = App.state.settings.sim;
  document.getElementById('simHandSize').value = sim.handSize;
  document.getElementById('simSecondDraw').value = sim.secondDraw;
  document.getElementById('simTrials').value = sim.trials;
  document.getElementById('simMulligan').checked = sim.mulligan;
  document.getElementById('simMainHieroToggle').checked = !!sim.useHierosgamos;
  document.getElementById('simMeta').textContent = `メインデッキ ${deckTotalQty(deck.mainCards)}枚を対象に計算します`;
  renderSimStarterList();
  document.getElementById('simStarterResults').innerHTML = `<div class="empty-state" style="padding:14px;">「シミュレーション実行」を押すと結果が表示されます</div>`;
  document.getElementById('simLevelMatrix').innerHTML = '';
}

function renderSimStarterList() {
  const deck = App.workingDeck;
  if (!deck) return;
  const starters = ensureSimStarters(deck);
  const wrap = document.getElementById('simStarterList');
  if (!starters.length) {
    wrap.innerHTML = `<div class="empty-state" style="padding:14px;">初動札グループがまだありません。「＋ 追加」から作成してください。</div>`;
    populateComboProgressSelect();
    runAndRenderComboProgress();
    return;
  }
  wrap.innerHTML = starters.map(s => {
    let detail;
    if (s.type === 'custom') {
      detail = (s.comboCards || []).map(e => {
        const c = getCard(e.cardId);
        return `${c ? escapeHtml(c.name) : e.cardId}×${e.qty}`;
      }).join(' + ') || '(カード未設定)';
    } else if (s.type === 'anyN') {
      const names = (s.cardIds || []).map(id => {
        const c = getCard(id);
        return c ? escapeHtml(c.name) : id;
      }).join(' / ') || '(カード未設定)';
      detail = `${names}　のうち合計${s.needCount || 1}枚`;
    } else if (s.type === 'anyOfGroups') {
      const names = (s.groupStarterIds || []).map(id => {
        const t = starters.find(x => x.id === id);
        return t ? escapeHtml(t.name) : '(削除済み)';
      }).join(' / ') || '(未選択)';
      detail = `${names}　のいずれかが成立`;
    } else {
      detail = (s.cardIds || []).map(id => {
        const c = getCard(id);
        return c ? escapeHtml(c.name) : id;
      }).join(' / ') || '(カード未設定)';
    }
    const typeLabel = s.type === 'custom' ? 'カスタムセット' : s.type === 'anyN' ? 'N枚(組み合わせ自由)' : s.type === 'anyOfGroups' ? 'グループ化(いずれか)' : '通常(色・レベル判定)';
    return `<div class="item-card" style="box-shadow:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div class="title">${escapeHtml(s.name)} <span class="badge neutral" style="font-size:10px;">${typeLabel}</span></div>
          <div class="row-actions">
            <button class="btn small" data-action="edit-sim-starter" data-id="${s.id}">編集</button>
            <button class="btn small danger" data-action="del-sim-starter" data-id="${s.id}">削除</button>
          </div>
        </div>
        <div class="sub" style="font-size:12px;color:var(--text-dim);">${detail}</div>
      </div>`;
  }).join('');
  populateComboProgressSelect();
  runAndRenderComboProgress();
}

// カスタム型初動札グループ用の「ターン推移グラフ」のプルダウンを、現在のカスタム型グループ一覧で埋める
function populateComboProgressSelect() {
  const deck = App.workingDeck;
  const sel = document.getElementById('comboProgressStarterSelect');
  if (!sel) return;
  if (!deck) { sel.innerHTML = ''; sel.disabled = true; return; }
  const customStarters = ensureSimStarters(deck).filter(s => s.type === 'custom');
  if (!customStarters.length) {
    sel.innerHTML = `<option value="">(カスタム型の初動札グループがありません)</option>`;
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  const keepId = App.comboProgressStarterId;
  sel.innerHTML = customStarters.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (keepId && customStarters.some(s => s.id === keepId)) sel.value = keepId;
  App.comboProgressStarterId = sel.value;
}

// 選択中のカスタム型初動札グループについて、ターン推移シミュレーションを実行してグラフを再描画する
function runAndRenderComboProgress() {
  const deck = App.workingDeck;
  const wrap = document.getElementById('comboProgressChart');
  if (!wrap) return;
  if (!deck) { wrap.innerHTML = ''; return; }
  const customStarters = ensureSimStarters(deck).filter(s => s.type === 'custom');
  if (!customStarters.length) {
    wrap.innerHTML = `<div class="empty-state" style="padding:14px;">カスタム型の初動札グループを1つ以上作成すると、ここにターン別の成立率が表示されます</div>`;
    App.lastComboProgressResult = null;
    return;
  }
  const sel = document.getElementById('comboProgressStarterSelect');
  const starter = customStarters.find(s => s.id === sel.value) || customStarters[0];
  if (!starter) { wrap.innerHTML = ''; App.lastComboProgressResult = null; return; }
  const useHiero = document.getElementById('hieroToggle').checked;
  const sim = App.state.settings.sim;
  if (deckTotalQty(deck.mainCards) < (sim.handSize || 6)) {
    wrap.innerHTML = `<div class="empty-state" style="padding:14px;">メインデッキの枚数が手札枚数より少ないため計算できません</div>`;
    App.lastComboProgressResult = null;
    return;
  }
  const result = runComboProgressSimulation(deck, starter, {
    handSize: sim.handSize, secondDraw: sim.secondDraw, trials: Math.min(sim.trials || 8000, 8000), maxTurns: 6, useHierosgamos: useHiero,
  });
  App.lastComboProgressResult = result;
  App.comboProgressPhase = App.comboProgressPhase || 'first';
  document.querySelectorAll('#comboProgressTabSeg button').forEach(b => b.classList.toggle('on', b.dataset.phase === App.comboProgressPhase));
  renderComboProgressChart(result, App.comboProgressPhase);
}

function renderComboProgressChart(result, phase) {
  const wrap = document.getElementById('comboProgressChart');
  if (!wrap) return;
  if (!result) { wrap.innerHTML = ''; return; }
  const series = result[phase];
  const withEnabled = !!series.with;
  const hieroNote = !result.hasHierosgamos
    ? `<div style="font-size:11px;color:var(--text-dim);margin-top:6px;">※このデッキにはヒエロスガモスが入っていないため、チェックを入れても結果は変わりません</div>`
    : (withEnabled ? `<div style="font-size:11px;color:var(--text-dim);margin-top:6px;">※「ヒエロ活用時」は、1ターン目の手札にヒエロスガモスがあれば出したものとして、2ドロー+コンボに無関係なカードから2枚墓地に置いた場合の成立率です</div>` : '');
  wrap.innerHTML = result.turns.map((t, i) => `
      <div style="margin-bottom:10px;">
        <div style="font-size:11.5px;color:var(--text-dim);margin-bottom:2px;">ターン${t}まで</div>
        <div class="dist-row"><span style="width:96px;">${withEnabled ? 'そのまま' : '成立率'}</span><div class="track"><div class="fill" style="width:${series.without[i]}%;background:var(--accent);"></div></div><span>${series.without[i]}%</span></div>
        ${withEnabled ? `<div class="dist-row"><span style="width:96px;">ヒエロ活用時</span><div class="track"><div class="fill" style="width:${series.with[i]}%;background:var(--ok);"></div></div><span>${series.with[i]}%</span></div>` : ''}
      </div>
    `).join('') + hieroNote;
}

function openSimStarterEditor(starterId) {
  const deck = App.workingDeck;
  if (!deck) return;
  const starters = ensureSimStarters(deck);
  const editing = starterId ? starters.find(s => s.id === starterId) : null;
  const s = editing || { id: uid('sim'), name: '新しい初動札グループ', type: 'resource', cardIds: [], comboCards: [] };
  const isNew = !editing;

  const cardListHtml = () => {
    if (s.type === 'custom') {
      return (s.comboCards || []).map(e => {
        const c = getCard(e.cardId);
        return `<div class="deck-card-row"><div class="thumb-xs">${c ? cardThumbHtml(c) : ''}</div>
          <span class="name">${c ? escapeHtml(c.name) : e.cardId}</span>
          <div class="qty-row" style="border:none;padding:0;">
            <button class="qty-btn" data-action="simdec" data-card-id="${e.cardId}">−</button><input type="number" class="qty-num" inputmode="numeric" min="0" data-action="simset" data-card-id="${e.cardId}" value="${e.qty}">
            <button class="qty-btn" data-action="siminc" data-card-id="${e.cardId}">＋</button>
          </div></div>`;
      }).join('') || `<div class="empty-state" style="padding:10px;">下の検索でカードを追加してください(全て手札にあるかで判定します)</div>`;
    }
    const emptyMsg = s.type === 'anyN'
      ? '下の検索でカードを追加してください(このプール内のカードが合計で必要枚数あればOK、内訳は自由です)'
      : '下の検索でカードを追加してください(いずれか1枚あればOK)';
    return (s.cardIds || []).map(id => {
      const c = getCard(id);
      return `<div class="deck-card-row"><div class="thumb-xs">${c ? cardThumbHtml(c) : ''}</div>
        <span class="name">${c ? escapeHtml(c.name) : id}</span>
        <button class="btn small danger" data-action="simremove" data-card-id="${id}">削除</button></div>`;
    }).join('') || `<div class="empty-state" style="padding:10px;">${emptyMsg}</div>`;
  };

  // グループ化型の候補: 自分自身と、他のグループ化型(ネスト防止のため1階層のみ)を除いた既存の初動札グループ
  const groupCandidates = () => starters.filter(x => x.id !== s.id && x.type !== 'anyOfGroups');

  const extraFieldsHtml = () => {
    if (s.type === 'anyN') {
      return `<div class="form-row" style="max-width:160px;"><label>合計必要枚数</label><input id="simStNeedCount" type="number" min="1" value="${s.needCount || 1}"></div>`;
    }
    if (s.type === 'anyOfGroups') {
      const candidates = groupCandidates();
      if (!candidates.length) {
        return `<div class="empty-state" style="padding:10px;">グループ化できる初動札グループがまだありません。先に通常・カスタム・N枚のグループを作成してください。</div>`;
      }
      const selected = new Set(s.groupStarterIds || []);
      const typeLabelOf = (t) => t === 'custom' ? 'カスタム' : t === 'anyN' ? 'N枚' : '通常';
      return `
        <div class="form-row"><label>まとめる初動札グループ(いずれか1つ成立でOK)</label></div>
        <div id="simStGroupList" style="display:flex;flex-direction:column;gap:2px;max-height:220px;overflow-y:auto;">
          ${candidates.map(c => `
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:5px 2px;">
              <input type="checkbox" data-group-member="${c.id}" ${selected.has(c.id) ? 'checked' : ''} style="width:auto;">
              ${escapeHtml(c.name)} <span class="badge neutral" style="font-size:10px;">${typeLabelOf(c.type)}</span>
            </label>`).join('')}
        </div>`;
    }
    return '';
  };

  const cardSectionHtml = () => {
    if (s.type === 'anyOfGroups') return '';
    return `
      <div class="form-row"><label>メインデッキのカードから追加(絞り込み可)</label><input id="simStCardSearch" type="search" placeholder="カード名で絞り込み"></div>
      <div id="simStSearchResults" style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;"></div>
      <div class="section-title" style="padding:2px 0;">対象カード</div>
      <div id="simStCardList">${cardListHtml()}</div>
    `;
  };

  const body = `
    <div class="form-row"><label>名前</label><input id="simStName" type="text" value="${escapeHtml(s.name)}"></div>
    <div class="form-row"><label>判定タイプ</label>
      <select id="simStType">
        <option value="resource" ${s.type !== 'custom' && s.type !== 'anyN' && s.type !== 'anyOfGroups' ? 'selected' : ''}>通常(該当色・レベルのマリョク/カルドロンで判定)</option>
        <option value="custom" ${s.type === 'custom' ? 'selected' : ''}>カスタム(指定したカードが全て手札にあるか)</option>
        <option value="anyN" ${s.type === 'anyN' ? 'selected' : ''}>N枚(グループ内のカードがどれでもいいので合計N枚)</option>
        <option value="anyOfGroups" ${s.type === 'anyOfGroups' ? 'selected' : ''}>グループ化(登録済みの初動札のいずれかが成立でOK)</option>
      </select>
    </div>
    <div id="simStExtraFields">${extraFieldsHtml()}</div>
    <div id="simStCardSection">${cardSectionHtml()}</div>
  `;
  const foot = `${!isNew ? `<button class="btn danger" id="simStDelete">削除</button>` : ''}<button class="btn" id="simStClose">キャンセル</button><button class="btn primary" id="simStSave">保存</button>`;
  Modal.open(isNew ? '初動札グループを追加' : '初動札グループを編集', body, foot, { wide: true });

  const refreshList = () => {
    const listEl = document.getElementById('simStCardList');
    if (listEl) listEl.innerHTML = cardListHtml();
  };

  // メインデッキに含まれるカードのみ(重複なし)を候補として返す。既にこのグループに追加済みのカードは除外する。
  const mainDeckCandidateCards = (query) => {
    const seen = new Set();
    const currentIds = new Set(s.type === 'custom' ? (s.comboCards || []).map(x => x.cardId) : (s.cardIds || []));
    const cards = [];
    for (const e of deck.mainCards) {
      if (seen.has(e.cardId) || currentIds.has(e.cardId)) continue;
      seen.add(e.cardId);
      const c = getCard(e.cardId);
      if (c) cards.push(c);
    }
    cards.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    const q = (query || '').trim().toLowerCase();
    return q ? cards.filter(c => searchableText(c).includes(q)) : cards;
  };
  const renderStResults = () => {
    const searchEl = document.getElementById('simStCardSearch');
    const resultsEl = document.getElementById('simStSearchResults');
    if (!searchEl || !resultsEl) return;
    const results = mainDeckCandidateCards(searchEl.value);
    resultsEl.innerHTML = results.length ? results.map(c => `
        <div class="mini-row"><span class="n">[${c.type}] ${escapeHtml(c.name)}</span>
        <button class="btn small" data-action="simaddsearch" data-card-id="${c.id}">追加</button></div>`).join('')
      : `<div class="empty-state" style="padding:8px;font-size:12px;">${deck.mainCards.length ? '該当するカードがメインデッキ内にありません' : 'メインデッキにカードがありません'}</div>`;
  };
  renderStResults();

  // #simStCardSectionはtype切替のたびにinnerHTMLごと差し替わるため、
  // 中の要素(検索欄・結果・対象カードリスト)への直接addEventListenerではなく、
  // 差し替えられない親コンテナへのイベント委任(delegation)でまとめて扱う。
  document.getElementById('simStType').addEventListener('change', (e) => {
    // resource/anyN/anyOfGroupsは同じcardIds配列を共有するので、custom⇔それ以外の切替時のみデータ形を変換する
    const prevType = s.type;
    s.type = e.target.value;
    if (prevType === 'custom' && s.type !== 'custom') {
      s.cardIds = (s.comboCards || []).map(x => x.cardId);
    } else if (prevType !== 'custom' && s.type === 'custom') {
      s.comboCards = (s.cardIds || []).map(id => ({ cardId: id, qty: 1 }));
    }
    document.getElementById('simStExtraFields').innerHTML = extraFieldsHtml();
    document.getElementById('simStCardSection').innerHTML = cardSectionHtml();
    renderStResults();
  });
  document.getElementById('simStCardSection').addEventListener('input', (e) => {
    if (e.target.id === 'simStCardSearch') renderStResults();
  });
  document.getElementById('simStCardSection').addEventListener('click', (e) => {
    const addBtn = e.target.closest('[data-action="simaddsearch"]');
    if (addBtn) {
      const cardId = addBtn.dataset.cardId;
      if (s.type === 'custom') {
        s.comboCards = s.comboCards || [];
        if (!s.comboCards.find(x => x.cardId === cardId)) s.comboCards.push({ cardId, qty: 1 });
      } else {
        s.cardIds = s.cardIds || [];
        if (!s.cardIds.includes(cardId)) s.cardIds.push(cardId);
      }
      refreshList();
      renderStResults();
      return;
    }
    const btn = e.target.closest('#simStCardList [data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'simset') return; // 数字入力欄は下のchangeイベントで処理する
    const cardId = btn.dataset.cardId;
    if (btn.dataset.action === 'simremove') {
      s.cardIds = (s.cardIds || []).filter(id => id !== cardId);
    } else if (btn.dataset.action === 'siminc') {
      const e2 = (s.comboCards || []).find(x => x.cardId === cardId);
      if (e2) e2.qty++;
    } else if (btn.dataset.action === 'simdec') {
      const e2 = (s.comboCards || []).find(x => x.cardId === cardId);
      if (e2) { e2.qty--; if (e2.qty <= 0) s.comboCards = s.comboCards.filter(x => x.cardId !== cardId); }
    }
    refreshList();
    renderStResults();
  });
  document.getElementById('simStCardSection').addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-action="simset"]');
    if (!inp) return;
    const cardId = inp.dataset.cardId;
    const e2 = (s.comboCards || []).find(x => x.cardId === cardId);
    let newVal = Math.max(0, Math.floor(Number(inp.value)) || 0);
    if (e2) {
      e2.qty = newVal;
      if (e2.qty <= 0) s.comboCards = s.comboCards.filter(x => x.cardId !== cardId);
    }
    refreshList();
  });
  document.getElementById('simStClose').addEventListener('click', Modal.close);
  if (!isNew) {
    document.getElementById('simStDelete').addEventListener('click', () => {
      deck.simStarters = starters.filter(x => x.id !== s.id);
      markWorkingDirty();
      Modal.close();
      renderSimStarterList();
      toast('削除しました');
    });
  }
  document.getElementById('simStSave').addEventListener('click', () => {
    s.name = document.getElementById('simStName').value.trim() || s.name;
    s.type = document.getElementById('simStType').value;
    if (s.type === 'anyN') {
      const inp = document.getElementById('simStNeedCount');
      s.needCount = Math.max(1, parseInt(inp ? inp.value : 1, 10) || 1);
    }
    if (s.type === 'anyOfGroups') {
      const checked = Array.from(document.querySelectorAll('#simStGroupList input[data-group-member]:checked')).map(el => el.dataset.groupMember);
      s.groupStarterIds = checked;
      if (!checked.length) {
        toast('まとめる初動札グループを1つ以上選んでください', 'err');
        return;
      }
    }
    if (isNew) starters.push(s);
    markWorkingDirty();
    Modal.close();
    renderSimStarterList();
    toast('保存しました');
  });
}

function renderSimStarterResults(result) {
  const wrap = document.getElementById('simStarterResults');
  if (!result.starterResults.length) {
    wrap.innerHTML = `<div class="empty-state" style="padding:14px;">初動札グループを追加してから実行してください</div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="table-scroll">
    <table style="width:100%;min-width:420px;border-collapse:collapse;font-size:13px;">
      <thead><tr style="text-align:left;color:var(--text-dim);font-size:11.5px;">
        <th style="padding:4px 6px;">初動札グループ</th><th style="padding:4px 6px;">先攻</th><th style="padding:4px 6px;">後攻</th><th style="padding:4px 6px;">合計(平均)</th>
      </tr></thead>
      <tbody>
        ${result.starterResults.map(r => `
          <tr style="border-top:1px solid var(--border);">
            <td style="padding:6px;">${escapeHtml(r.name)}</td>
            <td style="padding:6px;font-weight:700;">${r.first}%</td>
            <td style="padding:6px;font-weight:700;">${r.second}%</td>
            <td style="padding:6px;font-weight:700;color:var(--accent);">${r.both}%</td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>
  `;
}

function renderSimLevelMatrix(result, phase) {
  const wrap = document.getElementById('simLevelMatrix');
  if (!result) { wrap.innerHTML = ''; return; }
  const m = result.levelMatrix[phase] || result.levelMatrix.first;
  const deck = App.workingDeck;
  const hasPixieDust = !!(deck && deck.mainCards.concat(deck.sideCards).some(e => {
    const c = getCard(e.cardId);
    return c && c.name === 'ピクシーダスト';
  }));
  const pixieNote = (hasPixieDust && phase !== 'first')
    ? `<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">※後攻はピクシーダストを引いた場合、発動条件を満たしている前提で+1レベル分を加算して計算しています(引けなければ加算なし)</div>`
    : '';
  const faceDownNote = `<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">※無色Lv1は、手札のカードを1枚裏向きで魔力ゾーンに置けるルールにより、内容によらず常に100%として計算しています</div>`;
  wrap.innerHTML = `
    <div class="table-scroll">
    <table style="width:100%;min-width:360px;border-collapse:collapse;font-size:13px;">
      <thead><tr style="text-align:left;color:var(--text-dim);font-size:11.5px;">
        <th style="padding:4px 6px;">色</th><th style="padding:4px 6px;">Lv1以上</th><th style="padding:4px 6px;">Lv2以上</th><th style="padding:4px 6px;">Lv3以上</th>
      </tr></thead>
      <tbody>
        ${COLORS.map(c => `
          <tr style="border-top:1px solid var(--border);">
            <td style="padding:6px;"><span class="color-dot c-${c}"></span> ${c === '無' ? '無色' : c}</td>
            <td style="padding:6px;">${m[c][1]}%</td>
            <td style="padding:6px;">${m[c][2]}%</td>
            <td style="padding:6px;">${m[c][3]}%</td>
          </tr>`).join('')}
      </tbody>
    </table>
    ${faceDownNote}
    ${pixieNote}
    </div>
  `;
}

function renderPackageManager() {
  const q = document.getElementById('packageSearchInput').value.trim().toLowerCase();
  let pkgs = App.state.packages.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  if (q) pkgs = pkgs.filter(p => (p.name + ' ' + p.tags.join(' ') + ' ' + p.memo).toLowerCase().includes(q));
  document.getElementById('packageManagerCount').textContent = `${pkgs.length}件`;
  const grid = document.getElementById('packageManagerGrid');
  if (!pkgs.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="big">📦</div>パッケージがありません。よく使うカードの組み合わせ(コンボ・型)を登録しておくと、デッキ編集画面から一括で追加できます。</div>`;
    return;
  }
  grid.innerHTML = pkgs.map(p => {
    const total = deckTotalQty(p.cards);
    return `<div class="deck-poster-card" data-action="edit-package-card" data-id="${p.id}">
        <div class="poster-img-wrap">
          ${pkgThumbHtml(p)}
          <div class="poster-name-bar"><div class="poster-name">${escapeHtml(p.name)}</div></div>
        </div>
        <div class="poster-body">
          <div class="poster-sub">${total}枚 ・ ${p.cards.length}種</div>
          <div class="poster-tags">${p.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
          <div class="poster-actions">
            <button class="btn small" data-action="edit-package" data-id="${p.id}">編集</button>
            <button class="btn small danger" data-action="del-package" data-id="${p.id}">削除</button>
          </div>
        </div>
      </div>`;
  }).join('');
}


