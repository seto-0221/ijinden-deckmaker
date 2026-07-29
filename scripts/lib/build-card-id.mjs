'use strict';
/**
 * 【ビルド専用】src/data/cards/*.json (公式カードデータ) のカードIDを検証するための関数群。
 *
 * ================================ 重要な役割分担 ================================
 * このファイルの関数は、ビルド時にリポジトリ内の公式カードデータ(src/data/cards/*.json)
 * だけを検査するために存在する。以下のような「ユーザー入力・外部ツール由来」の経路には
 * 絶対に使用しない(importしない・呼び出さない)こと。
 *
 *   - イジンデッキ形式のテキスト出力/インポート(スイートポテト氏のイジンデッキ含む)
 *   - CSVインポート
 *   - QRインポート
 *   - 共有コード(#share=)
 *   - customCards(ブラウザ内で作成・編集したカード)
 *   - バックアップの復元(restoreBackup)
 *   - 将来追加される外部データ取込全般
 *   - デッキリスト内で使われる外部ツール由来の識別子
 *
 * これらは既存の共通サニタイズ層(src/app/features/deck/05-deck-logic.js の
 * sanitizeCardEntries/sanitizeCardIdList等)の責務であり、本ファイルの検証ルールを
 * 適用してはならない。外部ツールが独自のID体系・命名規則を使っていても、それらは
 * 「イジンデッキ形式のテキスト出力をそのまま受け取れる」という既存の互換性を維持するため
 * 無条件で受け入れる対象であり、本ファイルの対象外である。
 *
 * このファイルはNode.js(ビルドスクリプト)専用であり、scripts/build.mjsが生成する
 * ブラウザ向けの単一HTMLバンドルには一切含まれない。src/shared/配下にも置かず、
 * scripts/lib/配下に置くことで「SSG・ビルド専用」であることを構造的にも明示する。
 * ================================================================================
 *
 * ---- 仕様の位置づけ(将来固定するものではない) ----
 * 以下のCARD_ID_PATTERN/CARD_ID_MAX_LENGTHは、2026-07時点でsrc/data/cards/*.jsonに
 * 実在する576件の公式カードIDすべてを実際に検査した結果に基づく、「安全なファイル名/
 * URLパスセグメントとして使える範囲」のビルド時検証ルールである。イジンデン公式の
 * 恒久的なID仕様を定めるものではなく、外部ツールのID仕様を制限するものでもない。
 *
 * 実データの内訳(2026-07時点、576件):
 *   - 使用文字: 0-9 / 大文字A-Z(B,G,P,R,Y) / ハイフン区切りのみ
 *   - セグメント数: 2〜3(例 "1-1"、"1-R-1"、"1-B1")
 *   - 各セグメント長: 1〜3文字、全体の長さ: 3〜6文字
 * 将来、公式側で新しいID形式(例: "SP-001"・"PR-2026-01"のような英字プレフィックス+
 * 年+連番等)が追加された場合、そのIDが本ルールの範囲外であれば、このファイルの
 * CARD_ID_PATTERN/CARD_ID_MAX_LENGTHを更新する必要がある。更新を怠った場合は
 * ビルドが失敗する(=気づかずに脆弱な形式を許してしまうより、安全側に倒れて
 * ビルドが止まる設計を優先している)。
 */
import { resolve, relative, isAbsolute, sep } from 'node:path';

// セグメントあたり最大10文字・最大4セグメントまで許容(現行データの必要量より広めだが、
// パス区切り文字(/ \ .)・制御文字・空白・NULL等は文字クラス自体に含まれないため、
// 安全性を落とさずに将来の英字プレフィックス形式にもある程度の余裕を持たせられる)。
export const CARD_ID_PATTERN = /^[0-9A-Za-z]{1,10}(-[0-9A-Za-z]{1,10}){0,3}$/;
// src/app/core/01-header-constants.js の CARD_ID_MAX_LENGTH と同一値で揃えている
// (ビルド側とアプリ側で別々の上限値を持たないようにするため。ただし定数自体を
//  共有インポートすると「アプリ全体で共通利用されるバリデータ」に見えてしまうため、
//  値だけをこのファイル内に複製し、依存関係は作らない)。
export const CARD_ID_MAX_LENGTH = 20;

/**
 * idがパーセントエンコードされた文字列を含んでおり、それをデコードすると
 * パス区切り文字・ドット・制御文字が現れる、または不正なパーセントエンコード
 * (decodeURIComponentが例外を投げる)であるかどうかを検査する。
 *
 * CARD_ID_PATTERNは"%"自体を許可していないため、現状はこの関数が実行に至る前に
 * 正規表現側で弾かれる(この関数は現行パターンに対しては冗長な二重チェックになる)。
 * それでも独立した関数として常に実行するのは、将来CARD_ID_PATTERNが緩和された場合の
 * 保険(多層防御)として機能させるため。
 */
function containsDangerousDecodedPath(id) {
  // "%"を含まない文字列はパーセントエンコードされていないため、decodeURIComponentを
  // 呼ぶまでもなく安全(そもそもCARD_ID_PATTERNが"%"自体を許可していないため、
  // 現行の検証フローでこの関数に到達する時点で"%"入りのidは通常あり得ない。
  // それでも将来CARD_ID_PATTERNが緩和された場合の保険として、この関数自体は独立に残す)。
  if (!id.includes('%')) return false;
  let decoded;
  try {
    decoded = decodeURIComponent(id);
  } catch (e) {
    return true; // 不正なパーセントエンコード自体を危険とみなす
  }
  // / \ . 半角空白・制御文字のいずれかがデコード後に現れたら危険とみなす
  return /[\\/.\x00-\x1f\x7f ]/.test(decoded);
}

/**
 * ビルド用公式カードデータのidを検証する。
 * 妥当なら何もせず正常終了する。妥当でなければErrorをthrowする(fail closed)。
 * context: { cardName, sourceFile } (エラーメッセージに含める追加情報。省略可)
 */
export function assertValidBuildCardId(id, context = {}) {
  const { cardName, sourceFile } = context;
  const idLabel = typeof id === 'string' ? JSON.stringify(id) : String(id);
  const detail = [
    `不正なカードID: ${idLabel}`,
    cardName !== undefined ? `対象カード名: ${cardName}` : null,
    sourceFile !== undefined ? `読み込み元セットファイル: ${sourceFile}` : null,
  ].filter(Boolean);
  const expectFormat = `期待される形式: ${CARD_ID_PATTERN} (長さ1〜${CARD_ID_MAX_LENGTH}文字)`;

  if (typeof id !== 'string' || id.length === 0) {
    throw new Error([...detail, '拒否理由: 文字列でない、または空文字', expectFormat].join(' / '));
  }
  if (id.length > CARD_ID_MAX_LENGTH) {
    throw new Error([...detail, `拒否理由: 長さが上限(${CARD_ID_MAX_LENGTH}文字)を超過(実際: ${id.length}文字)`, expectFormat].join(' / '));
  }
  if (!CARD_ID_PATTERN.test(id)) {
    throw new Error([...detail, '拒否理由: 許可された文字種・形式(英数字をハイフンで区切った形式。先頭/末尾ハイフン・連続ハイフン・空白・記号・制御文字は不可)に一致しない', expectFormat].join(' / '));
  }
  if (containsDangerousDecodedPath(id)) {
    throw new Error([...detail, '拒否理由: パーセントエンコードのデコード後にパス区切り文字・ドット・制御文字が検出された、または不正なパーセントエンコード', expectFormat].join(' / '));
  }
}

/**
 * idが妥当かどうかをbooleanで返す版(throwしない)。
 * 複数件のエラーを列挙してからまとめてビルドを失敗させたい呼び出し側で使う。
 */
export function validateBuildCardId(id, context = {}) {
  try {
    assertValidBuildCardId(id, context);
    return { valid: true, reason: null };
  } catch (e) {
    return { valid: false, reason: e.message };
  }
}

/**
 * cardsRoot(通常は resolve(DIST, 'cards'))の配下に、idに対応する出力先ディレクトリが
 * 収まっていることを、文字列の前方一致比較ではなく実際のパス解決(path.resolve/
 * path.relative)で確認する。安全なら解決済みの絶対パスを返す。安全でなければErrorをthrowする。
 *
 * assertValidBuildCardId(正規表現による形式検証)とは役割が異なる、独立した二重の防御。
 * 将来assertValidBuildCardIdの実装に不備があっても、このチェックが最終防衛線になる。
 * path.relative()は、Windows(ドライブレターの違い等)とPOSIXの両方で、対象パスが
 * 基準パスの外側にあるかどうかを正しく判定できる(文字列のstartsWith比較だけに頼ると、
 * 例えば "/dist/cards-evil" のような「前方一致するが実際には別ディレクトリ」を
 * 誤って許可してしまう恐れがあるため、path.relative()ベースの判定を採用する)。
 * カード個別ページは必ず dist/cards/<id>/ という「1階層下のディレクトリ」に出力される
 * ため、outputDir が cardsRoot 自身と一致する場合(rel === '')も拒否する。
 */
export function resolveSafeCardOutputDir(cardsRoot, id) {
  const root = resolve(cardsRoot);
  const outputDir = resolve(root, id);
  const rel = relative(root, outputDir);
  const escapesRoot = rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (escapesRoot) {
    throw new Error(
      `カード出力先がdist/cards配下の境界外(または境界そのもの)に解決されました: ` +
      `id=${JSON.stringify(id)}, cardsRoot=${root}, 解決後パス=${outputDir}`
    );
  }
  return outputDir;
}
