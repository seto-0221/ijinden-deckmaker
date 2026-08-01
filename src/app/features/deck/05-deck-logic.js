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

// 件数がDECK_ENTRIES_MAXを超える場合、そのリスト全体を無効(空配列)として扱う(01-header-constants.js参照)。
// 一部だけ残す(切り詰め)ことはしない: 数百〜数十万件規模の異常データから「どれを残すか」に合理的な
// 基準が無く、部分的に残すと見かけ上は正常に読み込めたように見えてしまうため。
// 合計枚数(qty合計)には上限を設けない(理由は01-header-constants.jsのコメント参照)。
// sanitizeCardEntries(外部データ)とparseDeckText(テキストインポート)の両方から共通で使う。
function capCardEntries(list) {
  if (!Array.isArray(list)) return [];
  if (list.length > DECK_ENTRIES_MAX) return [];
  return list;
}

// 【外部由来データの1エントリあたりqty上限チェック(テキストインポート専用の合流点)】
// sanitizeCardEntries(共有リンク/QR/バックアップ復元が通る経路)は、合算後の1エントリが
// DECK_QTY_MAXを超えた場合、クランプせずそのエントリごと除外する(「直す」のではなく
// 「捨てる」方針。上のコメント・sanitizeCardEntries本体のコメント参照)。
// テキストインポート(parseDeckText/parseOtherSiteDeckText)はsanitizeCardEntriesを経由せず、
// 専用のaddEntry()で同一カード名の行を都度合算するため、行ごとの上限チェック(呼び出し側で実施)
// だけでは、複数行にまたがる合算の結果DECK_QTY_MAXを超えるケース(例: 600枚の行が2行で
// 合計1200枚)を防げない。この関数はその合算後チェックをsanitizeCardEntriesと全く同じ方針
// (クランプせず、そのエントリだけを除外)でテキストインポート側にも適用するための共通ヘルパー。
function dropEntriesOverQtyMax(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(e => Number.isFinite(e.qty) && e.qty <= DECK_QTY_MAX);
}

/* ---- 外部由来データの共通サニタイズ層 ----
   共有リンク(#dz=/#share=)・QRコードインポート・バックアップ復元など、通常のUI入力(数量ボタン・
   テキストインポート)を経由しない外部データは、必ずここを通してからApp.state/workingDeckへ入れること。
   方針:「直す」のではなく「捨てる」。範囲・型から外れた要素は個別に除外し、クランプ(丸め込み)はしない。
   同一cardIdは合算するが、合算前に無効な値(負数・NaN・Infinity・範囲外)を弾いているため、
   「正負を相殺させて実際より少なく見せる」ことはできない(合算後に上限を超えた場合もクランプせず除外する)。
   【DoS対策】マージ前の生配列の要素数がRAW_ENTRY_LIST_MAXを超える場合は、1件ずつ検証するループに
   入る前に空配列を返す(数十万件規模のペイロードでMap構築自体に時間がかかることを防ぐ、安価な最初のゲート)。
   マージ後も、異なるcardIdの件数(DECK_ENTRIES_MAX)がここまでの検証をすり抜けて残っている場合に
   備え、capCardEntriesで最終チェックする(合計枚数には上限を設けない。理由はcapCardEntries手前の
   コメントおよび01-header-constants.jsのコメントを参照)。
*/
function sanitizeCardEntries(rawList) {
  if (!Array.isArray(rawList)) return [];
  if (rawList.length > RAW_ENTRY_LIST_MAX) return [];
  const merged = new Map(); // cardId -> qty(1〜DECK_QTY_MAXの正の整数のみが入る)
  for (const raw of rawList) {
    // [cardId, qty] のタプル形式(共有リンク/QR由来)と {cardId, qty} のオブジェクト形式
    // (バックアップ復元由来。アプリ内部の通常形式でもある)の両方を受け付ける。
    let cardId, qty;
    if (Array.isArray(raw)) { cardId = raw[0]; qty = raw[1]; }
    else if (raw && typeof raw === 'object') { cardId = raw.cardId; qty = raw.qty; }
    else continue;

    if (typeof cardId !== 'string') continue;
    cardId = cardId.trim();
    if (cardId.length === 0 || cardId.length > CARD_ID_MAX_LENGTH) continue;

    const n = Math.floor(Number(qty));
    if (!Number.isFinite(n)) continue;         // 非数値・NaN・Infinity/-Infinityはここで除外
    if (n < 1 || n > DECK_QTY_MAX) continue;   // 0以下・DECK_QTY_MAX超はクランプせず除外

    // ここに到達する値は必ず1〜DECK_QTY_MAXの正の整数のみなので、後続の合算で
    // 「負数と正数が相殺して実際より少なく見える」状態は原理的に発生しない。
    merged.set(cardId, (merged.get(cardId) || 0) + n);
  }
  const out = [];
  for (const [cardId, qty] of merged) {
    if (qty > DECK_QTY_MAX) continue; // 合算後に上限を超えた場合もクランプせず除外する
    out.push({ cardId, qty });
  }
  return capCardEntries(out);
}

// カードID配列(leaderCards等、枚数を持たない単純なID配列)のサニタイズ。
function sanitizeCardIdList(rawList, maxCount) {
  const list = (Array.isArray(rawList) ? rawList : [])
    .filter(id => typeof id === 'string')
    .map(id => id.trim())
    .filter(id => id.length > 0 && id.length <= CARD_ID_MAX_LENGTH);
  return typeof maxCount === 'number' ? list.slice(0, maxCount) : list;
}

// 外部由来のデッキ様オブジェクトを安全な内部形式へ正規化する。
// 共有リンクのデコード結果(圧縮キー: n/r/m/s/l/t/tq/tags)と、
// バックアップ復元時の内部形式(name/regulationId/mainCards/sideCards/leaderCards/trumpCard/trumpQty/tags)の
// どちらの形でも受け付ける(どちらのキーがあればそちらを優先的に使う)。
function sanitizeDeckPayload(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};

  const mainCards = sanitizeCardEntries(src.mainCards !== undefined ? src.mainCards : src.m);
  const sideCards = sanitizeCardEntries(src.sideCards !== undefined ? src.sideCards : src.s);
  const leaderCards = sanitizeCardIdList(src.leaderCards !== undefined ? src.leaderCards : src.l, 2);

  let trumpCard = src.trumpCard !== undefined ? src.trumpCard : src.t;
  trumpCard = typeof trumpCard === 'string' ? trumpCard.trim() : '';
  if (trumpCard.length === 0 || trumpCard.length > CARD_ID_MAX_LENGTH) trumpCard = null;

  let trumpQtyRaw = src.trumpQty !== undefined ? src.trumpQty : src.tq;
  let trumpQty = Math.floor(Number(trumpQtyRaw));
  if (!Number.isFinite(trumpQty) || trumpQty < 0 || trumpQty > DECK_QTY_MAX) trumpQty = 0;
  if (!trumpCard) trumpQty = 0; // 切り札が無ければ枚数も持たせない(ensureLeaderFieldsと同じ考え方)

  const tagsRaw = Array.isArray(src.tags) ? src.tags : [];
  const tags = normalizeTags(tagsRaw.filter(t => typeof t === 'string'));

  const nameRaw = src.name !== undefined ? src.name : src.n;
  const name = typeof nameRaw === 'string' ? nameRaw : '';

  const regRaw = src.regulationId !== undefined ? src.regulationId : src.r;
  const regulationId = (typeof regRaw === 'string' && regRaw) ? regRaw : 'standard';

  // サイド上限0の不具合対策: 外部由来データ(共有リンク/QR/バックアップ復元)にsideCardsが
  // 含まれていても、regulationIdがサイド非対応(sideMax:0)を指すなら、ここでmainCardsへ
  // 合算してsideCardsを空にする(カードを削除しない。詳細はmergeSideIntoMainIfNoSide参照)。
  const merged = mergeSideIntoMainIfNoSide({ regulationId, mainCards, sideCards });

  return { name, regulationId, mainCards: merged.mainCards, sideCards: merged.sideCards, leaderCards, trumpCard, trumpQty, tags };
}

// deck.sideCards内のカードをdeck.mainCardsへ合算し、sideCardsを空にする(サイドカードを黙って
// 削除しない。カードは必ずmainCards側に残る)。reg.sideMax===0(サイド非対応レギュレーション)の
// ときだけ処理し、それ以外はdeckをそのまま返す。呼び出し元(sanitizeDeckPayload/saveWorkingDeck/
// finishDeckImport/レギュレーション変更イベント)を1箇所にまとめるための共通関数。
// 合算によって同名4枚超過等のレギュレーション違反が起きても、この関数では判定しない
// (呼び出し側のvalidateDeckが通常どおりNGを表示すればよいため)。
// 【重要】合算値をDECK_QTY_MAX(999)でクランプしない。合算後の値がDECK_QTY_MAXを超える可能性は
// あるが、この関数ではクランプしない(クランプすると、その分のカードが黙って消えてしまい、
// サイドカードを黙って削除しないという方針に反するため)。合算結果が同名上限等のレギュレーション
// 違反になる場合は、ここで隠さず、通常どおりvalidateDeckでNGを表示する。
// 引数はmainCards/sideCards/regulationIdを持つオブジェクトなら何でもよい(deck本体でも可)。
function mergeSideIntoMainIfNoSide(deck) {
  const reg = getRegulation(deck.regulationId);
  if (reg.sideMax !== 0) return deck;
  const sideCards = deck.sideCards || [];
  if (!sideCards.length) return deck;
  const map = new Map();
  for (const e of (deck.mainCards || [])) map.set(e.cardId, (map.get(e.cardId) || 0) + e.qty);
  for (const e of sideCards) map.set(e.cardId, (map.get(e.cardId) || 0) + e.qty);
  deck.mainCards = Array.from(map, ([cardId, qty]) => ({ cardId, qty }));
  deck.sideCards = [];
  return deck;
}

// 外部由来のパッケージ様オブジェクトを安全な内部形式へ正規化する(共有リンク圧縮キー n/c/tags、
// またはバックアップ復元時の内部形式 name/cards/tags のどちらでも受け付ける)。
function sanitizePackagePayload(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const cards = sanitizeCardEntries(src.cards !== undefined ? src.cards : src.c);
  const tagsRaw = Array.isArray(src.tags) ? src.tags : [];
  const tags = normalizeTags(tagsRaw.filter(t => typeof t === 'string'));
  const nameRaw = src.name !== undefined ? src.name : src.n;
  const name = typeof nameRaw === 'string' ? nameRaw : '';
  return { name, cards, tags };
}

// 初動シミュレーションの「初動札グループ/コンボ」定義で許可するtype一覧。
const SIM_STARTER_TYPES = ['custom', 'anyN', 'anyOfGroups', 'resource'];

// simStarters(初動シミュレーションのコンボ定義)のサニタイズ。
// 共有リンクには含まれないが、バックアップ復元ではdeck全体が外部入力になるため、
// 細工したバックアップ経由でcomboCardsに不正なqtyを混入できてしまう(例: 負数を入れると
// checkSimStarter側の判定が常に「成立」扱いになってしまう)。他のqty検証と同じ方針で扱う。
// 方針:「直す」のではなく「捨てる」。不正な要素・不正な1件だけを除外し、復元全体は失敗させない。
function sanitizeSimStarters(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue;
    const type = (typeof raw.type === 'string' && SIM_STARTER_TYPES.includes(raw.type)) ? raw.type : null;
    if (!type) continue; // 未知のtypeは丸ごと除外(形状が壊れたデータをそのまま持ち込まない)

    const entry = {
      id: (typeof raw.id === 'string' && raw.id) ? raw.id : uid('sim'),
      name: typeof raw.name === 'string' ? raw.name : '',
      type,
    };

    if (type === 'custom') {
      // comboCardsは[{cardId, qty}]形式。sanitizeCardEntriesと全く同じ規則(1〜999の正の整数のみ・
      // 同一cardIdは合算・相殺不可・不正値は個別除外)を適用する。
      entry.comboCards = sanitizeCardEntries(raw.comboCards);
    } else if (type === 'anyN') {
      entry.cardIds = sanitizeCardIdList(raw.cardIds);
      let needCount = Math.floor(Number(raw.needCount));
      entry.needCount = (Number.isFinite(needCount) && needCount >= 1) ? needCount : 1;
    } else if (type === 'anyOfGroups') {
      entry.groupStarterIds = (Array.isArray(raw.groupStarterIds) ? raw.groupStarterIds : [])
        .filter(id => typeof id === 'string');
    } else { // 'resource'
      entry.cardIds = sanitizeCardIdList(raw.cardIds);
    }
    out.push(entry);
  }
  return out;
}

// バックアップ復元(restoreBackup)専用: サニタイズ済みの中身に、id/createdAt等の付随情報を
// (元のバックアップの値を型チェックした上で)合わせて、保存可能な1件分のデッキオブジェクトを作る。
function sanitizeRestoredDeck(raw) {
  const clean = sanitizeDeckPayload(raw);
  const src = (raw && typeof raw === 'object') ? raw : {};
  return {
    id: (typeof src.id === 'string' && src.id) ? src.id : uid('deck'),
    name: clean.name || '無題のデッキ',
    regulationId: clean.regulationId,
    mainCards: clean.mainCards,
    sideCards: clean.sideCards,
    leaderCards: clean.leaderCards,
    trumpCard: clean.trumpCard,
    trumpQty: clean.trumpQty,
    tags: clean.tags,
    memo: typeof src.memo === 'string' ? src.memo : '',
    deckType: typeof src.deckType === 'string' ? src.deckType : '',
    strategy: typeof src.strategy === 'string' ? src.strategy : '',
    description: typeof src.description === 'string' ? src.description : '',
    thumbnailCardId: typeof src.thumbnailCardId === 'string' ? src.thumbnailCardId : null,
    simStarters: sanitizeSimStarters(src.simStarters),
    createdAt: Number.isFinite(src.createdAt) ? src.createdAt : Date.now(),
    updatedAt: Number.isFinite(src.updatedAt) ? src.updatedAt : Date.now(),
  };
}

// バックアップ復元専用: パッケージ版のsanitizeRestoredDeck相当。
function sanitizeRestoredPackage(raw) {
  const clean = sanitizePackagePayload(raw);
  const src = (raw && typeof raw === 'object') ? raw : {};
  return {
    id: (typeof src.id === 'string' && src.id) ? src.id : uid('pkg'),
    name: clean.name || '無題のパッケージ',
    tags: clean.tags,
    memo: typeof src.memo === 'string' ? src.memo : '',
    cards: clean.cards,
    thumbnailCardId: typeof src.thumbnailCardId === 'string' ? src.thumbnailCardId : null,
    createdAt: Number.isFinite(src.createdAt) ? src.createdAt : Date.now(),
    updatedAt: Number.isFinite(src.updatedAt) ? src.updatedAt : Date.now(),
  };
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

// zone/deltaで指定された移動・増減が、サイド上限0のレギュレーションでサイドを増やそうとしていないかを判定する。
// イベント層(15-events.js)・データ層(deckAddCard自体)の両方から同じ判定を使うための共通関数
// (表示制御だけに頼らず、どちらの層でも独立して拒否できるようにする)。
function isSideAdditionBlocked(deck, zone, delta) {
  if (zone !== 'side' || delta <= 0) return false;
  return getRegulation(deck.regulationId).sideMax === 0;
}

function deckAddCard(deck, cardId, zone, delta) {
  // サイド上限0の不具合対策(データ層): 表示上ボタンが非表示・無効化されていても、
  // 何らかの経路で呼ばれた場合に備え、ここでも独立してサイドへの追加を拒否する。
  if (isSideAdditionBlocked(deck, zone, delta)) return;
  const list = zone === 'side' ? deck.sideCards : deck.mainCards;
  let entry = list.find(e => e.cardId === cardId);
  if (!entry) {
    if (delta <= 0) return;
    // 内部安全上限(件数): 新規カード種類の追加は、そのゾーンが既にDECK_ENTRIES_MAX件に
    // 達している場合は行わない(通常操作でも外部データと同じ上限を働かせるため)。
    if (list.length >= DECK_ENTRIES_MAX) return;
    entry = { cardId, qty: 0 };
    list.push(entry);
  }
  // 内部安全上限(1エントリあたりの枚数): 通常操作(qtyボタン・数量欄への直接入力)で、
  // DECK_QTY_MAX以下の状態から新たにDECK_QTY_MAXを超えて増やすことは禁止する。
  // 【重要】mergeSideIntoMainIfNoSide(サイド上限0のレギュレーションへの変更時の合算)によって、
  // 既にDECK_QTY_MAXを超えている値(正規化によって生じた正当な値)については、ここで999へ
  // 巻き戻す(クランプする)と、その分のカードが黙って消えてしまう。そのため、
  //   ・減少方向(delta<=0)は常にそのまま適用する(上限を割り込むだけなのでクランプ不要)。
  //   ・既にDECK_QTY_MAXを超えている状態からの増加(delta>0)は、現在値を上限としてそれ以上は
  //     増やさない(=それ以上壊れないが、それ以上も増えない。仕様として明確でありカードは消えない)。
  //   ・DECK_QTY_MAX以下の状態からの増加(delta>0)は、従来どおりDECK_QTY_MAXで頭打ちにする。
  if (delta > 0) {
    const cap = Math.max(DECK_QTY_MAX, entry.qty);
    entry.qty = Math.min(entry.qty + delta, cap);
  } else {
    entry.qty += delta;
  }
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
  const byName = new Map(); // normalizedName -> { qty, displayName, unlimited, types:Set, sources:Set, rarities:Set }
  for (const e of deck.mainCards.concat(deck.sideCards)) {
    const card = getCard(e.cardId);
    if (!card) { messages.push({ level: 'warn', text: `未登録のカード(ID:${e.cardId})が含まれています` }); continue; }
    const key = cardLimitName(card);
    let g = byName.get(key);
    if (!g) { g = { qty: 0, displayName: key, unlimited: false, types: new Set(), sources: new Set(), rarities: new Set() }; byName.set(key, g); }
    g.qty += e.qty;
    if (card.unlimited) g.unlimited = true;
    g.types.add(card.type);
    if (card.source) g.sources.add(card.source);
    if (card.rarity) g.rarities.add(card.rarity);
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
  // ノーマルスクール等: 許可レアリティの一覧(allowedRarities)に無いレアリティが1件でも含まれる名前をNGにする。
  if (reg.allowedRarities && reg.allowedRarities.length) {
    const offenders = new Set();
    for (const [key, g] of byName) {
      if (Array.from(g.rarities).some(r => !reg.allowedRarities.includes(r))) offenders.add(g.displayName);
    }
    if (offenders.size) {
      messages.push({ level: 'err', text: `使用可能なレアリティは${reg.allowedRarities.join('/')}のみです。対象外のカードが含まれています: ${Array.from(offenders).join('、')}` });
    }
  }
  // bannedCardNames(カード名管理)とは別に、cardId配列で禁止カードを管理する場合のチェック。
  // 色違い等の表記ゆれに影響されず、特定のcardIdをピンポイントで禁止できる。
  if (reg.bannedCardIds && reg.bannedCardIds.length) {
    const bannedFound = new Set();
    for (const e of deck.mainCards.concat(deck.sideCards)) {
      if (reg.bannedCardIds.includes(e.cardId)) {
        const c = getCard(e.cardId);
        bannedFound.add(c ? c.name : e.cardId);
      }
    }
    if (deck.trumpCard && reg.bannedCardIds.includes(deck.trumpCard)) bannedFound.add(trumpCard ? trumpCard.name : deck.trumpCard);
    for (const lid of (deck.leaderCards || [])) {
      if (reg.bannedCardIds.includes(lid)) {
        const c = getCard(lid);
        bannedFound.add(c ? c.name : lid);
      }
    }
    for (const name of bannedFound) {
      messages.push({ level: 'err', text: `「${name}」はこのレギュレーションで使用禁止です` });
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

