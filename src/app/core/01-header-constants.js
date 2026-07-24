
'use strict';
/* =========================================================================
   イジンデン デッキメーカー
   単一HTMLで完結するカードデータベース内蔵デッキ構築ツール。
   構成:
     1. 定数・レギュレーション定義
     2. ストレージ層 (localStorage)
     3. 状態管理
     4. カードデータユーティリティ (フィルタ/検索)
     5. デッキ / パッケージ ロジック (検証・集計・テキスト出力)
     6. インポート (CSV / Excel) ロジック
     7. 描画 (各タブ)
     8. イベント配線・初期化
   ========================================================================= */

const CARD_TYPES = ['イジン', 'マホウ', 'ハイケイ', 'マリョク'];
const COLORS = ['赤', '青', '緑', '黄', '紫', '無'];
const RARITIES = ['N', 'R', 'SR', 'PSR'];

const STORAGE_KEY = 'ijinden_deckmaker_v1';

const DEFAULT_REGULATIONS = [
  { id: 'standard', name: '通常構築', builtin: true, minMain: 40, maxMain: null, maxCopies: 4, sideMax: 10, totalMax: 60, note: '同名カードは4枚まで（「デッキに何枚でも入れてよい」カードを除く）。メイン40枚以上。' },
  { id: 'mininden', name: 'ミニンデン', builtin: true, minMain: 20, maxMain: 20, maxCopies: 1, maryokuMaxCopies: 4, sideMax: 0, note: '20枚固定。マリョク以外は同名1枚まで、マリョクは4枚まで。' },
  { id: 'free', name: 'フリー(制限なし)', builtin: true, minMain: 0, maxMain: null, maxCopies: null, sideMax: null, note: '枚数・同名制限なしで自由に組めます。' },
  {
    id: 'tournament', name: '大会', builtin: true,
    minMain: 40, maxMain: null, maxCopies: 4, sideMax: 10, totalMax: 60,
    bannedCardNames: ['ジョバンニ＝ディ＝メディチ', 'リユニオン', '千利休'],
    note: '通常構築と同じルールに加え、「ジョバンニ＝ディ＝メディチ」「リユニオン」「千利休」は使用禁止です。',
  },
  {
    id: 'starter-only', name: 'スターター構築戦', builtin: true,
    minMain: 40, maxMain: null, maxCopies: 4, sideMax: 10, totalMax: 60,
    sourceFilter: 'starter',
    note: 'スターターデッキ収録カードのみ使用できます（ブースター収録カードは使用不可）。',
  },
  {
    id: 'leader', name: '統領戦', builtin: true,
    hasLeaderZone: true, hasTrumpZone: true,
    leaderMinCount: 1, leaderMaxCount: 2, leaderCombinedLevelCap: 6,
    totalMax: 60, totalExact: true,
    maxCopies: 2, maryokuMaxCopies: Infinity,
    trumpMaxCopies: 2,
    sideMax: 15,
    colorRestrictedByLeader: true,
    note: '統領イジンを1〜2枚選択（2枚の場合は合計レベル6以下）。統領の色（盟友の場合は合計色）を含むカードと無色のカードのみ使用可能。統領＋切り札＋メインで合計60枚ちょうど。同名カードは2枚まで（マリョクを除く）。切り札はマホウ1種類のみ、2枚まで選択できます。サイドデッキは15枚まで。',
  },
];

// カード種類ごとの表示アイコン文字
const TYPE_SHORT = { 'イジン': '偉', 'マホウ': '魔', 'ハイケイ': '景', 'マリョク': '力' };

// デッキの戦略分類マスタ。UIはこの配列から選択肢を生成するため、候補の追加・変更はここを編集するだけでよい。
// 保存されるのはid(英字)のみ。表示名を後から変えても保存済みデッキには影響しない。
// 未知のid(候補を将来削除した場合など)は「その他」として表示し、ユーザーが選び直すまでデータは書き換えない。
const DECK_STRATEGIES = [
  { id: 'aggro',    name: 'アグロ' },
  { id: 'midrange', name: 'ミッドレンジ' },
  { id: 'control',  name: 'コントロール' },
  { id: 'combo',    name: 'コンボ' },
  { id: 'ramp',     name: 'ランプ' },
  { id: 'other',    name: 'その他' },
];

// デッキタグの上限(件数・1タグの文字数)
const TAG_MAX_COUNT = 10;
const TAG_MAX_LENGTH = 20;

// マリョク色構築デフォルトパッケージ(単色5種+2色10種)。id固定でバージョン間の再適用を可能にする。
const DEFAULT_PACKAGES = [
  {
    "id": "default-mono-red",
    "name": "赤マリョクセット",
    "tags": [
      "マリョク",
      "赤"
    ],
    "cards": [
      {
        "cardId": "4-80",
        "qty": 4
      },
      {
        "cardId": "5-96",
        "qty": 4
      },
      {
        "cardId": "3-71",
        "qty": 4
      },
      {
        "cardId": "5-101",
        "qty": 4
      }
    ]
  },
  {
    "id": "default-mono-blue",
    "name": "青マリョクセット",
    "tags": [
      "マリョク",
      "青"
    ],
    "cards": [
      {
        "cardId": "4-80",
        "qty": 4
      },
      {
        "cardId": "5-97",
        "qty": 4
      },
      {
        "cardId": "3-72",
        "qty": 4
      },
      {
        "cardId": "5-102",
        "qty": 4
      }
    ]
  },
  {
    "id": "default-mono-green",
    "name": "緑マリョクセット",
    "tags": [
      "マリョク",
      "緑"
    ],
    "cards": [
      {
        "cardId": "4-80",
        "qty": 4
      },
      {
        "cardId": "5-98",
        "qty": 4
      },
      {
        "cardId": "3-73",
        "qty": 4
      },
      {
        "cardId": "5-103",
        "qty": 4
      }
    ]
  },
  {
    "id": "default-mono-yellow",
    "name": "黄マリョクセット",
    "tags": [
      "マリョク",
      "黄"
    ],
    "cards": [
      {
        "cardId": "4-80",
        "qty": 4
      },
      {
        "cardId": "5-99",
        "qty": 4
      },
      {
        "cardId": "3-74",
        "qty": 4
      },
      {
        "cardId": "5-104",
        "qty": 4
      }
    ]
  },
  {
    "id": "default-mono-purple",
    "name": "紫マリョクセット",
    "tags": [
      "マリョク",
      "紫"
    ],
    "cards": [
      {
        "cardId": "4-80",
        "qty": 4
      },
      {
        "cardId": "5-100",
        "qty": 4
      },
      {
        "cardId": "3-75",
        "qty": 4
      },
      {
        "cardId": "5-105",
        "qty": 4
      }
    ]
  },
  {
    "id": "default-dual-ry",
    "name": "赤黄マリョクセット",
    "tags": [
      "マリョク",
      "赤",
      "黄"
    ],
    "cards": [
      {
        "cardId": "4-80",
        "qty": 4
      },
      {
        "cardId": "2-78",
        "qty": 4
      },
      {
        "cardId": "6-60",
        "qty": 4
      },
      {
        "cardId": "5-96",
        "qty": 4
      },
      {
        "cardId": "3-71",
        "qty": 4
      },
      {
        "cardId": "5-101",
        "qty": 4
      },
      {
        "cardId": "5-99",
        "qty": 4
      },
      {
        "cardId": "3-74",
        "qty": 4
      },
      {
        "cardId": "5-104",
        "qty": 4
      }
    ]
  },
  {
    "id": "default-dual-by",
    "name": "青黄マリョクセット",
    "tags": [
      "マリョク",
      "青",
      "黄"
    ],
    "cards": [
      {
        "cardId": "4-80",
        "qty": 4
      },
      {
        "cardId": "2-79",
        "qty": 4
      },
      {
        "cardId": "5-97",
        "qty": 4
      },
      {
        "cardId": "3-72",
        "qty": 4
      },
      {
        "cardId": "5-102",
        "qty": 4
      },
      {
        "cardId": "5-99",
        "qty": 4
      },
      {
        "cardId": "3-74",
        "qty": 4
      },
      {
        "cardId": "5-104",
        "qty": 4
      }
    ]
  },
  {
    "id": "default-dual-gy",
    "name": "緑黄マリョクセット",
    "tags": [
      "マリョク",
      "緑",
      "黄"
    ],
    "cards": [
      {
        "cardId": "4-80",
        "qty": 4
      },
      {
        "cardId": "2-80",
        "qty": 4
      },
      {
        "cardId": "5-98",
        "qty": 4
      },
      {
        "cardId": "3-73",
        "qty": 4
      },
      {
        "cardId": "5-103",
        "qty": 4
      },
      {
        "cardId": "5-99",
        "qty": 4
      },
      {
        "cardId": "3-74",
        "qty": 4
      },
      {
        "cardId": "5-104",
        "qty": 4
      }
    ]
  },
  {
    "id": "default-dual-rg",
    "name": "赤緑マリョクセット",
    "tags": [
      "マリョク",
      "赤",
      "緑"
    ],
    "cards": [
      {
        "cardId": "4-80",
        "qty": 4
      },
      {
        "cardId": "6-61",
        "qty": 4
      },
      {
        "cardId": "5-96",
        "qty": 4
      },
      {
        "cardId": "3-71",
        "qty": 4
      },
      {
        "cardId": "5-101",
        "qty": 4
      },
      {
        "cardId": "5-98",
        "qty": 4
      },
      {
        "cardId": "3-73",
        "qty": 4
      },
      {
        "cardId": "5-103",
        "qty": 4
      }
    ]
  },
  {
    "id": "default-dual-bg",
    "name": "青緑マリョクセット",
    "tags": [
      "マリョク",
      "青",
      "緑"
    ],
    "cards": [
      {
        "cardId": "4-80",
        "qty": 4
      },
      {
        "cardId": "6-62",
        "qty": 4
      },
      {
        "cardId": "5-97",
        "qty": 4
      },
      {
        "cardId": "3-72",
        "qty": 4
      },
      {
        "cardId": "5-102",
        "qty": 4
      },
      {
        "cardId": "5-98",
        "qty": 4
      },
      {
        "cardId": "3-73",
        "qty": 4
      },
      {
        "cardId": "5-103",
        "qty": 4
      }
    ]
  },
  {
    "id": "default-dual-bp",
    "name": "青紫マリョクセット",
    "tags": [
      "マリョク",
      "青",
      "紫"
    ],
    "cards": [
      {
        "cardId": "4-80",
        "qty": 4
      },
      {
        "cardId": "6-63",
        "qty": 4
      },
      {
        "cardId": "5-97",
        "qty": 4
      },
      {
        "cardId": "3-72",
        "qty": 4
      },
      {
        "cardId": "5-102",
        "qty": 4
      },
      {
        "cardId": "5-100",
        "qty": 4
      },
      {
        "cardId": "3-75",
        "qty": 4
      },
      {
        "cardId": "5-105",
        "qty": 4
      }
    ]
  },
  {
    "id": "default-dual-yp",
    "name": "黄紫マリョクセット",
    "tags": [
      "マリョク",
      "黄",
      "紫"
    ],
    "cards": [
      {
        "cardId": "4-80",
        "qty": 4
      },
      {
        "cardId": "6-64",
        "qty": 4
      },
      {
        "cardId": "5-99",
        "qty": 4
      },
      {
        "cardId": "3-74",
        "qty": 4
      },
      {
        "cardId": "5-104",
        "qty": 4
      },
      {
        "cardId": "5-100",
        "qty": 4
      },
      {
        "cardId": "3-75",
        "qty": 4
      },
      {
        "cardId": "5-105",
        "qty": 4
      }
    ]
  },
  {
    "id": "default-dual-rb",
    "name": "赤青マリョクセット",
    "tags": [
      "マリョク",
      "赤",
      "青"
    ],
    "cards": [
      {
        "cardId": "4-80",
        "qty": 4
      },
      {
        "cardId": "5-96",
        "qty": 4
      },
      {
        "cardId": "3-71",
        "qty": 4
      },
      {
        "cardId": "5-101",
        "qty": 4
      },
      {
        "cardId": "5-97",
        "qty": 4
      },
      {
        "cardId": "3-72",
        "qty": 4
      },
      {
        "cardId": "5-102",
        "qty": 4
      }
    ]
  },
  {
    "id": "default-dual-rp",
    "name": "赤紫マリョクセット",
    "tags": [
      "マリョク",
      "赤",
      "紫"
    ],
    "cards": [
      {
        "cardId": "4-80",
        "qty": 4
      },
      {
        "cardId": "5-96",
        "qty": 4
      },
      {
        "cardId": "3-71",
        "qty": 4
      },
      {
        "cardId": "5-101",
        "qty": 4
      },
      {
        "cardId": "5-100",
        "qty": 4
      },
      {
        "cardId": "3-75",
        "qty": 4
      },
      {
        "cardId": "5-105",
        "qty": 4
      }
    ]
  },
  {
    "id": "default-dual-gp",
    "name": "緑紫マリョクセット",
    "tags": [
      "マリョク",
      "緑",
      "紫"
    ],
    "cards": [
      {
        "cardId": "4-80",
        "qty": 4
      },
      {
        "cardId": "5-98",
        "qty": 4
      },
      {
        "cardId": "3-73",
        "qty": 4
      },
      {
        "cardId": "5-103",
        "qty": 4
      },
      {
        "cardId": "5-100",
        "qty": 4
      },
      {
        "cardId": "3-75",
        "qty": 4
      },
      {
        "cardId": "5-105",
        "qty": 4
      }
    ]
  }
];

// インポート時の列名自動マッピング候補
const IMPORT_FIELD_ALIASES = {
  name: ['カード名', '名称', '名前', 'name'],
  rarity: ['レアリティ', 'rarity'],
  colors: ['色', '属性', 'color'],
  type: ['種類', 'タイプ', 'type'],
  level: ['レベル', 'lv', 'level'],
  cost: ['魔力コスト', 'コスト', 'cost'],
  power: ['パワー', 'power'],
  trait: ['特性', 'trait'],
  ruleText: ['ルールテキスト', '効果', 'テキスト', 'text', 'rule'],
  igyouText: ['遺業能力', '偉業能力', 'igyou'],
  illustrator: ['イラストレーター', 'illustlation', 'illustrator'],
  source: ['収録', 'セット', '弾', 'source'],
  no: ['no', 'no1-', 'no2-', 'カードno', '番号'],
  imageUrl: ['画像', 'image', 'imageurl'],
};

let RAW_CARDS = [];
try {
  RAW_CARDS = JSON.parse(document.getElementById('card-data').textContent);
} catch (e) {
  console.error('card-data parse failed', e);
  RAW_CARDS = [];
}

// カードID -> 縮小サムネイル(base64 data URI)。ビルド時に埋め込み済みのため、
// file://下でのfetch/canvasタインティング制限を受けず、常に確実に読み込める。
// 主に画像出力(PNGエクスポート)機能で使用する。
let CARD_THUMB_B64 = {};
try {
  const el = document.getElementById('card-thumbs-b64');
  if (el) CARD_THUMB_B64 = JSON.parse(el.textContent);
} catch (e) {
  console.error('card-thumbs-b64 parse failed', e);
  CARD_THUMB_B64 = {};
}

// サイトロゴ(イジンデンラボ)。ヘッダー表示・デッキ画像出力への埋め込みで使用する(base64埋め込みのため常に確実に読み込める)。
// headerLight/headerDark: ヘッダー用の横長ロゴ(アイコン+文字)。exportIconLight/exportIconDark: 画像出力の隅に入れるアイコンのみのマーク。
let LOGO_ASSETS = {};
try {
  const el2 = document.getElementById('logo-assets-b64');
  if (el2) LOGO_ASSETS = JSON.parse(el2.textContent);
} catch (e) {
  console.error('logo-assets-b64 parse failed', e);
  LOGO_ASSETS = {};
}


