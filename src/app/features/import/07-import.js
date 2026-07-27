/* ========================= 6. インポート (CSV / Excel) ========================= */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* skip */ }
      else { field += ch; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c !== ''));
}

let xlsxLoadPromise = null;
function ensureXLSX() {
  if (window.XLSX) return Promise.resolve();
  if (xlsxLoadPromise) return xlsxLoadPromise;
  xlsxLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Excel読込ライブラリの取得に失敗しました（インターネット接続が必要です）。CSVでの読み込みをお試しください。'));
    document.head.appendChild(s);
  });
  return xlsxLoadPromise;
}

function guessMapping(headerRow) {
  const mapping = {};
  const normalized = headerRow.map(h => String(h || '').trim().toLowerCase());
  for (const field of Object.keys(IMPORT_FIELD_ALIASES)) {
    let foundIdx = -1;
    for (const alias of IMPORT_FIELD_ALIASES[field]) {
      const idx = normalized.findIndex(h => h === alias.toLowerCase() || h.includes(alias.toLowerCase()));
      if (idx !== -1) { foundIdx = idx; break; }
    }
    mapping[field] = foundIdx;
  }
  return mapping;
}

function inferTypeFromRow(levelRaw, powerRaw, ruleText, name) {
  const s = String(levelRaw || '');
  const boxCount = (s.match(/[□■⬜]/g) || []).length;
  const costMatch = s.match(/魔力コスト\s*(\d+)/);
  const powerNum = /^\d+$/.test(String(powerRaw || '').trim()) ? Number(powerRaw) : null;
  let type, cost = null, level = null;
  const lvlMatch = s.match(/\d+/);
  if (lvlMatch) level = Number(lvlMatch[0]);
  if (costMatch) { type = 'マホウ'; cost = Number(costMatch[1]); }
  else if (boxCount > 0) { type = 'マホウ'; cost = boxCount; }
  else if (powerNum !== null) { type = 'イジン'; }
  else if (/魔力ゾーンに/.test(ruleText || '') || /(ストーン|オーブ)$/.test(name || '')) { type = 'マリョク'; }
  else { type = 'ハイケイ'; }
  // マホウは魔力コストを持たないカードが存在しないため、検出できない場合は0として扱う
  if (type === 'マホウ' && cost === null) cost = 0;
  return { type, cost, level, power: powerNum };
}

function parseColorField(raw) {
  const s = String(raw || '').trim();
  if (!s || s === '-' || s === '無' || s === '無色') return ['無'];
  const chars = s.split('').filter(c => COLORS.includes(c) && c !== '無');
  return chars.length ? Array.from(new Set(chars)) : ['無'];
}

// rows: 2D配列（1行目ヘッダ）, mapping: field->colIndex, mode: 'add' | 'replace'
function buildCardsFromRows(rows, mapping, setLabel) {
  const header = rows[0];
  const dataRows = rows.slice(1);
  const cards = [];
  let seq = 1;
  for (const r of dataRows) {
    const get = (field) => mapping[field] != null && mapping[field] >= 0 ? r[mapping[field]] : undefined;
    const name = (get('name') || '').toString().trim();
    if (!name) continue;
    const levelRaw = get('level');
    const powerRaw = get('power');
    const ruleText = (get('ruleText') || '').toString().trim();
    let inferred = { type: undefined, cost: null, level: null, power: null };
    const explicitType = (get('type') || '').toString().trim();
    if (explicitType && CARD_TYPES.includes(explicitType)) {
      inferred.type = explicitType;
      const lvlMatch = String(levelRaw || '').match(/\d+/);
      if (lvlMatch) inferred.level = Number(lvlMatch[0]);
      const costRaw = get('cost');
      inferred.cost = costRaw != null && costRaw !== '' ? Number(String(costRaw).match(/\d+/)?.[0] ?? NaN) : null;
      if (Number.isNaN(inferred.cost)) inferred.cost = null;
      inferred.power = /^\d+$/.test(String(powerRaw || '').trim()) ? Number(powerRaw) : null;
    } else {
      inferred = inferTypeFromRow(levelRaw, powerRaw, ruleText, name);
    }
    if (inferred.type === 'マホウ' && inferred.cost === null) inferred.cost = 0;
    const no = (get('no') || String(seq)).toString().trim();
    const id = uid('imp') + '_' + seq;
    cards.push({
      id,
      no,
      set: setLabel || 'インポート',
      source: (get('source') || setLabel || 'インポート').toString().trim(),
      name,
      rarity: (get('rarity') || '').toString().trim(),
      colors: parseColorField(get('colors')),
      type: inferred.type,
      level: inferred.level,
      cost: inferred.cost,
      power: inferred.power,
      trait: (get('trait') || '').toString().trim(),
      ruleText,
      igyouText: (get('igyouText') || '').toString().trim(),
      illustrator: (get('illustrator') || '').toString().trim(),
      unlimited: /デッキに何枚でも入れてよい/.test(ruleText),
      imageUrl: (get('imageUrl') || '').toString().trim(),
    });
    seq++;
  }
  return cards;
}


