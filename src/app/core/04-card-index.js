/* ========================= 4. カードデータユーティリティ ========================= */
function rebuildCardIndex() {
  const map = new Map();
  for (const c of RAW_CARDS) {
    if (App.state.removedCardIds.includes(c.id)) continue;
    map.set(c.id, c);
  }
  for (const c of App.state.customCards) {
    map.set(c.id, c); // 追加 or 上書き
  }
  App.allCards = Array.from(map.values());
  App.cardsById = map;
}

function getCard(id) { return App.cardsById.get(id); }

// 同名枚数制限の判定に使うキーを返す。収録弾違いの再録は同名として合算する。
// ヒエロスガモス(RY)等の色違い5種は色表記に関わらず全て「ヒエロスガモス」として同名扱いにする。
function cardLimitName(card) {
  if (!card || !card.name) return '';
  if (card.name.startsWith('ヒエロスガモス')) return 'ヒエロスガモス';
  return card.name;
}

function searchableText(c) {
  if (!c._search) {
    c._search = [c.name, c.trait, c.ruleText, c.igyouText, c.source].filter(Boolean).join(' ').toLowerCase();
  }
  return c._search;
}

// prefix付きの絞り込みUI(filterPanelHtml/renderFilterChipsで生成したもの)から現在の条件を読み取る。
function readFilters(prefix) {
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  const typeOn = Array.from(document.querySelectorAll(`#${prefix}Type .chip.on`)).map(e => e.dataset.type);
  const colorOn = Array.from(document.querySelectorAll(`#${prefix}Color .chip.on`)).map(e => e.dataset.color);
  const rarityOn = Array.from(document.querySelectorAll(`#${prefix}Rarity .chip.on`)).map(e => e.dataset.rarity);
  const setEl = document.getElementById(`${prefix}Set`);
  const sourceSel = setEl ? Array.from(setEl.selectedOptions).map(o => o.value) : [];
  const modeBtn = document.querySelector(`#${prefix}Mode button.on`);
  const keywordRaw = (val(`${prefix}Keyword`) || '').trim().toLowerCase();
  // キーワードは全角/半角スペース区切りで複数語を指定でき、種類・色・レアリティと同じ一致条件(AND/OR)で判定する
  const keywordTerms = keywordRaw.split(/[\s　]+/).filter(Boolean);
  return {
    keyword: keywordRaw,
    keywordTerms,
    types: typeOn,
    colors: colorOn,
    rarities: rarityOn,
    sources: sourceSel,
    matchMode: (modeBtn ? modeBtn.dataset.mode : 'or'),
    levelMin: numOrNull(val(`${prefix}LevelMin`)),
    levelMax: numOrNull(val(`${prefix}LevelMax`)),
    costMin: numOrNull(val(`${prefix}CostMin`)),
    costMax: numOrNull(val(`${prefix}CostMax`)),
    powerMin: numOrNull(val(`${prefix}PowerMin`)),
    powerMax: numOrNull(val(`${prefix}PowerMax`)),
    sort: val(`${prefix}Sort`) || 'no',
  };
}
function currentFilters() { return readFilters('f'); }
function numOrNull(v) { return v === '' || v === null || v === undefined ? null : Number(v); }

// 1枚のカードが絞り込み条件fに合致するかどうか(sortは無視)。カード検索・デッキ編集の追加検索・
// 自作フォーマットの禁止/制限カードルールなど、絞り込み条件を使う全ての箇所で共通利用する。
function matchesFilter(c, f) {
  const isAnd = f.matchMode === 'and';
  const terms = f.keywordTerms || (f.keyword ? [f.keyword] : []);
  if (terms.length) {
    const text = searchableText(c);
    const ok = isAnd ? terms.every(k => text.includes(k)) : terms.some(k => text.includes(k));
    if (!ok) return false;
  }
  if (f.types.length) {
    // 種類・レアリティはカード1枚につき1つしか持たないため、AND(すべて)で2つ以上選ぶと該当なしになるのは仕様通り
    const ok = isAnd ? f.types.every(t => c.type === t) : f.types.includes(c.type);
    if (!ok) return false;
  }
  if (f.colors.length) {
    // 色は複数持つカードがあるため、ANDは「選んだ色を全て持つ」、ORは「選んだ色のいずれかを持つ」で判定する
    const ok = isAnd ? f.colors.every(col => c.colors.includes(col)) : c.colors.some(col => f.colors.includes(col));
    if (!ok) return false;
  }
  if (f.rarities.length) {
    const ok = isAnd ? f.rarities.every(r => c.rarity === r) : f.rarities.includes(c.rarity);
    if (!ok) return false;
  }
  if (f.sources.length && !f.sources.includes(c.source)) return false;
  if (f.levelMin !== null && (c.level === null || c.level < f.levelMin)) return false;
  if (f.levelMax !== null && (c.level === null || c.level > f.levelMax)) return false;
  if (f.costMin !== null && (c.cost === null || c.cost < f.costMin)) return false;
  if (f.costMax !== null && (c.cost === null || c.cost > f.costMax)) return false;
  if (f.powerMin !== null && (c.power === null || c.power < f.powerMin)) return false;
  if (f.powerMax !== null && (c.power === null || c.power > f.powerMax)) return false;
  return true;
}

// 絞り込み条件fが何か1つでも指定されているか(空の条件で全カード一致してしまうのを防ぐガード用)。
function filterHasAnyCriteria(f) {
  return !!(f.keyword || f.types.length || f.colors.length || f.rarities.length || f.sources.length ||
    f.levelMin !== null || f.levelMax !== null || f.costMin !== null || f.costMax !== null ||
    f.powerMin !== null || f.powerMax !== null);
}

function filterCards(cards, f) {
  let out = cards.filter(c => matchesFilter(c, f));
  const sortKey = {
    no: (c) => [c.set, parseInt(c.no) || 0, c.no],
    name: (c) => [c.name],
    cost: (c) => [c.cost ?? c.level ?? 0],
    power: (c) => [-(c.power ?? -1)],
  }[f.sort] || ((c) => [c.set, c.no]);
  out.sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
  return out;
}


