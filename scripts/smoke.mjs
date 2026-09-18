/**
 * API スモークテスト。
 *
 * このリポジトリにはテストフレームワークが無いため、api/index.ts を触る前後で
 * 「壊していないか」を機械的に確認するための最低限の足場として置いている。
 *
 * 使い方 (別ターミナルで `npm run dev` を起動しておくこと):
 *
 *   npm run smoke                      … 実行して結果を表示する
 *   npm run smoke -- --save base.json  … 今の結果を基準値として保存する
 *   npm run smoke -- --compare base.json … 基準値と突き合わせる (差があれば非0終了)
 *   npm run smoke -- --base http://127.0.0.1:5199
 *
 * 想定する流れは「改修前に --save → 改修後に --compare」。
 * 案件数は月々増えるので、件数を固定値でコードに書かない。
 *
 * 書き込み系は「入力検証で弾かれること」だけを確認し、実際の書き込みは行わない。
 * Notion の実データを汚さないため、ここに書き込みが成功するケースを足さないこと。
 */

import fs from "fs";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = argOf("--base", "http://127.0.0.1:5173").replace(/\/$/, "");
const savePath = argOf("--save", null);
const comparePath = argOf("--compare", null);

const AREAS = [
  "jmotto", "univ", "overseas", "credit", "jmotto-app", "univ-app",
  "univ-contents", "nayose", "gyoshu", "ros", "meikancho",
];

/** 読み取り系: 期待ステータスと、記録しておきたい値の取り出し方 */
const GET_CHECKS = [
  ["/api/pdf-status", 200, (d) => ({ ready: d.ready })],
  ["/api/config/env-versions", 200, () => ({})],
  ["/api/config/kpi-targets", 200, (d) => ({ first: d.first?.length, second: d.second?.length })],
  ["/api/testcase-format/systems", 200, (d) => ({ systems: d.systems?.length })],
  ["/api/test-center/overview", 200, (d) => ({ items: d.items?.length })],
  ["/api/test-center/alerts", 200, (d) => ({
    planMissing: d.planMissing?.length,
    dueToday: d.dueToday?.length,
    needsCheck: d.needsCheck?.length,
  })],
  ["/api/test-center/case-stats", 200, (d) => ({ items: d.items?.length })],
  ["/api/test-center/bugs", 200, (d) => ({ items: d.items?.length })],
  ["/api/test-center/history", 200, (d) => ({ items: d.items?.length })],
  ["/api/jiji-list", 200, (d) => ({ items: d.items?.length })],
  ["/api/jiemian-list", 200, (d) => ({ items: d.items?.length })],
  ...AREAS.map((a) => [
    `/api/test-center?area=${a}`, 200,
    (d) => ({ total: d.total, items: d.items?.length }),
  ]),
];

/** 異常系: ステータスコードだけを見る (本文の文言は変わりうるので固定しない) */
const ERROR_CHECKS = [
  ["GET", "/api/test-center", null, 400],
  ["GET", "/api/test-center?area=badarea", null, 400],
  ["GET", "/api/testcase/list", null, 400],
  ["GET", "/api/test-center/notion-image", null, 400],
  ["GET", "/api/test-center/notion-image?url=http://example.com/x.png", null, 400],
  ["GET", "/api/no-such-route", null, 404],
  ["POST", "/api/upload", null, 400],
  ["POST", "/api/convert", null, 400],
  ["POST", "/api/pdf-convert", null, 400],
  ["POST", "/api/pdf-merge", null, 400],
  ["POST", "/api/pdf-extract-tables", null, 400],
  ["POST", "/api/testcase-format", null, 400],
  ["POST", "/api/test-center/results", {}, 400],
  ["POST", "/api/test-center/history", {}, 400],
  ["POST", "/api/testcase/export", {}, 400],
  ["POST", "/api/testcase/export", { rows: [] }, 400],
  ["POST", "/api/testcase/dummy-id/update", {}, 400],
  ["DELETE", "/api/test-center/history/no-such-entry-9999", null, 404],
];

const results = { base: BASE, at: new Date().toISOString(), get: {}, errors: {} };
const failures = [];

async function call(method, path, body) {
  const init = { method };
  if (body !== null && body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* JSON でない応答もある (xlsx/pdf/zip/markdown) */ }
  return { status: res.status, json, text };
}

console.log(`smoke: ${BASE}\n`);

console.log("── 読み取り系 ──");
for (const [path, want, pick] of GET_CHECKS) {
  const started = Date.now();
  try {
    const { status, json } = await call("GET", path, null);
    const ms = Date.now() - started;
    const ok = status === want;
    const picked = ok && json ? pick(json) : {};
    results.get[path] = { status, ...picked };
    console.log(`  ${ok ? "OK  " : "NG  "}[${status}] ${String(ms).padStart(6)}ms ${path} ${JSON.stringify(picked)}`);
    if (!ok) failures.push(`${path}: status ${status} (期待 ${want})`);
    // total と items 件数がずれていたら、どこかで静かに落としている
    if (picked.total !== undefined && picked.items !== undefined && picked.total !== picked.items) {
      failures.push(`${path}: total=${picked.total} と items=${picked.items} が不一致`);
    }
  } catch (e) {
    results.get[path] = { status: 0 };
    console.log(`  NG  [---] ${path} ${e.message}`);
    failures.push(`${path}: ${e.message}`);
  }
}

console.log("\n── 異常系 (入力検証。書き込みは行わない) ──");
for (const [method, path, body, want] of ERROR_CHECKS) {
  const key = `${method} ${path}${body ? ` ${JSON.stringify(body)}` : ""}`;
  try {
    const { status } = await call(method, path, body);
    const ok = status === want;
    results.errors[key] = status;
    console.log(`  ${ok ? "OK  " : "NG  "}[${status}] ${key}`);
    if (!ok) failures.push(`${key}: status ${status} (期待 ${want})`);
  } catch (e) {
    results.errors[key] = 0;
    console.log(`  NG  [---] ${key} ${e.message}`);
    failures.push(`${key}: ${e.message}`);
  }
}

if (savePath) {
  fs.writeFileSync(savePath, JSON.stringify(results, null, 2), "utf8");
  console.log(`\n基準値を保存しました: ${savePath}`);
}

if (comparePath) {
  console.log(`\n── 基準値との突合 (${comparePath}) ──`);
  const base = JSON.parse(fs.readFileSync(comparePath, "utf8"));
  let diff = 0;
  for (const [path, want] of Object.entries(base.get ?? {})) {
    const got = results.get[path];
    if (!got) { console.log(`  欠落 ${path}`); failures.push(`${path}: 今回の結果に無い`); diff++; continue; }
    for (const [k, v] of Object.entries(want)) {
      if (got[k] !== v) {
        console.log(`  差分 ${path} ${k}: ${v} → ${got[k]}`);
        failures.push(`${path} ${k}: ${v} → ${got[k]}`);
        diff++;
      }
    }
  }
  for (const [key, want] of Object.entries(base.errors ?? {})) {
    if (results.errors[key] !== want) {
      console.log(`  差分 ${key}: ${want} → ${results.errors[key]}`);
      failures.push(`${key}: ${want} → ${results.errors[key]}`);
      diff++;
    }
  }
  console.log(diff === 0 ? "  差分なし" : `  差分 ${diff} 件`);
  console.log("  ※ 案件やBUGが増減した直後は件数差分が出るのが正常。内容を見て判断すること。");
}

console.log(`\n${failures.length === 0 ? "=== 全て OK ===" : `=== NG ${failures.length} 件 ===`}`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
