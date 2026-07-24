/* ========================= 5. デッキ / パッケージ ロジック ========================= */
function allRegulations() {
  return DEFAULT_REGULATIONS.concat(App.state.regulations);
}
function getRegulation(id) {
  return allRegulations().find(r => r.id === id) || DEFAULT_REGULATIONS[0];
}

function newDeck(name) {
  const d = {
    id: uid('deck'),
    name: name || '無題のデッキ',
    regulationId: 'standard',
    mainCards: [],   // [{cardId, qty}]
    sideCards: [],
    tags: [],
    memo: '',        // 非公開の自分用メモ
    deckType: '',    // デッキタイプ名(任意入力。例:「デス虎ドー」。デッキ名とは独立)
    strategy: '',    // 戦略分類のid(DECK_STRATEGIES参照。''=未設定)
    description: '', // デッキ説明(公開デッキで表示する想定の文章)
    thumbnailCardId: null, // nullなら自動的にmainCardsの先頭カードを使う
    simStarters: [], // 初動シミュレーション用の初動札グループ/コンボ定義
    leaderCards: [], // 統領戦用: 統領イジンのcardId配列(1〜2枚)
    trumpCard: null, // 統領戦用: 切り札のcardId(1種類のみ)
    trumpQty: 1, // 統領戦用: 切り札の枚数(1〜2)
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  App.state.decks.push(d);
  persist();
  return d;
}

function getDeck(id) { return App.state.decks.find(d => d.id === id); }

// 既存デッキ(古いバージョンのデータ)にsimStartersが無い場合の後方互換
function ensureSimStarters(deck) {
  if (!deck.simStarters) deck.simStarters = [];
  return deck.simStarters;
}
// 既存デッキ(古いバージョンのデータ)に統領戦用フィールドが無い場合の後方互換
function ensureLeaderFields(deck) {
  if (!deck.leaderCards) deck.leaderCards = [];
  if (deck.trumpCard === undefined) deck.trumpCard = null;
  if (!deck.trumpQty || deck.trumpQty < 1) deck.trumpQty = deck.trumpCard ? 1 : 0;
  return deck;
}
// 既存デッキ(古いバージョンのデータ)に分類・説明メタデータが無い場合の後方互換。
// 【重要】これはメモリ上の補完のみ。localStorageへ書き込まれるのは、ユーザーがそのデッキを
// 次に保存(saveWorkingDeck)したときだけ(既存データを一括で書き換えない方針)。
function ensureDeckMeta(deck) {
  if (deck.deckType === undefined) deck.deckType = '';
  if (deck.strategy === undefined) deck.strategy = '';
  if (deck.description === undefined) deck.description = '';
  if (!Array.isArray(deck.tags)) deck.tags = [];
  if (!deck.createdAt) deck.createdAt = deck.updatedAt || Date.now();
  if (!deck.updatedAt) deck.updatedAt = deck.createdAt;
  return deck;
}

// タグの正規化(純粋関数): 前後空白の除去 → 空タグの除外 → 文字数上限で切り詰め → 完全一致の重複除去(先勝ち)
// → 件数上限。表記そのものの強制変更(大小文字統一・全半角変換など)は行わない。
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const t of tags) {
    const s = String(t ?? '').trim().slice(0, TAG_MAX_LENGTH);
    if (!s) continue;
    if (out.includes(s)) continue;
    out.push(s);
    if (out.length >= TAG_MAX_COUNT) break;
  }
  return out;
}

// デッキの使用色をカードデータから算出する純粋関数(保存はしない。表示のたびに算出する)。
// getCardFnを引数で受け取るためテストが容易で、タッチカラーの判定方法もoptsで調整できる。
//   opts.touchRatio      (既定0.15): マリョクを除くメイン枚数に占める割合がこれ未満の色を「タッチ」と判定
//   opts.includeMaryoku  (既定false): マリョクの色を算出に含めるか
//   opts.includeColorless(既定false): 無色を使用色に含めるか
// 戻り値: { all: 使用色すべて(COLORS定義順), main: 主要色, touch: タッチカラー }
function computeDeckColors(deck, getCardFn, opts = {}) {
  const touchRatio = opts.touchRatio !== undefined ? opts.touchRatio : 0.15;
  const includeMaryoku = !!opts.includeMaryoku;
  const includeColorless = !!opts.includeColorless;
  const counts = new Map();
  let total = 0;
  for (const e of (deck && deck.mainCards) || []) {
    const c = getCardFn(e.cardId);
    if (!c) continue;
    if (!includeMaryoku && c.type === 'マリョク') continue;
    total += e.qty;
    for (const col of c.colors || []) {
      if (!includeColorless && col === '無') continue;
      counts.set(col, (counts.get(col) || 0) + e.qty);
    }
  }
  const all = COLORS.filter(col => counts.has(col));
  const main = [], touch = [];
  for (const col of all) {
    if (total > 0 && counts.get(col) / total < touchRatio) touch.push(col);
    else main.push(col);
  }
  return { all, main, touch };
}

function deckTotalQty(list) { return list.reduce((s, e) => s + e.qty, 0); }

function deckAddCard(deck, cardId, zone, delta) {
  const list = zone === 'side' ? deck.sideCards : deck.mainCards;
  let entry = list.find(e => e.cardId === cardId);
  if (!entry) {
    if (delta <= 0) return;
    entry = { cardId, qty: 0 };
    list.push(entry);
  }
  entry.qty += delta;
  if (entry.qty <= 0) {
    const idx = list.indexOf(entry);
    list.splice(idx, 1);
  }
  deck.updatedAt = Date.now();
  markWorkingDirty();
}

function deckCardQty(deck, cardId, zone) {
  if (!deck) return 0;
  const list = zone === 'side' ? deck.sideCards : deck.mainCards;
  const e = list.find(x => x.cardId === cardId);
  return e ? e.qty : 0;
}

// 自作フォーマットの「禁止・制限カード」ルール1件が、指定のカードに該当するかどうか。
// mode:'name'は同名判定(ヒエロスガモスの色違いはcardLimitNameによりまとめて同名扱い)、
// mode:'filter'はカード検索画面と同じ絞り込み条件(レアリティ・収録弾・色・種類など)での判定。
function cardMatchesRestrictionRule(card, rule) {
  if (!rule) return false;
  if (rule.mode === 'name') return cardLimitName(card) === rule.name;
  if (rule.mode === 'filter') return matchesFilter(card, rule.filter || {});
  return false;
}

// 制限ルール1件を人間が読める説明文にする(ルール一覧表示・エラーメッセージ両方で使用)。
function describeRestrictionRule(rule) {
  const kindLabel = rule.kind === 'ban' ? '完全禁止' : `枚数制限(${rule.limitCount != null ? rule.limitCount : 0}枚まで)`;
  if (rule.mode === 'name') return `${kindLabel}: ${rule.name}`;
  const f = rule.filter || {};
  const parts = [];
  if (f.keyword) parts.push(`キーワード「${f.keyword}」`);
  if (f.types && f.types.length) parts.push(`種類:${f.types.join('/')}`);
  if (f.colors && f.colors.length) parts.push(`色:${f.colors.join('/')}`);
  if (f.rarities && f.rarities.length) parts.push(`レアリティ:${f.rarities.join('/')}`);
  if (f.sources && f.sources.length) parts.push(`収録:${f.sources.join('/')}`);
  if (f.levelMin != null || f.levelMax != null) parts.push(`レベル${f.levelMin ?? ''}〜${f.levelMax ?? ''}`);
  if (f.costMin != null || f.costMax != null) parts.push(`コスト${f.costMin ?? ''}〜${f.costMax ?? ''}`);
  if (f.powerMin != null || f.powerMax != null) parts.push(`パワー${f.powerMin ?? ''}〜${f.powerMax ?? ''}`);
  return `${kindLabel}: ${parts.join('、') || '(条件なし)'}`;
}

// reg.cardRestrictionsに登録された各ルールをデッキのメイン/サイドカードに対して評価し、
// 違反があればmessagesにエラーを追加する(完全禁止=1枚でも入っていたらエラー、枚数制限=上限超過でエラー)。
function applyCardRestrictions(deck, reg, messages) {
  const rules = reg.cardRestrictions || [];
  if (!rules.length) return;
  const entries = deck.mainCards.concat(deck.sideCards)
    .map(e => ({ e, c: getCard(e.cardId) }))
    .filter(x => x.c);
  for (const rule of rules) {
    const matched = entries.filter(x => cardMatchesRestrictionRule(x.c, rule));
    if (!matched.length) continue;
    const names = Array.from(new Set(matched.map(x => x.c.name)));
    if (rule.kind === 'ban') {
      messages.push({ level: 'err', text: `使用禁止のカードが含まれています[${describeRestrictionRule(rule)}]: ${names.join('、')}` });
    } else {
      const total = matched.reduce((s, x) => s + x.e.qty, 0);
      const limit = rule.limitCount != null ? rule.limitCount : 0;
      if (total > limit) {
        messages.push({ level: 'err', text: `枚数制限を超えています[${describeRestrictionRule(rule)}]。該当${total}枚: ${names.join('、')}` });
      }
    }
  }
}

function validateDeck(deck) {
  ensureLeaderFields(deck);
  const reg = getRegulation(deck.regulationId);
  const messages = [];
  const mainTotal = deckTotalQty(deck.mainCards);
  const sideTotal = deckTotalQty(deck.sideCards);
  const leaderCards = (deck.leaderCards || []).map(id => getCard(id)).filter(Boolean);
  const trumpCard = deck.trumpCard ? getCard(deck.trumpCard) : null;

  if (reg.hasLeaderZone) {
    // ---- 統領戦専用の検証 ----
    const leaderMin = reg.leaderMinCount || 1;
    const leaderMax = reg.leaderMaxCount || 2;
    const leaderCount = leaderCards.length;
    if (leaderCount < leaderMin || leaderCount > leaderMax) {
      messages.push({ level: 'err', text: `統領イジンは${leaderMin}〜${leaderMax}枚選択してください（現在${leaderCount}枚）` });
    }
    if (leaderCount === 2 && reg.leaderCombinedLevelCap != null) {
      const combinedLevel = leaderCards.reduce((s, c) => s + (c.level || 0), 0);
      if (combinedLevel > reg.leaderCombinedLevelCap) {
        messages.push({ level: 'err', text: `統領イジン2枚の合計レベルが${reg.leaderCombinedLevelCap}を超えています（現在${combinedLevel}）` });
      }
    }
    if (reg.hasTrumpZone && trumpCard) {
      if (trumpCard.type !== 'マホウ') {
        messages.push({ level: 'err', text: '切り札にはマホウカードを選択してください' });
      } else if (reg.trumpMaxCopies != null && deck.trumpQty > reg.trumpMaxCopies) {
        messages.push({ level: 'err', text: `切り札は${reg.trumpMaxCopies}枚までです（現在${deck.trumpQty}枚）` });
      }
    }
    const trumpCount = trumpCard ? (deck.trumpQty || 1) : 0;
    const total = mainTotal + leaderCount + trumpCount;
    if (reg.totalMax != null) {
      if (reg.totalExact ? total !== reg.totalMax : total > reg.totalMax) {
        messages.push({ level: 'err', text: `デッキ合計枚数（統領＋切り札＋メイン）が${reg.totalMax}枚になっていません（現在${total}枚）` });
      }
    }
    if (reg.sideMax != null && sideTotal > reg.sideMax) {
      messages.push({ level: 'err', text: `サイドデッキが${reg.sideMax}枚を超えています（現在${sideTotal}枚）` });
    }
    if (reg.colorRestrictedByLeader && leaderCount > 0) {
      const allowedColors = new Set();
      for (const lc of leaderCards) for (const col of lc.colors) allowedColors.add(col);
      const isAllowed = (c) => c.colors.includes('無') || c.colors.some(col => allowedColors.has(col));
      const checkColorList = (list, label) => {
        const offenders = new Set();
        for (const e of list) {
          const c = getCard(e.cardId);
          if (c && !isAllowed(c)) offenders.add(c.name);
        }
        if (offenders.size) messages.push({ level: 'err', text: `${label}に統領の色に含まれないカードがあります: ${Array.from(offenders).join('、')}` });
      };
      checkColorList(deck.mainCards, 'メインデッキ');
      checkColorList(deck.sideCards, 'サイドデッキ');
      if (trumpCard && !isAllowed(trumpCard)) {
        messages.push({ level: 'err', text: `切り札「${trumpCard.name}」が統領の色に含まれていません` });
      }
    }
  } else {
    // ---- 通常フォーマットの検証 ----
    if (reg.minMain != null && mainTotal < reg.minMain) {
      messages.push({ level: 'err', text: `メインデッキが${reg.minMain}枚未満です（現在${mainTotal}枚）` });
    }
    if (reg.maxMain != null && mainTotal > reg.maxMain) {
      messages.push({ level: 'err', text: `メインデッキが${reg.maxMain}枚を超えています（現在${mainTotal}枚）` });
    }
    if (reg.sideMax != null) {
      if (sideTotal > reg.sideMax) messages.push({ level: 'err', text: `サイドデッキが${reg.sideMax}枚を超えています（現在${sideTotal}枚）` });
    } else if (sideTotal > 0 && reg.sideMax === 0) {
      messages.push({ level: 'err', text: `このレギュレーションではサイドデッキを使用できません` });
    }
    if (reg.totalMax != null && (mainTotal + sideTotal) > reg.totalMax) {
      messages.push({ level: 'err', text: `合計枚数が${reg.totalMax}枚を超えています` });
    }
    if (deck.mainCards.length === 0) {
      messages.push({ level: 'warn', text: 'メインデッキにカードがありません' });
    }
  }

  // ---- 全フォーマット共通: 同名枚数制限・禁止カード・収録元制限 ----
  // 収録弾(source)や色違い等で収録カードIDが異なっていても、同じ名前のカードは合算してカウントする。
  // 例外: ヒエロスガモス(RY)等の色違い5種は、色表記に関わらず全て「ヒエロスガモス」として同名扱いにする。
  const byName = new Map(); // normalizedName -> { qty, displayName, unlimited, types:Set, sources:Set }
  for (const e of deck.mainCards.concat(deck.sideCards)) {
    const card = getCard(e.cardId);
    if (!card) { messages.push({ level: 'warn', text: `未登録のカード(ID:${e.cardId})が含まれています` }); continue; }
    const key = cardLimitName(card);
    let g = byName.get(key);
    if (!g) { g = { qty: 0, displayName: key, unlimited: false, types: new Set(), sources: new Set() }; byName.set(key, g); }
    g.qty += e.qty;
    if (card.unlimited) g.unlimited = true;
    g.types.add(card.type);
    if (card.source) g.sources.add(card.source);
  }
  for (const [key, g] of byName) {
    if (g.unlimited) continue;
    let limit = reg.maxCopies;
    if (reg.maryokuMaxCopies != null && g.types.has('マリョク')) limit = reg.maryokuMaxCopies;
    if (limit != null && isFinite(limit) && g.qty > limit) {
      messages.push({ level: 'err', text: `「${g.displayName}」が${limit}枚を超えています（${g.qty}枚）` });
    }
  }
  if (reg.bannedCardNames && reg.bannedCardNames.length) {
    const bannedFound = new Set();
    for (const [key] of byName) {
      if (reg.bannedCardNames.includes(key)) bannedFound.add(key);
    }
    if (trumpCard && reg.bannedCardNames.includes(trumpCard.name)) bannedFound.add(trumpCard.name);
    for (const lc of leaderCards) { if (reg.bannedCardNames.includes(lc.name)) bannedFound.add(lc.name); }
    for (const name of bannedFound) {
      messages.push({ level: 'err', text: `「${name}」はこのレギュレーションで使用禁止です` });
    }
  }
  if (reg.sourceFilter === 'starter') {
    const offenders = new Set();
    for (const [key, g] of byName) {
      if (Array.from(g.sources).some(s => s.includes('ブースター'))) offenders.add(g.displayName);
    }
    if (offenders.size) {
      messages.push({ level: 'err', text: `スターターデッキ収録カードのみ使用できます。ブースター収録カードが含まれています: ${Array.from(offenders).join('、')}` });
    }
  }

  applyCardRestrictions(deck, reg, messages);

  if (!messages.some(m => m.level === 'err')) {
    messages.unshift({ level: 'ok', text: 'レギュレーションの条件を満たしています' });
  }
  return { messages, mainTotal, sideTotal, valid: !messages.some(m => m.level === 'err') };
}

function computeDeckStats(deck) {
  const byLevel = new Map();
  const byColor = new Map();
  const byType = new Map();
  let known = 0;
  let levelSum = 0, levelQty = 0; // メイン全体(マリョク込み)の平均レベル用
  for (const e of deck.mainCards) {
    const c = getCard(e.cardId);
    if (!c) continue;
    known += e.qty;
    // レベルカーブはマリョクを含めない(マリョクはコスト源であってゲーム進行上のレベル推移を表さないため)
    if (c.type !== 'マリョク') {
      const levelKey = c.level != null ? c.level : '?';
      byLevel.set(levelKey, (byLevel.get(levelKey) || 0) + e.qty);
    }
    if (c.level != null) { levelSum += c.level * e.qty; levelQty += e.qty; }
    for (const col of c.colors) byColor.set(col, (byColor.get(col) || 0) + e.qty);
    byType.set(c.type, (byType.get(c.type) || 0) + e.qty);
  }
  const avgLevel = levelQty > 0 ? Math.round((levelSum / levelQty) * 100) / 100 : null;
  return { byLevel, byColor, byType, known, avgLevel };
}

