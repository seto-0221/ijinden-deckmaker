/* ========================= 7a. カード検索タブ ========================= */
// カード検索画面と同じ絞り込みUIを、モーダル内など別の場所でも使い回せる様にprefix付きで生成する。
// prefixが'f'の場合はブラウズ画面本体の絞り込み(既存ID: fKeyword, fType, ...)になる。
function filterPanelHtml(prefix, opts) {
  opts = opts || {};
  const showSort = opts.sort !== false;
  const showReset = opts.reset !== false;
  // hideType/hideCost/hidePower: 呼び出し元で対象カードの種類が固定されている場合(統領=イジン固定、切り札=マホウ固定など)に、
  // 意味のない絞り込み項目(種類チップ・使わない方のコスト/パワー欄)を非表示にするためのオプション。
  const showType = opts.hideType !== true;
  const showCost = opts.hideCost !== true;
  const showPower = opts.hidePower !== true;
  return `
    <div class="filter-group">
      <label class="title">キーワード</label>
      <input type="search" id="${prefix}Keyword" placeholder="カード名・テキスト・特性で検索(スペース区切りで複数語)">
    </div>
    <div class="filter-group">
      <label class="title">一致条件(キーワード・種類・色・レアリティ)</label>
      <div class="seg" id="${prefix}Mode">
        <button class="on" type="button" data-mode="or">OR(いずれか)</button>
        <button type="button" data-mode="and">AND(すべて)</button>
      </div>
    </div>
    ${showType ? `<div class="filter-group">
      <label class="title">種類</label>
      <div class="chip-row" id="${prefix}Type"></div>
    </div>` : ''}
    <div class="filter-group">
      <label class="title">色</label>
      <div class="chip-row" id="${prefix}Color"></div>
    </div>
    <div class="filter-group">
      <label class="title">レベル</label>
      <div class="range-row"><input type="number" id="${prefix}LevelMin" placeholder="下限" min="0"><span>〜</span><input type="number" id="${prefix}LevelMax" placeholder="上限" min="0"></div>
    </div>
    ${showCost ? `<div class="filter-group">
      <label class="title">コスト(マホウ)</label>
      <div class="range-row"><input type="number" id="${prefix}CostMin" placeholder="下限" min="0"><span>〜</span><input type="number" id="${prefix}CostMax" placeholder="上限" min="0"></div>
    </div>` : ''}
    ${showPower ? `<div class="filter-group">
      <label class="title">パワー(イジン)</label>
      <div class="range-row"><input type="number" id="${prefix}PowerMin" placeholder="下限" min="0" step="500"><span>〜</span><input type="number" id="${prefix}PowerMax" placeholder="上限" min="0" step="500"></div>
    </div>` : ''}
    <div class="filter-group">
      <label class="title">収録弾・収録デッキ</label>
      <select id="${prefix}Set" multiple size="8"></select>
    </div>
    <div class="filter-group">
      <label class="title">レアリティ</label>
      <div class="chip-row" id="${prefix}Rarity"></div>
    </div>
    ${showSort ? `<div class="filter-group">
      <label class="title">並び替え</label>
      <select id="${prefix}Sort">
        <option value="no">No順</option>
        <option value="name">名前順</option>
        <option value="cost">コスト/レベル順</option>
        <option value="power">パワー順</option>
      </select>
    </div>` : ''}
    ${showReset ? `<button class="btn small" id="${prefix}Reset" type="button">絞り込みをリセット</button>` : ''}
  `;
}

// 絞り込みチップ(種類/色/レアリティ)と収録弾セレクトの中身を描画し、チップのクリックにonChangeを紐付ける。
function renderFilterChips(prefix, onChange) {
  prefix = prefix || 'f';
  onChange = onChange || applyFilters;
  // 種類チップ(${prefix}Type)はhideType指定時のfilterPanelHtmlでは描画されないことがあるため、
  // その場合でも色・レアリティ・収録弾は正しく初期化できるよう、ここでは早期returnしない。
  const typeWrap = document.getElementById(`${prefix}Type`);
  if (typeWrap) typeWrap.innerHTML = CARD_TYPES.map(t => `<span class="chip" data-type="${t}">${t}</span>`).join('');
  const colorWrap = document.getElementById(`${prefix}Color`);
  if (!colorWrap) return;
  colorWrap.innerHTML = COLORS.map(c => `<span class="chip" data-color="${c}">${c === '無' ? '無色' : c}</span>`).join('');
  const rarityWrap = document.getElementById(`${prefix}Rarity`);
  const raritiesPresent = Array.from(new Set(App.allCards.map(c => c.rarity).filter(Boolean)));
  const order = RARITIES.concat(raritiesPresent.filter(r => !RARITIES.includes(r)));
  rarityWrap.innerHTML = order.filter(r => raritiesPresent.includes(r)).map(r => `<span class="chip" data-rarity="${r}">${r}</span>`).join('');

  const setSel = document.getElementById(`${prefix}Set`);
  const sourceEntries = new Map(); // source -> representative set number (for sort order)
  for (const c of App.allCards) {
    if (!c.source) continue;
    if (!sourceEntries.has(c.source)) sourceEntries.set(c.source, c.set);
  }
  const sources = Array.from(sourceEntries.keys()).sort((a, b) => {
    const sa = sourceEntries.get(a), sb = sourceEntries.get(b);
    if (sa !== sb) return Number(sa) - Number(sb);
    // 同じ弾内ではブースターを先に、スターター/構築済みデッキを後に
    const aBooster = a.includes('ブースター'), bBooster = b.includes('ブースター');
    if (aBooster !== bBooster) return aBooster ? -1 : 1;
    return a.localeCompare(b, 'ja');
  });
  setSel.innerHTML = sources.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

  document.querySelectorAll(`#${prefix}Type .chip, #${prefix}Color .chip, #${prefix}Rarity .chip`).forEach(chip => {
    chip.addEventListener('click', () => { chip.classList.toggle('on'); onChange(); });
  });
  const modeWrap = document.getElementById(`${prefix}Mode`);
  if (modeWrap) {
    modeWrap.querySelectorAll('button[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        modeWrap.querySelectorAll('button[data-mode]').forEach(b => b.classList.toggle('on', b === btn));
        onChange();
      });
    });
  }
}

// 指定prefixの絞り込みUIの入力欄すべてに、変更時にonChangeを呼ぶイベントを紐付ける(キーワード/範囲入力/収録弾/並び替え)。
// チップのクリックはrenderFilterChips内で紐付け済みなのでここでは扱わない。
function wireFilterInputs(prefix, onChange, opts) {
  opts = opts || {};
  const debounced = debounce(onChange, 150);
  const kw = document.getElementById(`${prefix}Keyword`);
  if (kw) kw.addEventListener('input', debounced);
  ['LevelMin', 'LevelMax', 'CostMin', 'CostMax', 'PowerMin', 'PowerMax'].forEach(suf => {
    const el = document.getElementById(`${prefix}${suf}`);
    if (el) el.addEventListener('input', debounced);
  });
  const setEl = document.getElementById(`${prefix}Set`);
  if (setEl) setEl.addEventListener('change', onChange);
  const sortEl = document.getElementById(`${prefix}Sort`);
  if (sortEl) sortEl.addEventListener('change', onChange);
  const resetEl = document.getElementById(`${prefix}Reset`);
  if (resetEl && opts.reset !== false) {
    resetEl.addEventListener('click', () => {
      if (kw) kw.value = '';
      ['LevelMin', 'LevelMax', 'CostMin', 'CostMax', 'PowerMin', 'PowerMax'].forEach(suf => {
        const el = document.getElementById(`${prefix}${suf}`);
        if (el) el.value = '';
      });
      document.querySelectorAll(`#${prefix}Type .chip, #${prefix}Color .chip, #${prefix}Rarity .chip`).forEach(c => c.classList.remove('on'));
      const modeWrap = document.getElementById(`${prefix}Mode`);
      if (modeWrap) modeWrap.querySelectorAll('button[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === 'or'));
      if (setEl) setEl.selectedIndex = -1;
      if (sortEl) sortEl.value = 'no';
      onChange();
    });
  }
}

function activeDeck() {
  return App.workingDeck;
}

function applyFilters() {
  const f = currentFilters();
  App.filtered = filterCards(App.allCards, f);
  App.renderLimit = 60;
  document.getElementById('resultCount').textContent = `${App.filtered.length}件`;
  renderCardContainer();
}
const applyFiltersDebounced = debounce(applyFilters, 150);

function renderCardContainer() {
  const container = document.getElementById('cardContainer');
  const deck = activeDeck();
  const slice = App.filtered.slice(0, App.renderLimit);
  container.className = App.viewMode === 'grid' ? 'card-grid' : 'card-list';
  container.innerHTML = slice.map(c => App.viewMode === 'grid' ? cardTileHtml(c, deck) : cardRowHtml(c, deck)).join('');
  document.getElementById('loadMoreRow').classList.toggle('hidden', App.filtered.length <= App.renderLimit);
}

function renderDeckSelect() {
  const sel = document.getElementById('activeDeckSelect');
  const decks = App.state.decks;
  const workingIsUnsaved = App.workingDeck && !decks.some(d => d.id === App.workingDeck.id);
  const options = decks.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`);
  if (workingIsUnsaved) options.push(`<option value="${App.workingDeck.id}">${escapeHtml(App.workingDeck.name)}（未保存）</option>`);
  sel.innerHTML = options.length ? options.join('') : `<option value="">（デッキがありません）</option>`;
  if (App.workingDeck) {
    sel.value = App.workingDeck.id;
  } else if (decks.length) {
    loadWorkingDeck(decks[0].id);
    sel.value = decks[0].id;
  }
}

function renderDeckSidePanel() {
  const deck = activeDeck();
  const listEl = document.getElementById('deckSideList');
  const countEl = document.getElementById('deckSideCount');
  const badgeEl = document.getElementById('deckSideBadge');
  if (!deck) {
    listEl.innerHTML = `<div class="empty-state"><div class="big">🗂️</div>新規デッキを作成してください</div>`;
    countEl.textContent = '0 枚';
    badgeEl.textContent = '未選択';
    badgeEl.className = 'badge neutral';
    return;
  }
  function groupedHtml(list) {
    const grouped = {};
    for (const e of list) {
      const c = getCard(e.cardId);
      if (!c) continue;
      (grouped[c.type] = grouped[c.type] || []).push({ c, qty: e.qty });
    }
    let html = '';
    for (const type of CARD_TYPES) {
      if (!grouped[type]) continue;
      grouped[type].sort((a, b) => a.c.name.localeCompare(b.c.name, 'ja'));
      for (const { c, qty } of grouped[type]) {
        html += `<div class="mini-row"><span class="n">${escapeHtml(c.name)}</span><span class="q">×${qty}</span></div>`;
      }
    }
    return html;
  }
  const mainHtml = groupedHtml(deck.mainCards);
  let html = `<div style="font-size:11px;font-weight:800;color:var(--text-faint);padding:2px 2px 4px;">メインデッキ</div>`
    + (mainHtml || `<div class="empty-state" style="padding:14px 10px;"><div class="big">📭</div>カード未追加</div>`);
  const reg = getRegulation(deck.regulationId);
  if (reg.sideMax !== 0) {
    const sideHtml = groupedHtml(deck.sideCards);
    html += `<div style="font-size:11px;font-weight:800;color:var(--text-faint);padding:10px 2px 4px;border-top:1px dashed var(--border);margin-top:6px;">サイドデッキ</div>`
      + (sideHtml || `<div class="empty-state" style="padding:10px;font-size:12px;">カード未追加</div>`);
  }
  listEl.innerHTML = html;
  const mainTotal = deckTotalQty(deck.mainCards);
  const sideTotal = deckTotalQty(deck.sideCards);
  countEl.textContent = `メ${mainTotal} / サ${sideTotal} 枚`;
  const v = validateDeck(deck);
  badgeEl.textContent = v.valid ? 'OK' : '要確認';
  badgeEl.className = 'badge ' + (v.valid ? 'ok' : 'ng');
}

function refreshBrowseView() {
  renderDeckSelect();
  applyFilters();
  renderDeckSidePanel();
}


