/**
 * scripts/build-card-pages.mjs の「カードIDパストラバーサル対策」統合テスト(所見#17)。
 *
 * 単体関数テスト(tests/build-card-id.test.js)とは別に、実際のビルドスクリプトを
 * 子プロセスとして実行し、
 *   - 正常なカードデータではこれまで通りビルドが成功すること
 *   - 不正なID(パストラバーサル)を含むカードデータではビルドがexit code非0で失敗し、
 *     dist/cards配下の外へ一切ファイル・ディレクトリが生成されないこと
 *   - 重複ID(大文字小文字違い含む)を含むカードデータではビルドが失敗すること
 * を、文字列上のパス確認だけでなく実ファイルシステム上の生成有無で検証する。
 *
 * テスト対象のscripts/build-card-pages.mjs・scripts/lib/build-card-id.mjs・
 * scripts/lib/render-card-page.mjsは、本番と全く同じファイルをそのまま
 * 一時ディレクトリへコピーして実行する(テスト専用の再実装は行わない)。
 *
 * 実行: node tests/build-card-pages-integrity.test.js
 */
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ', name); }
  else { fail++; console.log('FAIL', name); }
}

const GOOD_CARD_1 = {
  id: '1-1', no: '1', set: 1, source: 'テストセット', name: 'テストカードA', rarity: 'SR',
  colors: ['赤'], type: 'イジン', level: 1, cost: null, power: 1000, trait: '',
  ruleText: 'テスト用のルールテキスト', igyouText: '-', illustrator: 'テスト', unlimited: false,
};
const GOOD_CARD_2 = { ...GOOD_CARD_1, id: '1-2', name: 'テストカードB' };

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

/**
 * 本番のscripts/・src/shared/card-detail-html.mjs・card-page.template.htmlをそのまま
 * 一時ディレクトリへコピーし、指定したカード配列だけを持つ最小限のビルド環境を作る。
 * cssOrderは空にして(スタイルは今回の検証に無関係のため)、styles/配下のコピーを省略する。
 */
function buildFixture(cards) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'build-card-pages-integrity-'));
  mkdirSync(join(fixtureRoot, 'scripts', 'lib'), { recursive: true });
  mkdirSync(join(fixtureRoot, 'src', 'shared'), { recursive: true });
  mkdirSync(join(fixtureRoot, 'src', 'data', 'cards'), { recursive: true });

  cpSync(join(ROOT, 'scripts', 'build-card-pages.mjs'), join(fixtureRoot, 'scripts', 'build-card-pages.mjs'));
  cpSync(join(ROOT, 'scripts', 'lib', 'render-card-page.mjs'), join(fixtureRoot, 'scripts', 'lib', 'render-card-page.mjs'));
  cpSync(join(ROOT, 'scripts', 'lib', 'build-card-id.mjs'), join(fixtureRoot, 'scripts', 'lib', 'build-card-id.mjs'));
  cpSync(join(ROOT, 'src', 'shared', 'card-detail-html.mjs'), join(fixtureRoot, 'src', 'shared', 'card-detail-html.mjs'));
  cpSync(join(ROOT, 'src', 'card-page.template.html'), join(fixtureRoot, 'src', 'card-page.template.html'));

  writeFileSync(join(fixtureRoot, 'src', 'build-manifest.json'), JSON.stringify({ cssOrder: [], cardSetOrder: ['fixture'] }));
  writeFileSync(join(fixtureRoot, 'src', 'site-config.json'), JSON.stringify({ baseUrl: 'https://example.test/ijinden-deckmaker/' }));
  writeFileSync(join(fixtureRoot, 'src', 'data', 'cards', 'set-fixture.json'), JSON.stringify(cards));

  return fixtureRoot;
}

function runBuild(fixtureRoot) {
  const result = spawnSync(process.execPath, [join(fixtureRoot, 'scripts', 'build-card-pages.mjs')], {
    cwd: fixtureRoot,
    encoding: 'utf-8',
  });
  return result;
}

// ==================================================================
// シナリオ1: 正常系(既存互換性の非破壊確認) — ビルドが成功し、想定通りのページが生成される
// ==================================================================
{
  const fixtureRoot = buildFixture([GOOD_CARD_1, GOOD_CARD_2]);
  const result = runBuild(fixtureRoot);
  check('正常系: 正常なカードデータのみの場合、ビルドはexit code 0で成功する', result.status === 0);
  const cardsDir = join(fixtureRoot, 'dist', 'cards');
  check('正常系: dist/cards/1-1/index.html が生成される', listRecursive(cardsDir).some((p) => p.endsWith(join('1-1', 'index.html'))));
  check('正常系: dist/cards/1-2/index.html が生成される', listRecursive(cardsDir).some((p) => p.endsWith(join('1-2', 'index.html'))));
  rmSync(fixtureRoot, { recursive: true, force: true });
}

// ==================================================================
// シナリオ2: パストラバーサルIDを含む場合 — ビルド失敗・境界外への書き込みなし
// ==================================================================
{
  const maliciousCard = { ...GOOD_CARD_1, id: '../../escaped-by-traversal', name: '悪意あるカード' };
  const fixtureRoot = buildFixture([GOOD_CARD_1, maliciousCard]);
  const beforeListing = JSON.stringify(listRecursive(fixtureRoot));
  const beforeParentListing = JSON.stringify(listRecursive(tmpdir()).filter((p) => !p.startsWith(fixtureRoot)));

  const result = runBuild(fixtureRoot);

  check('シナリオ2: 不正ID(パストラバーサル)を含む場合、ビルドはexit code非0で失敗する', result.status !== 0 && result.status !== null);
  check('シナリオ2: エラー出力に不正なIDが含まれる', result.stderr.includes('../../escaped-by-traversal'));
  check('シナリオ2: エラー出力に対象カード名が含まれる', result.stderr.includes('悪意あるカード'));
  check('シナリオ2: エラー出力に読み込み元セットファイルが含まれる', result.stderr.includes('set-fixture.json'));
  check('シナリオ2: エラー出力に拒否理由が含まれる', result.stderr.includes('拒否理由'));

  const afterListing = JSON.stringify(listRecursive(fixtureRoot));
  check('シナリオ2: 失敗後もfixture配下(dist/含む)に正常カードのページすら生成されていない(全体が失敗する設計)',
    !listRecursive(fixtureRoot).some((p) => p.includes(join('dist', 'cards'))));

  const afterParentListing = JSON.stringify(listRecursive(tmpdir()).filter((p) => !p.startsWith(fixtureRoot)));
  check('シナリオ2: OSの一時ディレクトリ配下(fixture自身の外)に想定外のファイル・ディレクトリが生成されていない(実ファイルシステム上での境界確認)',
    beforeParentListing === afterParentListing);

  rmSync(fixtureRoot, { recursive: true, force: true });
}

// ==================================================================
// シナリオ3: 重複ID(完全一致)を含む場合 — ビルド失敗
// ==================================================================
{
  const dup1 = { ...GOOD_CARD_1, id: '1-1', name: 'カードX' };
  const dup2 = { ...GOOD_CARD_1, id: '1-1', name: 'カードY' };
  const fixtureRoot = buildFixture([dup1, dup2]);
  const result = runBuild(fixtureRoot);
  check('シナリオ3: 完全一致の重複IDを含む場合、ビルドはexit code非0で失敗する', result.status !== 0 && result.status !== null);
  check('シナリオ3: エラー出力に重複IDである旨が含まれる', result.stderr.includes('重複カードID'));
  check('シナリオ3: エラー出力に先に出現したカード名が含まれる', result.stderr.includes('カードX'));
  check('シナリオ3: エラー出力に後に出現したカード名が含まれる', result.stderr.includes('カードY'));
  rmSync(fixtureRoot, { recursive: true, force: true });
}

// ==================================================================
// シナリオ4: 大文字小文字だけが異なる重複IDを含む場合 — ビルド失敗(衝突として扱う方針の確認)
// ==================================================================
{
  const dupCase1 = { ...GOOD_CARD_1, id: '1-b1', name: 'カード小文字' };
  const dupCase2 = { ...GOOD_CARD_1, id: '1-B1', name: 'カード大文字' };
  const fixtureRoot = buildFixture([dupCase1, dupCase2]);
  const result = runBuild(fixtureRoot);
  check('シナリオ4: 大文字小文字だけが異なるID同士も、重複として扱われビルドが失敗する', result.status !== 0 && result.status !== null);
  check('シナリオ4: エラー出力に「大文字小文字を区別せず比較」の注記が含まれる', result.stderr.includes('大文字小文字を区別せず比較'));
  rmSync(fixtureRoot, { recursive: true, force: true });
}

// ==================================================================
// シナリオ5: 不正な形式のIDのみ(パス境界チェックまで到達しない、正規表現段階で拒否)
// ==================================================================
{
  const badFormatCard = { ...GOOD_CARD_1, id: '', name: '空ID' };
  const fixtureRoot = buildFixture([GOOD_CARD_1, badFormatCard]);
  const result = runBuild(fixtureRoot);
  check('シナリオ5: 空文字IDを含む場合もビルドが失敗する', result.status !== 0 && result.status !== null);
  check('シナリオ5: エラー出力に「空ID」カード名が含まれる', result.stderr.includes('空ID'));
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
