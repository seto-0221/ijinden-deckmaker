/**
 * ビルド成果物(dist/index.html)に対する回帰テスト。
 * 実行: npm install && npm test
 * 見た目や機能の変更なしにソース構成だけを変えるリファクタリングでは、
 * このテストが全て通ることを「壊れていない」の基準にする。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf-8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

function makeFakeCtx() {
  const calls = [];
  return {
    calls,
    fillStyle: '', strokeStyle: '', font: '', textAlign: 'left', textBaseline: 'alphabetic', lineWidth: 1,
    fillRect(...a) { calls.push(['fillRect', this.fillStyle, ...a]); },
    strokeRect(...a) { calls.push(['strokeRect', this.strokeStyle, ...a]); },
    fillText(...a) { calls.push(['fillText', this.fillStyle, ...a]); },
    measureText(t) { return { width: String(t).length * 8 }; },
    drawImage(...a) { calls.push(['drawImage', ...a]); },
    beginPath() {}, arc() {}, fill() {}, stroke() {}, save() {}, restore() {},
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
  };
}

const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
const w = dom.window;
const d = w.document;
w.HTMLCanvasElement.prototype.getContext = function () { if (!this.__ctx) this.__ctx = makeFakeCtx(); return this.__ctx; };
w.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,AAAA'; };
w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(['x'])); };
d.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));

// ---- 基本構造 ----
check('App initialized', w.eval('typeof App') === 'object');
check('card data loaded (576 cards)', w.eval('App.allCards.length') === 576);
check('thumbs loaded (576 entries)', w.eval('Object.keys(CARD_THUMB_B64).length') === 576);
check('logo assets loaded', w.eval('!!LOGO_ASSETS.headerLight && !!LOGO_ASSETS.headerDark'));
check('brand logo wired', !!d.getElementById('brandLogoLight').getAttribute('src'));

// ---- QRライブラリ遅延実行 ----
check('QR libs inert before use', w.eval('typeof window.qrcode') === 'undefined' && w.eval('typeof window.jsQR') === 'undefined');
w.eval('ensureQREncodeLib()'); w.eval('ensureQRDecodeLib()');
check('QR libs load on demand', w.eval('typeof window.qrcode') === 'function' && w.eval('typeof window.jsQR') === 'function');
check('QR round-trip canvas', w.eval(`!!buildQRCanvas('https://example.com/#dz=TEST', 4)`));

// ---- レギュレーション ----
const banned = JSON.parse(w.eval(`JSON.stringify(DEFAULT_REGULATIONS.find(r => r.id === 'tournament').bannedCardNames)`));
check('tournament bans 千利休', banned.includes('千利休'));
check('leader regulation exists', w.eval(`!!DEFAULT_REGULATIONS.find(r => r.hasLeaderZone)`));

// ---- バリデーション ----
const v = w.eval(`
  (function() {
    const sen = App.allCards.find(c => c.name === '千利休');
    const deck = { id:'t', name:'t', regulationId:'tournament', mainCards:[{cardId: sen.id, qty: 2}], sideCards:[], tags:[], memo:'', leaderCards:[], trumpCard:null, trumpQty:0 };
    ensureLeaderFields(deck);
    return JSON.stringify(validateDeck(deck));
  })()
`);
check('validateDeck flags banned card', v.includes('千利休'));

// ---- デッキ画像出力 ----
const img = w.eval(`
  (function() {
    const ijin = App.allCards.find(c => c.type === 'イジン');
    const mahou = App.allCards.find(c => c.type === 'マホウ');
    const others = App.allCards.filter(c => c.id !== ijin.id && c.id !== mahou.id).slice(0, 5);
    const regId = (DEFAULT_REGULATIONS.find(r => r.hasLeaderZone)).id;
    const deck = { id:'t', name:'T', regulationId: regId, mainCards: others.map(c => ({cardId:c.id, qty:2})), sideCards: [], leaderCards:[ijin.id], trumpCard: mahou.id, trumpQty:1, tags:[], memo:'' };
    const canvas = buildDeckImageCanvas(deck, new Map(), false, null, null);
    const texts = canvas.getContext('2d').calls.filter(x => x[0]==='fillText').map(x => x[2]);
    return JSON.stringify({ h: canvas.height, w: canvas.width, combined: texts.includes('メイン+統領+切り札'), role: texts.includes('統領') });
  })()
`);
const imgR = JSON.parse(img);
check('deck image canvas builds', imgR.h > 300 && imgR.w > 0);
check('leader deck shows combined stat box', imgR.combined);
check('leader/trump section drawn', imgR.role);

// ---- 絞り込み/ピッカー ----
check('filterPanelHtml hideType option', !w.eval(`filterPanelHtml('tF', { hideType: true })`).includes('tFType'));
check('leader picker uses filter panel', /filterPanelHtml\('lpF'/.test(w.eval('openLeaderPicker.toString()')));

// ---- ビュー切替まわり ----
check('deckViewModeSeg before leaderZoneWrap before deckMainList', (() => {
  const ids = Array.from(d.querySelectorAll('#deckViewModeSeg, #leaderZoneWrap, #deckMainList')).map(e => e.id);
  return ids.join(',') === 'deckViewModeSeg,leaderZoneWrap,deckMainList';
})());
check('renderLeaderTrumpZones respects view mode', /App\.deckViewMode === 'grid'/.test(w.eval('renderLeaderTrumpZones.toString()')));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
