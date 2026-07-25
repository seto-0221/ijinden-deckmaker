'use strict';
/**
 * カード詳細の表示に関する純粋関数群(DOM操作なし・文字列生成のみ)。
 *
 * ブラウザ側(カード詳細モーダル: src/app/ui/13-modals.js)と、
 * Node.jsのビルド時静的ページ生成(scripts/build-card-pages.mjs)の
 * 両方から「同一の関数」を利用するための共有モジュール。
 * カードの表示ロジックを二重実装しないことが目的。
 *
 * 設計方針:
 *   - 画像パスの深さ(images/ か ../../images/ か)や、JSエラー時フォールバックの要否は、
 *     グローバル定数や実行環境の暗黙の前提に依存せず、呼び出し側がoptionsで明示的に渡す。
 *     これにより、Webアプリ・SSGカードページ・将来の独自ドメイン/CDNのいずれでも
 *     同じレンダラーを安全に使い回せる。
 *   - このファイル単体でNode.js側から `import { cardDetailBodyHtml } from '...'` として
 *     通常のESモジュールとしてimportできるよう、他ファイルへの依存を一切持たない
 *     (escapeHtml等もこのファイル内に自己完結させている)。
 *   - ブラウザ向けの単一HTMLビルド(scripts/build.mjs)では、既存の17ファイルと同様に
 *     ソースをそのまま結合して1つの<script>にする方式を踏襲する(アプリ全体をESモジュール化する
 *     大改修は今回のスコープ外のため)。結合時に、このファイル特有の処理として先頭の`export `のみを
 *     機械的に取り除く。そのため、このファイルでは named export の
 *     `export function ...` / `export const ... = ...` 以外の構文
 *     (export default・re-export・分割export文など)は使わないこと。
 */

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// 公式サイトが実際に使っているファイル名の慣習を再現する:
//   ブースター       : {set 2桁}_{No 3桁}.png                 例) 01_001.png
//   第1弾スターター  : {英字}_{No 3桁}.png                    例) R_009.png
//   第2弾以降スターター: {set 2桁}_{英字}_{No 3桁}.png         例) 02_Y_001.png, 03_P_016.png
export function officialImageFilename(c) {
  const no = String(c.no || '').trim();
  const setNum = Number(c.set);
  if (!no || Number.isNaN(setNum)) return null;
  const setStr = String(setNum).padStart(2, '0');
  const letterMatch = no.match(/^([A-Za-z]+)[\s\-]?(\d+)$/);
  if (letterMatch) {
    const letter = letterMatch[1].toUpperCase();
    const num = letterMatch[2].padStart(3, '0');
    return setNum === 1 ? `${letter}_${num}.png` : `${setStr}_${letter}_${num}.png`;
  }
  const plainMatch = no.match(/^(\d+)$/);
  if (plainMatch) return `${setStr}_${plainMatch[1].padStart(3, '0')}.png`;
  return null;
}

// options.imageBasePath: カード画像を探す基点パス(既定 'images/'。呼び出し側が明示指定する)
export function imageCandidates(c, options = {}) {
  const base = options.imageBasePath != null ? options.imageBasePath : 'images/';
  const list = [];
  const official = officialImageFilename(c);
  if (official) list.push(`${base}${official}`);
  list.push(`${base}${c.id}.png`, `${base}${c.id}.jpg`, `${base}${c.id}.webp`);
  if (c.imageUrl) list.push(c.imageUrl);
  return list;
}

// options.enableJsFallback: true(既定)ならブラウザのカード検索一覧などと同じ
//   「onerrorで次候補へ切り替える」JS前提のマークアップにする。
//   false を渡すと、JSが一切実行されなくても完成した1枚の<img>になるよう、
//   最有力候補(公式ファイル名)のみを直接埋め込む(SSGカードページ向け)。
export function cardImageBlockHtml(c, options = {}) {
  const candidates = imageCandidates(c, options);
  const first = candidates[0] || '';
  const alt = escapeHtml(c.name);
  if (options.enableJsFallback === false) {
    return `<img src="${escapeHtml(first)}" alt="${alt}" width="360" height="502" loading="lazy">`;
  }
  // 既存のcardThumbHtml(08-card-tile.js)と完全に同一のマークアップ(既存動作を変えないため、
  // width/height属性は付けない。コンテナ側のCSS(aspect-ratio指定)でレイアウトシフトは既に防止済み)。
  const rest = escapeHtml(JSON.stringify(candidates.slice(1)));
  return `<img src="${escapeHtml(first)}" loading="lazy" alt="${alt}"
      data-card-id="${c.id}" data-fallbacks="${rest}" onerror="handleImgError(this)">`;
}

/* ---- 将来の追加セクション(関連裁定/公開デッキ/関連カード/大会実績)の登録制スキーマ ----
   データが無いセクションは何も描画しない(空配列を返す限り画面は現状と完全に同一)。
   将来、getDataの中身を実データ源(rulings.json・公開デッキAPI等)に差し替えるだけで、
   カード詳細モーダルとSSGカードページの両方に同時に反映される。 */
export const CARD_DETAIL_SECTIONS = [
  {
    id: 'rulings',
    title: '関連裁定',
    getData: (c) => [], // 将来: getRulingsForCard(c.id)
    render: (items) => items.map((r) => `<div class="rule-text"><b>Q.</b> ${escapeHtml(r.q)}<br><b>A.</b> ${escapeHtml(r.a)}${r.date ? `<div style="font-size:11px;color:var(--text-faint);">${escapeHtml(r.source || '')} ${escapeHtml(r.date)}</div>` : ''}</div>`).join(''),
  },
  {
    id: 'publicDecks',
    title: 'このカードを採用した公開デッキ',
    getData: (c) => [], // 将来: 公開デッキAPI
    render: (items) => items.map((d) => `<div class="kv-row"><span>${escapeHtml(d.name)}</span></div>`).join(''),
  },
  {
    id: 'related',
    title: '関連カード',
    getData: (c) => [], // 将来: 関連カード定義
    render: (items, options) => `<div style="display:flex;gap:8px;flex-wrap:wrap;">${items.map((rc) => `<div class="thumb-sm">${cardImageBlockHtml(rc, options)}</div>`).join('')}</div>`,
  },
  {
    id: 'results',
    title: '大会での採用実績',
    getData: (c) => [], // 将来: 大会結果データ
    render: (items) => items.map((t) => `<div class="kv-row"><span>${escapeHtml(t.name)}</span><span>${escapeHtml(t.result || '')}</span></div>`).join(''),
  },
];

// データが存在するセクションだけHTMLを生成する(全セクション空なら空文字列を返し、画面に何も足さない)
export function cardDetailSectionsHtml(c, options = {}) {
  let html = '';
  for (const sec of CARD_DETAIL_SECTIONS) {
    let items = [];
    try { items = sec.getData(c) || []; } catch (e) { items = []; }
    if (!items.length) continue;
    html += `<div><div class="section-title" style="padding:4px 0;">${escapeHtml(sec.title)}</div>${sec.render(items, options)}</div>`;
  }
  return html;
}

// カード詳細の本文(画像+基本情報+ルールテキスト+将来セクション)を組み立てる純粋関数。
// デッキの所持枚数などApp状態に依存する部分(モーダルのフッター)はここに含めない
// (呼び出し側であるopenCardDetail側の責務のまま)。
// options: { imageBasePath, enableJsFallback }
export function cardDetailBodyHtml(c, options = {}) {
  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;">
      <div style="width:180px;flex-shrink:0;"><div class="card-detail-img">${cardImageBlockHtml(c, options)}</div></div>
      <div style="flex:1;min-width:220px;display:flex;flex-direction:column;gap:6px;">
        <div style="font-size:17px;font-weight:800;">${escapeHtml(c.name)}</div>
        <div style="display:flex;gap:6px;align-items:center;">
          <span class="type-badge type-${c.type}">${c.type}</span>
          ${c.colors.map((col) => `<span class="color-dot c-${col}"></span>`).join('')}
          <span class="badge neutral">${escapeHtml(c.rarity || '-')}</span>
        </div>
        <div class="kv-row"><span class="k">No.</span><span>${escapeHtml(String(c.set))}-${escapeHtml(c.no)}</span></div>
        <div class="kv-row"><span class="k">収録</span><span>${escapeHtml(c.source || '-')}</span></div>
        ${c.level !== null && c.level !== undefined ? `<div class="kv-row"><span class="k">レベル</span><span>${c.level}</span></div>` : ''}
        ${c.cost !== null && c.cost !== undefined ? `<div class="kv-row"><span class="k">魔力コスト</span><span>${c.cost}</span></div>` : ''}
        ${c.power !== null && c.power !== undefined ? `<div class="kv-row"><span class="k">パワー</span><span>${c.power}</span></div>` : ''}
        ${c.trait ? `<div class="kv-row"><span class="k">特性</span><span>${escapeHtml(c.trait)}</span></div>` : ''}
        ${c.unlimited ? `<div class="badge ok" style="width:fit-content;">デッキ投入枚数無制限</div>` : ''}
      </div>
    </div>
    ${c.ruleText ? `<div><div class="section-title" style="padding:4px 0;">ルールテキスト</div><div class="rule-text">${escapeHtml(c.ruleText)}</div></div>` : ''}
    ${c.igyouText ? `<div><div class="section-title" style="padding:4px 0;">遺業能力</div><div class="rule-text">${escapeHtml(c.igyouText)}</div></div>` : ''}
    ${c.illustrator ? `<div class="kv-row"><span class="k">イラスト</span><span>${escapeHtml(c.illustrator)}</span></div>` : ''}
    ${cardDetailSectionsHtml(c, options)}
  `;
}
