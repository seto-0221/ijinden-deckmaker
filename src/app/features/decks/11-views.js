/* ========================= 7c. デッキ一覧 / パッケージ一覧タブ ========================= */
function renderDeckManager() {
  const q = document.getElementById('deckSearchInput').value.trim().toLowerCase();
  const regFilter = document.getElementById('deckRegFilter').value;
  const regSel = document.getElementById('deckRegFilter');
  if (!regSel.dataset.filled) {
    regSel.innerHTML = '<option value="">すべてのレギュレーション</option>' + allRegulations().map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    regSel.dataset.filled = '1';
  }
  let decks = App.state.decks.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  if (q) decks = decks.filter(d => (d.name + ' ' + d.tags.join(' ') + ' ' + d.memo).toLowerCase().includes(q));
  if (regFilter) decks = decks.filter(d => d.regulationId === regFilter);

  document.getElementById('deckManagerCount').textContent = `${decks.length}件`;
  const grid = document.getElementById('deckManagerGrid');
  if (!decks.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="big">🗂️</div>デッキがありません</div>`;
    return;
  }
  grid.innerHTML = decks.map(d => {
    const total = deckTotalQty(d.mainCards);
    const v = validateDeck(d);
    return `<div class="deck-poster-card" data-action="open-deck-card" data-id="${d.id}">
        <div class="poster-img-wrap">
          ${deckThumbHtml(d)}
          <div class="poster-name-bar"><div class="poster-name">${escapeHtml(d.name)}</div></div>
        </div>
        <div class="poster-body">
          <div class="poster-sub">${escapeHtml(getRegulation(d.regulationId).name)} ・ ${total}枚 ・ <span class="badge ${v.valid ? 'ok' : 'ng'}" style="padding:1px 7px;">${v.valid ? 'OK' : '要確認'}</span></div>
          <div class="poster-tags">${d.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
          <div class="poster-actions">
            <button class="btn small" data-action="open-deck" data-id="${d.id}">開く</button>
            <button class="btn small" data-action="open-sim" data-id="${d.id}" title="初動シミュレーション">🎲</button>
            <button class="btn small" data-action="dup-deck" data-id="${d.id}">複製</button>
            <button class="btn small danger" data-action="del-deck" data-id="${d.id}">削除</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

