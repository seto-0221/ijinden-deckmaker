/* ========================= 7d. モーダル共通 ========================= */
// モバイルのオーバーレイパネル(絞り込み/デッキ側/デッキ編集の統計側)を全て閉じる。
// モーダルを開く直前にも必ず呼び出し、パネル用の背景暗転(#mobilePanelBackdrop)がモーダルの裏に
// 残ったままにならないようにする(スマホで統計パネルを開いたままカード検索モーダルを開くと、
// パネルの暗転だけが残って画面が暗いままになる不具合があったため)。
function closeMobilePanels() {
  const fPanelHost = document.getElementById('fPanelHost');
  const deckSidePanel = document.getElementById('deckSidePanel');
  const deckEditorSide = document.getElementById('deckEditorSide');
  const mobilePanelBackdrop = document.getElementById('mobilePanelBackdrop');
  if (fPanelHost) fPanelHost.classList.remove('mobile-open');
  if (deckSidePanel) deckSidePanel.classList.remove('mobile-open');
  if (deckEditorSide) deckEditorSide.classList.remove('mobile-open');
  if (mobilePanelBackdrop) mobilePanelBackdrop.classList.remove('show');
}

const Modal = {
  // openCardDetail()を「呼び出し元のモーダルを再度開く関数」付きで開いた際、その関数を覚えておく場所。
  // カード詳細のフッターの数量+/-ボタンで詳細を再描画する際にも、この値を引き継いで「戻る」ボタンを維持する。
  detailOnBack: null,
  open(title, bodyHtml, footHtml, opts) {
    closeMobilePanels();
    document.getElementById('modalTitle').textContent = title;
    // openPackagePicker等、モーダルを開くたびに#modalBody自体へ直接addEventListenerしている箇所があり、
    // 同じモーダルを複数回開くとリスナーが積み重なってクリックが多重発火し、
    // パッケージ一括追加などで枚数が2倍3倍になる不具合があった。
    // 毎回#modalBodyをリスナーの付いていない新しい要素に差し替えてから内容を入れることで解消する。
    const oldBody = document.getElementById('modalBody');
    const freshBody = oldBody.cloneNode(false);
    oldBody.replaceWith(freshBody);
    freshBody.innerHTML = bodyHtml;
    document.getElementById('modalFoot').innerHTML = footHtml || '';
    document.getElementById('modalBox').classList.toggle('wide', !!(opts && opts.wide));
    document.getElementById('modalBackdrop').classList.remove('hidden');
  },
  close() {
    document.getElementById('modalBackdrop').classList.add('hidden');
    Modal.detailOnBack = null;
  },
};

/* ---- カード詳細の拡張セクション(将来機能の受け皿) ----
   カード個別ページに将来追加する「関連裁定」「このカードを採用した公開デッキ」「関連カード」
   「大会での採用実績」を、データ取得(getData)+描画(render)のペアとして登録する構造。
   getDataが空配列を返すセクションは描画自体を行わないため、データが存在しない現時点では
   画面の見た目は従来と完全に同一になる。
   将来はgetDataの中身を実データ源(src/data/rulings.json やサーバーAPI)に差し替えるだけでよい。 */
const CARD_DETAIL_SECTIONS = [
  {
    id: 'rulings',
    title: '関連裁定',
    getData: (c) => [], // 将来: getRulingsForCard(c.id)
    render: (items) => items.map(r => `<div class="rule-text"><b>Q.</b> ${escapeHtml(r.q)}<br><b>A.</b> ${escapeHtml(r.a)}${r.date ? `<div style="font-size:11px;color:var(--text-faint);">${escapeHtml(r.source || '')} ${escapeHtml(r.date)}</div>` : ''}</div>`).join(''),
  },
  {
    id: 'publicDecks',
    title: 'このカードを採用した公開デッキ',
    getData: (c) => [], // 将来: 公開デッキAPI
    render: (items) => items.map(d => `<div class="kv-row"><span>${escapeHtml(d.name)}</span></div>`).join(''),
  },
  {
    id: 'related',
    title: '関連カード',
    getData: (c) => [], // 将来: 関連カード定義
    render: (items) => `<div style="display:flex;gap:8px;flex-wrap:wrap;">${items.map(rc => `<div class="thumb-sm" data-action="detail" data-card-id="${rc.id}">${cardThumbHtml(rc)}</div>`).join('')}</div>`,
  },
  {
    id: 'results',
    title: '大会での採用実績',
    getData: (c) => [], // 将来: 大会結果データ
    render: (items) => items.map(t => `<div class="kv-row"><span>${escapeHtml(t.name)}</span><span>${escapeHtml(t.result || '')}</span></div>`).join(''),
  },
];
// データが存在するセクションだけHTMLを生成する(全セクション空なら空文字列を返し、画面に何も足さない)
function cardDetailSectionsHtml(c) {
  let html = '';
  for (const sec of CARD_DETAIL_SECTIONS) {
    let items = [];
    try { items = sec.getData(c) || []; } catch (e) { console.error(`card detail section failed: ${sec.id}`, e); }
    if (!items.length) continue;
    html += `<div><div class="section-title" style="padding:4px 0;">${escapeHtml(sec.title)}</div>${sec.render(items)}</div>`;
  }
  return html;
}

// onBack: 指定すると、カード詳細モーダルに「← 戻る」ボタンが表示され、押すと詳細を閉じて呼び出し元のモーダル
// (カードを検索して追加/統領を選択/切り札を選択、など)を再度開き直す。省略時(未指定またはnull)は従来通り、
// カード詳細は「✕」でそのまま閉じるだけの、呼び出し元モーダルを持たない単独表示として開く。
// (以前はカード検索追加モーダル等からカード詳細を開くと、詳細のModal.open()が中身を丸ごと差し替えてしまうため
//  「✕」で閉じると検索モーダルごと消えてしまい、もう一度開き直す必要があった。onBackで元のモーダルを
//  再構築できるようにすることで、検索結果を保持したまま詳細だけを閉じられるようにした)
function openCardDetail(cardId, onBack = null) {
  const c = getCard(cardId);
  if (!c) return;
  Modal.detailOnBack = onBack;
  const deck = activeDeck();
  const mainQty = deckCardQty(deck, c.id, 'main');
  const sideQty = deckCardQty(deck, c.id, 'side');
  const body = `
    <div style="display:flex;gap:16px;flex-wrap:wrap;">
      <div style="width:180px;flex-shrink:0;"><div class="card-detail-img">${cardThumbHtml(c)}</div></div>
      <div style="flex:1;min-width:220px;display:flex;flex-direction:column;gap:6px;">
        <div style="font-size:17px;font-weight:800;">${escapeHtml(c.name)}</div>
        <div style="display:flex;gap:6px;align-items:center;">
          <span class="type-badge type-${c.type}">${c.type}</span>
          ${c.colors.map(col => `<span class="color-dot c-${col}"></span>`).join('')}
          <span class="badge neutral">${escapeHtml(c.rarity || '-')}</span>
        </div>
        <div class="kv-row"><span class="k">No.</span><span>${escapeHtml(String(c.set))}-${escapeHtml(c.no)}</span></div>
        <div class="kv-row"><span class="k">収録</span><span>${escapeHtml(c.source || '-')}</span></div>
        ${c.level !== null && c.level !== undefined ? `<div class="kv-row"><span class="k">レベル</span><span>${c.level}</span></div>` : ''}
        ${c.cost !== null && c.cost !== undefined ? `<div class="kv-row"><span class="k">魔力コスト</span><span>${c.cost}</span></div>` : ''}
        ${c.power !== null && c.power !== undefined ? `<div class="kv-row"><span class="k">パワー</span><span>${c.power}</span></div>` : ''}
        ${c.trait ? `<div class="kv-row"><span class="k">特性</span><span>${escapeHtml(c.trait)}</span></div>` : ''}
        ${c.unlimited ? `<div class="badge ok" style="width:fit-content;">デッキ投入枚数無制限</div>` : ''}
      </div>
    </div>
    ${c.ruleText ? `<div><div class="section-title" style="padding:4px 0;">ルールテキスト</div><div class="rule-text">${escapeHtml(c.ruleText)}</div></div>` : ''}
    ${c.igyouText ? `<div><div class="section-title" style="padding:4px 0;">遺業能力</div><div class="rule-text">${escapeHtml(c.igyouText)}</div></div>` : ''}
    ${c.illustrator ? `<div class="kv-row"><span class="k">イラスト</span><span>${escapeHtml(c.illustrator)}</span></div>` : ''}
    ${cardDetailSectionsHtml(c)}
  `;
  const backBtnHtml = onBack ? `<button class="btn" type="button" id="cardDetailBackBtn">← 戻る</button>` : '';
  const foot = deck ? `
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
      ${backBtnHtml}
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:12px;color:var(--text-dim);">メイン</span>
        <button class="btn small" data-action="dec" data-zone="main" data-card-id="${c.id}">−</button>
        <span style="font-weight:700;min-width:20px;text-align:center;">${mainQty}</span>
        <button class="btn small primary" data-action="inc" data-zone="main" data-card-id="${c.id}">＋</button>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:12px;color:var(--text-dim);">サイド</span>
        <button class="btn small" data-action="dec" data-zone="side" data-card-id="${c.id}">−</button>
        <span style="font-weight:700;min-width:20px;text-align:center;">${sideQty}</span>
        <button class="btn small primary" data-action="inc" data-zone="side" data-card-id="${c.id}">＋</button>
      </div>
      <button class="btn" data-action="edit-card" data-id="${c.id}">カード情報を編集</button>
    </div>
  ` : `${backBtnHtml}<button class="btn" data-action="edit-card" data-id="${c.id}">カード情報を編集</button>`;
  Modal.open('カード詳細', body, foot, { wide: true });
  if (onBack) {
    const backEl = document.getElementById('cardDetailBackBtn');
    if (backEl) backEl.addEventListener('click', () => { Modal.detailOnBack = null; onBack(); });
  }
}

/* ---- カード手動追加/編集 ---- */
function openCardEditForm(cardId) {
  const c = cardId ? getCard(cardId) : null;
  const v = c || { id: '', name: '', type: 'イジン', colors: ['無'], level: '', cost: '', power: '', rarity: '', trait: '', ruleText: '', igyouText: '', illustrator: '', source: '自作', set: 'custom', no: '', unlimited: false, imageUrl: '' };
  const body = `
    <div class="form-inline"><div class="form-row"><label>カード名 *</label><input id="ceName" type="text" value="${escapeHtml(v.name)}"></div>
      <div class="form-row" style="max-width:140px;"><label>種類</label><select id="ceType">${CARD_TYPES.map(t => `<option value="${t}" ${t === v.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <div class="form-row"><label>色（複数可）</label><div class="chip-row" id="ceColors">${COLORS.map(col => `<span class="chip ${v.colors.includes(col) ? 'on' : ''}" data-color="${col}">${col === '無' ? '無色' : col}</span>`).join('')}</div></div>
    <div class="form-inline">
      <div class="form-row"><label>レベル</label><input id="ceLevel" type="number" value="${v.level ?? ''}"></div>
      <div class="form-row"><label>魔力コスト</label><input id="ceCost" type="number" value="${v.cost ?? ''}"></div>
      <div class="form-row"><label>パワー</label><input id="cePower" type="number" value="${v.power ?? ''}"></div>
    </div>
    <div class="form-inline">
      <div class="form-row"><label>レアリティ</label><input id="ceRarity" type="text" value="${escapeHtml(v.rarity || '')}"></div>
      <div class="form-row"><label>収録</label><input id="ceSource" type="text" value="${escapeHtml(v.source || '')}"></div>
      <div class="form-row"><label>No.</label><input id="ceNo" type="text" value="${escapeHtml(v.no || '')}"></div>
    </div>
    <div class="form-row"><label>特性</label><input id="ceTrait" type="text" value="${escapeHtml(v.trait || '')}"></div>
    <div class="form-row"><label>ルールテキスト</label><textarea id="ceRule" rows="4">${escapeHtml(v.ruleText || '')}</textarea></div>
    <div class="form-row"><label>遺業能力</label><textarea id="ceIgyou" rows="2">${escapeHtml(v.igyouText || '')}</textarea></div>
    <div class="form-row"><label>画像URL（任意）</label><input id="ceImage" type="text" value="${escapeHtml(v.imageUrl || '')}"></div>
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input id="ceUnlimited" type="checkbox" style="width:auto;" ${v.unlimited ? 'checked' : ''}> デッキに何枚でも入れてよいカード</label>
  `;
  const foot = `${c ? `<button class="btn danger" id="ceDelete">このカードを削除</button>` : ''}<button class="btn" id="ceCancel">キャンセル</button><button class="btn primary" id="ceSave">保存</button>`;
  Modal.open(c ? 'カードを編集' : 'カードを新規追加', body, foot);
  document.getElementById('ceColors').querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => chip.classList.toggle('on')));
  document.getElementById('ceCancel').addEventListener('click', Modal.close);
  if (c) document.getElementById('ceDelete').addEventListener('click', () => {
    if (!confirm(`「${c.name}」を削除しますか？（デッキに含まれている場合そのまま残ります）`)) return;
    if (!App.state.removedCardIds.includes(c.id) && RAW_CARDS.some(r => r.id === c.id)) App.state.removedCardIds.push(c.id);
    App.state.customCards = App.state.customCards.filter(x => x.id !== c.id);
    persist(); rebuildCardIndex(); Modal.close(); refreshAll(); toast('削除しました');
  });
  document.getElementById('ceSave').addEventListener('click', () => {
    const name = document.getElementById('ceName').value.trim();
    if (!name) { toast('カード名を入力してください', 'err'); return; }
    const colors = Array.from(document.getElementById('ceColors').querySelectorAll('.chip.on')).map(e => e.dataset.color);
    const numOr = (id) => { const s = document.getElementById(id).value; return s === '' ? null : Number(s); };
    const card = {
      id: c ? c.id : uid('custom'),
      no: document.getElementById('ceNo').value.trim() || (c ? c.no : ''),
      set: c ? c.set : 'custom',
      source: document.getElementById('ceSource').value.trim() || '自作',
      name,
      rarity: document.getElementById('ceRarity').value.trim(),
      colors: colors.length ? colors : ['無'],
      type: document.getElementById('ceType').value,
      level: numOr('ceLevel'),
      cost: numOr('ceCost'),
      power: numOr('cePower'),
      trait: document.getElementById('ceTrait').value.trim(),
      ruleText: document.getElementById('ceRule').value.trim(),
      igyouText: document.getElementById('ceIgyou').value.trim(),
      illustrator: c ? c.illustrator : '',
      unlimited: document.getElementById('ceUnlimited').checked,
      imageUrl: document.getElementById('ceImage').value.trim(),
    };
    if (card.type === 'マホウ' && card.cost === null) card.cost = 0;
    App.state.customCards = App.state.customCards.filter(x => x.id !== card.id);
    App.state.customCards.push(card);
    persist(); rebuildCardIndex(); Modal.close(); refreshAll();
    toast(c ? '更新しました' : '追加しました');
  });
}


/* ---- パッケージ編集モーダル ---- */
function openPackageEditor(pkgId) {
  const p = pkgId ? getPackage(pkgId) : newPackage();
  App.editingPackageId = p.id;
  renderPackageEditorModal(p);
}
function renderPackageEditorModal(p) {
  const rows = p.cards.map(e => {
    const c = getCard(e.cardId);
    return `<div class="deck-card-row"><div class="thumb-xs">${c ? cardThumbHtml(c) : ''}</div>
      <span class="name">${c ? escapeHtml(c.name) : e.cardId}</span>
      <div class="qty-row" style="border:none;padding:0;">
        <button class="qty-btn" data-action="pkgdec" data-card-id="${e.cardId}">−</button><input type="number" class="qty-num" inputmode="numeric" min="0" data-action="pkgset" data-card-id="${e.cardId}" value="${e.qty}">
        <button class="qty-btn" data-action="pkginc" data-card-id="${e.cardId}">＋</button>
      </div></div>`;
  }).join('') || `<div class="empty-state" style="padding:14px;">下の検索でカードを追加してください</div>`;
  const body = `
    <div class="form-inline">
      <div class="thumb-picker" style="width:70px;flex-shrink:0;">
        <div class="thumb" style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;cursor:pointer;" id="pkgThumbPreview">${pkgThumbHtml(p)}</div>
        <button class="btn small block" id="pkgThumbChangeBtn" style="margin-top:4px;font-size:11px;padding:3px 4px;">サムネイル変更</button>
      </div>
      <div class="form-row"><label>パッケージ名</label><input id="pkgName" type="text" value="${escapeHtml(p.name)}"></div>
    </div>
    <div class="form-row"><label>タグ</label><div class="tag-input-row" id="pkgTagRow"><input id="pkgTagInput" type="text" placeholder="タグを入力してEnter"></div></div>
    <div class="form-row"><label>メモ</label><textarea id="pkgMemo" rows="2">${escapeHtml(p.memo)}</textarea></div>
    <div class="form-row"><label>カードを検索して追加</label><input id="pkgCardSearch" type="search" placeholder="カード名で検索"></div>
    <div id="pkgSearchResults" style="max-height:140px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;"></div>
    <div class="section-title" style="padding:2px 0;">構成カード (${deckTotalQty(p.cards)}枚)</div>
    <div id="pkgCardList">${rows}</div>
  `;
  const foot = `<button class="btn danger" id="pkgDelete">削除</button><button class="btn" id="pkgShare">🔗 共有リンクを発行</button><button class="btn" id="pkgClose">閉じる</button><button class="btn primary" id="pkgSave">保存</button>`;
  Modal.open('パッケージを編集', body, foot, { wide: true });
  renderTagChipsGeneric('pkgTagRow', 'pkgTagInput', p.tags);

  document.getElementById('pkgCardSearch').addEventListener('input', debounce((e) => {
    const q = e.target.value.trim().toLowerCase();
    const results = q ? App.allCards.filter(c => searchableText(c).includes(q)).slice(0, 20) : [];
    document.getElementById('pkgSearchResults').innerHTML = results.map(c => `
        <div class="mini-row"><span class="n">[${c.type}] ${escapeHtml(c.name)}</span>
        <button class="btn small" data-action="pkgaddsearch" data-card-id="${c.id}">追加</button></div>`).join('');
  }, 150));
  document.getElementById('pkgSearchResults').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="pkgaddsearch"]');
    if (!btn) return;
    pkgAdjustQty(p, btn.dataset.cardId, 1);
    renderPackageEditorModal(getPackage(p.id));
  });
  document.getElementById('pkgCardList').addEventListener('click', (e) => {
    const btn = e.target.closest('.qty-btn');
    if (!btn) return;
    pkgAdjustQty(p, btn.dataset.cardId, btn.dataset.action === 'pkginc' ? 1 : -1);
    renderPackageEditorModal(getPackage(p.id));
  });
  document.getElementById('pkgCardList').addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-action="pkgset"]');
    if (!inp) return;
    const entry = p.cards.find(x => x.cardId === inp.dataset.cardId);
    const cur = entry ? entry.qty : 0;
    let newVal = Math.max(0, Math.floor(Number(inp.value)) || 0);
    pkgAdjustQty(p, inp.dataset.cardId, newVal - cur);
    renderPackageEditorModal(getPackage(p.id));
  });
  document.getElementById('pkgThumbChangeBtn').addEventListener('click', () => openPackageThumbnailPicker(p));
  document.getElementById('pkgThumbPreview').addEventListener('click', () => openPackageThumbnailPicker(p));
  document.getElementById('pkgClose').addEventListener('click', Modal.close);
  document.getElementById('pkgShare').addEventListener('click', () => openPackageShareModal(p));
  document.getElementById('pkgDelete').addEventListener('click', () => {
    if (!confirm(`パッケージ「${p.name}」を削除しますか？`)) return;
    App.state.packages = App.state.packages.filter(x => x.id !== p.id);
    persist(); Modal.close(); renderPackageManager(); toast('削除しました');
  });
  document.getElementById('pkgSave').addEventListener('click', () => {
    p.name = document.getElementById('pkgName').value.trim() || '無題のパッケージ';
    p.memo = document.getElementById('pkgMemo').value;
    p.tags = collectTagChips('pkgTagRow');
    p.updatedAt = Date.now();
    persist(); Modal.close(); renderPackageManager(); toast('保存しました');
  });
}

/* ---- パッケージサムネイル選択 ---- */
function openPackageThumbnailPicker(p) {
  const uniqueCards = [];
  const seen = new Set();
  for (const e of p.cards) {
    if (seen.has(e.cardId)) continue;
    seen.add(e.cardId);
    const c = getCard(e.cardId);
    if (c) uniqueCards.push(c);
  }
  if (!uniqueCards.length) {
    Modal.open('サムネイルを選ぶ', `<div class="empty-state"><div class="big">🃏</div>パッケージにカードを追加すると選べるようになります。</div>`, `<button class="btn" id="tpClose">閉じる</button>`);
    document.getElementById('tpClose').addEventListener('click', Modal.close);
    return;
  }
  const autoCard = uniqueCards[0];
  const isAuto = !p.thumbnailCardId;
  const body = `
    <div class="manager-grid" style="grid-template-columns:repeat(auto-fill, minmax(110px,1fr));">
      <div class="item-card" style="box-shadow:none;cursor:pointer;padding:8px;${isAuto ? 'outline:2px solid var(--accent);' : ''}" data-action="pick-pkg-thumb" data-id="">
        <div class="item-thumb">${cardThumbHtml(autoCard)}</div>
        <div class="sub" style="text-align:center;">自動（先頭カード）</div>
      </div>
      ${uniqueCards.map(c => `
        <div class="item-card" style="box-shadow:none;cursor:pointer;padding:8px;${p.thumbnailCardId === c.id ? 'outline:2px solid var(--accent);' : ''}" data-action="pick-pkg-thumb" data-id="${c.id}">
          <div class="item-thumb">${cardThumbHtml(c)}</div>
          <div class="sub" style="text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.name)}</div>
        </div>`).join('')}
    </div>
  `;
  Modal.open('サムネイルを選ぶ', body, `<button class="btn" id="tpClose">閉じる</button>`, { wide: true });
  document.getElementById('tpClose').addEventListener('click', () => renderPackageEditorModal(getPackage(p.id)));
  document.getElementById('modalBody').addEventListener('click', (e) => {
    const item = e.target.closest('[data-action="pick-pkg-thumb"]');
    if (!item) return;
    p.thumbnailCardId = item.dataset.id || null;
    p.updatedAt = Date.now();
    persist();
    renderPackageEditorModal(getPackage(p.id));
    toast('サムネイルを変更しました');
  });
}

function pkgAdjustQty(p, cardId, delta) {
  let e = p.cards.find(x => x.cardId === cardId);
  if (!e) { if (delta <= 0) return; e = { cardId, qty: 0 }; p.cards.push(e); }
  e.qty += delta;
  if (e.qty <= 0) p.cards.splice(p.cards.indexOf(e), 1);
  persist();
}

// パッケージの共有リンクを発行するモーダル(共有リンクボタンと同様、QRコードも可能なら添える)
async function openPackageShareModal(p) {
  toast('共有リンクを作成しています…');
  const code = await encodePackageShareCode(p);
  const url = location.origin + location.pathname + '#pkg=' + code;
  let qrImgHtml = '';
  let qrDataUrl = null;
  try {
    await ensureQREncodeLib();
    const qrCanvas = buildQRCanvasFit(url, 220);
    if (qrCanvas) {
      qrDataUrl = qrCanvas.toDataURL('image/png');
      qrImgHtml = `<div style="text-align:center;margin-top:10px;">
          <img id="pkgShareQrImg" src="${qrDataUrl}" width="${qrCanvas.width}" height="${qrCanvas.height}" style="max-width:220px;width:auto;height:auto;image-rendering:pixelated;border:1px solid var(--border);border-radius:6px;background:#fff;">
          <div style="margin-top:6px;"><button class="btn small" id="pkgShareQrDownload">QR画像を保存</button></div>
        </div>`;
    }
  } catch (e) {
    // オフライン等でQRライブラリを読み込めない場合はリンクのみ表示する(致命的ではない)
  }
  const body = `
    <div class="form-row"><label>パッケージの共有リンク</label><input type="text" id="pkgShareLinkInput" readonly value="${escapeHtml(url)}" style="width:100%;"></div>
    <div style="font-size:12px;color:var(--text-dim);">このリンクを相手に送ると、パッケージ一覧の「共有リンクからインポート」から取り込めます(相手も本ツールを使う必要があります)。</div>
    ${qrImgHtml}
  `;
  Modal.open('パッケージの共有リンクを発行', body, `<button class="btn" id="pkgShareClose">閉じる</button><button class="btn primary" id="pkgShareCopy">コピー</button>`);
  document.getElementById('pkgShareClose').addEventListener('click', () => renderPackageEditorModal(getPackage(p.id)));
  document.getElementById('pkgShareCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); toast('コピーしました'); }
    catch {
      const inp = document.getElementById('pkgShareLinkInput');
      inp.select();
      toast('コピーに失敗しました。手動で選択してください', 'err');
    }
  });
  const qrDlBtn = document.getElementById('pkgShareQrDownload');
  if (qrDlBtn) qrDlBtn.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = qrDataUrl; a.download = (p.name || 'package') + '_qr.png';
    document.body.appendChild(a); a.click(); a.remove();
  });
}

// パッケージ取り込み共通処理
function finishPackageImport(pkg) {
  App.state.packages.push(pkg);
  persist();
  Modal.close();
  renderPackageManager();
  toast(`パッケージ「${pkg.name}」を取り込みました`);
}

// パッケージの共有リンク(テキスト)からインポートするモーダル
function openPackageTextImportModal() {
  const body = `
    <div class="form-row">
      <label>パッケージの共有リンクを貼り付け</label>
      <textarea id="importPkgTextarea" rows="4" style="width:100%;font-family:ui-monospace,monospace;font-size:12.5px;" placeholder="相手から受け取った共有リンク(#pkg=... を含むURL)を貼り付けてください"></textarea>
    </div>
    <div id="importPkgWarnings" style="font-size:12px;color:var(--warn);white-space:pre-wrap;"></div>
  `;
  Modal.open('共有リンクからパッケージをインポート', body, `<button class="btn" id="ipCancel">キャンセル</button><button class="btn primary" id="ipImport">インポート</button>`, { wide: true });
  document.getElementById('ipCancel').addEventListener('click', Modal.close);
  document.getElementById('ipImport').addEventListener('click', async () => {
    const text = document.getElementById('importPkgTextarea').value;
    const warnEl = document.getElementById('importPkgWarnings');
    const pkg = await tryDecodeShareTextToPackage(text);
    if (!pkg) { warnEl.textContent = 'パッケージの共有リンクとして読み取れませんでした。リンクの内容を確認してください。'; return; }
    finishPackageImport(pkg);
  });
}

// パッケージのQRコード画像からインポートするモーダル
function openPackageQrImportModal() {
  const body = `
    <div class="form-row">
      <label>QRコード画像を選択</label>
      <input type="file" id="importPkgQrFile" accept="image/*">
    </div>
    <div id="importPkgWarnings" style="font-size:12px;color:var(--warn);white-space:pre-wrap;"></div>
  `;
  Modal.open('QRコードからパッケージをインポート', body, `<button class="btn" id="ipqCancel">キャンセル</button>`, { wide: true });
  document.getElementById('ipqCancel').addEventListener('click', Modal.close);
  document.getElementById('importPkgQrFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const warnEl = document.getElementById('importPkgWarnings');
    warnEl.textContent = 'QRコードを読み取っています…';
    try {
      const text = await decodeQRFromImageFile(file);
      if (!text) { warnEl.textContent = 'QRコードを認識できませんでした。画像がはっきり写っているか確認してください。'; return; }
      const pkg = await tryDecodeShareTextToPackage(text);
      if (!pkg) { warnEl.textContent = 'QRコードは読み取れましたが、パッケージ共有リンクの形式ではありませんでした。'; return; }
      finishPackageImport(pkg);
    } catch (err) {
      warnEl.textContent = 'QRコードの読み取りに失敗しました: ' + (err && err.message ? err.message : String(err));
    }
  });
}

function openPackagePicker() {
  const deck = App.workingDeck;
  if (!deck) return;
  if (!App.state.packages.length) {
    Modal.open('パッケージから一括追加', `<div class="empty-state"><div class="big">📦</div>パッケージがまだありません。「パッケージ」タブで作成できます。</div>`, `<button class="btn" id="ppClose">閉じる</button>`);
    document.getElementById('ppClose').addEventListener('click', Modal.close);
    return;
  }
  const body = App.state.packages.map(p => `
      <div class="item-card" style="box-shadow:none;">
        <div class="title">${escapeHtml(p.name)}</div>
        <div class="sub">${deckTotalQty(p.cards)}枚 ・ ${p.cards.length}種</div>
        <div class="tags">${p.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="row-actions"><button class="btn small primary" data-action="apply-package" data-id="${p.id}">メインに追加</button></div>
      </div>`).join('');
  Modal.open('パッケージから一括追加', `<div style="display:flex;flex-direction:column;gap:8px;">${body}</div>`, `<button class="btn" id="ppClose">閉じる</button>`, { wide: true });
  document.getElementById('ppClose').addEventListener('click', Modal.close);
  document.getElementById('modalBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="apply-package"]');
    if (!btn) return;
    const pkg = getPackage(btn.dataset.id);
    for (const entry of pkg.cards) deckAddCard(deck, entry.cardId, 'main', entry.qty);
    Modal.close(); renderDeckEditor(); renderDeckSidePanel();
    toast(`「${pkg.name}」をメインデッキに追加しました`);
  });
}

/* ---- デッキ編集画面からのカード検索追加 ---- */
// デッキ編集画面のカード追加モーダル。カード検索画面(#view-browse)と同じ絞り込み一式(種類/色/レベル/
// コスト/パワー/収録弾/レアリティ/並び替え)を、prefix "csaF" で使い回す。
function openCardSearchAddModal() {
  const deck = App.workingDeck;
  if (!deck) return;
  const body = `
    <div class="modal-two-col">
      <div class="filter-col panel side-panel" id="csaFPanelHost"></div>
      <div class="main-panel">
        <div class="result-count" id="csaResultCount" style="margin-bottom:6px;">0件</div>
        <div id="csaResults" style="display:flex;flex-direction:column;gap:6px;max-height:480px;overflow-y:auto;"></div>
      </div>
    </div>
  `;
  Modal.open('カードを検索して追加', body, `<button class="btn" id="csaClose">閉じる</button>`, { wide: true });
  document.getElementById('csaClose').addEventListener('click', Modal.close);
  document.getElementById('csaFPanelHost').innerHTML = filterPanelHtml('csaF');
  renderFilterChips('csaF', renderResults);
  wireFilterInputs('csaF', renderResults);

  function renderResults() {
    const f = readFilters('csaF');
    const matched = filterCards(App.allCards, f);
    document.getElementById('csaResultCount').textContent = `${matched.length}件`;
    const results = matched.slice(0, 60);
    document.getElementById('csaResults').innerHTML = results.map(c => {
      const mainQty = deckCardQty(deck, c.id, 'main');
      const sideQty = deckCardQty(deck, c.id, 'side');
      return `<div class="card-row" data-card-id="${c.id}" style="flex-wrap:wrap;">
          <div class="thumb-sm" data-action="csa-detail" data-card-id="${c.id}">${cardThumbHtml(c)}</div>
          <span class="type-badge type-${c.type}">${TYPE_SHORT[c.type] || c.type}</span>
          <span class="name">${escapeHtml(c.name)}</span>
          <span class="sub">${cardStatLine(c)} ・ ${escapeHtml(c.source || '')}</span>
          <div style="display:flex;gap:12px;align-items:center;">
            <div style="display:flex;align-items:center;gap:4px;">
              <span style="font-size:10.5px;color:var(--text-dim);">メイン</span>
              <button class="qty-btn" data-action="csa-dec" data-zone="main" data-card-id="${c.id}">−</button>
              <input type="number" class="qty-num" inputmode="numeric" min="0" style="min-width:30px;width:38px;" data-action="csa-set" data-zone="main" data-card-id="${c.id}" value="${mainQty}">
              <button class="qty-btn" data-action="csa-inc" data-zone="main" data-card-id="${c.id}">＋</button>
            </div>
            <div style="display:flex;align-items:center;gap:4px;">
              <span style="font-size:10.5px;color:var(--text-dim);">サイド</span>
              <button class="qty-btn" data-action="csa-dec" data-zone="side" data-card-id="${c.id}">−</button>
              <input type="number" class="qty-num" inputmode="numeric" min="0" style="min-width:30px;width:38px;" data-action="csa-set" data-zone="side" data-card-id="${c.id}" value="${sideQty}">
              <button class="qty-btn" data-action="csa-inc" data-zone="side" data-card-id="${c.id}">＋</button>
            </div>
          </div>
        </div>`;
    }).join('') || `<div class="empty-state" style="padding:20px;">該当するカードがありません</div>`;
  }
  renderResults();
  document.getElementById('csaResults').addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    if (actionEl.dataset.action === 'csa-detail') { openCardDetail(actionEl.dataset.cardId, () => openCardSearchAddModal()); return; }
    if (actionEl.dataset.action === 'csa-inc' || actionEl.dataset.action === 'csa-dec') {
      const zone = actionEl.dataset.zone;
      const delta = actionEl.dataset.action === 'csa-inc' ? 1 : -1;
      deckAddCard(deck, actionEl.dataset.cardId, zone, delta);
      renderResults();
      renderDeckEditor();
    }
  });
  document.getElementById('csaResults').addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-action="csa-set"]');
    if (!inp) return;
    const zone = inp.dataset.zone;
    let newVal = Math.max(0, Math.floor(Number(inp.value)) || 0);
    const cur = deckCardQty(deck, inp.dataset.cardId, zone);
    deckAddCard(deck, inp.dataset.cardId, zone, newVal - cur);
    renderResults();
    renderDeckEditor();
  });
}

/* ---- 統領戦: 統領・切り札選択 ----
   カード検索追加モーダル(openCardSearchAddModal)と同じ絞り込みUI(filterPanelHtml/絞り込みパネル+結果一覧の2カラム)を
   prefix "lpF"/"tpF" で使い回す。統領はイジン、切り札はマホウに種類が固定なので種類チップは非表示にし、
   候補は先に該当種類だけへ絞ってから、色・レベル・レアリティ・収録弾などの絞り込み条件を適用する。 */
function openLeaderPicker() {
  const deck = App.workingDeck;
  if (!deck) return;
  ensureLeaderFields(deck);
  const reg = getRegulation(deck.regulationId);
  const maxCount = reg.leaderMaxCount || 2;
  if (deck.leaderCards.length >= maxCount) { toast(`統領は${maxCount}枚まで選択できます`, 'err'); return; }
  const body = `
    <div class="modal-two-col">
      <div class="filter-col panel side-panel" id="lpFPanelHost"></div>
      <div class="main-panel">
        <div class="result-count" id="lpResultCount" style="margin-bottom:6px;">0件</div>
        <div id="leaderPickResults" style="display:flex;flex-direction:column;gap:6px;max-height:480px;overflow-y:auto;"></div>
      </div>
    </div>
  `;
  Modal.open('統領イジンを選択', body, `<button class="btn" id="lpClose">閉じる</button>`, { wide: true });
  document.getElementById('lpClose').addEventListener('click', Modal.close);
  document.getElementById('lpFPanelHost').innerHTML = filterPanelHtml('lpF', { hideCost: true });
  renderFilterChips('lpF', renderResults);
  wireFilterInputs('lpF', renderResults);

  function renderResults() {
    const f = readFilters('lpF');
    const base = App.allCards.filter(c => c.type === 'イジン' && !deck.leaderCards.includes(c.id));
    const matched = filterCards(base, f);
    document.getElementById('lpResultCount').textContent = `${matched.length}件`;
    const results = matched.slice(0, 60);
    document.getElementById('leaderPickResults').innerHTML = results.map(c => `
        <div class="card-row" data-card-id="${c.id}">
          <div class="thumb-sm" data-action="lp-detail" data-card-id="${c.id}">${cardThumbHtml(c)}</div>
          <span class="type-badge type-${c.type}">${TYPE_SHORT[c.type]}</span>
          <span class="name">${escapeHtml(c.name)}</span>
          <span class="sub">${cardStatLine(c)} ・ ${c.colors.join('/')}</span>
          <button class="btn small primary" data-action="lp-pick" data-card-id="${c.id}">選択</button>
        </div>`).join('') || `<div class="empty-state" style="padding:16px;">該当するカードがありません</div>`;
  }
  renderResults();
  document.getElementById('leaderPickResults').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'lp-detail') { openCardDetail(btn.dataset.cardId, () => openLeaderPicker()); return; }
    if (btn.dataset.action === 'lp-pick') {
      deck.leaderCards.push(btn.dataset.cardId);
      markWorkingDirty();
      Modal.close();
      renderDeckEditor();
      toast('統領を選択しました');
    }
  });
}

function openTrumpPicker() {
  const deck = App.workingDeck;
  if (!deck) return;
  ensureLeaderFields(deck);
  const body = `
    <div class="modal-two-col">
      <div class="filter-col panel side-panel" id="tpFPanelHost"></div>
      <div class="main-panel">
        <div class="result-count" id="tpResultCount" style="margin-bottom:6px;">0件</div>
        <div id="trumpPickResults" style="display:flex;flex-direction:column;gap:6px;max-height:480px;overflow-y:auto;"></div>
      </div>
    </div>
  `;
  Modal.open('切り札を選択', body, `<button class="btn" id="tpkClose">閉じる</button>`, { wide: true });
  document.getElementById('tpkClose').addEventListener('click', Modal.close);
  document.getElementById('tpFPanelHost').innerHTML = filterPanelHtml('tpF', { hidePower: true });
  renderFilterChips('tpF', renderResults);
  wireFilterInputs('tpF', renderResults);

  function renderResults() {
    const f = readFilters('tpF');
    const base = App.allCards.filter(c => c.type === 'マホウ');
    const matched = filterCards(base, f);
    document.getElementById('tpResultCount').textContent = `${matched.length}件`;
    const results = matched.slice(0, 60);
    document.getElementById('trumpPickResults').innerHTML = results.map(c => `
        <div class="card-row" data-card-id="${c.id}">
          <div class="thumb-sm" data-action="tpk-detail" data-card-id="${c.id}">${cardThumbHtml(c)}</div>
          <span class="type-badge type-${c.type}">${TYPE_SHORT[c.type]}</span>
          <span class="name">${escapeHtml(c.name)}</span>
          <span class="sub">${cardStatLine(c)} ・ ${c.colors.join('/')}</span>
          <button class="btn small primary" data-action="tpk-pick" data-card-id="${c.id}">選択</button>
        </div>`).join('') || `<div class="empty-state" style="padding:16px;">該当するカードがありません</div>`;
  }
  renderResults();
  document.getElementById('trumpPickResults').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'tpk-detail') { openCardDetail(btn.dataset.cardId, () => openTrumpPicker()); return; }
    if (btn.dataset.action === 'tpk-pick') {
      deck.trumpCard = btn.dataset.cardId;
      deck.trumpQty = 1;
      markWorkingDirty();
      Modal.close();
      renderDeckEditor();
      toast('切り札を選択しました');
    }
  });
}

/* ---- デッキサムネイル選択 ---- */
function openThumbnailPicker() {
  const deck = App.workingDeck;
  if (!deck) return;
  const uniqueCards = [];
  const seen = new Set();
  for (const e of deck.mainCards) {
    if (seen.has(e.cardId)) continue;
    seen.add(e.cardId);
    const c = getCard(e.cardId);
    if (c) uniqueCards.push(c);
  }
  if (!uniqueCards.length) {
    Modal.open('サムネイルを選ぶ', `<div class="empty-state"><div class="big">🃏</div>メインデッキにカードを追加すると選べるようになります。</div>`, `<button class="btn" id="tpClose">閉じる</button>`);
    document.getElementById('tpClose').addEventListener('click', Modal.close);
    return;
  }
  const autoCard = uniqueCards[0];
  const isAuto = !deck.thumbnailCardId;
  const body = `
    <div class="manager-grid" style="grid-template-columns:repeat(auto-fill, minmax(110px,1fr));">
      <div class="item-card" style="box-shadow:none;cursor:pointer;padding:8px;${isAuto ? 'outline:2px solid var(--accent);' : ''}" data-action="pick-thumb" data-id="">
        <div class="item-thumb">${cardThumbHtml(autoCard)}</div>
        <div class="sub" style="text-align:center;">自動（先頭カード）</div>
      </div>
      ${uniqueCards.map(c => `
        <div class="item-card" style="box-shadow:none;cursor:pointer;padding:8px;${deck.thumbnailCardId === c.id ? 'outline:2px solid var(--accent);' : ''}" data-action="pick-thumb" data-id="${c.id}">
          <div class="item-thumb">${cardThumbHtml(c)}</div>
          <div class="sub" style="text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.name)}</div>
        </div>`).join('')}
    </div>
  `;
  Modal.open('サムネイルを選ぶ', body, `<button class="btn" id="tpClose">閉じる</button>`, { wide: true });
  document.getElementById('tpClose').addEventListener('click', Modal.close);
  document.getElementById('modalBody').addEventListener('click', (e) => {
    const item = e.target.closest('[data-action="pick-thumb"]');
    if (!item) return;
    deck.thumbnailCardId = item.dataset.id || null;
    markWorkingDirty();
    Modal.close();
    document.getElementById('deckThumbPreview').innerHTML = deckThumbHtml(deck);
    toast('サムネイルを変更しました');
  });
}

/* ---- タグ入力共通 ---- */
function renderTagChipsGeneric(rowId, inputId, tags) {
  const row = document.getElementById(rowId);
  row.querySelectorAll('.tag-pill').forEach(el => el.remove());
  const input = document.getElementById(inputId);
  for (const tag of tags) {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `${escapeHtml(tag)}<button data-tag="${escapeHtml(tag)}">✕</button>`;
    row.insertBefore(pill, input);
  }
  row.dataset.tags = JSON.stringify(tags);
  row.querySelectorAll('.tag-pill button').forEach(btn => btn.addEventListener('click', () => {
    const cur = JSON.parse(row.dataset.tags || '[]').filter(t => t !== btn.dataset.tag);
    renderTagChipsGeneric(rowId, inputId, cur);
  }));
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      e.preventDefault();
      const cur = JSON.parse(row.dataset.tags || '[]');
      if (!cur.includes(input.value.trim())) cur.push(input.value.trim());
      renderTagChipsGeneric(rowId, inputId, cur);
      document.getElementById(inputId).focus();
    }
  };
}
function collectTagChips(rowId) {
  return JSON.parse(document.getElementById(rowId).dataset.tags || '[]');
}


