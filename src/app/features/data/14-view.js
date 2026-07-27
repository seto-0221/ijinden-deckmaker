/* ========================= 7e. データ管理タブ ========================= */
function renderDataView() {
  const info = document.getElementById('dbInfo');
  const bySet = {};
  for (const c of App.allCards) bySet[c.set] = (bySet[c.set] || 0) + 1;
  const setLines = Object.keys(bySet).sort((a, b) => String(a).localeCompare(String(b), 'ja', { numeric: true }))
    .map(s => `${s}: ${bySet[s]}枚`).join(' / ');
  info.textContent = `合計 ${App.allCards.length} 枚のカードを収録（うち手動追加・インポート分 ${App.state.customCards.length} 枚）。 ${setLines}`;

  const bytes = Store.sizeBytes();
  const pct = Math.min(100, Math.round(bytes / (5 * 1024 * 1024) * 100));
  document.getElementById('storageInfo').textContent = `保存データ: 約 ${(bytes / 1024).toFixed(1)} KB （ブラウザのlocalStorage上限は概ね5MB程度です）`;
  document.getElementById('storageBar').style.width = pct + '%';

  renderRegulationManagerList();
}

function renderRegulationManagerList() {
  const el = document.getElementById('regulationManagerList');
  el.innerHTML = allRegulations().map(r => `
    <div class="item-card" style="box-shadow:none;flex-direction:row;align-items:center;justify-content:space-between;padding:8px 12px;">
      <div><div style="font-weight:700;font-size:13px;">${escapeHtml(r.name)}${r.builtin ? ' <span class="badge neutral">標準</span>' : ''}</div>
      <div class="sub" style="font-size:11.5px;">${escapeHtml(r.note || '')}</div></div>
      ${r.builtin ? '' : `<button class="btn small danger" data-action="del-regulation" data-id="${r.id}">削除</button>`}
    </div>`).join('');
}

function openRegulationForm() {
  const pendingRestrictions = []; // このモーダル内だけの一時リスト。「追加」で確定するまでレギュレーションには反映されない

  const body = `
    <div class="form-row"><label>名前</label><input id="regName" type="text" placeholder="例: 第5弾までフォーマット"></div>
    <div class="form-inline">
      <div class="form-row"><label>メイン最小枚数</label><input id="regMin" type="number" value="40"></div>
      <div class="form-row"><label>メイン最大枚数（空欄=無制限）</label><input id="regMax" type="number"></div>
    </div>
    <div class="form-inline">
      <div class="form-row"><label>同名カード上限（空欄=無制限）</label><input id="regCopies" type="number" value="4"></div>
      <div class="form-row"><label>サイド枚数上限（空欄=無制限, 0=不可）</label><input id="regSide" type="number" value="10"></div>
    </div>
    <div class="form-row"><label>メモ</label><textarea id="regNote" rows="2"></textarea></div>

    <div class="form-row" style="border-top:1px solid var(--border); padding-top:12px; margin-top:4px;">
      <label>禁止・制限カード</label>
      <div class="sub" style="font-size:11.5px; color:var(--text-dim); margin-bottom:6px;">
        カード名を1枚だけ指定するか、レアリティ・収録弾・色・種類などの絞り込み条件で複数枚まとめて指定できます。
        それぞれ「完全禁止」または「枚数制限」を選んでルールとして追加してください。
      </div>
      <div id="regRestrictionList" style="display:flex; flex-direction:column; gap:6px; margin-bottom:10px;"></div>

      <div class="seg" id="regRestrictModeSeg">
        <button class="on" type="button" data-mode="name">カード名で指定</button>
        <button type="button" data-mode="filter">絞り込みで指定</button>
      </div>

      <div id="regRestrictNamePanel" style="margin-top:8px;">
        <input id="regRestrictNameInput" type="text" list="regRestrictNameList" placeholder="カード名を入力(候補から選択してください)" style="width:100%;">
        <datalist id="regRestrictNameList"></datalist>
      </div>
      <div id="regRestrictFilterPanel" style="display:none; margin-top:8px;">
        <div class="filter-col panel" id="regRestrictFilterHost" style="max-height:320px; overflow-y:auto;"></div>
        <div class="sub" id="regRestrictFilterCount" style="margin:6px 0; color:var(--text-dim); font-size:12px;"></div>
      </div>

      <div class="form-inline" style="align-items:flex-end; margin-top:8px;">
        <div class="form-row">
          <label>制限の種類</label>
          <select id="regRestrictKind">
            <option value="ban">完全禁止(使用不可)</option>
            <option value="limit">枚数制限</option>
          </select>
        </div>
        <div class="form-row" id="regRestrictLimitRow" style="display:none;">
          <label>上限枚数</label>
          <input id="regRestrictLimitCount" type="number" min="0" value="1">
        </div>
        <button class="btn small" id="regRestrictAddBtn" type="button">このルールを追加</button>
      </div>
    </div>
  `;
  const foot = `<button class="btn" id="regCancel">キャンセル</button><button class="btn primary" id="regSave">追加</button>`;
  Modal.open('レギュレーションを追加', body, foot, { wide: true });
  document.getElementById('regCancel').addEventListener('click', Modal.close);

  // カード名指定モード用の候補一覧(ヒエロスガモスの色違いはまとめて1件にする)
  const nameSet = new Set(App.allCards.map(c => cardLimitName(c)));
  document.getElementById('regRestrictNameList').innerHTML =
    Array.from(nameSet).sort((a, b) => a.localeCompare(b, 'ja')).map(n => `<option value="${escapeHtml(n)}"></option>`).join('');

  document.getElementById('regRestrictFilterHost').innerHTML = filterPanelHtml('regRestrictF', { sort: false, reset: false });
  const updateFilterPreviewCount = () => {
    const f = readFilters('regRestrictF');
    const countEl = document.getElementById('regRestrictFilterCount');
    if (!filterHasAnyCriteria(f)) { countEl.textContent = '絞り込み条件を1つ以上指定してください'; return; }
    const n = App.allCards.filter(c => matchesFilter(c, f)).length;
    countEl.textContent = `${n}枚のカードが該当します`;
  };
  renderFilterChips('regRestrictF', updateFilterPreviewCount);
  wireFilterInputs('regRestrictF', updateFilterPreviewCount, { reset: false });
  updateFilterPreviewCount();

  const renderRestrictionList = () => {
    const el = document.getElementById('regRestrictionList');
    if (!pendingRestrictions.length) {
      el.innerHTML = `<div class="sub" style="color:var(--text-dim); font-size:12px;">まだルールがありません</div>`;
      return;
    }
    el.innerHTML = pendingRestrictions.map(r => `
      <div class="item-card" style="box-shadow:none; flex-direction:row; align-items:center; justify-content:space-between; padding:6px 10px;">
        <div class="sub" style="font-size:12px;">${escapeHtml(describeRestrictionRule(r))}</div>
        <button class="btn small danger" type="button" data-action="rm-restriction" data-id="${r.id}">削除</button>
      </div>`).join('');
  };
  renderRestrictionList();
  document.getElementById('regRestrictionList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="rm-restriction"]');
    if (!btn) return;
    const idx = pendingRestrictions.findIndex(r => r.id === btn.dataset.id);
    if (idx >= 0) pendingRestrictions.splice(idx, 1);
    renderRestrictionList();
  });

  const modeSeg = document.getElementById('regRestrictModeSeg');
  modeSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    modeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
    document.getElementById('regRestrictNamePanel').style.display = btn.dataset.mode === 'name' ? '' : 'none';
    document.getElementById('regRestrictFilterPanel').style.display = btn.dataset.mode === 'filter' ? '' : 'none';
  });

  document.getElementById('regRestrictKind').addEventListener('change', (e) => {
    document.getElementById('regRestrictLimitRow').style.display = e.target.value === 'limit' ? '' : 'none';
  });

  document.getElementById('regRestrictAddBtn').addEventListener('click', () => {
    const mode = modeSeg.querySelector('button.on').dataset.mode;
    const kind = document.getElementById('regRestrictKind').value;
    const limitCount = kind === 'limit' ? Math.max(0, Math.floor(Number(document.getElementById('regRestrictLimitCount').value) || 0)) : null;
    let rule;
    if (mode === 'name') {
      const name = document.getElementById('regRestrictNameInput').value.trim();
      if (!name) { toast('カード名を入力してください', 'err'); return; }
      if (!nameSet.has(name)) { toast('候補一覧にある名前を選択してください', 'err'); return; }
      rule = { id: uid('rest'), mode: 'name', name, kind, limitCount };
      document.getElementById('regRestrictNameInput').value = '';
    } else {
      const f = readFilters('regRestrictF');
      if (!filterHasAnyCriteria(f)) { toast('絞り込み条件を1つ以上指定してください', 'err'); return; }
      rule = { id: uid('rest'), mode: 'filter', filter: f, kind, limitCount };
    }
    pendingRestrictions.push(rule);
    renderRestrictionList();
    toast('ルールを追加しました(レギュレーション保存時に確定します)');
  });

  document.getElementById('regSave').addEventListener('click', () => {
    const name = document.getElementById('regName').value.trim();
    if (!name) { toast('名前を入力してください', 'err'); return; }
    const numOr = (id) => { const s = document.getElementById(id).value; return s === '' ? null : Number(s); };
    App.state.regulations.push({
      id: uid('reg'), name, builtin: false,
      minMain: numOr('regMin'), maxMain: numOr('regMax'), maxCopies: numOr('regCopies'), sideMax: numOr('regSide'),
      cardRestrictions: pendingRestrictions,
      note: document.getElementById('regNote').value.trim(),
    });
    persist(); Modal.close(); renderDataView(); toast('レギュレーションを追加しました');
  });
}

/* ---- デッキ画像出力 ---- */
function getColorHex(col) {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--c-' + col);
  return (v && v.trim()) || '#888888';
}

// カードタイプ別には分けず、名前順の1本のリストにする(画像出力のグリッド用)
// 画像出力専用の並び順: イジン→マホウ→ハイケイ→マリョクの種類順、種類内は色順(青赤緑黄紫、無は最後)、
// 色内はレベル高→低(マホウのみさらにレベル内で魔法コスト高→低)、最後にレアリティ高→低で並べる。
const IMAGE_EXPORT_TYPE_ORDER = ['イジン', 'マホウ', 'ハイケイ', 'マリョク'];
const IMAGE_EXPORT_COLOR_ORDER = ['青', '赤', '緑', '黄', '紫', '無'];
function groupDeckListForImage(list) {
  const entries = list.map(e => ({ c: getCard(e.cardId), qty: e.qty, cardId: e.cardId }));
  entries.sort((a, b) => {
    const ca = a.c, cb = b.c;
    if (!ca && !cb) return (a.cardId || '').localeCompare(b.cardId || '', 'ja');
    if (!ca) return 1; // 未登録カードは末尾へ
    if (!cb) return -1;
    const typeIdx = (c) => { const i = IMAGE_EXPORT_TYPE_ORDER.indexOf(c.type); return i === -1 ? IMAGE_EXPORT_TYPE_ORDER.length : i; };
    let cmp = typeIdx(ca) - typeIdx(cb);
    if (cmp) return cmp;
    const colorIdx = (c) => { const col = c.colors && c.colors[0]; const i = IMAGE_EXPORT_COLOR_ORDER.indexOf(col); return i === -1 ? IMAGE_EXPORT_COLOR_ORDER.length : i; };
    cmp = colorIdx(ca) - colorIdx(cb);
    if (cmp) return cmp;
    const lvA = ca.level != null ? ca.level : -1;
    const lvB = cb.level != null ? cb.level : -1;
    cmp = lvB - lvA; // レベル高→低
    if (cmp) return cmp;
    if (ca.type === 'マホウ' || cb.type === 'マホウ') {
      const costA = ca.cost != null ? ca.cost : -1;
      const costB = cb.cost != null ? cb.cost : -1;
      cmp = costB - costA; // マホウはレベル内で魔法コスト高→低
      if (cmp) return cmp;
    }
    const rarIdx = (c) => { const i = RARITIES.indexOf(c.rarity); return i === -1 ? -1 : i; };
    cmp = rarIdx(cb) - rarIdx(ca); // レアリティ高→低(RARITIESはN<R<SR<PSRの昇順配列)
    if (cmp) return cmp;
    return ca.name.localeCompare(cb.name, 'ja');
  });
  return entries;
}

// 画像を<img>要素として読み込む(失敗時はnullでresolveする、rejectしない)
function loadImageEl(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// カードのサムネイル画像を読み込む。
// 最優先で、ビルド時にHTMLへ埋め込み済みのbase64サムネ(CARD_THUMB_B64)を使う。
// data: URLは生成元(オリジン)を持たないためcanvasを汚染(タインティング)せず、file://環境でも確実にtoDataURL/toBlobできる。
// 埋め込みデータが無いカードのみ、従来通りfetch→Blob URL化(失敗時は直接<img src>)で読み込みを試みる。
async function loadCardThumbImage(c) {
  const b64 = CARD_THUMB_B64[c.id];
  if (b64) {
    const img = await loadImageEl(b64);
    if (img) return img;
  }
  const candidates = imageCandidates(c);
  for (const url of candidates) {
    try {
      const resp = await fetch(url);
      if (resp && resp.ok) {
        const blob = await resp.blob();
        const objUrl = URL.createObjectURL(blob);
        const img = await loadImageEl(objUrl);
        if (img) return img;
        URL.revokeObjectURL(objUrl);
      }
    } catch (e) { /* fetch不可(file://制限など) → 直接読み込みにフォールバック */ }
    const img = await loadImageEl(url);
    if (img) return img;
  }
  return null;
}

async function preloadDeckThumbImages(deck) {
  const imgMap = new Map();
  const ids = new Set();
  for (const e of deck.mainCards.concat(deck.sideCards)) ids.add(e.cardId);
  for (const id of (deck.leaderCards || [])) ids.add(id);
  if (deck.trumpCard) ids.add(deck.trumpCard);
  await Promise.all(Array.from(ids).map(async (id) => {
    const c = getCard(id);
    if (!c) return;
    const img = await loadCardThumbImage(c);
    imgMap.set(id, img);
  }));
  return imgMap;
}

const GRID_COLS = 6;
const GRID_CELL_W = 170;
const GRID_GAP = 16;
const GRID_IMG_H = Math.round(GRID_CELL_W * 1.4);
const GRID_NAME_H = 38;
const GRID_CELL_H = GRID_IMG_H + GRID_NAME_H;

// 指定幅に収まる様に日本語テキストを最大maxLines行まで折り返して中央揃えで描画する(超過分は末尾を…に)
function wrapCenteredText(ctx, text, cx, topY, maxWidth, lineHeight, maxLines) {
  const chars = Array.from(String(text || ''));
  const lines = [];
  let cur = '';
  for (const ch of chars) {
    const test = cur + ch;
    if (cur && ctx.measureText(test).width > maxWidth) {
      lines.push(cur);
      cur = ch;
      if (lines.length >= maxLines) break;
    } else {
      cur = test;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  const consumedLen = lines.join('').length;
  if (lines.length >= maxLines && consumedLen < chars.length) {
    let last = lines[maxLines - 1];
    while (last.length > 0 && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'center';
  lines.forEach((ln, i) => ctx.fillText(ln, cx, topY + i * lineHeight));
  ctx.textAlign = prevAlign;
}

function groupGridHeight(entries) {
  const rows = Math.ceil(entries.length / GRID_COLS);
  return rows * (GRID_CELL_H + GRID_GAP);
}

// useImages=falseの場合はカード画像を一切描画しない(タインティングでtoDataURL/toBlobが失敗した際のフォールバック用)
// ---- QRコード: 共有リンクの発行/画像出力への埋め込み/読み取りインポート用に、外部ライブラリを必要時のみ読み込む ----
// (xlsxライブラリと同様、オフライン等で読み込みに失敗しても他の機能には影響しないよう呼び出し側でtry/catchする)
// qrcode-generator/jsQRは外部CDNからではなく、ファイル冒頭に直接埋め込んで同梱している
// (以前はCDNから動的に読み込んでいたが、環境によっては拡張機能・企業ネットワーク等でCDNへのアクセスがブロックされ
//  「インターネット接続が必要です」というエラーになる報告があったため、他の機能と同様に完全オフラインで動くようにした)。
// ただし埋め込みライブラリ(約300KB)を毎回のページ読み込み時に実行すると初期表示が遅くなるため、
// 埋め込み<script type="text/plain">はそのままでは実行されない状態にしてあり、QR機能を実際に使う瞬間にのみ
// テキストを取り出してevalし、初回だけ実行コストを払うようにしている(2回目以降はwindow.qrcode/window.jsQRが
// 既に存在するので即resolveする)。
function execInertScript(scriptId) {
  const el = document.getElementById(scriptId);
  if (!el) return false;
  try {
    // 間接eval: グローバルスコープで実行されるため、ライブラリ内のvar宣言やroot(=self)への代入が
    // window上のプロパティとして確実に反映される(関数ローカルスコープに閉じ込められない)。
    (0, eval)(el.textContent);
    return true;
  } catch (e) {
    console.error('埋め込みライブラリの実行に失敗しました: ' + scriptId, e);
    return false;
  }
}
function ensureQREncodeLib() {
  if (!window.qrcode) execInertScript('lib-qrcode-generator');
  if (!window.qrcode) return Promise.reject(new Error('QRコード生成ライブラリを読み込めませんでした。ページを再読み込みしてお試しください。'));
  return Promise.resolve();
}
function ensureQRDecodeLib() {
  if (!window.jsQR) execInertScript('lib-jsqr');
  if (!window.jsQR) return Promise.reject(new Error('QRコード読み取りライブラリを読み込めませんでした。ページを再読み込みしてお試しください。'));
  return Promise.resolve();
}
// テキスト(共有リンクURL)からQRコードのモジュール(白黒マス)データを作る。ensureQREncodeLib()の読み込み完了後に呼ぶこと。
// データが大きすぎてQR化できない場合や未読み込みの場合はnullを返す。
function buildQRModel(text) {
  if (!window.qrcode) return null;
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return { qr, count: qr.getModuleCount() };
  } catch (e) {
    return null;
  }
}
// QRモデルを、1マス=cellSize(整数px)としてそのままcanvasに焼き込む。
// 【重要】QRコードは後から別サイズへ拡大縮小(drawImageでの引き伸ばしやCSSでの表示サイズ変更)すると、
// にじみ・モアレでモジュールの境界が崩れて読み取れなくなることがある。呼び出し側は必ずcanvasの実サイズのまま
// (drawImage(canvas, x, y)のように幅・高さを指定せず)使うこと。
function rasterizeQRCanvas(model, cellSize) {
  const { qr, count } = model;
  const size = count * cellSize;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
    }
  }
  return canvas;
}
// テキストをQRコードのcanvasに変換する(1マスあたりcellSizeピクセル、等倍でそのまま使うこと)。
// 未読み込み・生成失敗時はnullを返す。
function buildQRCanvas(text, cellSize) {
  const model = buildQRModel(text);
  if (!model) return null;
  return rasterizeQRCanvas(model, cellSize || 4);
}
// テキストをQRコードのcanvasに変換する。目標の一辺の長さ(targetPx)に近くなるよう、
// マス目1個分が整数pxになる範囲で自動的にセルサイズを選ぶ(小さすぎるQRを無理に等倍で使うと大きくなりすぎるため)。
function buildQRCanvasFit(text, targetPx) {
  const model = buildQRModel(text);
  if (!model) return null;
  const cellSize = Math.max(1, Math.round((targetPx || 120) / model.count));
  return rasterizeQRCanvas(model, cellSize);
}
// アップロードされた画像ファイル(QRコード単体の画像・QRコードが埋め込まれたデッキ画像出力・スクリーンショット等)から
// QRコードを読み取り、その内容の文字列を返す。読み取れなければnullを返す。
async function decodeQRFromImageFile(file) {
  await ensureQRDecodeLib();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
  const img = await loadImageEl(dataUrl);
  if (!img) throw new Error('画像を読み込めませんでした');
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = window.jsQR(imageData.data, imageData.width, imageData.height);
  return result ? result.data : null;
}

// 指定した最大幅に収まるよう、必要であれば末尾を「…」で省略したテキストを返す(現在のctx.fontを使用)
function truncateTextToWidth(ctx, text, maxW) {
  if (maxW <= 0) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s.length < text.length ? s + '…' : s;
}

// メイン/サイド/統領/切り札で共通利用する、1枚分のカードタイル(画像+枚数バッジ+色ドット+カード名)を描画する。
function drawCardImageTile(ctx, cellX, cellY, entry, imgMap, useImages) {
  const { c, qty, cardId } = entry;
  const img = useImages && c ? imgMap.get(cardId) : null;
  if (img) {
    ctx.drawImage(img, cellX, cellY, GRID_CELL_W, GRID_IMG_H);
  } else {
    ctx.fillStyle = '#eeeeee';
    ctx.fillRect(cellX, cellY, GRID_CELL_W, GRID_IMG_H);
    ctx.strokeStyle = '#dddddd';
    ctx.strokeRect(cellX, cellY, GRID_CELL_W, GRID_IMG_H);
  }
  // 枚数バッジ(左上)。カード画像の上に黒文字を直接置くと絵柄次第で見にくくなるため、
  // 数字の後ろに最小限の白背景を敷いてから濃色の文字を描く
  ctx.font = 'bold 17px sans-serif';
  const badgeText = `${qty}x`;
  const badgeW = ctx.measureText(badgeText).width + 12;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(cellX + 6, cellY + 6, badgeW, 24);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cellX + 6, cellY + 6, badgeW, 24);
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'left';
  ctx.fillText(badgeText, cellX + 12, cellY + 24);
  // 色ドット(右上)
  if (c && c.colors && c.colors.length) {
    let dotX = cellX + GRID_CELL_W - 12;
    for (const col2 of c.colors) {
      ctx.beginPath();
      ctx.fillStyle = getColorHex(col2);
      ctx.arc(dotX, cellY + 19, 7, 0, Math.PI * 2);
      ctx.fill();
      dotX -= 18;
    }
  }
  // カード名(画像下、中央揃え・最大2行)
  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#222222';
  wrapCenteredText(ctx, c ? c.name : `(未登録: ${cardId})`, cellX + GRID_CELL_W / 2, cellY + GRID_IMG_H + 17, GRID_CELL_W - 6, 17, 2);
}

// 統領・切り札を「メインデッキの上の専用枠」に左から統領→切り札の順で並べるためのエントリ一覧を作る。
function leaderTrumpEntries(deck) {
  ensureLeaderFields(deck);
  const entries = [];
  for (const id of (deck.leaderCards || [])) {
    const c = getCard(id);
    entries.push({ c, qty: 1, cardId: id, role: '統領' });
  }
  if (deck.trumpCard) {
    const c = getCard(deck.trumpCard);
    entries.push({ c, qty: deck.trumpQty || 1, cardId: deck.trumpCard, role: '切り札' });
  }
  return entries;
}
const LT_ROLE_LABEL_H = 18;
// 統領・切り札の枠全体(タイトル行+カード行+余白)が消費する高さ。canvasサイズの事前計算と実際の描画の
// 両方から呼び、必ず同じ値になるようにする(ずれるとcanvasの高さが実際の描画内容と合わなくなるため)。
function leaderTrumpSectionHeight(entries) {
  if (!entries.length) return 34 + 24 + 16;
  const rows = Math.ceil(entries.length / GRID_COLS);
  return 34 + rows * (LT_ROLE_LABEL_H + GRID_CELL_H + GRID_GAP) + 16;
}

// 統計の数値1つ分(枚数など)を四角いボックスとして描画する
function drawStatBox(ctx, x, y, w, h, value, label) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#e2e2e6';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 21px sans-serif';
  ctx.fillText(String(value), x + w / 2, y + h / 2 - 1);
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#888888';
  ctx.fillText(label, x + w / 2, y + h - 9);
  ctx.textAlign = 'left';
}

// レベルカーブ(色構成の積み上げ棒グラフ)をcanvasに描画する。デッキ編集画面のミニ表示と同じ
// computeLevelColorBreakdown()のデータをそのまま使い、見た目を極力揃える。
function drawLevelCurveChart(ctx, x, y, w, h, byLevel) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#e2e2e6';
  ctx.strokeRect(x, y, w, h);
  const entries = Array.from(byLevel.entries()).sort((a, b) => {
    if (a[0] === '?') return 1;
    if (b[0] === '?') return -1;
    return (Number(a[0]) || 0) - (Number(b[0]) || 0);
  });
  if (!entries.length) {
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#999999';
    ctx.textAlign = 'center';
    ctx.fillText('レベルカーブのデータがありません', x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
    return;
  }
  const totals = entries.map(([, colorMap]) => Array.from(colorMap.values()).reduce((a, b) => a + b, 0));
  const maxV = Math.max(1, ...totals);
  const innerPad = 12;
  const labelH = 16;
  const countLabelH = 14;
  const barAreaTop = y + innerPad + countLabelH;
  const barAreaH = h - innerPad * 2 - labelH - countLabelH;
  const gap = 8;
  const barW = Math.max(6, (w - innerPad * 2 - gap * (entries.length - 1)) / entries.length);
  let bx = x + innerPad;
  ctx.textAlign = 'center';
  entries.forEach(([lvKey, colorMap], i) => {
    const total = totals[i];
    const barH = Math.max(2, Math.round(total / maxV * barAreaH));
    let stackY = barAreaTop + barAreaH;
    const colorsPresent = COLORS.filter(col => colorMap.get(col));
    for (const col of colorsPresent) {
      const qty = colorMap.get(col);
      const segH = Math.max(1, Math.round(qty / total * barH));
      stackY -= segH;
      ctx.fillStyle = getColorHex(col);
      ctx.fillRect(bx, stackY, barW, segH);
    }
    ctx.fillStyle = '#555555';
    ctx.font = '11px sans-serif';
    ctx.fillText(String(total), bx + barW / 2, barAreaTop + barAreaH - barH - 5);
    ctx.fillStyle = '#333333';
    ctx.font = '12px sans-serif';
    ctx.fillText(String(lvKey), bx + barW / 2, y + h - 8);
    bx += barW + gap;
  });
  ctx.textAlign = 'left';
}

function buildDeckImageCanvas(deck, imgMap, useImages, qrCanvas, logoImg) {
  ensureLeaderFields(deck);
  const reg = getRegulation(deck.regulationId);
  const padding = 40;
  const gridContentW = GRID_COLS * GRID_CELL_W + (GRID_COLS - 1) * GRID_GAP;
  const width = gridContentW + padding * 2;
  const contentW = width - padding * 2;

  const mainGroups = groupDeckListForImage(deck.mainCards);
  const sideGroups = groupDeckListForImage(deck.sideCards);
  const ltEntries = reg.hasLeaderZone ? leaderTrumpEntries(deck) : [];

  // ヘッダーは3カラム構成: 左=ロゴ+デッキ名+レギュレーション、中央=統計+レベルカーブ、右=QRコード。
  // 各カラムの高さはデッキの内容によらず固定(データ依存の可変要素はテキストの折返し先ではなく
  // 統計ボックス+レベルカーブ側に寄せてあるため)。3カラムのうち一番高いものにヘッダー全体の高さを合わせる。
  const logoH = 64;
  const logoW = logoImg ? Math.round(logoImg.naturalWidth * (logoH / logoImg.naturalHeight)) : 0;
  const LEFT_COL_W = Math.max(280, logoW + 20);
  const LEFT_COL_H = logoH + 34 + 25 + 10; // ロゴ + デッキ名行 + レギュレーション行 + 下余白
  const STATS_PANEL_H = 150;
  const qrBoxSize = qrCanvas ? qrCanvas.width : 0;
  const qrBlockH = qrCanvas ? (qrBoxSize + 12 + 8) : 0;
  const headerH = Math.max(LEFT_COL_H, STATS_PANEL_H, qrBlockH);

  const leaderTrumpH = reg.hasLeaderZone ? leaderTrumpSectionHeight(ltEntries) : 0;
  const mainSectionH = mainGroups.length ? (34 + groupGridHeight(mainGroups) + 16) : 0;
  const sideSectionH = sideGroups.length ? (34 + groupGridHeight(sideGroups) + 16) : 0;
  // 下の余白は上のpaddingとそろえる(以前は別途footerHを足していたため下だけ余白が目立って広くなっていた)
  const totalH = padding + headerH + leaderTrumpH + mainSectionH + sideSectionH + padding;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.max(300, Math.round(totalH));
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let y = padding;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // ---- 左カラム: ロゴ(テキスト付きの横組み、大きめ)。その下にデッキ名、さらにその下にレギュレーション ----
  if (logoImg) ctx.drawImage(logoImg, padding, y, logoW, logoH);
  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = '#1a1a1a';
  const nameBaselineY = y + logoH + 34;
  ctx.fillText(truncateTextToWidth(ctx, deck.name || '(名称未設定)', LEFT_COL_W), padding, nameBaselineY);
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#666666';
  const regBaselineY = nameBaselineY + 25;
  ctx.fillText(`レギュレーション: ${reg.name}`, padding, regBaselineY);

  // ---- 右カラム: QRコード(右上、実サイズのまま描画) ----
  if (qrCanvas) {
    const qx = width - padding - qrBoxSize;
    const qy = padding;
    ctx.drawImage(qrCanvas, qx, qy);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#888888';
    ctx.textAlign = 'center';
    ctx.fillText('スキャンして読み込み', qx + qrBoxSize / 2, qy + qrBoxSize + 12);
    ctx.textAlign = 'left';
  }

  // ---- 中央カラム: 統計+レベルカーブ(ロゴ列とQRコードの間に配置。枚数・タグ・統領/切り札などの
  //      テキスト情報の代わりに画像で見せる。統領戦の場合はメイン単独の枚数は省き、
  //      メイン+統領+切り札の合計だけを見せれば十分なので、その1箱に置き換える) ----
  const colGap = 24;
  const statColX = padding + LEFT_COL_W + colGap;
  const qrLeftEdge = qrCanvas ? (width - padding - qrBoxSize) : (width - padding);
  const statColW = Math.max(200, qrLeftEdge - colGap - statColX);
  const mainTotal = deckTotalQty(deck.mainCards);
  const sideTotal = deckTotalQty(deck.sideCards);
  const uniqueCount = new Set(deck.mainCards.map(e => e.cardId)).size;
  const dstats = computeDeckStats(deck);
  const statBoxes = [];
  if (!reg.hasLeaderZone) statBoxes.push([mainTotal, 'メイン']);
  statBoxes.push([sideTotal, 'サイド'], [uniqueCount, 'カード種'], [dstats.avgLevel != null ? dstats.avgLevel : '-', '平均Lv']);
  if (reg.hasLeaderZone) {
    const leaderCount = deck.leaderCards.length;
    const trumpCount = deck.trumpCard ? (deck.trumpQty || 1) : 0;
    statBoxes.push([mainTotal + leaderCount + trumpCount, 'メイン+統領+切り札']);
  }
  const statBoxH = 50, statBoxGap = 10;
  const statBoxW = Math.max(70, Math.floor((statColW - statBoxGap * (statBoxes.length - 1)) / statBoxes.length));
  let sbx = statColX;
  for (const [value, label] of statBoxes) {
    drawStatBox(ctx, sbx, y, statBoxW, statBoxH, value, label);
    sbx += statBoxW + statBoxGap;
  }
  const chartY = y + statBoxH + 10;
  const chartH = STATS_PANEL_H - statBoxH - 10;
  drawLevelCurveChart(ctx, statColX, chartY, statColW, chartH, computeLevelColorBreakdown(deck));

  // ヘッダー分の高さを確定させ、以降のセクションはロゴ列・統計パネル・QRのどれより下からでも必ず重ならない位置から描く
  y = padding + headerH;

  // ---- 統領・切り札(メインデッキの上の専用枠に、左から統領→切り札の順で配置) ----
  if (reg.hasLeaderZone) {
    const sectionH = leaderTrumpSectionHeight(ltEntries);
    ctx.fillStyle = '#f7f7fa';
    ctx.fillRect(padding - 12, y - 8, contentW + 24, sectionH - 8);
    ctx.strokeStyle = '#e6e6ec';
    ctx.lineWidth = 1;
    ctx.strokeRect(padding - 12, y - 8, contentW + 24, sectionH - 8);

    ctx.font = 'bold 19px sans-serif';
    ctx.fillStyle = '#222222';
    ctx.fillText('統領・切り札', padding, y + 18);
    y += 34;
    if (!ltEntries.length) {
      ctx.font = '13px sans-serif';
      ctx.fillStyle = '#999999';
      ctx.fillText('統領・切り札が選択されていません', padding, y + 16);
      y += 24 + 16;
    } else {
      let col = 0;
      for (const entry of ltEntries) {
        const cellX = padding + col * (GRID_CELL_W + GRID_GAP);
        const roleY = y;
        const cellY = y + LT_ROLE_LABEL_H;
        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = '#666666';
        ctx.fillText(entry.role, cellX, roleY + 13);
        drawCardImageTile(ctx, cellX, cellY, entry, imgMap, useImages);
        col++;
        if (col >= GRID_COLS) { col = 0; y += LT_ROLE_LABEL_H + GRID_CELL_H + GRID_GAP; }
      }
      if (col > 0) y += LT_ROLE_LABEL_H + GRID_CELL_H + GRID_GAP;
      y += 16;
    }
  }

  const drawSection = (title, entries) => {
    if (!entries.length) return;
    const total = entries.reduce((s, e) => s + e.qty, 0);
    ctx.font = 'bold 19px sans-serif';
    ctx.fillStyle = '#222222';
    ctx.fillText(`${title} (${total}枚)`, padding, y + 18);
    y += 34;

    let col = 0;
    for (const entry of entries) {
      const cellX = padding + col * (GRID_CELL_W + GRID_GAP);
      const cellY = y;
      drawCardImageTile(ctx, cellX, cellY, entry, imgMap, useImages);
      col++;
      if (col >= GRID_COLS) { col = 0; y += GRID_CELL_H + GRID_GAP; }
    }
    if (col > 0) y += GRID_CELL_H + GRID_GAP;
    y += 16;
  };

  drawSection('メインデッキ', mainGroups);
  drawSection('サイドデッキ', sideGroups);

  ctx.font = '11.5px sans-serif';
  ctx.fillStyle = '#aaaaaa';
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  ctx.fillText(`イジンデン デッキメーカー / ${dateStr} 出力`, padding, canvas.height - 16);

  return canvas;
}

function downloadCanvasAsPNG(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) { toast('画像の書き出しに失敗しました', 'err'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}

// 画像出力に埋め込むロゴ(イジンデンラボ、テキスト付きの横組みロゴ)を読み込んでキャッシュする。
// アイコン単体ではなくヘッダーと同じ横組み(アイコン+文字)を使う。出力canvasの背景は常に白なので、
// 明るい背景用(黒)のロゴを使う。
let exportLogoImgPromise = null;
function ensureExportLogoImg() {
  if (!LOGO_ASSETS.headerLight) return Promise.resolve(null);
  if (exportLogoImgPromise) return exportLogoImgPromise;
  exportLogoImgPromise = loadImageEl(LOGO_ASSETS.headerLight);
  return exportLogoImgPromise;
}

async function openDeckImageExportModal() {
  const deck = App.workingDeck;
  if (!deck) return;
  Modal.open('デッキ画像プレビュー', `<div style="padding:40px;text-align:center;color:var(--text-dim);">画像を生成中...</div>`, '', { wide: true });

  // 共有リンクをQRコード化して画像右上に埋め込む(失敗・オフライン時はQRなしで続行する。致命的ではないため無視する)
  let qrCanvas = null;
  try {
    const code = await encodeDeckShareCode(deck);
    const url = location.origin + location.pathname + '#dz=' + code;
    await ensureQREncodeLib();
    qrCanvas = buildQRCanvasFit(url, 120);
  } catch (e) {
    qrCanvas = null;
  }
  const logoImg = await ensureExportLogoImg();

  const imgMap = await preloadDeckThumbImages(deck);
  let canvas = buildDeckImageCanvas(deck, imgMap, true, qrCanvas, logoImg);
  let dataUrl;
  let imagesEmbedded = true;
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch (e) {
    // canvasがタインティングされてtoDataURLが失敗した場合は、カード画像なしで再構築する
    imagesEmbedded = false;
    canvas = buildDeckImageCanvas(deck, imgMap, false, qrCanvas, logoImg);
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch (e2) {
      toast('画像の生成に失敗しました', 'err');
      Modal.close();
      return;
    }
  }
  const warn = imagesEmbedded ? '' : `<div class="empty-state" style="padding:8px 0;color:var(--warn);">お使いの環境ではカード画像を埋め込めなかったため、テキストのみで出力しました。</div>`;
  const qrNote = qrCanvas ? '' : `<div style="font-size:11.5px;color:var(--text-dim);padding:4px 0;">※QRコードの生成に失敗したため、QRコードなしで出力しました(オフラインの場合はインターネット接続をご確認ください)。</div>`;
  const body = `${warn}${qrNote}<div style="max-height:70vh;overflow:auto;text-align:center;"><img src="${dataUrl}" style="max-width:100%;border:1px solid var(--border);border-radius:8px;"></div>`;
  Modal.open('デッキ画像プレビュー', body, `<button class="btn" id="imgClose">閉じる</button><button class="btn primary" id="imgDownload">画像をダウンロード</button>`, { wide: true });
  document.getElementById('imgClose').addEventListener('click', Modal.close);
  document.getElementById('imgDownload').addEventListener('click', () => {
    downloadCanvasAsPNG(canvas, (deck.name || 'deck') + '.png');
  });
}

/* ---- バックアップ ---- */
function exportBackup() {
  const data = JSON.stringify(App.state, null, 2);
  downloadFile('ijinden_deckmaker_backup_' + new Date().toISOString().slice(0, 10) + '.json', data, 'application/json');
  toast('バックアップを書き出しました');
}
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---- 画像ファイル名 対応表 ---- */
function exportImageManifest() {
  const rows = [['公式サイト形式のファイル名', 'カードID形式のファイル名', 'カードID', '収録弾/収録', 'No', 'カード名', '種類', '色']];
  const sorted = App.allCards.slice().sort((a, b) => {
    if (a.set !== b.set) return String(a.set).localeCompare(String(b.set), 'ja', { numeric: true });
    return String(a.no).localeCompare(String(b.no), 'ja', { numeric: true });
  });
  for (const c of sorted) {
    const official = officialImageFilename(c) || '(該当なし)';
    rows.push([official, `${c.id}.png`, c.id, c.source || String(c.set), c.no, c.name, c.type, c.colors.join('/')]);
  }
  const csv = rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
  downloadFile('ijinden_image_filenames.csv', '﻿' + csv, 'text/csv');
  toast(`${sorted.length}件の画像ファイル名対応表を書き出しました`);
}
function restoreBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object') throw new Error('invalid');
      App.state = Object.assign(Store.defaults(), data);
      App.workingDeck = null; App.workingDeckDirty = false;
      persist(); rebuildCardIndex(); refreshAll();
      toast('バックアップを復元しました');
    } catch (e) {
      toast('復元に失敗しました。ファイルを確認してください', 'err');
    }
  };
  reader.readAsText(file);
}

/* ---- インポート: 列マッピングモーダル ---- */
function openImportMappingModal(rows, filename) {
  const header = rows[0].map(h => String(h ?? ''));
  const mapping = guessMapping(header);
  const fieldLabels = { name: 'カード名*', rarity: 'レアリティ', colors: '色', type: '種類', level: 'レベル', cost: 'コスト', power: 'パワー', trait: '特性', ruleText: 'ルールテキスト', igyouText: '遺業能力', illustrator: 'イラスト', source: '収録', no: 'No', imageUrl: '画像URL' };
  const options = ['<option value="-1">（使用しない）</option>'].concat(header.map((h, i) => `<option value="${i}">${escapeHtml(h || '(列' + (i + 1) + ')')}</option>`)).join('');
  const mapRowsHtml = Object.keys(fieldLabels).map(field => `
    <tr><td>${fieldLabels[field]}</td><td><select data-field="${field}" style="width:100%;">${options}</select></td></tr>
  `).join('');
  const previewRows = rows.slice(1, 4);
  const previewHtml = `<table class="map-table"><thead><tr>${header.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${previewRows.map(r => `<tr>${header.map((_, i) => `<td>${escapeHtml(String(r[i] ?? '').slice(0, 24))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

  const body = `
    <p style="font-size:12.5px;color:var(--text-dim);">列名から自動でマッピングしました。内容を確認し、必要に応じて修正してください。</p>
    <div class="form-inline">
      <div class="form-row"><label>収録ラベル（例: 第7弾）</label><input id="impSetLabel" type="text" value="${escapeHtml(filename.replace(/\.(csv|xlsx)$/i, ''))}"></div>
      <div class="form-row"><label>取り込みモード</label><select id="impMode"><option value="add">追加（既存データは保持）</option><option value="replace">同じ収録ラベルを置き換え</option></select></div>
    </div>
    <div style="max-height:280px;overflow-y:auto;"><table class="map-table">${mapRowsHtml}</table></div>
    <div class="section-title" style="padding:2px 0;">プレビュー（先頭数行）</div>
    <div style="max-height:160px;overflow:auto;">${previewHtml}</div>
  `;
  const foot = `<button class="btn" id="impCancel">キャンセル</button><button class="btn primary" id="impRun">この内容で取り込む</button>`;
  Modal.open(`インポート: ${filename}`, body, foot, { wide: true });
  for (const field of Object.keys(fieldLabels)) {
    document.querySelector(`[data-field="${field}"]`).value = mapping[field] != null ? mapping[field] : -1;
  }
  document.getElementById('impCancel').addEventListener('click', Modal.close);
  document.getElementById('impRun').addEventListener('click', () => {
    const finalMapping = {};
    document.querySelectorAll('#modalBody [data-field]').forEach(sel => { finalMapping[sel.dataset.field] = Number(sel.value); });
    const setLabel = document.getElementById('impSetLabel').value.trim() || filename;
    const mode = document.getElementById('impMode').value;
    const newCards = buildCardsFromRows(rows, finalMapping, setLabel);
    if (!newCards.length) { toast('取り込めるカードがありませんでした。マッピングを確認してください', 'err'); return; }
    if (mode === 'replace') {
      App.state.customCards = App.state.customCards.filter(c => c.source !== setLabel && c.set !== setLabel);
    }
    App.state.customCards.push(...newCards);
    persist(); rebuildCardIndex(); Modal.close(); refreshAll();
    toast(`${newCards.length}枚のカードを取り込みました`);
  });
}

async function handleImportFile(file) {
  try {
    if (/\.csv$/i.test(file.name)) {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length < 2) { toast('データ行が見つかりませんでした', 'err'); return; }
      openImportMappingModal(rows, file.name);
    } else if (/\.xlsx$/i.test(file.name)) {
      toast('Excel読み込み用ライブラリを読み込んでいます…');
      await ensureXLSX();
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      if (rows.length < 2) { toast('データ行が見つかりませんでした', 'err'); return; }
      openImportMappingModal(rows, file.name);
    } else {
      toast('対応形式は .csv / .xlsx です', 'err');
    }
  } catch (e) {
    console.error(e);
    toast('読み込みに失敗しました: ' + e.message, 'err');
  }
}


