/* ========================= 2. ストレージ層 ========================= */
const Store = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return this.defaults();
      const data = JSON.parse(raw);
      const merged = Object.assign(this.defaults(), data);
      // settings/sim はネストしたオブジェクトなので、旧バージョンの保存データに無いキーが
      // 消えてしまわないよう個別にデフォルト値とマージする
      merged.settings = Object.assign({}, this.defaults().settings, data.settings || {});
      merged.settings.sim = Object.assign({}, this.defaults().settings.sim, (data.settings || {}).sim || {});
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

