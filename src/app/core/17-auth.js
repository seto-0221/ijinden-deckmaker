/* ========================= 17. Supabase Auth連携 (Stage 1B) =========================
   目的: 「ログインしなくても今まで通り使える。ログインすると、より便利になる」という方針のもと、
   Googleログイン/ログアウトの導線だけを追加する。デッキのクラウド保存・公開デッキ・お気に入り等は
   次Stage以降で実装する(ここでは一切行わない)。

   設計方針:
   - Supabase JS SDKはCDNから動的に<script>を挿入して読み込む(index.template.html側に
     静的な<script src>を置かない)。これにより、ネットワークが無い/読み込みに失敗した場合でも
     既存アプリの初期化(DOMContentLoaded → init())を一切ブロックしない。
   - SUPABASE_URL/SUPABASE_PUBLISHABLE_KEYが未設定(空文字)の間は、initAuth()は即座に何もせず
     終了する。ログインボタンも表示されない。既存機能への影響はゼロ。
   - 認証状態(AuthState)はApp.stateには入れない(localStorageへの永続化対象外)。
     セッション自体の永続化・復元はSupabase SDKが自分専用のlocalStorageキーで行う。
   - ログアウト時、ローカルの既存デッキ(App.state.decks等)には一切触れない。
   ========================================================================= */

const AuthState = {
  client: null,
  session: null,
};

// Supabase JS SDK(UMD版)をCDNから動的に読み込む。index.template.htmlに<script src>を
// 静的に置かない理由は、既存アプリの初期化をこのスクリプトの読み込み待ちでブロックしないため。
function loadSupabaseSdk() {
  return new Promise((resolve, reject) => {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });
}

// ログイン状態に応じてヘッダーのauthBtnの見た目を更新する。
function renderAuthButton(session) {
  const btn = document.getElementById('authBtn');
  if (!btn) return;
  btn.style.display = '';
  if (session && session.user) {
    const label = (session.user.user_metadata && session.user.user_metadata.full_name)
      || session.user.email
      || 'ログイン中';
    btn.title = label + '(クリックでアカウント情報)';
    btn.classList.add('auth-signed-in');
  } else {
    btn.title = 'ログイン';
    btn.classList.remove('auth-signed-in');
  }
}

// authBtnクリック時: ログイン状態に応じてログイン導線/アカウント情報+ログアウトを表示する。
// 既存のModal共通コンポーネントをそのまま使い、新規UI部品を増やさない。
function openAuthModal() {
  const session = AuthState.session;
  if (session && session.user) {
    const label = (session.user.user_metadata && session.user.user_metadata.full_name)
      || session.user.email
      || '';
    Modal.open(
      'アカウント',
      `<p>ログイン中: <strong>${escapeHtml(label)}</strong></p>
       <p style="font-size:12.5px;color:var(--text-dim);">端末をまたいだデッキ保存・公開デッキ・お気に入り機能は準備中です。ログアウトしても、このブラウザに保存されているデッキが削除されることはありません。</p>`,
      `<button class="btn block" id="authSignOutBtn">ログアウト</button>`
    );
    const btn = document.getElementById('authSignOutBtn');
    if (btn) btn.addEventListener('click', handleSignOut);
  } else {
    Modal.open(
      'ログイン',
      `<p>ログインすると、将来的に端末をまたいだデッキ保存・公開デッキ・お気に入り機能が使えるようになります(現在準備中です)。</p>
       <p style="font-size:12.5px;color:var(--text-dim);">ログインしなくても、カード検索・デッキ作成・保存など、これまでの機能はすべてそのままご利用いただけます。</p>`,
      `<button class="btn primary block" id="authGoogleSignInBtn">Googleでログイン</button>`
    );
    const btn = document.getElementById('authGoogleSignInBtn');
    if (btn) btn.addEventListener('click', handleGoogleSignIn);
  }
}

async function handleGoogleSignIn() {
  if (!AuthState.client) return;
  try {
    const { error } = await AuthState.client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) toast('ログインを開始できませんでした: ' + error.message, 'err');
  } catch (e) {
    toast('ログインを開始できませんでした', 'err');
  }
}

async function handleSignOut() {
  if (!AuthState.client) return;
  Modal.close();
  try {
    const { error } = await AuthState.client.auth.signOut();
    if (error) toast('ログアウトに失敗しました: ' + error.message, 'err');
    else toast('ログアウトしました');
  } catch (e) {
    toast('ログアウトに失敗しました', 'err');
  }
}

// 既存アプリのinit()末尾から呼ばれる。非同期・失敗しても既存機能に一切影響しない(fire-and-forget)。
function initAuth() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return; // 未設定の間は何もしない

  loadSupabaseSdk()
    .then(() => {
      if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.warn('Supabase SDKの読み込みに失敗したため、ログイン機能は無効です');
        return;
      }
      AuthState.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

      const btn = document.getElementById('authBtn');
      if (btn) btn.addEventListener('click', openAuthModal);
      renderAuthButton(null);

      AuthState.client.auth.getSession().then(({ data, error }) => {
        if (error) { console.warn('Supabaseセッション取得エラー', error); return; }
        AuthState.session = data.session;
        renderAuthButton(AuthState.session);
      });

      // SIGNED_IN / SIGNED_OUT / セッション復元(TOKEN_REFRESHED等)をすべてここでUIへ反映する。
      AuthState.client.auth.onAuthStateChange((_event, session) => {
        AuthState.session = session;
        renderAuthButton(session);
      });
    })
    .catch((e) => {
      console.warn('Supabase SDKを読み込めませんでした(ネットワーク未接続の可能性)。ログイン機能のみ無効化されます', e);
    });
}
