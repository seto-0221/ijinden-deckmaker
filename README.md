# イジンデンラボ 開発リポジトリ

TCG「イジンデン」の非公式デッキ構築ツール。
このリポジトリは「ソース分割+自動ビルド」構成(フェーズ0)です。**公開されるサイトの見た目・機能・URLは従来と同一**で、ビルド出力は移行前の単一HTMLとバイト単位で一致することを確認済みです。

## 構成

```
src/
├─ index.template.html   # ページの骨組み(各ブロックの流し込み先)
├─ styles/               # CSS(番号順に結合される)
├─ app/                  # アプリ本体JS(番号順に結合され、1つの<script>になる)
│   ├─ core/             #   定数/ストレージ/状態/カード索引/イベント配線/初期化
│   ├─ features/         #   機能別(browse, deck-editor, decks, sim, import, data)
│   └─ ui/               #   共通UI(カードタイル、モーダル群)
├─ data/
│   ├─ cards/set-N.json        # カードデータ(弾ごと)
│   └─ card-thumbs/set-N.json  # カードサムネ(base64、弾ごと)
├─ lib/                  # 同梱ライブラリ(qrcode-generator, jsQR)
└─ build-manifest.json   # 結合順の定義
public/                  # そのまま公開される静的ファイル(カード画像・アイコン類)
scripts/build.mjs        # ビルド(依存ゼロ)
tests/regression.test.js # 回帰テスト(要 npm install)
.github/workflows/deploy.yml  # push時の自動ビルド&公開
```

## 日常の作業フロー

1. `src/` 以下を編集する(**dist/ は編集しない。ビルドで毎回作り直されます**)
2. コミットして push する
3. GitHub Actions が自動でビルドして GitHub Pages に公開する(1〜2分)

ローカルで確認したい場合:

```bash
node scripts/build.mjs   # dist/index.html が生成される(ブラウザで開いて確認)
npm install              # 初回のみ(テスト用のjsdom)
npm test                 # ビルド+回帰テスト
```

## 初回だけ必要な設定(重要)

GitHub のリポジトリ設定で、Pages の公開元を Actions に切り替えてください。

1. リポジトリの Settings → Pages
2. Build and deployment → Source を **GitHub Actions** に変更

これをするまでは従来どおり「ブランチのファイルをそのまま公開」のままです(切り替えるまで新構成は公開に反映されません)。

## 新しい弾のカードを追加するには

1. `src/data/cards/set-7.json` を追加(既存の set-6.json と同じ形式)
2. `src/data/card-thumbs/set-7.json` を追加(カードID→base64画像)
3. `src/build-manifest.json` の `cardSetOrder` と `thumbSetOrder` に `"7"` を追記
4. `public/images/` に公式ファイル名の画像を追加
5. push(自動で公開)

## 禁止カード・レギュレーションの変更

`src/app/core/01-header-constants.js` の `DEFAULT_REGULATIONS` を編集してください。

## 今後の拡張(フェーズ1以降の予定)

- ハッシュルーター導入(`#/cards/1-33` などページ直リンク) → カードDB・裁定ページの土台
- カード画像の外部参照化+PWAキャッシュ(初期ロード約20MB→約1MB)
- `services/api.js` のAPI境界追加 → 公開デッキ・大会・ユーザー機能

---

## フェーズ0の作業内容と完了条件(実施記録)

### 作業順序(推奨コミット分割)

段階ごとに戻せるよう、リポジトリへは以下の順で小さくコミットするのを推奨します。

1. `docs: 開発README追加` … README.md / .gitignore
2. `build: ソース分割(src/)とビルドスクリプト追加` … src/一式 + scripts/build.mjs ※この時点では公開物に影響なし
3. `test: 回帰テストと画像対応チェック追加` … tests/ + scripts/check-images.mjs + package.json / package-lock.json
4. `ci: 自動ビルド&デプロイのワークフロー追加` … .github/workflows/deploy.yml
5. Settings → Pages の Source を「GitHub Actions」へ切り替え(コミットではなく設定変更)
6. 動作確認後、旧`index.html`等のルート直下の成果物ファイルを削除するコミット(任意・最後)

### 作成・変更ファイル一覧

- 新規: `src/`(styles 7・app 17・data 14・lib 2・テンプレート・build-manifest)、`scripts/build.mjs`、`scripts/check-images.mjs`、`tests/regression.test.js`、`.github/workflows/deploy.yml`、`package.json`、`.gitignore`、`README.md`
- 移動: カード画像・アイコン類 → `public/`
- 変更: なし(アプリのコードは1文字も変更していません)

### 回帰テスト項目(tests/regression.test.js)

起動と全データ読込(カード576/サムネ576/ロゴ)、QRライブラリの遅延実行と生成、レギュレーション定義(大会の禁止カード含む)、validateDeckの禁止カード判定、デッキ画像出力(統領戦の専用枠・統計ボックス)、絞り込みパネルのオプション、統領/切り札ピッカー、デッキ編集画面のDOM構造とリスト/グリッド切替。

### 完了条件(すべて達成済み)

1. `node scripts/build.mjs` の出力が移行前の公開HTMLと**バイト単位で一致**する
2. 回帰テスト18項目が全て合格する
3. `check:images` が欠損・重複・大小文字・拡張子不一致ゼロを報告する
4. CIはビルド+テスト+画像チェック合格時のみデプロイする(失敗時は現公開版を維持)
5. localStorage・共有リンク・QR・インポート形式・カード並び順・初期表示に変更なし(1の同一性により保証)

### フェーズ0で意図的にやっていないこと

- pub/subや状態管理の変更(コード移動のみ、という条件のため見送り。フェーズ1で土台だけ導入予定)
- ルーティング変更(フェーズ1)。なお`switchView()`は現状でも画面描画関数と分離されており、ルート定義への置き換えが可能な構造です

---

## Search Console / SEO運用メモ

- サイトマップは Search Console の「サイトマップ」で `sitemap.xml` と**手入力**して送信する(URLのコピペは不可視文字が混ざることがある)
- 新規サイトは送信直後「読み込めませんでした」と表示されることが多いが、ファイルに問題がなければ数時間〜数日で「成功しました」に変わる
- robots.txtはホストルートしか有効にならない。ルート用リポジトリ(seto-0221.github.io)側で管理する
- 反映を早めたいページは、Search Consoleの「URL検査」→「インデックス登録をリクエスト」を使う
- サイトの主要な変更を公開したら、sitemap.xmlの<lastmod>を更新するとクロールの再訪が促される
