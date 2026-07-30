#!/usr/bin/env node
/**
 * ローカルReport-Only検証用: 生成済みdist/index.html・dist/ijinden-deckmaker.html内の
 * APP_JS(唯一の実行可能なインラインscript要素)のtextContentから、
 * 改行・インデントを一切正規化せず、実際に生成されたUTF-8バイト列そのものでSHA-256ハッシュを計算する。
 *
 * 抽出方法の詳細はscripts/lib/csp-hash.mjsを参照。
 *
 * 使い方: node scripts/compute-csp-hash.mjs
 * 出力: Web版/オフライン版それぞれのAPP_JSのSHA-256ハッシュ(CSPのscript-src用 'sha256-...' 形式)と、
 *       両者が完全に同一バイト列かどうかの判定結果。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractAppJs, sha256Base64 } from './lib/csp-hash.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const htmlWeb = readFileSync(join(DIST, 'index.html'), 'utf-8');
const htmlOffline = readFileSync(join(DIST, 'ijinden-deckmaker.html'), 'utf-8');

const appJsWeb = extractAppJs(htmlWeb, 'dist/index.html');
const appJsOffline = extractAppJs(htmlOffline, 'dist/ijinden-deckmaker.html');

const hashWeb = sha256Base64(appJsWeb);
const hashOffline = sha256Base64(appJsOffline);

const identical = appJsWeb === appJsOffline;

console.log('=== APP_JS CSPハッシュ計算結果 ===');
console.log(`Web版      (dist/index.html)            : ${hashWeb.bytes} bytes, sha256-${hashWeb.digest}`);
console.log(`オフライン版 (dist/ijinden-deckmaker.html): ${hashOffline.bytes} bytes, sha256-${hashOffline.digest}`);
console.log(`Web版とオフライン版のAPP_JSは完全に同一バイト列か: ${identical ? 'YES(同一)' : 'NO(異なる)'}`);
console.log('');
console.log(`script-src用ハッシュ値(Web版基準): 'sha256-${hashWeb.digest}'`);
if (!identical) {
  console.log(`script-src用ハッシュ値(オフライン版用、別途必要): 'sha256-${hashOffline.digest}'`);
}
