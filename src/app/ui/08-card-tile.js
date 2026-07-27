/* ========================= 7. 描画: 共通カードタイル ========================= */
// 画像は 1) images/フォルダ内のローカル画像(公式サイト形式のファイル名) → 2) images/フォルダ内のローカル画像(カードID形式)
// → 3) 公式サイトの画像URL(取得できる場合) → 4) プレースホルダー の順で試す。
// 「images」フォルダをこのHTMLファイルと同じ場所に置くと自動的に読み込まれる（データ管理タブから対応表を書き出せます）。
//
// officialImageFilename/imageCandidates/cardImageBlockHtmlは、Node.js側の静的カードページ生成
// (scripts/build-card-pages.mjs)とロジックを二重管理しないよう、src/shared/card-detail-html.mjs
// に定義されている(結合順の都合上、このファイルより前に読み込まれる)。

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

// マークアップは共有モジュール(card-detail-html.mjs)のcardImageBlockHtmlと同一。
function cardThumbHtml(c) {
  return cardImageBlockHtml(c, { imageBasePath: IMAGE_BASE_PATH });
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
        <a class="name" href="${CARD_PAGE_BASE_PATH}${encodeURIComponent(c.id)}/" data-action="detail" data-card-id="${c.id}">${escapeHtml(c.name)}</a>
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
      <a class="name" href="${CARD_PAGE_BASE_PATH}${encodeURIComponent(c.id)}/" data-action="detail" data-card-id="${c.id}">${escapeHtml(c.name)}</a>
      <span class="sub">${dots} ${cardStatLine(c)} ・ ${escapeHtml(c.source || '')} ・ ${escapeHtml(c.rarity || '')}</span>
      ${zoneMini}
      <div class="qty-row">
        <button class="qty-btn" data-action="dec" data-card-id="${c.id}">−</button>
        <input type="number" class="qty-num" inputmode="numeric" min="0" data-action="qtyset" data-card-id="${c.id}" value="${activeQty}">
        <button class="qty-btn" data-action="inc" data-card-id="${c.id}">＋</button>
      </div>
    </div>`;
}

