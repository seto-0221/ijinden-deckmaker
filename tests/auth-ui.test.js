/**
 * Stage 1B: Supabase Auth連携の最小限の回帰テスト。
 * 実行: npm install && npm test
 *
 * 重要な前提: SUPABASE_URL/SUPABASE_PUBLISHABLE_KEYは現時点では未設定(空文字)であり、
 * その間はinitAuth()が即座に何もせず終了する(ネットワークに一切触れない)。
 * このテストは「未設定の状態で既存の初期化が壊れていないこと」「authBtnが既定で隠れていること」
 * を確認する。実際のSupabase接続(ログイン/ログアウトの実動作)は、鍵を設定した実環境での
 * 手動確認が必要(9章の確認項目参照)。
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

// ---- 未設定状態でも既存の初期化が壊れていないこと ----
check('App initialized (既存機能に影響なし)', w.eval('typeof App') === 'object');
check('card data loaded (576 cards)', w.eval('App.allCards.length') === 576);

// ---- 設定値のプレースホルダ確認 ----
check('SUPABASE_URLは未設定(空文字)', w.eval('SUPABASE_URL') === '');
check('SUPABASE_PUBLISHABLE_KEYは未設定(空文字)', w.eval('SUPABASE_PUBLISHABLE_KEY') === '');

// ---- AuthStateはネットワークに触れていないこと ----
check('AuthState.clientはnull(未接続)', w.eval('AuthState.client') === null);
check('AuthState.sessionはnull(未ログイン)', w.eval('AuthState.session') === null);
check('window.supabase(SDK)は読み込まれていない', w.eval('typeof window.supabase') === 'undefined');

// ---- authBtnのDOM構造 ----
const authBtn = d.getElementById('authBtn');
check('authBtnが存在する', !!authBtn);
check('authBtnは未設定時は非表示のまま(display:none)', !!authBtn && authBtn.style.display === 'none');
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
