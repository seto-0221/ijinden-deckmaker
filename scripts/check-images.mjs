#!/usr/bin/env node
/**
 * カードIDと public/images/ の画像ファイルの対応を自動検証する。
 * 検出対象:
 *   1. 欠損        … カードに対応する画像が1つも無い
 *   2. 重複        … 同じカードに複数の画像が該当(公式名とID名の二重登録など)
 *   3. 大文字小文字 … 大文字小文字だけが異なるファイルがある(macOSでは動くがLinux/Pagesで404になる)
 *   4. 拡張子不一致 … .png以外(.PNG/.jpg/.jpeg/.webp)で置かれていて参照候補と合わない
 *   5. 孤立ファイル … どのカードにも対応しない画像(消し忘れ・リネームミスの検出)
 * 使い方: node scripts/check-images.mjs   (問題があれば終了コード1)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMG_DIR = join(ROOT, 'public/images');

// アプリ本体(imageCandidates/officialImageFilename)と同じ対応規則。変更時は両方を揃えること。
function officialImageFilename(c) {
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

const manifest = JSON.parse(readFileSync(join(ROOT, 'src/build-manifest.json'), 'utf-8'));
const cards = manifest.cardSetOrder.flatMap((s) =>
  JSON.parse(readFileSync(join(ROOT, `src/data/cards/set-${s}.json`), 'utf-8')));

const files = readdirSync(IMG_DIR).filter((f) => !f.startsWith('.') && /\.(png|jpe?g|webp)$/i.test(f));
const fileSet = new Set(files);
const lowerMap = new Map(); // 小文字化名 → 実ファイル名リスト
for (const f of files) {
  const k = f.toLowerCase();
  if (!lowerMap.has(k)) lowerMap.set(k, []);
  lowerMap.get(k).push(f);
}

const problems = { missing: [], duplicate: [], caseMismatch: [], extMismatch: [] };
const used = new Set();

for (const c of cards) {
  const candidates = [officialImageFilename(c), `${c.id}.png`, `${c.id}.jpg`, `${c.id}.webp`].filter(Boolean);
  const hits = candidates.filter((f) => fileSet.has(f));
  hits.forEach((h) => used.add(h));
  if (hits.length === 0) {
    // 大文字小文字違い・拡張子違いなら別カウントで報告する
    const caseHit = candidates.map((f) => lowerMap.get(f.toLowerCase())).find((l) => l && l.length);
    if (caseHit) {
      problems.caseMismatch.push(`${c.id} ${c.name}: 期待 ${candidates[0]} / 実際 ${caseHit.join(', ')}`);
      caseHit.forEach((h) => used.add(h));
    } else {
      const base = (officialImageFilename(c) || `${c.id}.png`).replace(/\.png$/i, '');
      const extHit = files.filter((f) => f.toLowerCase().startsWith(base.toLowerCase() + '.'));
      if (extHit.length) {
        problems.extMismatch.push(`${c.id} ${c.name}: 期待 ${base}.png / 実際 ${extHit.join(', ')}`);
        extHit.forEach((h) => used.add(h));
      } else {
        problems.missing.push(`${c.id} ${c.name} (期待: ${candidates.join(' または ')})`);
      }
    }
  } else if (hits.length > 1) {
    problems.duplicate.push(`${c.id} ${c.name}: ${hits.join(', ')}`);
  }
}

// 大文字小文字だけ違う同名ファイルの共存(カード対応と無関係に危険)
for (const [k, list] of lowerMap) {
  if (list.length > 1) problems.caseMismatch.push(`同名ファイルの大小文字違いが共存: ${list.join(', ')}`);
}

const orphans = files.filter((f) => !used.has(f) && !/^README/i.test(f));

let bad = false;
for (const [label, key] of [['欠損', 'missing'], ['重複', 'duplicate'], ['大文字小文字', 'caseMismatch'], ['拡張子不一致', 'extMismatch']]) {
  const list = problems[key];
  if (list.length) {
    bad = true;
    console.log(`\n[NG] ${label} (${list.length}件)`);
    list.slice(0, 20).forEach((x) => console.log('  -', x));
    if (list.length > 20) console.log(`  ...他${list.length - 20}件`);
  }
}
if (orphans.length) {
  console.log(`\n[注意] どのカードにも対応しない画像 (${orphans.length}件・エラー扱いにはしない)`);
  orphans.slice(0, 10).forEach((x) => console.log('  -', x));
}
console.log(`\nカード${cards.length}件 / 画像${files.length}件 → ${bad ? '問題あり' : '問題なし'}`);
process.exit(bad ? 1 : 0);
