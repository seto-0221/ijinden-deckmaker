/**
 * scripts/lib/build-card-id.mjs のテスト(ビルド専用カードID検証、所見#17対応)。
 *
 * 【重要】このテストが検証しているのは「src/data/cards/*.json(公式カードデータ)の
 * ビルド時ID検証」だけである。共有コード・CSV・QR・customCards・バックアップ等の
 * ユーザー入力経路はここでは一切扱わない(それらは既存のtests/deck-sanitize.test.js等が担当)。
 *
 * 実行: node tests/build-card-id.test.js
 */
import { readFileSync, readdirSync, mkdtempSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  assertValidBuildCardId,
  validateBuildCardId,
  resolveSafeCardOutputDir,
  CARD_ID_PATTERN,
  CARD_ID_MAX_LENGTH,
} from '../scripts/lib/build-card-id.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

const cardFiles = readdirSync(join(SRC, 'data', 'cards')).filter((f) => f.endsWith('.json'));
let realTotal = 0;
let realIds = [];
for (const f of cardFiles) {
  const cards = JSON.parse(readFileSync(join(SRC, 'data', 'cards', f), 'utf-8'));
  for (const c of cards) {
    realTotal++;
    realIds.push(c.id);
    const r = validateBuildCardId(c.id, { cardName: c.name, sourceFile: f });
    if (!r.valid) check(`[実データ] ${f} の "${c.id}"(${c.name}) が拒否された(不正): ${r.reason}`, false);
  }
}
check(`実データ576件相当が全件読み込めている(実際: ${realTotal}件)`, realTotal > 0);
check(`実データ${realTotal}件が全件バリデーション通過(不正0件)`, realIds.every((id) => validateBuildCardId(id).valid));

check('"1-1" は通過する', validateBuildCardId('1-1').valid);
check('"1-R-1" は通過する', validateBuildCardId('1-R-1').valid);
check('"1-B1" は通過する', validateBuildCardId('1-B1').valid);

const maxLen = Math.max(...realIds.map((id) => id.length));
const longestIds = realIds.filter((id) => id.length === maxLen);
check(`現在存在する最長ID(${maxLen}文字、例: ${longestIds[0]})が通過する`, validateBuildCardId(longestIds[0]).valid);

const letterShapes = new Map();
for (const id of realIds) {
  if (/[A-Za-z]/.test(id)) {
    const shape = id.replace(/[0-9]/g, 'D').replace(/[A-Za-z]/g, 'L');
    if (!letterShapes.has(shape)) letterShapes.set(shape, id);
  }
}
check(`英字を含む全形式(${letterShapes.size}種)がそれぞれ通過する`,
  Array.from(letterShapes.values()).every((id) => validateBuildCardId(id).valid));

const REJECT_CASES = [
  ['../evil', 'パストラバーサル(相対1階層)'],
  ['../../evil', 'パストラバーサル(相対2階層)'],
  ['a/b', 'スラッシュ区切り'],
  ['a\\b', 'バックスラッシュ区切り'],
  ['.', 'カレントディレクトリ参照'],
  ['..', '親ディレクトリ参照'],
  ['', '空文字'],
  ['1 1', '半角空白入り'],
  ['1　1', '全角空白入り'],
  ['1\n1', '改行入り'],
  ['1\t1', 'タブ入り'],
  ['1 1', 'NULL文字入り'],
  ['-1', '先頭ハイフン'],
  ['1-', '末尾ハイフン'],
  ['1--1', '連続ハイフン'],
  ['a'.repeat(CARD_ID_MAX_LENGTH + 5), `最大長(${CARD_ID_MAX_LENGTH}文字)超過`],
  ['%2F', 'パーセントエンコード(スラッシュ大文字)'],
  ['%2f', 'パーセントエンコード(スラッシュ小文字)'],
  ['%5C', 'パーセントエンコード(バックスラッシュ大文字)'],
  ['%5c', 'パーセントエンコード(バックスラッシュ小文字)'],
  ['%zz', '不正なパーセントエンコード'],
  ['1-1%2e%2e', 'デコードすると危険文字になるパーセントエンコード'],
  ['/absolute', '絶対パス(先頭スラッシュ)'],
  ['\\windows-path', 'Windows絶対パス風(先頭バックスラッシュ)'],
];
for (const [value, label] of REJECT_CASES) {
  const r = validateBuildCardId(value);
  check(`異常系拒否: ${label} (${JSON.stringify(value)})`, r.valid === false);
}

{
  let threw = false;
  try { assertValidBuildCardId('../evil', { cardName: 'テストカード', sourceFile: 'set-1.json' }); }
  catch (e) {
    threw = true;
    check('assertValidBuildCardIdのエラーメッセージに不正なIDが含まれる', e.message.includes('../evil'));
    check('assertValidBuildCardIdのエラーメッセージに対象カード名が含まれる', e.message.includes('テストカード'));
    check('assertValidBuildCardIdのエラーメッセージに読み込み元セットファイルが含まれる', e.message.includes('set-1.json'));
    check('assertValidBuildCardIdのエラーメッセージに拒否理由が含まれる', e.message.includes('拒否理由'));
    check('assertValidBuildCardIdのエラーメッセージに期待される形式が含まれる', e.message.includes('期待される形式'));
  }
  check('assertValidBuildCardIdは不正なIDに対してthrowする', threw);
}

const scratchRoot = mkdtempSync(join(tmpdir(), 'build-card-id-test-'));
const cardsRoot = join(scratchRoot, 'dist', 'cards');
mkdirSync(cardsRoot, { recursive: true });

const PATH_ESCAPE_CASES = [
  '../../../escaped-outside',
  '..',
  '.',
  '../sibling-dir',
];
for (const id of PATH_ESCAPE_CASES) {
  let threw = false;
  try {
    resolveSafeCardOutputDir(cardsRoot, id);
  } catch (e) {
    threw = true;
  }
  check(`resolveSafeCardOutputDir: "${id}" は境界外またはcardsRoot自身として拒否される`, threw);
}

{
  const outputDir = resolveSafeCardOutputDir(cardsRoot, '1-1');
  // 本番のresolveSafeCardOutputDir自体もpath.relative()ベースで境界判定しているため、
  // テスト側の確認も同じrelative()を使う(startsWith()による文字列前方一致だけに頼らない)。
  // 前方一致だけの判定だと、例えば cardsRoot="/tmp/cards" に対して
  // outputDir="/tmp/cards-evil" のような「文字列としては前方一致するが実際には
  // 兄弟ディレクトリ」を誤って安全と判定してしまう恐れがある。
  const rel = relative(cardsRoot, outputDir);
  const isInsideCardsRoot = rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep) && rel !== outputDir;
  check('resolveSafeCardOutputDir: 正常なIDはcardsRoot配下に解決される(path.relative()で判定)', isInsideCardsRoot);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'index.html'), '<html></html>');
  check('resolveSafeCardOutputDir: 正常なIDで実際にファイルが生成できる', existsSync(join(outputDir, 'index.html')));
}

// startsWith()による前方一致判定の落とし穴を明示的に確認する回帰テスト:
// "/tmp/cards" と "/tmp/cards-evil" のような「文字列としては前方一致するが実際には
// 兄弟ディレクトリ」のペアで、本番のresolveSafeCardOutputDirが正しくrelative()ベースの
// 判定をしていること(=このような紛らわしいペアでも誤判定しないこと)を確認する。
{
  const siblingLikeRoot = join(scratchRoot, 'cards');
  const siblingLikeEvilDir = join(scratchRoot, 'cards-evil');
  mkdirSync(siblingLikeRoot, { recursive: true });
  mkdirSync(siblingLikeEvilDir, { recursive: true });
  check('startsWith()の落とし穴確認: "cards-evil" は文字列としては "cards" の前方一致になる(この事実自体の確認)',
    siblingLikeEvilDir.startsWith(siblingLikeRoot));
  // resolveSafeCardOutputDirへは「cards-evil」というidそのものを渡すのではなく、
  // 実際の脅威モデルである「cardsRootの外へ出ようとするid」を渡して判定を確認する。
  // (siblingLikeEvilDirを直接cardsRootとして使うテストではなく、実際のAPIの入力である
  //  idの形で "../cards-evil" のように外へ出るケースが正しく拒否されることを確認する)
  let threw = false;
  try {
    resolveSafeCardOutputDir(siblingLikeRoot, '../cards-evil');
  } catch (e) {
    threw = true;
  }
  check('resolveSafeCardOutputDir: "../cards-evil"(前方一致する兄弟ディレクトリへの脱出)は拒否される', threw);
}

{
  const beforeListing = JSON.stringify(listRecursive(scratchRoot));
  for (const id of PATH_ESCAPE_CASES) {
    try {
      const outputDir = resolveSafeCardOutputDir(cardsRoot, id);
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, 'index.html'), 'SHOULD NOT EXIST');
    } catch (e) {
      // 期待通り: 何もファイルシステムに書き込まれない
    }
  }
  const afterListing = JSON.stringify(listRecursive(scratchRoot));
  check('悪意あるIDに対する試行後も、scratchRoot配下のファイル一覧が変化していない(dist/cards外への書き込みが一切発生していない)',
    beforeListing === afterListing);
}

function listRecursive(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const ent of entries) {
      const full = join(d, ent.name);
      out.push(full);
      if (ent.isDirectory()) stack.push(full);
    }
  }
  return out.sort();
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
