/**
 * Stage 1B: Supabase Auth連携の最小限の回帰テスト。
 * 実行: npm install && npm test
 *
 * SUPABASE_URL/SUPABASE_PUBLISHABLE_KEYは設定済みのため、initAuth()はSupabase SDKの
 * 読み込みを非同期に開始する(このテスト実行環境にネットワークが無い/制限されている場合は
 * 読み込みに失敗し、initAuth()内のcatchで握りつぶされるだけで例外は投げない)。
 * いずれにせよ既存アプリの初期化(DOMContentLoaded→init())は同期的に完了しており、
 * このテストのcheck()はすべて同期実行のため、SDKの読み込み成否に左右されない。
 * このテストでは、
 *  (1) 既存の初期化が壊れていないこと
 *  (2) 設定した鍵がPublishable key形式であり、secret/service_role相当のキーではないこと
 *  (3) authBtn等のUI要素・関数が期待通り定義されていること
 * を確認する。実際のGoogleログイン/ログアウトの実動作は、実環境での手動確認が必要
 * (9章の確認項目参照)。
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
  return {
    fillStyle: '', strokeStyle: '', font: '', textAlign: 'left', textBaseline: 'alphabetic', lineWidth: 1,
    fillRect() {}, strokeRect() {}, fillText() {}, measureText(t) { return { width: String(t).length * 8 }; },
    drawImage() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, save() {}, restore() {},
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
  };
}

// resources:'usable' はJSDOM上でも既存テストと同じ設定にしているが、SUPABASE_URLが空のため
// initAuth()はスクリプト読み込み自体を試みず、実際のネットワークアクセスは発生しない。
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
const w = dom.window;
const d = w.document;
w.HTMLCanvasElement.prototype.getContext = function () { if (!this.__ctx) this.__ctx = makeFakeCtx(); return this.__ctx; };
w.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,AAAA'; };
w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(['x'])); };
d.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));

// ---- 既存の初期化が壊れていないこと ----
check('App initialized (既存機能に影響なし)', w.eval('typeof App') === 'object');
check('card data loaded (576 cards)', w.eval('App.allCards.length') === 576);

// ---- 設定値の確認: Publishable key形式であり、secret/service_role相当ではないこと ----
const supabaseUrl = w.eval('SUPABASE_URL');
const supabaseKey = w.eval('SUPABASE_PUBLISHABLE_KEY');
check('SUPABASE_URLが設定されている(https://*.supabase.co形式)', /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl));
check('SUPABASE_PUBLISHABLE_KEYが設定されている', typeof supabaseKey === 'string' && supabaseKey.length > 0);
check('SUPABASE_PUBLISHABLE_KEYはPublishable key形式(sb_publishable_接頭辞)', supabaseKey.startsWith('sb_publishable_'));
check('SUPABASE_PUBLISHABLE_KEYはsecret key形式ではない(sb_secret_を含まない)', !supabaseKey.startsWith('sb_secret_'));
check('SUPABASE_PUBLISHABLE_KEYは旧形式のJWT(anon/service_role)ではない(eyJで始まらない)', !supabaseKey.startsWith('eyJ'));

// ---- authBtnのDOM構造(SDKの非同期読み込み結果に左右されない同期的な初期状態) ----
const authBtn = d.getElementById('authBtn');
check('authBtnが存在する', !!authBtn);
check('authBtnは初期状態では非表示(SDK読み込み完了まではdisplay:none)', !!authBtn && authBtn.style.display === 'none');
check('authBtnはicon-btnクラスを持つ(既存デザインを踏襲)', !!authBtn && authBtn.classList.contains('icon-btn'));
check('authBtnの既定titleは「ログイン」', !!authBtn && authBtn.getAttribute('title') === 'ログイン');

// ---- initAuth/openAuthModal等の関数自体は定義されている(将来の鍵設定時にすぐ動く) ----
check('initAuth関数が定義されている', w.eval('typeof initAuth') === 'function');
check('openAuthModal関数が定義されている', w.eval('typeof openAuthModal') === 'function');
check('handleGoogleSignIn関数が定義されている', w.eval('typeof handleGoogleSignIn') === 'function');
check('handleSignOut関数が定義されている', w.eval('typeof handleSignOut') === 'function');
check('renderAuthButton関数が定義されている', w.eval('typeof renderAuthButton') === 'function');

// ---- 既存のテーマ切替ボタン等、他のヘッダー要素に影響していないこと ----
check('themeToggleは引き続き存在する', !!d.getElementById('themeToggle'));
check('brand logoは引き続き存在する', !!d.getElementById('brandLogoLight'));

console.log(`\n[auth-ui] ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
