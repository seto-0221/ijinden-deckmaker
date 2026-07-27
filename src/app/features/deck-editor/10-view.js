/* ========================= 7b. デッキ編集タブ ========================= */
function renderRegulationSelect(selectEl, selectedId) {
  selectEl.innerHTML = allRegulations().map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  selectEl.value = selectedId;
}

// 戦略分類のselectをDECK_STRATEGIESマスタから生成する。
// 保存済みデッキが未知のid(将来マスタから削除された候補など)を持つ場合は「その他」表記の選択肢として
// 表示するだけで、ユーザーが明示的に選び直すまでデータのidは書き換えない。
function renderStrategySelect(selectEl, selectedId) {
  let html = `<option value="">未設定</option>` +
    DECK_STRATEGIES.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  if (selectedId && !DECK_STRATEGIES.some(s => s.id === selectedId)) {
    html += `<option value="${escapeHtml(selectedId)}">その他</option>`;
  }
  selectEl.innerHTML = html;
  selectEl.value = selectedId || '';
}

// 使用色チップ(読み取り専用)。保存はせず、表示のたびにcomputeDeckColorsで算出する。
function renderDeckColorsRow(deck) {
  const el = document.getElementById('deckColorsRow');
  if (!el) return;
  const { main, touch } = computeDeckColors(deck, getCard);
  if (!main.length && !touch.length) {
    el.innerHTML = `<span style="color:var(--text-faint);">メインデッキにカードを追加すると表示されます</span>`;
    return;
  }
  const chip = (col, isTouch) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;">
       <span class="color-dot c-${col}"></span>${col === '無' ? '無色' : col}${isTouch ? '<span style="color:var(--text-faint);">(タッチ)</span>' : ''}
     </span>`;
  el.innerHTML = main.map(c => chip(c, false)).join('') + touch.map(c => chip(c, true)).join('');
}

function formatDeckDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function renderDeckTimestamps(deck) {
  const el = document.getElementById('deckTimestamps');
  if (!el) return;
  el.textContent = `作成: ${formatDeckDate(deck.createdAt)} ／ 更新: ${formatDeckDate(deck.updatedAt)}`;
}

function renderDeckEditor() {
  const deck = App.workingDeck;
  const emptyEl = document.getElementById('deckEditorEmpty');
  const mainEl = document.getElementById('deckEditorMain');
  const sideEl = document.getElementById('deckEditorSide');
  updateSaveStatusBadge();
  if (!deck) {
    emptyEl.classList.remove('hidden');
    mainEl.classList.add('hidden');
    sideEl.classList.add('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  mainEl.classList.remove('hidden');
  sideEl.classList.remove('hidden');

  ensureDeckMeta(deck);
  document.getElementById('deckName').value = deck.name;
  renderRegulationSelect(document.getElementById('deckRegulation'), deck.regulationId);
  document.getElementById('deckMemo').value = deck.memo;
  document.getElementById('deckTypeInput').value = deck.deckType;
  document.getElementById('deckDescription').value = deck.description;
  renderStrategySelect(document.getElementById('deckStrategy'), deck.strategy);
  renderDeckColorsRow(deck);
  renderDeckTimestamps(deck);
  renderTagChips(deck);
  document.getElementById('deckThumbPreview').innerHTML = deckThumbHtml(deck);
  document.querySelectorAll('#deckViewModeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === App.deckViewMode));
  document.getElementById('deckSortField').value = App.deckSort.field;
  document.getElementById('deckSortDirBtn').textContent = App.deckSort.dir === 'desc' ? '▼降順' : '▲昇順';

  const reg = getRegulation(deck.regulationId);
  document.getElementById('leaderZoneWrap').classList.toggle('hidden', !reg.hasLeaderZone);
  if (reg.hasLeaderZone) renderLeaderTrumpZones(deck, reg);

  renderDeckCardList('deckMainList', deck.mainCards, deck, 'main');
  document.getElementById('deckSideZoneList').parentElement.style.display = ''; // section-title
  if (reg.sideMax === 0) {
    document.getElementById('deckSideZoneList').innerHTML = `<div class="empty-state" style="padding:16px;">このレギュレーションはサイドデッキ非対応です</div>`;
  } else {
    renderDeckCardList('deckSideZoneList', deck.sideCards, deck, 'side');
  }

  renderDeckStats(deck);
  renderValidation(deck);
  renderSideboardStatus(deck);
}

// メイン/サイドのカードリストを cardId->qty のマップにする(順序に依存しない比較のため)
function cardListToMap(list) {
  const m = new Map();
  for (const e of (list || [])) m.set(e.cardId, (m.get(e.cardId) || 0) + e.qty);
  return m;
}
function cardMapsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) { if (b.get(k) !== v) return false; }
  return true;
}
// 「デフォルト構成(サイドチェンジ前の基準)」の設定・復元・状態表示。
// デフォルトはdeck.defaultMainCards/defaultSideCardsに保存し、統計・検証・シミュレーションは
// 常に現在のdeck.mainCards/sideCardsを見るだけなので、サイドチェンジ後の結果は自動的に反映される。
function renderSideboardStatus(deck) {
  const el = document.getElementById('sideboardStatus');
  if (!el) return;
  if (!deck.defaultMainCards) {
    el.textContent = 'デフォルト構成は未設定です(サイドチェンジ前の状態を保存しておくと、ワンボタンで戻せます)';
    return;
  }
  const same = cardMapsEqual(cardListToMap(deck.mainCards), cardListToMap(deck.defaultMainCards)) &&
    cardMapsEqual(cardListToMap(deck.sideCards), cardListToMap(deck.defaultSideCards));
  el.innerHTML = same
    ? '✓ デフォルト構成と一致しています'
    : '<span style="color:var(--warn);">● サイドチェンジ中です(デフォルト構成と異なります)</span>';
}

// 統領・切り札の1枚をグリッド表示用タイル(card-tile)として描画する。
// メイン/サイドのdeckCardGridTileHtmlと見た目を揃えつつ、操作は「外す」ボタンのみにする。
function leaderCardGridTileHtml(c) {
  const dots = c.colors.map(col => `<span class="color-dot c-${col}"></span>`).join('');
  return `<div class="card-tile" data-card-id="${c.id}">
      <div class="thumb" data-action="detail" data-card-id="${c.id}">${cardThumbHtml(c)}</div>
      <div class="meta">
        <div class="name">${escapeHtml(c.name)}</div>
        <div class="stats"><span class="type-badge type-${c.type}">${TYPE_SHORT[c.type] || c.type}</span>${dots}<span>${cardStatLine(c)}</span></div>
      </div>
      <div class="qty-row">
        <button class="qty-btn del-btn" style="flex:1;width:auto;" data-action="removeleader" data-card-id="${c.id}">外す</button>
      </div>
    </div>`;
}
// 切り札の1枚をグリッド表示用タイルとして描画する。枚数の増減はメイン/サイドと同じqty-btn+qty-num構成。
function trumpCardGridTileHtml(c, qty, max) {
  const dots = c.colors.map(col => `<span class="color-dot c-${col}"></span>`).join('');
  return `<div class="card-tile" data-card-id="${c.id}">
      <div class="thumb" data-action="detail" data-card-id="${c.id}">${cardThumbHtml(c)}</div>
      <div class="meta">
        <div class="name">${escapeHtml(c.name)}</div>
        <div class="stats"><span class="type-badge type-${c.type}">${TYPE_SHORT[c.type] || c.type}</span>${dots}<span>${cardStatLine(c)}</span></div>
      </div>
      <div class="qty-row">
        <button class="qty-btn" data-action="trumpdec">−</button>
        <input type="number" class="qty-num" inputmode="numeric" min="0" max="${max}" data-action="trumpset" value="${qty}">
        <button class="qty-btn" data-action="trumpinc">＋</button>
      </div>
    </div>`;
}
function renderLeaderTrumpZones(deck, reg) {
  ensureLeaderFields(deck);
  // メイン/サイドと同じApp.deckViewMode(list/grid)を統領・切り札の表示にも適用する
  const gridMode = App.deckViewMode === 'grid';
  const leaderEl = document.getElementById('deckLeaderList');
  leaderEl.className = 'deck-list-group panel ' + (gridMode ? 'card-grid' : '');
  const leaderCards = deck.leaderCards.map(id => getCard(id)).filter(Boolean);
  if (!leaderCards.length) {
    leaderEl.innerHTML = `<div class="empty-state" style="padding:14px;">統領イジンが選択されていません（${reg.leaderMinCount || 1}〜${reg.leaderMaxCount || 2}枚）</div>`;
  } else if (gridMode) {
    leaderEl.innerHTML = leaderCards.map(c => leaderCardGridTileHtml(c)).join('');
  } else {
    leaderEl.innerHTML = leaderCards.map(c => `
      <div class="deck-card-row">
        <div class="thumb-xs" data-action="detail" data-card-id="${c.id}">${cardThumbHtml(c)}</div>
        <span class="name">${escapeHtml(c.name)}</span>
        <span class="cost">${cardStatLine(c)}</span>
        <button class="btn small danger" data-action="removeleader" data-card-id="${c.id}">外す</button>
      </div>`).join('');
  }
  const addBtn = document.getElementById('addLeaderBtn');
  addBtn.disabled = leaderCards.length >= (reg.leaderMaxCount || 2);
  addBtn.style.opacity = addBtn.disabled ? '0.5' : '';

  const trumpEl = document.getElementById('deckTrumpList');
  trumpEl.className = 'deck-list-group panel ' + (gridMode ? 'card-grid' : '');
  const trumpCard = deck.trumpCard ? getCard(deck.trumpCard) : null;
  const trumpMax = reg.trumpMaxCopies || 2;
  if (!trumpCard) {
    trumpEl.innerHTML = `<div class="empty-state" style="padding:14px;">切り札が選択されていません（マホウ1種類、${trumpMax}枚まで）</div>`;
  } else if (gridMode) {
    trumpEl.innerHTML = trumpCardGridTileHtml(trumpCard, deck.trumpQty, trumpMax);
  } else {
    trumpEl.innerHTML = `
      <div class="deck-card-row">
        <div class="thumb-xs" data-action="detail" data-card-id="${trumpCard.id}">${cardThumbHtml(trumpCard)}</div>
        <span class="name">${escapeHtml(trumpCard.name)}</span>
        <span class="cost">${cardStatLine(trumpCard)}</span>
        <div class="qty-row" style="border:none;padding:0;">
          <button class="qty-btn" data-action="trumpdec">−</button>
          <input type="number" class="qty-num" inputmode="numeric" min="0" max="${trumpMax}" data-action="trumpset" value="${deck.trumpQty}">
          <button class="qty-btn" data-action="trumpinc">＋</button>
        </div>
      </div>`;
  }
}

function renderTagChips(deck) {
  const row = document.getElementById('deckTagRow');
  const input = document.getElementById('deckTagInput');
  row.querySelectorAll('.tag-pill').forEach(el => el.remove());
  for (const tag of deck.tags) {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `${escapeHtml(tag)}<button data-tag="${escapeHtml(tag)}">✕</button>`;
    row.insertBefore(pill, input);
  }
}

function deckCardGridTileHtml(c, qty, zone) {
  const dots = c.colors.map(col => `<span class="color-dot c-${col}"></span>`).join('');
  const badge = qty > 0 ? `<div class="qty-badge"><span class="qty-badge-part">${qty}</span></div>` : '';
  return `<div class="card-tile" data-card-id="${c.id}">
      ${badge}
      <div class="thumb" data-action="detail" data-card-id="${c.id}">${cardThumbHtml(c)}</div>
      <div class="meta">
        <div class="name">${escapeHtml(c.name)}</div>
        <div class="stats"><span class="type-badge type-${c.type}">${TYPE_SHORT[c.type] || c.type}</span>${dots}<span>${cardStatLine(c)}</span></div>
      </div>
      <div class="qty-row">
        <button class="qty-btn" data-action="deckdec" data-card-id="${c.id}" data-zone="${zone}">−</button>
        <input type="number" class="qty-num" inputmode="numeric" min="0" data-action="deckset" data-card-id="${c.id}" data-zone="${zone}" value="${qty}">
        <button class="qty-btn" data-action="deckinc" data-card-id="${c.id}" data-zone="${zone}">＋</button>
        <button class="qty-btn move-btn" data-action="movezone" data-card-id="${c.id}" data-zone="${zone}" title="${zone === 'side' ? 'メインへ1枚移動' : 'サイドへ1枚移動'}">${zone === 'side' ? '⬆' : '⬇'}</button>
        <button class="qty-btn del-btn" data-action="deckdel" data-card-id="${c.id}" data-zone="${zone}" title="デッキから削除">🗑</button>
      </div>
    </div>`;
}

// メイン/サイドのカードリスト表示順を、App.deckSort(field/dir)に従って決めるための比較関数。
// { c: card|null, e: entry }のペア同士を比較する。名前を常に最終タイブレークに使い、表示順を安定させる。
function deckCardSortComparator(a, b) {
  const sort = App.deckSort || { field: 'name', dir: 'asc' };
  const dirMul = sort.dir === 'desc' ? -1 : 1;
  const nameOf = (x) => (x.c ? x.c.name : '');
  const nameCmp = () => nameOf(a).localeCompare(nameOf(b), 'ja');
  let cmp = 0;
  switch (sort.field) {
    case 'color': {
      const idxOf = (x) => {
        const col = x.c && x.c.colors && x.c.colors[0];
        const i = COLORS.indexOf(col);
        return i === -1 ? COLORS.length : i;
      };
      cmp = idxOf(a) - idxOf(b);
      break;
    }
    case 'level': {
      const lvOf = (x) => (x.c && x.c.level != null ? x.c.level : -1);
      cmp = lvOf(a) - lvOf(b);
      break;
    }
    case 'qty': {
      cmp = (a.e.qty || 0) - (b.e.qty || 0);
      break;
    }
    case 'rarity': {
      const idxOf = (x) => {
        const i = RARITIES.indexOf(x.c ? x.c.rarity : undefined);
        return i === -1 ? RARITIES.length : i;
      };
      cmp = idxOf(a) - idxOf(b);
      break;
    }
    case 'name':
    default:
      cmp = 0;
      break;
  }
  if (cmp !== 0) return cmp * dirMul;
  // 同値、またはname指定の場合は名前で比較(nameのみdirMulを適用し、他フィールドは常に名前昇順でタイブレーク)
  const nc = nameCmp();
  return sort.field === 'name' ? nc * dirMul : nc;
}

function renderDeckCardList(containerId, list, deck, zone) {
  const el = document.getElementById(containerId);
  const gridMode = App.deckViewMode === 'grid';
  el.className = 'deck-list-group panel ' + (gridMode ? 'card-grid' : '');
  if (!list.length) {
    el.innerHTML = `<button type="button" class="empty-state" data-action="empty-open-search" data-zone="${zone}" style="padding:20px;width:100%;border:none;background:transparent;cursor:pointer;font:inherit;color:inherit;"><div class="big">➕</div>タップしてカードを検索・追加してください</button>`;
    return;
  }
  const grouped = {};
  for (const e of list) {
    const c = getCard(e.cardId);
    const type = c ? c.type : '不明';
    (grouped[type] = grouped[type] || []).push({ c, e });
  }
  let html = '';
  // 種類ごとにCARD_TYPES本来の並び順でグループ化する(種類は元々見出しで区別されているため、ソート対象には含めない)
  for (const type of CARD_TYPES.concat(['不明'])) {
    if (!grouped[type]) continue;
    grouped[type].sort(deckCardSortComparator);
    if (!gridMode) {
      html += `<div style="font-size:11px;font-weight:800;color:var(--text-faint);padding:4px 4px 2px;">${type} (${deckTotalQty(grouped[type].map(x => x.e))}枚)</div>`;
    }
    for (const { c, e } of grouped[type]) {
      if (!c) {
        html += gridMode ? '' : `<div class="deck-card-row"><span class="name">(未登録: ${e.cardId})</span></div>`;
        continue;
      }
      if (gridMode) {
        html += deckCardGridTileHtml(c, e.qty, zone);
      } else {
        html += `<div class="deck-card-row">
            <div class="thumb-xs" data-action="detail" data-card-id="${e.cardId}">${cardThumbHtml(c)}</div>
            <span class="name">${escapeHtml(c.name)}</span>
            <span class="cost">${cardStatLine(c)}</span>
            <div class="qty-row" style="border:none;padding:0;">
              <button class="qty-btn" data-action="deckdec" data-card-id="${e.cardId}" data-zone="${zone}">−</button>
              <input type="number" class="qty-num" inputmode="numeric" min="0" data-action="deckset" data-card-id="${e.cardId}" data-zone="${zone}" value="${e.qty}">
              <button class="qty-btn" data-action="deckinc" data-card-id="${e.cardId}" data-zone="${zone}">＋</button>
              <button class="qty-btn move-btn" data-action="movezone" data-card-id="${e.cardId}" data-zone="${zone}" title="${zone === 'side' ? 'メインへ1枚移動' : 'サイドへ1枚移動'}">${zone === 'side' ? '⬆' : '⬇'}</button>
              <button class="qty-btn del-btn" data-action="deckdel" data-card-id="${e.cardId}" data-zone="${zone}" title="デッキから削除">🗑</button>
            </div>
          </div>`;
      }
    }
  }
  el.innerHTML = html;
}

// レベルカーブ用: レベルごとに「色ごとの枚数」を集計する(マリョクは除く。代表色はcolors[0]、無色は'無'扱い)。
function computeLevelColorBreakdown(deck) {
  const byLevel = new Map(); // level -> Map(color -> qty)
  for (const e of deck.mainCards) {
    const c = getCard(e.cardId);
    if (!c || c.type === 'マリョク') continue;
    const levelKey = c.level != null ? c.level : '?';
    const color = (c.colors && c.colors[0]) || '無';
    if (!byLevel.has(levelKey)) byLevel.set(levelKey, new Map());
    const colorMap = byLevel.get(levelKey);
    colorMap.set(color, (colorMap.get(color) || 0) + e.qty);
  }
  return byLevel;
}
// レベルカーブの棒グラフHTMLを組み立てる。各レベルの棒は、そのレベルの色構成に応じて色分けして積み上げる。
function levelCurveHtml(byLevel) {
  const entries = Array.from(byLevel.entries()).sort((a, b) => {
    if (a[0] === '?') return 1;
    if (b[0] === '?') return -1;
    return (Number(a[0]) || 0) - (Number(b[0]) || 0);
  });
  if (!entries.length) return `<div class="empty-state" style="padding:8px;font-size:12px;">データなし</div>`;
  const totals = entries.map(([, colorMap]) => Array.from(colorMap.values()).reduce((a, b) => a + b, 0));
  const maxV = Math.max(1, ...totals);
  return entries.map(([k, colorMap], i) => {
    const total = totals[i];
    const heightPct = Math.max(1, Math.round(total / maxV * 100));
    const segs = COLORS.filter(col => colorMap.get(col)).map(col => {
      const qty = colorMap.get(col);
      const segPct = Math.round(qty / total * 100);
      return `<div style="width:100%;height:${segPct}%;background:var(--c-${col});" title="Lv${k} ${col === '無' ? '無色' : col}: ${qty}枚"></div>`;
    }).join('');
    return `<div class="bar-col"><div class="bar" style="height:${heightPct}%;display:flex;flex-direction:column-reverse;overflow:hidden;background:transparent;" title="Lv${k}: ${total}枚">${segs}</div><div class="bar-label">${k}</div></div>`;
  }).join('');
}

function renderDeckStats(deck) {
  ensureLeaderFields(deck);
  const stats = computeDeckStats(deck);
  const numsEl = document.getElementById('statNums');
  const mainTotal = deckTotalQty(deck.mainCards);
  const sideTotal = deckTotalQty(deck.sideCards);
  const uniqueCount = new Set(deck.mainCards.map(e => e.cardId)).size;
  const reg = getRegulation(deck.regulationId);
  let extraStat = '';
  if (reg.hasLeaderZone) {
    const leaderCount = deck.leaderCards.length;
    const trumpCount = deck.trumpCard ? (deck.trumpQty || 1) : 0;
    const grandTotal = mainTotal + leaderCount + trumpCount;
    extraStat = `<div class="stat-num"><div class="v">${grandTotal}</div><div class="l">統領+切り札+メイン</div></div>`;
  }
  numsEl.innerHTML = `
    <div class="stat-num"><div class="v">${mainTotal}</div><div class="l">メイン</div></div>
    <div class="stat-num"><div class="v">${sideTotal}</div><div class="l">サイド</div></div>
    <div class="stat-num"><div class="v">${uniqueCount}</div><div class="l">カード種</div></div>
    <div class="stat-num"><div class="v">${stats.avgLevel != null ? stats.avgLevel : '-'}</div><div class="l">平均Lv(マリョク込)</div></div>
    ${extraStat}`;

  // デッキサムネ横のミニ統計(常時見える位置に主要な枚数だけ抜粋して表示する)
  const miniNumsEl = document.getElementById('statNumsMini');
  if (miniNumsEl) {
    miniNumsEl.innerHTML = `
      <div class="stat-num" style="padding:5px 3px;"><div class="v" style="font-size:16px;">${mainTotal}</div><div class="l">メイン</div></div>
      <div class="stat-num" style="padding:5px 3px;"><div class="v" style="font-size:16px;">${sideTotal}</div><div class="l">サイド</div></div>
      <div class="stat-num" style="padding:5px 3px;"><div class="v" style="font-size:16px;">${uniqueCount}</div><div class="l">カード種</div></div>`;
  }

  const costEl = document.getElementById('costCurve');
  const costHtml = levelCurveHtml(computeLevelColorBreakdown(deck));
  costEl.innerHTML = costHtml;
  const miniCostEl = document.getElementById('costCurveMini');
  if (miniCostEl) miniCostEl.innerHTML = costHtml;

  const colorEl = document.getElementById('colorDist');
  const colorTotal = Math.max(1, Array.from(stats.byColor.values()).reduce((a, b) => a + b, 0));
  colorEl.innerHTML = COLORS.filter(c => stats.byColor.get(c)).map(c => {
    const v = stats.byColor.get(c) || 0;
    return `<div class="dist-row"><span class="color-dot c-${c}"></span><span style="width:28px;">${c === '無' ? '無色' : c}</span>
        <div class="track"><div class="fill" style="width:${Math.round(v / colorTotal * 100)}%;background:var(--c-${c});"></div></div><span>${v}</span></div>`;
  }).join('') || `<div class="empty-state" style="padding:8px;font-size:12px;">データなし</div>`;

  const typeEl = document.getElementById('typeDist');
  const typeTotal = Math.max(1, Array.from(stats.byType.values()).reduce((a, b) => a + b, 0));
  typeEl.innerHTML = CARD_TYPES.filter(t => stats.byType.get(t)).map(t => {
    const v = stats.byType.get(t) || 0;
    return `<div class="dist-row"><span class="type-badge type-${t}">${TYPE_SHORT[t]}</span><span style="width:44px;">${t}</span>
        <div class="track"><div class="fill" style="width:${Math.round(v / typeTotal * 100)}%;background:var(--accent);"></div></div><span>${v}</span></div>`;
  }).join('') || `<div class="empty-state" style="padding:8px;font-size:12px;">データなし</div>`;
}

function renderValidation(deck) {
  const { messages } = validateDeck(deck);
  document.getElementById('validationList').innerHTML = messages.map(m =>
    `<div class="validation-item ${m.level}">${m.level === 'ok' ? '✓' : m.level === 'err' ? '✕' : '!'} ${escapeHtml(m.text)}</div>`
  ).join('');
}

function openDeckEditor(deckId) {
  if (!App.workingDeck || App.workingDeck.id !== deckId) loadWorkingDeck(deckId);
  switchView('deck');
}


