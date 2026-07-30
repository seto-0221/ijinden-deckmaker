
/* ========================= 18. Service Worker登録 =========================
   目的: CSP対応(meta CSPをscript-src 'self' + ハッシュ方式に絞れるようにするため)、
   index.template.html側にあった独立したインラインscriptをAPP_JS本体へ統合し、
   実行可能なインラインscriptをAPP_JS一本だけにする。

   登録条件は統合前と完全に同一(挙動を一切変えない):
   - location.protocol !== 'file:' の場合のみ登録を試みる(file://で開いた単一HTML版では何もしない)
   - windowのload後に登録する
   - navigator.serviceWorkerの存在確認をしてから登録する(非対応環境では何もしない)
   - 登録に失敗しても握りつぶし(.catch(() => {}))、アプリ本体の初期化・動作には一切影響させない
   ========================================================================= */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
