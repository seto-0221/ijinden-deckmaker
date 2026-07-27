/**
 * 段階C: 静的カードページと既存Webアプリの相互接続(#/cards/:id ルート・内部リンク)のテスト。
 * 実行: node scripts/build.mjs && node scripts/build-card-pages.mjs && node tests/hash-routing.test.js
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf-8');
const SRC = join(ROOT, 'src');
const manifest = JSON.parse(readFileSync(join(SRC, 'build-manifest.json'), 'utf-8'));
const allCards = manifest.cardSetOrder.flatMap((s) => JSON.parse(readFileSync(join(SRC, 'data/cards', `set-${s}.json`), 'utf-8')));
const card1_1 = allCards.find((c) => c.id === '1-1');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

function makeApp(url) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url });
  const w = dom.window;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
  return { dom, w, d: w.document };
}

// ---- 1. #/cards/:id を直接開いた場合、カード検索画面へ遷移したうえで対象カード詳細が開く ----
{
  const { w, d } = makeApp('http://localhost/#/cards/1-1');
  const c = JSON.parse(w.eval(`JSON.stringify(App.allCards.find(x => x.id === '1-1'))`));
  check('直接開いた場合: currentViewがbrowseになる', w.eval('App.currentView') === 'browse');
  check('直接開いた場合: モーダルが開いている', !d.getElementById('modalBackdrop').classList.contains('hidden'));
  check('直接開いた場合: モーダルタイトルがカード詳細', d.getElementById('modalTitle').textContent === 'カード詳細');
  check('直接開いた場合: 対象カード名が本文に含まれる', d.getElementById('modalBody').innerHTML.includes(c.name));
}

// ---- 2. 動的なhashchange(アプリ内で#/cards/:idへ移動)でも同様に開く ----
{
  const { w, d } = makeApp('http://localhost/');
  check('初期状態ではモーダルは閉じている', d.getElementById('modalBackdrop').classList.contains('hidden'));
  const targetId = w.eval(`App.allCards[10].id`);
  w.eval(`location.hash = '#/cards/${targetId}'`);
  w.dispatchEvent(new w.Event('hashchange', { bubbles: true, cancelable: true }));
  const c = JSON.parse(w.eval(`JSON.stringify(App.allCards.find(x => x.id === '${targetId}'))`));
  check('hashchangeでもcurrentViewがbrowseになる', w.eval('App.currentView') === 'browse');
  check('hashchangeでもモーダルが開く', !d.getElementById('modalBackdrop').classList.contains('hidden'));
  check('hashchangeでも対象カード名が本文に含まれる', d.getElementById('modalBody').innerHTML.includes(c.name));
}

// ---- 3. 存在しないカードIDの場合は例外を起こさず、分かりやすいエラー表示になる ----
{
  let threw = false;
  let w, d;
  try {
    const app = makeApp('http://localhost/#/cards/存在しないID-9999');
    w = app.w; d = app.d;
  } catch (e) {
    threw = true;
  }
  check('存在しないIDでも初期化時に例外を投げない', !threw);
  if (!threw) {
    check('存在しないID: currentViewはbrowseのまま', w.eval('App.currentView') === 'browse');
    check('存在しないID: モーダルにエラーメッセージが表示される', d.getElementById('modalTitle').textContent === 'カードが見つかりません');
    check('存在しないID: 本文に分かりやすい説明がある', d.getElementById('modalBody').innerHTML.includes('見つかりませんでした'));
    check('存在しないID: 「カード検索に戻る」ボタンで閉じられる', !!d.getElementById('cardNotFoundBackBtn'));
  }
}

// ---- 4. 既存の共有リンク(#dz=/#share=/#pkg=)・既存ルート(#/browse等)と衝突しないこと ----
{
  // #/browse・#/decks・#/packages・#/data は従来通り動作する(cardsルートの正規表現は完全一致の専用パスなので無関係)
  const { w: w1 } = makeApp('http://localhost/#/decks');
  check('既存ルート#/decksは従来通り動作する', w1.eval('App.currentView') === 'decks');

  // #dz=/#share=/#pkg= は location.hash 内の部分一致で検出されるため、#/cards/:id の完全一致正規表現とは
  // 衝突しない。壊れた共有コードでも例外を投げず、エラートーストのみで済むことを確認する(cardsルートには入らない)。
  let threw = false;
  let w2, d2;
  try {
    const app = makeApp('http://localhost/#dz=INVALID_CODE_XXXX');
    w2 = app.w; d2 = app.d;
  } catch (e) { threw = true; }
  check('壊れた#dz=共有リンクでも例外を投げない', !threw);
  if (!threw) {
    // 非同期のdecodeDeckShareCodeV2失敗時にtoastが出る想定だが、少なくともカード詳細モーダルには
    // 入っていないこと(#/cards/:id側の処理と誤って混線していないこと)を確認する
    check('#dz=はカード詳細モーダルとは無関係(モーダルタイトルが「カード詳細」になっていない)',
      d2.getElementById('modalTitle').textContent !== 'カード詳細');
  }

  // #/cards/:id 自体が #dz= 等のパラメータを巻き込まない完全一致ルートであることの直接確認
  const cardsRouteRe = /^#\/cards\/([^\/?&]+)\/?$/;
  check('#/cards/1-1 はcardsルート正規表現にマッチする', cardsRouteRe.test('#/cards/1-1'));
  check('#dz=XXX はcardsルート正規表現にマッチしない', !cardsRouteRe.test('#dz=XXX'));
  check('#/browse はcardsルート正規表現にマッチしない', !cardsRouteRe.test('#/browse'));
}

// ---- 5. カード検索一覧: カード名部分がカード個別ページへの通常のa[href]になっている ----
{
  const { w, d } = makeApp('http://localhost/');
  w.eval(`App.viewMode = 'grid'; renderCardContainer();`);
  const gridNameLink = d.querySelector('#cardContainer .card-tile .name');
  check('グリッド表示: カード名はa要素', gridNameLink && gridNameLink.tagName === 'A');
  check('グリッド表示: hrefがcards/<id>/形式', /^cards\/[^/]+\/$/.test(gridNameLink.getAttribute('href') || ''));
  check('グリッド表示: data-action=detailを保持(クリック委譲で使う)', gridNameLink.dataset.action === 'detail');

  w.eval(`App.viewMode = 'list'; renderCardContainer();`);
  const listNameLink = d.querySelector('#cardContainer .card-row .name');
  check('リスト表示: カード名はa要素', listNameLink && listNameLink.tagName === 'A');
  check('リスト表示: hrefがcards/<id>/形式', /^cards\/[^/]+\/$/.test(listNameLink.getAttribute('href') || ''));
}

// ---- 6. 通常クリックは詳細モーダルを開きpreventDefaultする。Ctrl/Cmd/Shift+クリックや中クリックは
//         ブラウザ標準の新しいタブで開く動作に任せ、詳細モーダルは開かない ----
{
  const { w, d } = makeApp('http://localhost/');
  w.eval(`App.viewMode = 'grid'; renderCardContainer();`);
  const nameLink = d.querySelector('#cardContainer .card-tile .name');

  const evNormal = new w.MouseEvent('click', { bubbles: true, cancelable: true });
  nameLink.dispatchEvent(evNormal);
  check('通常クリックはpreventDefaultされる', evNormal.defaultPrevented === true);
  check('通常クリックで詳細モーダルが開く', !d.getElementById('modalBackdrop').classList.contains('hidden'));
  w.eval(`Modal.close()`);

  const evCtrl = new w.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
  nameLink.dispatchEvent(evCtrl);
  check('Ctrl+クリックはpreventDefaultされない(通常のリンク遷移に任せる)', evCtrl.defaultPrevented === false);
  check('Ctrl+クリックでは詳細モーダルを開かない', d.getElementById('modalBackdrop').classList.contains('hidden'));
}

// ---- 7. アプリ→静的ページの導線: カード詳細モーダルのフッターに個別ページへのパーマリンクがある ----
{
  const { w, d } = makeApp('http://localhost/');
  const cardId = w.eval(`App.allCards[0].id`);
  w.eval(`openCardDetail('${cardId}')`);
  const permalink = Array.from(d.getElementById('modalFoot').querySelectorAll('a')).find(a => a.textContent.includes('個別ページ'));
  check('カード詳細モーダルに個別ページへのパーマリンクがある', !!permalink);
  check('パーマリンクのhrefがcards/<id>/形式', !!permalink && permalink.getAttribute('href') === `cards/${cardId}/`);
  check('パーマリンクは新しいタブで開く(target=_blank)', !!permalink && permalink.getAttribute('target') === '_blank');
  check('パーマリンクにrel=noopenerがある', !!permalink && permalink.getAttribute('rel') === 'noopener');
}

// ---- 8. 静的ページ→アプリの導線: card-page.template.html由来の実ページに、分かりやすい文言のリンクがある ----
{
  const cardPageHtml = readFileSync(join(ROOT, 'dist/cards/1-1/index.html'), 'utf-8');
  const dom = new JSDOM(cardPageHtml);
  const d = dom.window.document;
  const link = d.querySelector('a[href="../../#/cards/1-1"]');
  check('静的ページに#/cards/:idへの実際のa[href]リンクがある', !!link);
  check('リンク文言が分かりやすい(イジンデンラボ/デッキメーカーへの導線であることが分かる)',
    !!link && /(イジンデンラボ|デッキメーカー)/.test(link.textContent) && /使う/.test(link.textContent));
  // 静的ページ自体が中継ページ化していないこと(カード名・画像・ルールテキスト等、情報がページ内に十分残っていること)
  const bodyText = d.body.textContent;
  check('静的ページは中継ページ化していない(カード名が本文にある)', !!card1_1 && bodyText.includes(card1_1.name));
  check('静的ページは中継ページ化していない(画像が表示される)', !!d.querySelector('.card-detail-img img'));
  check('静的ページは中継ページ化していない(非公式の説明が本文にある)', bodyText.includes('非公式'));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
