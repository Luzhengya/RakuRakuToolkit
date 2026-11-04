/**
 * TestCase Library の Notion DB から「大分類×中分類×機能名」ごとの件数を取り、
 * combos/{system}_combos.tsv に保存する (gen_flow.py / check.ts の入力)。
 *
 * 使い方 (リポジトリ直下で、.env に NOTION_API_KEY / NOTION_TESTCASE_LIBRARY_PARENT_ID が必要):
 *   node scripts/library-flow/dump-combos.mjs
 */
import 'dotenv/config';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Client } from '@notionhq/client';

const SYSTEMS = ['wreport_base', 'wreport_admin_base'];
const outDir = fileURLToPath(new URL('./combos', import.meta.url));
const notion = new Client({ auth: process.env.NOTION_API_KEY });

const text = (p) => {
  if (!p) return '';
  const v = p[p.type];
  if (Array.isArray(v)) return v.map((x) => x.plain_text ?? x.name ?? '').join('');
  if (v && v.name) return v.name;
  return String(v ?? '');
};

const blocks = [];
let cursor;
do {
  const r = await notion.blocks.children.list({ block_id: process.env.NOTION_TESTCASE_LIBRARY_PARENT_ID, start_cursor: cursor, page_size: 100 });
  blocks.push(...r.results);
  cursor = r.has_more ? r.next_cursor : undefined;
} while (cursor);

fs.mkdirSync(outDir, { recursive: true });
for (const name of SYSTEMS) {
  const b = blocks.find((x) => x.type === 'child_database' && x.child_database.title === name);
  if (!b) throw new Error(`${name} の DB が見つかりません`);
  const db = await notion.databases.retrieve({ database_id: b.id });
  const ds = db.data_sources[0].id;
  const pages = [];
  let cur;
  do {
    const q = await notion.dataSources.query({ data_source_id: ds, start_cursor: cur, page_size: 100 });
    pages.push(...q.results);
    cur = q.has_more ? q.next_cursor : undefined;
  } while (cur);
  const m = new Map();
  for (const p of pages) {
    const k = ['大分類', '中分類', '機能名'].map((f) => text(p.properties[f]).trim()).join('\t');
    m.set(k, (m.get(k) || 0) + 1);
  }
  const lines = [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${v}\t${k}`);
  fs.writeFileSync(`${outDir}/${name}_combos.tsv`, `total\t${pages.length}\n` + lines.join('\n'), 'utf8');
  console.log(`${name}: ${pages.length} 件 / ${m.size} 組合せ`);
}
