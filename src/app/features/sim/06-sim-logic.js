/* ========================= 5a. 初動シミュレーション ========================= */
// メインデッキを実カード枚数分のフラットな配列に展開する(シャッフル前の「山札」)
function buildSimPile(deck) {
  const pile = [];
  for (const e of deck.mainCards) {
    const c = getCard(e.cardId);
    if (!c) continue;
    for (let i = 0; i < e.qty; i++) pile.push(c);
  }
  return pile;
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

// 手札1つ分から、色ごとの「単体マリョクの最高レベル」「色カード枚数」「カルドロン枚数」を集計する
function summarizeHand(hand) {
  const maxLevelByColor = {};
  const colorCount = {};
  let cauldronCount = 0;
  const idCount = new Map();
  for (const c of hand) {
    idCount.set(c.id, (idCount.get(c.id) || 0) + 1);
    for (const col of c.colors) {
      colorCount[col] = (colorCount[col] || 0) + 1;
    }
    if (c.type === 'マリョク') {
      for (const col of c.colors) {
        const lv = c.level ?? 0;
        if (!(col in maxLevelByColor) || lv > maxLevelByColor[col]) maxLevelByColor[col] = lv;
      }
    }
    if (c.name === 'カルドロン' && c.type === 'マリョク') cauldronCount++;
  }
  const hasPixieDust = hand.some(c => c.name === 'ピクシーダスト');
  return { maxLevelByColor, colorCount, cauldronCount, idCount, hasPixieDust, handSize: hand.length };
}

// カルドロンの実際のルールテキスト:
// 「魔力ゾーンに置かれたとき、自分の手札のカード1つを指定して発動できる。
// 「そのカードを墓地に置く」か「そのカードを裏向きで魔力ゾーンに置く」のどちらかを発揮する。
// これが魔力ゾーンにある間、自分の墓地の色すべてを得る。」(カルドロン自身はレベル2・無色)
// → 捨て札化: 指定した1枚を墓地へ置くと、その色を「カルドロン自身のレベル(2)」として得られる。
// → 裏向き化: 指定した1枚を裏向きで魔力ゾーンに置くと、カルドロン自身(Lv2無色)+裏向きの1枚(Lv1無色、一般ルール)で
//   合計「無色レベル3」の資源になる。どちらか一方のみ選べる。

// 指定した初動札カード(1枚)について、手札の状態から「引けて、出せる」かを判定する
// 条件A: 該当色・レベル以上の単体マリョクが手札にある
// 条件B(カルドロン・捨て札化): カルドロンが1枚以上あり、かつ該当色のカード(初動札自身とは別にもう1枚)が手札にある
//   →実際に出す初動札自身とは別の1枚を捨てる必要があるため、該当色のカードが手札に2枚以上必要
// 条件C(カルドロン・裏向き化): 該当色が無色かつレベル3以下で、カルドロン+初動札自身+裏向き用の1枚の合計3枚以上が手札にある
function canPlayStarterCard(handSummary, starterCard) {
  const color = starterCard.colors[0] || '無';
  const level = starterCard.level ?? 0;
  if ((handSummary.maxLevelByColor[color] ?? -1) >= level) return true;
  if (handSummary.cauldronCount >= 1) {
    // 捨て札化(条件B)はカルドロン自身とは別の色付きカードが必要。カルドロン自身の色は無色なので、
    // 無色に対してはこの条件は使わない(カルドロン自身を「捨てる予備」に数えてしまうのを防ぐ)。
    // 無色はカルドロンをマリョクとしてそのまま置くだけで既にLv2(条件A)を満たせる。
    if (color !== '無' && (handSummary.colorCount[color] || 0) >= 2) return true;
    if (color === '無' && level <= 3 && handSummary.handSize >= 3) return true;
  }
  return false;
}

// レベルマトリックス(特定のカードを想定しない一般的な「この手札で何色何レベルまで出せるか」の集計)用に、
// カルドロンの効果を織り込んだ色ごとの到達可能レベルを計算する。
// 特定の初動札自身を手札に残しておく必要がないため、canPlayStarterCardより緩い条件(必要枚数が1枚少ない)になる。
function effectiveLevelMatrixColors(handSummary) {
  const result = Object.assign({}, handSummary.maxLevelByColor);
  if (handSummary.cauldronCount >= 1) {
    for (const col of COLORS) {
      if (col === '無') continue;
      if ((handSummary.colorCount[col] || 0) >= 1 && (result[col] ?? -1) < 2) result[col] = 2;
    }
    if (handSummary.handSize >= 2 && (result['無'] ?? -1) < 3) result['無'] = 3;
  }
  return result;
}

// 初動札グループ/コンボ定義1つが、この手札で成立しているかどうか。
// allStarters: 「グループ化」型(いずれか1つが成立すればOK)が参照する他の初動札グループの一覧(省略時は空扱い)。
function checkSimStarter(handSummary, starter, allStarters) {
  if (starter.type === 'custom') {
    for (const entry of (starter.comboCards || [])) {
      if ((handSummary.idCount.get(entry.cardId) || 0) < (entry.qty || 1)) return false;
    }
    return (starter.comboCards || []).length > 0;
  }
  if (starter.type === 'anyN') {
    // グループ内のカードがどれでもいいので合計N枚あればOK(内訳自由、プレイ可否は問わない)
    const cardIds = starter.cardIds || [];
    if (!cardIds.length) return false;
    let total = 0;
    for (const cardId of cardIds) total += (handSummary.idCount.get(cardId) || 0);
    return total >= (starter.needCount || 1);
  }
  if (starter.type === 'anyOfGroups') {
    // 多層グループ化: 登録済みの他の初動札グループのうち、いずれか1つでも成立していればOK。
    // ネストの循環参照を避けるため、参照先がさらに「グループ化」型の場合は対象外とする(1階層のみ)。
    const list = allStarters || [];
    for (const id of (starter.groupStarterIds || [])) {
      const target = list.find(x => x.id === id);
      if (target && target.type !== 'anyOfGroups' && checkSimStarter(handSummary, target, list)) return true;
    }
    return false;
  }
  // resource型: グループ内のいずれかのカードが手札にあり、かつそのカードを支払えるか
  for (const cardId of (starter.cardIds || [])) {
    if ((handSummary.idCount.get(cardId) || 0) > 0) {
      const c = getCard(cardId);
      if (c && canPlayStarterCard(handSummary, c)) return true;
    }
  }
  return false;
}

// ヒエロスガモスを出した(applyHierosgamosLootでルート後)の手札で、初動札グループが成立するかどうかを判定する。
// ヒエロスガモス自身がこのターンの唯一のマリョク配置になるため(マリョクは原則1ターンに1枚しか置けない)、
// resource型は「ヒエロスガモス自身の色・レベル」でしか支払えないものとして判定する(手札の他のマリョクは今回は使えない前提)。
// custom/anyN/anyOfGroups型はカードの存在(または他グループの成立)のみで判定するため、この制約を受けない。
function checkSimStarterHieroAssisted(handAfterLoot, starter, hieroCard, allStarters) {
  if (starter.type === 'custom' || starter.type === 'anyN' || starter.type === 'anyOfGroups') {
    return checkSimStarter(summarizeHand(handAfterLoot), starter, allStarters);
  }
  const idCount = new Map();
  for (const c of handAfterLoot) idCount.set(c.id, (idCount.get(c.id) || 0) + 1);
  for (const cardId of (starter.cardIds || [])) {
    if ((idCount.get(cardId) || 0) > 0) {
      const c = getCard(cardId);
      if (!c) continue;
      const color = c.colors[0] || '無';
      const level = c.level ?? 0;
      // 当然、ヒエロスガモス自身の色とレベルが足りていなければ出せない
      if (hieroCard.colors.includes(color) && hieroCard.level >= level) return true;
    }
  }
  return false;
}

// deck: 対象デッキ, opts: { handSize, secondDraw, mulligan, trials, useHierosgamos }
// 戻り値: { starterResults: [{id,name,first,second,both}], levelMatrix: {first:{color:{1:%,2:%,3:%}}, second:{...}, both:{...}}, pileSize }
function runDeckSimulation(deck, opts) {
  const pile = buildSimPile(deck);
  const starters = ensureSimStarters(deck);
  const trials = Math.max(100, Math.min(200000, opts.trials || 15000));
  const handSizeFirst = Math.max(1, opts.handSize || 6);
  const handSizeSecond = handSizeFirst + Math.max(0, opts.secondDraw ?? 1);
  const useMulligan = !!opts.mulligan;
  const hasHiero = pile.some(c => c.name && c.name.startsWith('ヒエロスガモス'));
  const useHiero = !!opts.useHierosgamos && hasHiero;
  const levels = [1, 2, 3];

  const starterCounts = { first: new Array(starters.length).fill(0), second: new Array(starters.length).fill(0) };
  const levelCounts = {
    first: {}, second: {},
  };
  for (const col of COLORS) {
    levelCounts.first[col] = { 1: 0, 2: 0, 3: 0 };
    levelCounts.second[col] = { 1: 0, 2: 0, 3: 0 };
  }

  const drawOneHand = (handSize) => {
    if (pile.length < handSize) return null;
    let shuffled = shuffleArray(pile);
    let hand = shuffled.slice(0, handSize);
    if (useMulligan) {
      // 単純なロンドンマリガン: 1回だけ、全て戻して同じ枚数を引き直せる
      // (ここでは「引き直した方が良いかどうか」の判断は行わず、
      //  各初動札グループを1つでも満たしていない場合に引き直す、という単純な採用ルールでシミュレートする)
      const summary0 = summarizeHand(hand);
      const satisfiesAny = starters.length === 0 ? true : starters.some(s => checkSimStarter(summary0, s, starters));
      if (!satisfiesAny) {
        shuffled = shuffleArray(pile);
        hand = shuffled.slice(0, handSize);
      }
    }
    return { hand, shuffled };
  };

  for (let t = 0; t < trials; t++) {
    for (const key of ['first', 'second']) {
      const handSize = key === 'first' ? handSizeFirst : handSizeSecond;
      const drawn = drawOneHand(handSize);
      if (!drawn) continue;
      const { hand, shuffled } = drawn;
      const summary = summarizeHand(hand);
      const hieroCard = useHiero ? hand.find(c => c.name && c.name.startsWith('ヒエロスガモス')) : null;
      starters.forEach((s, i) => {
        let ok = checkSimStarter(summary, s, starters);
        if (!ok && hieroCard) {
          // starterごとに独立して、手札の直後(同じ開始位置)から2枚引き直す想定でループ後の手札を作る
          let idx = handSize;
          const drawFn = () => (idx < shuffled.length ? shuffled[idx++] : null);
          const afterLoot = applyHierosgamosLoot(hand, drawFn, s, starters);
          ok = checkSimStarterHieroAssisted(afterLoot, s, hieroCard, starters);
        }
        if (ok) starterCounts[key][i]++;
      });
      // ピクシーダスト: 「自分の魔力ゾーンが相手より多いと発動しない」という条件を満たしている前提で、
      // 後攻がピクシーダストを引いていれば、手札か墓地のマリョクをもう1つ魔力ゾーンに置けるため
      // 到達可能レベルを+1として計算する(引けなければ+1は無し)。先攻には適用しない。
      const pixieBonus = (key === 'second' && summary.hasPixieDust) ? 1 : 0;
      const effLevels = effectiveLevelMatrixColors(summary);
      for (const col of COLORS) {
        for (const lv of levels) {
          if ((effLevels[col] ?? -1) + pixieBonus >= lv) levelCounts[key][col][lv]++;
        }
      }
    }
  }

  const pct = (n) => trials > 0 ? Math.round((n / trials) * 1000) / 10 : 0;
  const starterResults = starters.map((s, i) => {
    const first = pct(starterCounts.first[i]);
    const second = pct(starterCounts.second[i]);
    return { id: s.id, name: s.name, first, second, both: Math.round((first + second) / 2 * 10) / 10 };
  });
  const levelMatrix = { first: {}, second: {}, both: {} };
  for (const col of COLORS) {
    levelMatrix.first[col] = {}; levelMatrix.second[col] = {}; levelMatrix.both[col] = {};
    for (const lv of levels) {
      const f = pct(levelCounts.first[col][lv]);
      const s = pct(levelCounts.second[col][lv]);
      levelMatrix.first[col][lv] = f;
      levelMatrix.second[col][lv] = s;
      levelMatrix.both[col][lv] = Math.round((f + s) / 2 * 10) / 10;
    }
  }
  // 裏向きで1枚(マリョクでないカードでも良い)を魔力ゾーンに置けるルールがあるため、
  // 無色レベル1は手札の内容によらず常に成立する(手札が1枚以上あれば実質100%)。
  levelMatrix.first['無'][1] = 100;
  levelMatrix.second['無'][1] = 100;
  levelMatrix.both['無'][1] = 100;
  return { starterResults, levelMatrix, pileSize: pile.length, trials, handSizeFirst, handSizeSecond };
}

// starter(グループ化型の場合は参照先も再帰的に)が必要とするカードの枚数マップを組み立てる。
// ヒエロスガモスのループでどのカードを優先して手札に残すかの判定に使う。
function collectStarterNeedMap(starter, allStarters, need, seenGroupIds) {
  need = need || new Map();
  seenGroupIds = seenGroupIds || new Set();
  if (!starter) return need;
  if (starter.type === 'custom') {
    for (const e of (starter.comboCards || [])) need.set(e.cardId, Math.max(need.get(e.cardId) || 0, e.qty || 1));
  } else if (starter.type === 'anyN' || starter.type === 'resource') {
    for (const id of (starter.cardIds || [])) need.set(id, Math.max(need.get(id) || 0, 1));
  } else if (starter.type === 'anyOfGroups' && !seenGroupIds.has(starter.id)) {
    seenGroupIds.add(starter.id);
    for (const id of (starter.groupStarterIds || [])) {
      const target = (allStarters || []).find(x => x.id === id);
      if (target) collectStarterNeedMap(target, allStarters, need, seenGroupIds);
    }
  }
  return need;
}

// ヒエロスガモスを1ターン目に出す(2ドロー、手札から2枚を墓地へ)ことを想定した場合の手札変化をシミュレートする。
// starterの成立に不要そうなカードを優先して2枚選び、捨てる(コンボ/初動札に必要なカードは可能な限り温存する)。
function applyHierosgamosLoot(hand, drawFn, starter, allStarters) {
  const heroIdx = hand.findIndex(c => c.name && c.name.startsWith('ヒエロスガモス'));
  if (heroIdx === -1) return hand;
  let newHand = hand.slice();
  newHand.splice(heroIdx, 1);
  for (let i = 0; i < 2; i++) {
    const drawn = drawFn();
    if (drawn) newHand.push(drawn);
  }
  // starterの種類に応じて「必要なカード」の枚数を数え、それを超える分・無関係なカードから優先して2枚捨てる
  const need = collectStarterNeedMap(starter, allStarters);
  const seenSoFar = new Map();
  const scored = newHand.map((c, idx) => {
    const needQty = need.get(c.id) || 0;
    seenSoFar.set(c.id, (seenSoFar.get(c.id) || 0) + 1);
    const isEssential = needQty > 0 && seenSoFar.get(c.id) <= needQty;
    return { idx, isEssential };
  });
  // 無関係(isEssential=false)なカードを優先し、同条件内では手札の後ろ側から捨てる
  const order = scored.slice().sort((a, b) => {
    if (a.isEssential !== b.isEssential) return a.isEssential ? 1 : -1;
    return b.idx - a.idx;
  });
  const discardIdx = new Set(order.slice(0, 2).map(x => x.idx));
  return newHand.filter((c, idx) => !discardIdx.has(idx));
}

// カスタム型(その他の型にも対応)の初動札グループ1つについて、ターン経過ごとの累積成立率を計算する。
// deck: 対象デッキ, starter: 判定対象の初動札グループ, opts: { handSize, secondDraw, trials, maxTurns, useHierosgamos }
// 戻り値: { turns:[1..maxTurns], first:{without:[%...], with:[%...]|null}, second:{...}, hasHierosgamos }
function runComboProgressSimulation(deck, starter, opts) {
  const pile = buildSimPile(deck);
  const trials = Math.max(200, Math.min(50000, opts.trials || 8000));
  const handSizeFirst = Math.max(1, opts.handSize || 6);
  const handSizeSecond = handSizeFirst + Math.max(0, opts.secondDraw ?? 1);
  const maxTurns = Math.max(1, opts.maxTurns || 6);
  const hasHierosgamos = pile.some(c => c.name && c.name.startsWith('ヒエロスガモス'));
  const useHiero = !!opts.useHierosgamos && hasHierosgamos;

  const counts = {
    first: { without: new Array(maxTurns).fill(0), with: useHiero ? new Array(maxTurns).fill(0) : null },
    second: { without: new Array(maxTurns).fill(0), with: useHiero ? new Array(maxTurns).fill(0) : null },
  };
  const validTrials = { first: 0, second: 0 };

  for (let t = 0; t < trials; t++) {
    for (const key of ['first', 'second']) {
      const handSize = key === 'first' ? handSizeFirst : handSizeSecond;
      if (pile.length < handSize) continue;
      validTrials[key]++;
      const shuffled = shuffleArray(pile);

      // 「ヒエロスガモスを出さない」場合の手札の推移
      let hand = shuffled.slice(0, handSize);
      let drawIdx = handSize;
      const drawNext = () => (drawIdx < shuffled.length ? shuffled[drawIdx++] : null);

      // 「ヒエロスガモスを出す」場合は同じ初期手札から分岐させ、以降は別インデックスで独立にドローする
      let handWith = useHiero ? hand.slice() : null;
      let drawIdxWith = handSize;
      const drawNextWith = () => (drawIdxWith < shuffled.length ? shuffled[drawIdxWith++] : null);
      let heroApplied = false;

      for (let turn = 1; turn <= maxTurns; turn++) {
        if (turn > 1) {
          const d1 = drawNext();
          if (d1) hand.push(d1);
          if (useHiero) {
            const d2 = drawNextWith();
            if (d2) handWith.push(d2);
          }
        }
        const summary = summarizeHand(hand);
        if (checkSimStarter(summary, starter)) counts[key].without[turn - 1]++;

        if (useHiero) {
          if (turn === 1 && !heroApplied) {
            heroApplied = true;
            handWith = applyHierosgamosLoot(handWith, drawNextWith, starter);
          }
          const summaryWith = summarizeHand(handWith);
          if (checkSimStarter(summaryWith, starter)) counts[key].with[turn - 1]++;
        }
      }
    }
  }

  const pct = (n, denom) => denom > 0 ? Math.round((n / denom) * 1000) / 10 : 0;
  const toSeries = (arr, denom) => arr ? arr.map(n => pct(n, denom)) : null;
  const turns = Array.from({ length: maxTurns }, (_, i) => i + 1);
  const first = { without: toSeries(counts.first.without, validTrials.first), with: toSeries(counts.first.with, validTrials.first) };
  const second = { without: toSeries(counts.second.without, validTrials.second), with: toSeries(counts.second.with, validTrials.second) };
  const avgSeries = (a, b) => (a && b) ? a.map((v, i) => Math.round((v + b[i]) / 2 * 10) / 10) : null;
  const both = { without: avgSeries(first.without, second.without), with: avgSeries(first.with, second.with) };
  return {
    turns,
    first, second, both,
    hasHierosgamos,
    trials,
  };
}

// ---- 共有リンク: このツール独自の圧縮形式でデッキをURLのハッシュに埋め込む/読み戻す ----
// (他サイトの共有リンク形式は暗号化ではなく単に独自エンコードされているだけだが、
//  その方式が公開されていないため確実な解読はできない。本機能は弊サイト同士でのみ有効)
function b64EncodeUnicode(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
}
function b64DecodeUnicode(str) {
  return decodeURIComponent(Array.prototype.map.call(atob(str), c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
}

// ---- 共有リンクの圧縮: リンクを短くするため、ブラウザ標準のCompressionStream(deflate-raw)を使う ----
// 対応ブラウザ(Chrome/Edge/Safari16.4+/Firefox113+など、いずれも十分に普及済み)では大幅に短縮できる。
// 万一対応していない場合は、圧縮なしのbase64にフォールバックする(フラグ文字'0'で判別)。
function bytesToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlToBytes(b64) {
  let s = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function deflateCompress(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}
async function deflateDecompress(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(buf);
}

function deckSharePayload(deck) {
  return {
    n: deck.name, r: deck.regulationId,
    m: (deck.mainCards || []).map(e => [e.cardId, e.qty]),
    s: (deck.sideCards || []).map(e => [e.cardId, e.qty]),
    l: deck.leaderCards || [], t: deck.trumpCard || null, tq: deck.trumpQty || 0,
    tags: deck.tags || [],
  };
}
// 新形式(圧縮)の共有コードを発行する。URLでは #dz=<コード> として使う。
// 戻り値はPromise(圧縮処理が非同期のため)。
async function encodeDeckShareCode(deck) {
  const json = JSON.stringify(deckSharePayload(deck));
  if (typeof CompressionStream === 'undefined') {
    // 圧縮非対応ブラウザ向けフォールバック(先頭'0'=圧縮なし)
    const plain = b64EncodeUnicode(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return '0' + plain;
  }
  const compressed = await deflateCompress(new TextEncoder().encode(json));
  return '1' + bytesToBase64Url(compressed);
}
// 新形式(圧縮)の共有コードを読み戻す。戻り値はPromise。
async function decodeDeckShareCodeV2(code) {
  const raw = String(code || '');
  const flag = raw[0];
  const body = raw.slice(1);
  if (flag === '0') {
    let b64 = body.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(b64DecodeUnicode(b64));
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('このブラウザは圧縮形式の共有リンクに対応していません');
  }
  const decompressed = await deflateDecompress(base64UrlToBytes(body));
  return JSON.parse(new TextDecoder().decode(decompressed));
}
// 旧形式(単純base64、圧縮なし)の共有コードを読み戻す。以前発行されたリンクとの後方互換用。
// URLでは #share=<コード> として使う(発行は行わず、読み込みのみ対応する)。
function decodeDeckShareCode(code) {
  let b64 = String(code || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return JSON.parse(b64DecodeUnicode(b64));
}
function deckFromSharePayload(payload) {
  return {
    id: uid('deck'), name: payload.n || 'インポートしたデッキ', regulationId: payload.r || 'standard',
    mainCards: (payload.m || []).map(([cardId, qty]) => ({ cardId, qty })),
    sideCards: (payload.s || []).map(([cardId, qty]) => ({ cardId, qty })),
    leaderCards: payload.l || [], trumpCard: payload.t || null, trumpQty: payload.tq || 0,
    tags: payload.tags || [], memo: '',
    thumbnailCardId: null, simStarters: [],
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

// ---- パッケージの共有リンク: デッキと同じ圧縮方式(deflateCompress等)を流用し、URLでは #pkg=<コード> として使う ----
function packageSharePayload(pkg) {
  return {
    n: pkg.name,
    c: (pkg.cards || []).map(e => [e.cardId, e.qty]),
    tags: pkg.tags || [],
  };
}
async function encodePackageShareCode(pkg) {
  const json = JSON.stringify(packageSharePayload(pkg));
  if (typeof CompressionStream === 'undefined') {
    const plain = b64EncodeUnicode(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return '0' + plain;
  }
  const compressed = await deflateCompress(new TextEncoder().encode(json));
  return '1' + bytesToBase64Url(compressed);
}
async function decodePackageShareCode(code) {
  const raw = String(code || '');
  const flag = raw[0];
  const body = raw.slice(1);
  if (flag === '0') {
    let b64 = body.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(b64DecodeUnicode(b64));
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('このブラウザは圧縮形式の共有リンクに対応していません');
  }
  const decompressed = await deflateDecompress(base64UrlToBytes(body));
  return JSON.parse(new TextDecoder().decode(decompressed));
}
function packageFromSharePayload(payload) {
  return {
    id: uid('pkg'), name: payload.n || 'インポートしたパッケージ',
    tags: payload.tags || [], memo: '',
    cards: (payload.c || []).map(([cardId, qty]) => ({ cardId, qty })),
    thumbnailCardId: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}
// 文字列がパッケージの共有リンク(#pkg=<コード>を含むURLまたはリンク全体)であれば、そのパッケージを返す。該当しなければnull。
// (デッキの共有コードとの混同を避けるため、あえて「コード部分だけ」の裸文字列には対応しない。必ず#pkg=付きで判別する)
async function tryDecodeShareTextToPackage(text) {
  const trimmed = String(text || '').trim();
  const pkgMatch = trimmed.match(/[#?&]pkg=([A-Za-z0-9\-_]+)/);
  if (!pkgMatch) return null;
  try {
    const payload = await decodePackageShareCode(pkgMatch[1]);
    return packageFromSharePayload(payload);
  } catch (e) {
    return null;
  }
}

function deckToText(deck) {
  ensureLeaderFields(deck);
  const lines = [];
  lines.push(`■ ${deck.name}`);
  lines.push(`レギュレーション: ${getRegulation(deck.regulationId).name}`);
  if (deck.tags.length) lines.push(`タグ: ${deck.tags.join(', ')}`);
  if (deck.leaderCards.length) {
    lines.push(`統領: ${deck.leaderCards.map(id => getCard(id)?.name || id).join(', ')}`);
  }
  if (deck.trumpCard) {
    const trumpName = getCard(deck.trumpCard)?.name || deck.trumpCard;
    const qtySuffix = (deck.trumpQty && deck.trumpQty > 1) ? ` x${deck.trumpQty}` : '';
    lines.push(`切り札: ${trumpName}${qtySuffix}`);
  }
  lines.push('');
  const groupAndPrint = (title, list) => {
    if (!list.length) return;
    lines.push(`--- ${title} (${deckTotalQty(list)}枚) ---`);
    const byType = {};
    for (const e of list) {
      const c = getCard(e.cardId);
      const type = c ? c.type : '不明';
      (byType[type] = byType[type] || []).push({ c, qty: e.qty });
    }
    for (const type of CARD_TYPES) {
      if (!byType[type]) continue;
      byType[type].sort((a, b) => (a.c ? a.c.name : '').localeCompare(b.c ? b.c.name : '', 'ja'));
      for (const { c, qty } of byType[type]) {
        // カードNo.(第○弾-番号)を付記しておくと、同名カードが複数弾にまたがる場合でも再インポート時に正確に判別できる
        const noSuffix = (c && c.set != null && c.no) ? `\tNo.${c.set}-${c.no}` : '';
        lines.push(`${qty}x\t${c ? c.name : '(未登録カード)'}\t[${type}]${noSuffix}`);
      }
    }
    lines.push('');
  };
  groupAndPrint('メインデッキ', deck.mainCards);
  groupAndPrint('サイドデッキ', deck.sideCards);
  if (deck.memo) { lines.push('--- メモ ---'); lines.push(deck.memo); }
  return lines.join('\n');
}

// 同名カードの候補が複数ある場合に、括弧書きなどから得たヒント文字列(収録弾・収録名)で絞り込む。
// 「第3弾」のように数字が拾えればc.set(弾番号)との一致を最優先し、次点でc.source(収録名)への部分一致を見る。
// 絞り込めなければ(ヒントが無い/該当なしの場合)先頭の1件を返す。
function pickCardByHint(candidates, hintText) {
  if (!candidates.length) return null;
  if (candidates.length === 1 || !hintText) return candidates[0];
  const hint = String(hintText).trim();
  const numMatch = hint.match(/(\d+)/);
  if (numMatch) {
    const setNum = parseInt(numMatch[1], 10);
    const bySet = candidates.filter(c => Number(c.set) === setNum);
    if (bySet.length) return bySet[0];
  }
  const bySource = candidates.filter(c => c.source && (c.source.includes(hint) || hint.includes(c.source)));
  if (bySource.length) return bySource[0];
  return candidates[0];
}

// カード名から候補カードを探す。完全一致に加え、以下の他サイト形式の差異を吸収する:
// ・「ヒエロスガモス (赤黄)」のように色を漢字で括弧書きしているケース → colors配列の一致で照合
// ・「今川義元 (スターター)」「英傑 (第2弾)」のように末尾に収録元・収録弾らしき括弧書きが付いているケース
//   → 括弧を外して名前だけで再照合しつつ、括弧の中身を収録弾/収録名のヒントとしてpickCardByHintで判別に活用する
function findCardByFlexibleName(rawName) {
  const n = String(rawName || '').trim();
  if (!n) return null;
  const hieroMatch = n.match(/^ヒエロスガモス\s*[\(（]([^\)）]+)[\)）]\s*$/);
  if (hieroMatch) {
    const colorChars = hieroMatch[1].split('').filter(ch => COLORS.includes(ch) && ch !== '無');
    if (colorChars.length) {
      const card = App.allCards.find(c => c.name.startsWith('ヒエロスガモス') && sameColorSet(c.colors, colorChars));
      if (card) return card;
    }
  }
  let candidates = App.allCards.filter(c => c.name === n);
  if (candidates.length) return pickCardByHint(candidates, null);
  const parenMatch = n.match(/^(.*?)\s*[\(（]([^\)）]*)[\)）]\s*$/);
  if (parenMatch) {
    const stripped = parenMatch[1].trim();
    const hint = parenMatch[2].trim();
    if (stripped) {
      candidates = App.allCards.filter(c => c.name === stripped);
      if (candidates.length) return pickCardByHint(candidates, hint);
    }
  }
  return null;
}

// 他サイト(イジンデン デッキ作成 / sweetpotato版)のテキスト出力形式に対応するパーサー。
// 「メインデッキ<TAB>40」のような見出し行 + 「カード名<TAB>枚数」の行が並ぶ形式。
// この見出し行が見つからない場合はnullを返し、呼び出し側で弊サイト独自形式の解析にフォールバックする。
function parseOtherSiteDeckText(lines) {
  const hasHeader = lines.some(l => /^(メインデッキ|サイドデッキ)[\t ]+\d+\s*$/.test(l.trim()));
  if (!hasHeader) return null;
  const mainCards = [];
  const sideCards = [];
  const warnings = [];
  let section = 'main';
  const addEntry = (list, cardId, qty) => {
    let e = list.find(x => x.cardId === cardId);
    if (!e) { e = { cardId, qty: 0 }; list.push(e); }
    e.qty += qty;
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const headerMatch = line.match(/^(メインデッキ|サイドデッキ)[\t ]+(\d+)\s*$/);
    if (headerMatch) { section = headerMatch[1] === 'サイドデッキ' ? 'side' : 'main'; continue; }
    let m = line.match(/^(.+?)\t+(\d+)\s*$/);
    if (!m) m = line.match(/^(.+?)[ 　]{2,}(\d+)\s*$/);
    if (!m) { warnings.push(`解析できませんでした: ${rawLine}`); continue; }
    const cardName = m[1].trim();
    const qty = parseInt(m[2], 10) || 0;
    if (qty <= 0 || !cardName) continue;
    const card = findCardByFlexibleName(cardName);
    if (!card) { warnings.push(`見つからないカード: ${cardName}`); continue; }
    addEntry(section === 'side' ? sideCards : mainCards, card.id, qty);
  }
  return { mainCards, sideCards, warnings };
}

// deckToText()の出力(またはそれに近い形式)を解析してデッキオブジェクトへ変換する
// 対応形式: "■ デッキ名" / "レギュレーション: 名前" / "タグ: a, b" / "--- メインデッキ (N枚) ---" 等の
// 区切り行 / "2x\tカード名\t[タイプ]" 形式のカード行(タブは半角スペースでも可、[タイプ]は省略可)
// 「メインデッキ<TAB>枚数」形式の他サイトのテキスト出力にも対応する(parseOtherSiteDeckText参照)。
function parseDeckText(text) {
  const lines = String(text || '').split(/\r\n|\r|\n/);
  const otherSiteResult = parseOtherSiteDeckText(lines);
  if (otherSiteResult) {
    return {
      deck: {
        id: uid('deck'), name: 'インポートしたデッキ', regulationId: 'standard',
        mainCards: otherSiteResult.mainCards, sideCards: otherSiteResult.sideCards, tags: [], memo: '',
        thumbnailCardId: null, simStarters: [], leaderCards: [], trumpCard: null, trumpQty: 0,
        createdAt: Date.now(), updatedAt: Date.now(),
      },
      warnings: otherSiteResult.warnings,
    };
  }
  let name = 'インポートしたデッキ';
  let regulationId = 'standard';
  let tags = [];
  let memo = '';
  const mainCards = [];
  const sideCards = [];
  const leaderCards = [];
  let trumpCard = null;
  let trumpQty = 1;
  const warnings = [];
  let section = 'main';
  let sawNameLine = false;

  const addEntry = (list, cardId, qty) => {
    let e = list.find(x => x.cardId === cardId);
    if (!e) { e = { cardId, qty: 0 }; list.push(e); }
    e.qty += qty;
  };
  const findCardByName = (rawName, typeHint, setHint, noHint) => {
    const n = rawName.trim();
    let candidates = App.allCards.filter(c => c.name === n);
    if (!candidates.length) return findCardByFlexibleName(n); // 「カード名 (第○弾)」等の括弧書き形式もここで吸収する
    if (typeHint) {
      const byType = candidates.filter(c => c.type === typeHint);
      if (byType.length) candidates = byType;
    }
    if (candidates.length > 1 && setHint != null) {
      // このサイトのテキスト出力に付記されるNo.(第○弾-番号)があれば、それで同名カードを正確に判別する
      const bySetAndNo = candidates.filter(c => Number(c.set) === setHint && (!noHint || String(c.no) === noHint));
      if (bySetAndNo.length) candidates = bySetAndNo;
      else {
        const bySetOnly = candidates.filter(c => Number(c.set) === setHint);
        if (bySetOnly.length) candidates = bySetOnly;
      }
    }
    return candidates[0];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!sawNameLine && line.startsWith('■')) {
      name = line.replace(/^■\s*/, '').trim() || name;
      sawNameLine = true;
      continue;
    }
    if (/^レギュレーション/.test(line)) {
      const val = line.replace(/^レギュレーション[:：]/, '').trim();
      const found = allRegulations().find(r => r.name === val);
      if (found) regulationId = found.id;
      continue;
    }
    if (/^タグ/.test(line)) {
      const val = line.replace(/^タグ[:：]/, '').trim();
      if (val) tags = val.split(/[,、]/).map(t => t.trim()).filter(Boolean);
      continue;
    }
    if (/^統領/.test(line)) {
      const val = line.replace(/^統領[:：]/, '').trim();
      for (const nm of val.split(/[,、]/).map(t => t.trim()).filter(Boolean)) {
        const card = findCardByName(nm, 'イジン');
        if (card) leaderCards.push(card.id); else warnings.push(`統領が見つかりません: ${nm}`);
      }
      continue;
    }
    if (/^切り札/.test(line)) {
      let val = line.replace(/^切り札[:：]/, '').trim();
      const qtyMatch = val.match(/\s*[xX]\s*(\d+)\s*$/);
      if (qtyMatch) {
        trumpQty = parseInt(qtyMatch[1], 10) || 1;
        val = val.slice(0, qtyMatch.index).trim();
      }
      if (val) {
        const card = findCardByName(val, 'マホウ');
        if (card) trumpCard = card.id; else warnings.push(`切り札が見つかりません: ${val}`);
      }
      continue;
    }
    if (/^-+.*サイドデッキ/.test(line)) { section = 'side'; continue; }
    if (/^-+.*メインデッキ/.test(line)) { section = 'main'; continue; }
    if (/^-+.*メモ/.test(line)) { section = 'memo'; continue; }
    if (/^-+$/.test(line)) continue;

    if (section === 'memo') {
      memo = memo ? memo + '\n' + rawLine : rawLine;
      continue;
    }

    const m = line.match(/^(\d+)\s*[xX]?[\t ]+(.+?)(?:[\t ]*\[([^\]]+)\])?(?:[\t ]*No\.(\d+)-(\S+))?$/);
    if (!m) { warnings.push(`解析できませんでした: ${rawLine}`); continue; }
    const qty = parseInt(m[1], 10) || 0;
    const cardName = m[2].trim();
    const typeHint = m[3] ? m[3].trim() : null;
    const setHint = m[4] ? parseInt(m[4], 10) : null;
    const noHint = m[5] ? m[5].trim() : null;
    if (qty <= 0 || !cardName) continue;
    const card = findCardByName(cardName, typeHint, setHint, noHint);
    if (!card) { warnings.push(`見つからないカード: ${cardName}`); continue; }
    addEntry(section === 'side' ? sideCards : mainCards, card.id, qty);
  }

  const deck = {
    id: uid('deck'), name, regulationId, mainCards, sideCards, tags, memo,
    thumbnailCardId: null, simStarters: [], leaderCards, trumpCard,
    trumpQty: trumpCard ? trumpQty : 0,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  return { deck, warnings };
}

// 文字列が共有リンク(新形式#dz=・旧形式#share=、またはリンクのコード部分だけ)であれば、そのデッキを返す。
// 該当しない/解読できない場合はnullを返す(呼び出し側で通常のテキスト解析等にフォールバックする)。
async function tryDecodeShareTextToDeck(text) {
  const trimmed = String(text || '').trim();
  const dzMatch = trimmed.match(/[#?&]dz=([A-Za-z0-9\-_]+)/);
  const shareMatch = !dzMatch && trimmed.match(/[#?&]share=([A-Za-z0-9\-_]+)/);
  const bareMatch = !dzMatch && !shareMatch && trimmed.match(/^([A-Za-z0-9\-_]{16,})$/);
  if (!dzMatch && !shareMatch && !bareMatch) return null;
  try {
    const payload = dzMatch ? await decodeDeckShareCodeV2(dzMatch[1]) : decodeDeckShareCode((shareMatch || bareMatch)[1]);
    return deckFromSharePayload(payload);
  } catch (e) {
    return null;
  }
}

function openDeckImportModal() {
  const body = `
    <div class="form-row">
      <label>デッキリストのテキストを貼り付け</label>
      <textarea id="importDeckTextarea" rows="14" style="width:100%;font-family:ui-monospace,monospace;font-size:12.5px;" placeholder="「デッキリストをテキスト出力」で書き出した内容(またはこの形式のテキスト)、または共有リンクを貼り付けてください。他サイト「イジンデン デッキ作成」のテキスト出力形式(メインデッキ[TAB]枚数 の見出し+カード名[TAB]枚数)にも対応しています"></textarea>
    </div>
    <div id="importDeckWarnings" style="font-size:12px;color:var(--warn);white-space:pre-wrap;"></div>
  `;
  Modal.open('テキストからデッキをインポート', body, `<button class="btn" id="idCancel">キャンセル</button><button class="btn primary" id="idImport">インポート</button>`, { wide: true });
  document.getElementById('idCancel').addEventListener('click', Modal.close);
  document.getElementById('idImport').addEventListener('click', async () => {
    const text = document.getElementById('importDeckTextarea').value;
    // 共有リンク(新形式#dz=・旧形式#share=、またはリンクのコード部分だけ)が貼られた場合はそちらを優先して読み込む
    const shareDeck = await tryDecodeShareTextToDeck(text);
    if (shareDeck) { finishDeckImport(shareDeck, []); return; }
    const { deck, warnings } = parseDeckText(text);
    const total = deckTotalQty(deck.mainCards) + deckTotalQty(deck.sideCards);
    if (total === 0) {
      document.getElementById('importDeckWarnings').textContent = 'カードを1枚も認識できませんでした。テキストの形式を確認してください。\n' + warnings.join('\n');
      return;
    }
    finishDeckImport(deck, warnings);
  });
}

// QRコード画像からデッキをインポートするモーダル(共有リンクのQR単体・画像出力に埋め込まれたQR付きデッキ画像のどちらでも可)
function openDeckQrImportModal() {
  const body = `
    <div class="form-row">
      <label>QRコード画像を選択</label>
      <input type="file" id="importQrFile" accept="image/*">
      <div style="font-size:12px;color:var(--text-dim);margin-top:6px;">共有リンクのQRコード画像、または「デッキリストを画像で出力」で書き出した画像(右上にQRコードが埋め込まれています)をそのままアップロードできます。</div>
    </div>
    <div id="importDeckWarnings" style="font-size:12px;color:var(--warn);white-space:pre-wrap;"></div>
  `;
  Modal.open('QRコードからデッキをインポート', body, `<button class="btn" id="idCancel">キャンセル</button>`, { wide: true });
  document.getElementById('idCancel').addEventListener('click', Modal.close);
  document.getElementById('importQrFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const warnEl = document.getElementById('importDeckWarnings');
    warnEl.style.color = 'var(--text-dim)';
    warnEl.textContent = 'QRコードを読み取っています…';
    try {
      const text = await decodeQRFromImageFile(file);
      if (!text) { warnEl.style.color = 'var(--warn)'; warnEl.textContent = 'QRコードを認識できませんでした。画像がはっきり写っているか確認してください。'; return; }
      const shareDeck = await tryDecodeShareTextToDeck(text);
      if (!shareDeck) { warnEl.style.color = 'var(--warn)'; warnEl.textContent = 'QRコードは読み取れましたが、デッキ共有リンクの形式ではありませんでした。'; return; }
      finishDeckImport(shareDeck, []);
    } catch (err) {
      warnEl.style.color = 'var(--warn)';
      warnEl.textContent = 'QRコードの読み取りに失敗しました: ' + (err && err.message ? err.message : String(err));
    }
  });
}

function finishDeckImport(deck, warnings) {
  confirmDiscardIfDirty(() => {
    App.workingDeck = deck;
    App.state.activeDeckId = null;
    App.workingDeckDirty = true;
    Modal.close();
    switchView('deck');
    updateSaveStatusBadge();
    if (warnings.length) {
      toast(`インポートしました。一部認識できませんでした(${warnings.length}件)。保存ボタンで確定してください`, 'err');
    } else {
      toast('インポートしました。内容を確認して保存ボタンを押してください');
    }
  });
}

// サムネイル: 手動指定があればそれ、なければメインデッキの先頭(=最初に追加した)カード
function getDeckThumbnailCard(deck) {
  if (deck.thumbnailCardId) {
    const c = getCard(deck.thumbnailCardId);
    if (c) return c;
  }
  for (const e of deck.mainCards) {
    const c = getCard(e.cardId);
    if (c) return c;
  }
  return null;
}
function deckThumbHtml(deck) {
  // 統領戦: 統領イジンが設定されていればそちらをサムネにする(手動指定より優先)。
  // 統領が2枚(盟友)の場合は面積を半分ずつにして両方を表示する。
  const reg = getRegulation(deck.regulationId);
  if (reg && reg.hasLeaderZone && deck.leaderCards && deck.leaderCards.length) {
    const leaders = deck.leaderCards.map(id => getCard(id)).filter(Boolean);
    if (leaders.length === 1) return cardThumbHtml(leaders[0]);
    if (leaders.length >= 2) {
      return `<div style="display:flex; width:100%; height:100%;">
        <div style="width:50%; height:100%; overflow:hidden;">${cardThumbHtml(leaders[0])}</div>
        <div style="width:50%; height:100%; overflow:hidden;">${cardThumbHtml(leaders[1])}</div>
      </div>`;
    }
  }
  const c = getDeckThumbnailCard(deck);
  if (!c) return `<div class="thumb-fallback"><span class="fb-name">?</span></div>`;
  return cardThumbHtml(c);
}

function newPackage(name) {
  const p = { id: uid('pkg'), name: name || '無題のパッケージ', tags: [], memo: '', cards: [], thumbnailCardId: null, createdAt: Date.now(), updatedAt: Date.now() };
  App.state.packages.push(p);
  persist();
  return p;
}
function getPackage(id) { return App.state.packages.find(p => p.id === id); }

function sameColorSet(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every(x => sa.has(x));
}

// マリョクパッケージ(色タグ付き)向けの自動サムネ選定:
// 単色パッケージはその色のオーブ、混色パッケージはヒエロスガモス(あれば優先)、無ければマーブルオーブを
// パッケージ内のカードから探す。該当が無ければnullを返す(呼び出し側で先頭カードにフォールバック)。
function getAutoMaryokuThumbnailCard(pkg) {
  if (!pkg.tags || !pkg.tags.includes('マリョク')) return null;
  const colorTags = pkg.tags.filter(t => COLORS.includes(t) && t !== '無');
  const inPkg = (pred) => {
    for (const e of pkg.cards) {
      const c = getCard(e.cardId);
      if (c && pred(c)) return c;
    }
    return null;
  };
  if (colorTags.length === 1) {
    // 単色: オーブ(レベル2・単色のマリョク)
    return inPkg(c => c.type === 'マリョク' && c.level === 2 && c.colors.length === 1 && c.colors[0] === colorTags[0]);
  }
  if (colorTags.length === 2) {
    const hiero = inPkg(c => c.name.startsWith('ヒエロスガモス') && sameColorSet(c.colors, colorTags));
    if (hiero) return hiero;
    const marble = inPkg(c => c.name.includes('マーブルオーブ') && sameColorSet(c.colors, colorTags));
    if (marble) return marble;
  }
  return null;
}

// サムネイル: 手動指定 > マリョクパッケージの自動選定(オーブ/マーブルオーブ/ヒエロスガモス) > パッケージ内の先頭カード
function getPackageThumbnailCard(pkg) {
  if (pkg.thumbnailCardId) {
    const c = getCard(pkg.thumbnailCardId);
    if (c) return c;
  }
  const auto = getAutoMaryokuThumbnailCard(pkg);
  if (auto) return auto;
  for (const e of pkg.cards) {
    const c = getCard(e.cardId);
    if (c) return c;
  }
  return null;
}
function pkgThumbHtml(pkg) {
  const c = getPackageThumbnailCard(pkg);
  if (!c) return `<div class="thumb-fallback"><span class="fb-name">?</span></div>`;
  return cardThumbHtml(c);
}


