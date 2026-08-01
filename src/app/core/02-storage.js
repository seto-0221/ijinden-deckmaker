/* ========================= 2. ストレージ層 ========================= */

// localStorageから読み込んだ外部由来のオブジェクト(data)を、あらかじめ決めた許可キーの
// 一覧(allowedKeys)だけに限定して、新しいプレーンオブジェクトへ明示的にコピーする。
//
// 【重要】Object.assign(target, data) や { ...target, ...data } のような一括マージは、
// dataが JSON.parse で作られたプレーンオブジェクトであっても、data自身が
// "__proto__" という名前の"普通の"キーを持っていた場合(JSON.parse('{"__proto__":{...}}')は
// これを例外的なアクセサではなく通常のown data propertyとして生成する)、
// target.__proto__ = data.__proto__ という代入が実際に発生し、targetのプロトタイプが
// 書き換えられてしまう(prototype pollutionに隣接する挙動)。
//
// この関数は、コピー先のプロパティ名を必ず「こちら側で用意した固定の許可リスト」からしか
// 取らないため("__proto__"等の危険なキー名がdataに含まれていても、そもそも許可リストに
// 無ければ一切読み書きされない)、上記のような書き換えは構造的に発生しない。
// 念のため、許可リスト自体に"__proto__"/"constructor"/"prototype"が紛れ込んだ場合の
// 保険として、コピー直前にも明示的な除外チェックを行う(多層防御)。
function pickAllowedFields(data, defaults, allowedKeys) {
  const src = (data && typeof data === 'object') ? data : {};
  const out = {};
  for (const key of allowedKeys) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = Object.prototype.hasOwnProperty.call(src, key) ? src[key] : defaults[key];
  }
  return out;
}

const STORE_TOP_LEVEL_KEYS = [
  'schemaVersion', 'customCards', 'removedCardIds', 'decks', 'packages',
  'regulations', 'settings', 'activeDeckId', 'seenDefaultPackageIds',
];
const STORE_SETTINGS_KEYS = ['theme', 'viewMode', 'sim'];
const STORE_SETTINGS_SIM_KEYS = ['handSize', 'secondDraw', 'mulligan', 'trials', 'useHierosgamos'];

// 【信頼境界について】Store.load()は「このアプリ自身が過去にStore.save()で書き込んだ
// localStorageの中身」を読み込む処理であり、共有リンク/QRコード/バックアップファイル等の
// 外部由来データを読み込む処理ではない。そのため、以下のload()はトップレベルのキー構成
// (pickAllowedFieldsによる許可キー方式・__proto__等の除外)については防御するが、
// 各デッキのmainCards/sideCards内の個々のqty値については、sanitizeCardEntries
// (05-deck-logic.js)のような1エントリごとの範囲チェックを一切行わない。
// これは見落としではなく意図的な設計であり、理由は次の2点:
//   1. localStorageはオリジン単位で分離されており、このアプリのJSコード以外が書き込む
//      経路は通常存在しない(devtoolsでの手動改ざん等は別問題であり、そもそもJS実行が
//      同一オリジンで可能な時点でこのアプリの信頼境界の外側にある)。
//   2. mergeSideIntoMainIfNoSide(05-deck-logic.js)のように、アプリ自身が正規化の過程で
//      意図的にDECK_QTY_MAX(999)を超える値(合算結果)を生成するケースがあり、これを
//      Store.load()側で999超過を理由に除外してしまうと、正常な操作(サイド上限0への
//      切り替え)で作られた既存カードが再読み込みのたびに消えてしまう。
// 一方、共有リンク/QRコード/バックアップ復元/テキストインポート等、このアプリの外から
// やってくるデータは、Store.load()を経由せず、必ずsanitizeDeckPayload/sanitizeRestoredDeck/
// sanitizeCardEntries(いずれも05-deck-logic.js)を個別に通してからApp.state/workingDeckへ
// 取り込まれる(呼び出し箇所: 06-sim-logic.jsのdeckFromSharePayload、14-view.jsの
// buildRestoredStateFromBackup、06-sim-logic.jsのparseDeckText/parseOtherSiteDeckText)。
// そちらの経路ではqty>999のエントリは(クランプせず)除外される。「内部保存データは壊さず
// 保持する」ことと「外部由来データはqty>999を拒否する」ことは、この関数の呼び出し元を
// 分けることで両立させている。
const Store = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return this.defaults();
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return this.defaults();

      const defaults = this.defaults();
      // トップレベルは許可キー方式で新しいオブジェクトへ明示的にコピーする
      // (Object.assign(defaults, data)のような一括マージは行わない)。
      const merged = pickAllowedFields(data, defaults, STORE_TOP_LEVEL_KEYS);

      // settings/sim はネストしたオブジェクトなので、同じ許可キー方式で個別にマージする。
      // 旧バージョンの保存データに無いキーはdefaultsの値で補完される(互換性は維持)。
      const rawSettings = (data.settings && typeof data.settings === 'object') ? data.settings : {};
      merged.settings = pickAllowedFields(rawSettings, defaults.settings, STORE_SETTINGS_KEYS);
      const rawSim = (rawSettings.sim && typeof rawSettings.sim === 'object') ? rawSettings.sim : {};
      merged.settings.sim = pickAllowedFields(rawSim, defaults.settings.sim, STORE_SETTINGS_SIM_KEYS);

      return merged;
    } catch (e) {
      console.error('load failed', e);
      return this.defaults();
    }
  },
  defaults() {
    return {
      // 保存データの形式バージョン。現時点では判定に使わないが、将来「読み込み時変換が必要な形式変更」を
      // 行う際の判断材料として保持する(2: デッキ分類メタデータ導入以降)
      schemaVersion: 2,
      customCards: [],       // ユーザーが追加/編集したカード (idが一致すれば上書き)
      removedCardIds: [],    // デフォルトカードの中で削除されたもの
      decks: [],
      packages: [],
      regulations: [],       // ユーザー定義レギュレーション追加分
      settings: {
        theme: 'auto', viewMode: 'grid',
        sim: { handSize: 6, secondDraw: 1, mulligan: true, trials: 15000, useHierosgamos: false },
      },
      activeDeckId: null,
      seenDefaultPackageIds: [],
    };
  },
  save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('save failed', e);
      toast('保存に失敗しました（ストレージ容量オーバーの可能性があります）', 'err');
    }
  },
  sizeBytes() {
    const raw = localStorage.getItem(STORAGE_KEY) || '';
    return new Blob([raw]).size;
  },
};
