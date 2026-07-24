/* ========================= 7. 描画: 共通カードタイル ========================= */
// 画像は 1) images/フォルダ内のローカル画像(公式サイト形式のファイル名) → 2) images/フォルダ内のローカル画像(カードID形式)
// → 3) 公式サイトの画像URL(取得できる場合) → 4) プレースホルダー の順で試す。
// 「images」フォルダをこのHTMLファイルと同じ場所に置くと自動的に読み込まれる（データ管理タブから対応表を書き出せます）。

// 公式サイトが実際に使っているファイル名の慣習を再現する:
//   ブースター       : {set 2桁}_{No 3桁}.png                 例) 01_001.png
//   第1弾スターター  : {英字}_{No 3桁}.png                    例) R_009.png
//   第2弾以降スターター: {set 2桁}_{英字}_{No 3桁}.png         例) 02_Y_001.png, 03_P_016.png
function officialImageFilename(c) {
  const no = String(c.no || '').trim();
  const setNum = Number(c.set);
  if (!no || Number.isNaN(setNum)) return null;
  const setStr = String(setNum).padStart(2, '0');
  const letterMatch = no.match(/^([A-Za-z]+)[\s\-]?(\d+)$/);
  if (letterMatch) {
    const letter = letterMatch[1].toUpperCase();
    const num = letterMatch[2].padStart(3, '0');
    return setNum === 1 ? `${letter}_${num}.png` : `${setStr}_${letter}_${num}.png`;
  }
  const plainMatch = no.match(/^(\d+)$/);
  if (plainMatch) {
    return `${setStr}_${plainMatch[1].padStart(3, '0')}.png`;
  }
  return null;
}

function imageCandidates(c) {
  const list = [];
  const official = officialImageFilename(c);
  if (official) list.push(`images/${official}`);
  list.push(`images/${c.id}.png`, `images/${c.id}.jpg`, `images/${c.id}.webp`);
  if (c.imageUrl) list.push(c.imageUrl);
  return list;
}

function thumbFallbackHtml(c) {
  return `<div class="thumb-fallback">
      <span class="type-badge type-${c.type}">${c.type}</span>
      <div class="fb-name">${escapeHtml(c.name)}</div>
      <span class="color-dot c-${c.colors[0]}"></span>
    </div>`;
}

function handleImgError(img) {
  let remaining = [];
  try { remaining = JSON.parse(img.dataset.fallbacks || '[]'); } catch (e) { remaining = []; }
  if (remaining.length) {
    const next = remaining.shift();
    img.dataset.fallbacks = JSON.stringify(remaining);
    img.src = next;
    return;
  }
  const c = getCard(img.dataset.cardId);
  if (img.parentElement && c) img.parentElement.innerHTML = thumbFallbackHtml(c);
}

function cardThumbHtml(c) {
  const candidates = imageCandidates(c);
  const first = candidates[0];
  const rest = escapeHtml(JSON.stringify(candidates.slice(1)));
  return `<img src="${escapeHtml(first)}" loading="lazy" alt="${escapeHtml(c.name)}"
      data-card-id="${c.id}" data-fallbacks="${rest}" onerror="handleImgError(this)">`;
}

function cardStatLine(c) {
  const parts = [];
  if (c.level !== null && c.level !== undefined) parts.push(`Lv${c.level}`);
  if (c.cost !== null && c.cost !== undefined) parts.push(`コスト${c.cost}`);
  if (c.power !== null && c.power !== undefined) parts.push(`P${c.power}`);
  return parts.join(' / ');
}

function cardTileHtml(c, deck) {
  const mainQty = deckCardQty(deck, c.id, 'main');
  const sideQty = deckCardQty(deck, c.id, 'side');
  const activeQty = App.addZone === 'side' ? sideQty : mainQty;
  const dots = c.colors.map(col => `<span class="color-dot c-${col}"></span>`).join('');
  const badgeParts = [];
  if (mainQty > 0) badgeParts.push(`<span class="qty-badge-part main">メ${mainQty}</span>`);
  if (sideQty > 0) badgeParts.push(`<span class="qty-badge-part side">サ${sideQty}</span>`);
  const badge = badgeParts.length ? `<div class="qty-badge">${badgeParts.join('')}</div>` : '';
  const sourceLabel = c.source || (typeof c.set === 'number' ? `第${c.set}弾` : String(c.set || ''));
  return `<div class="card-tile" data-card-id="${c.id}" title="収録: ${escapeHtml(sourceLabel)} / No.${escapeHtml(String(c.set))}-${escapeHtml(c.no)}">
      ${badge}
      <div class="thumb" data-action="detail" data-card-id="${c.id}">${cardThumbHtml(c)}</div>
      <div class="meta">
        <div class="name">${escapeHtml(c.name)}</div>
        <div class="stats"><span class="type-badge type-${c.type}">${TYPE_SHORT[c.type] || c.type}</span>${dots}<span>${cardStatLine(c)}</span></div>
        <div class="source-label" style="font-size:10px;color:var(--text-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(sourceLabel)}</div>
      </div>
      <div class="qty-row">
        <button class="qty-btn" data-action="dec" data-card-id="${c.id}">−</button>
        <input type="number" class="qty-num" inputmode="numeric" min="0" data-action="qtyset" data-card-id="${c.id}" value="${activeQty}">
        <button class="qty-btn" data-action="inc" data-card-id="${c.id}">＋</button>
      </div>
    </div>`;
}

function cardRowHtml(c, deck) {
  const mainQty = deckCardQty(deck, c.id, 'main');
  const sideQty = deckCardQty(deck, c.id, 'side');
  const activeQty = App.addZone === 'side' ? sideQty : mainQty;
  const dots = c.colors.map(col => `<span class="color-dot c-${col}"></span>`).join('');
  const zoneMini = (mainQty > 0 || sideQty > 0) ? `<span style="font-size:11px;color:var(--text-dim);white-space:nowrap;">メ${mainQty} / サ${sideQty}</span>` : '';
  return `<div class="card-row" data-card-id="${c.id}">
      <div class="thumb-sm" data-action="detail" data-card-id="${c.id}">${cardThumbHtml(c)}</div>
      <span class="type-badge type-${c.type}">${TYPE_SHORT[c.type] || c.type}</span>
      <span class="name">${escapeHtml(c.name)}</span>
      <span class="sub">${dots} ${cardStatLine(c)} ・ ${escapeHtml(c.source || '')} ・ ${escapeHtml(c.rarity || '')}</span>
      ${zoneMini}
      <div class="qty-row">
        <button class="qty-btn" data-action="dec" data-card-id="${c.id}">−</button>
        <input type="number" class="qty-num" inputmode="numeric" min="0" data-action="qtyset" data-card-id="${c.id}" value="${activeQty}">
        <button class="qty-btn" data-action="inc" data-card-id="${c.id}">＋</button>
      </div>
    </div>`;
}

