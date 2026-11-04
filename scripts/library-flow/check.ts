// libraryFlow ユーティリティと src/data/libraryFlows.ts の整合チェック（combos/*.tsv の実件数で検証）。
// 実行: npx tsx scripts/library-flow/check.ts
import fs from 'fs';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { LIBRARY_FLOWS } from '../../src/data/libraryFlows';
import { buildTree, countByKey, nodeKey, tabNodes, unassignedRows, type TreeItem } from '../../src/utils/libraryFlow';

const walk = (items: TreeItem[], f: (x: TreeItem) => void) => items.forEach((x) => { f(x); walk(x.children, f); });

const S = fileURLToPath(new URL('./combos', import.meta.url));
let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('OK', name); };

for (const sys of ['wreport_base', 'wreport_admin_base']) {
  const tabs = LIBRARY_FLOWS[sys];
  const rows: Record<string, string>[] = [];
  const lines = fs.readFileSync(`${S}/${sys}_combos.tsv`, 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
  for (const l of lines) { const [c, dai, chu] = l.split('\t'); for (let i = 0; i < +c; i++) rows.push({ '大分類': dai, '中分類': chu }); }
  const total = +fs.readFileSync(`${S}/${sys}_combos.tsv`, 'utf8').split(/\r?\n/)[0].split('\t')[1];
  const counts = countByKey(rows);

  test(`${sys}: 件数合計 = 総ケース数 (${total})`, () => assert.equal(rows.length, total));
  test(`${sys}: 未割当 0 件`, () => assert.equal(unassignedRows(rows, tabs).length, 0));
  test(`${sys}: 非共有ノードの件数合計 = 総ケース数`, () => {
    const sum = tabs.flatMap(tabNodes).filter((x) => !x.shared).reduce((a, x) => a + (counts.get(nodeKey(x.dai, x.chu)) || 0), 0);
    assert.equal(sum, total);
  });
  test(`${sys}: 非共有ノードに重複なし・全ノードが件数1以上`, () => {
    const keys = tabs.flatMap(tabNodes).filter((x) => !x.shared).map((x) => nodeKey(x.dai, x.chu));
    assert.equal(new Set(keys).size, keys.length);
    for (const x of tabs.flatMap(tabNodes)) assert.ok((counts.get(nodeKey(x.dai, x.chu)) || 0) > 0, x.chu);
  });
  test(`${sys}: タブ内ノードID一意・エッジ端点が存在`, () => {
    for (const t of tabs) {
      const ids = tabNodes(t).map((x) => x.id);
      assert.equal(new Set(ids).size, ids.length, t.title);
      for (const [a, b] of t.edges) assert.ok(ids.includes(a) && ids.includes(b), `${t.title} ${a}->${b}`);
    }
  });
  test(`${sys}: ツリーで全ノードが1回ずつ展開・残りのエッジは参照ノード`, () => {
    for (const t of tabs) {
      const expanded: string[] = [];
      let refs = 0, links = 0, roots = 0;
      buildTree(t).forEach((sec) => { roots += sec.roots.length; walk(sec.roots, (x) => { x.ref ? refs++ : expanded.push(x.node.id); links += x.children.length; }); });
      assert.deepEqual([...expanded].sort(), tabNodes(t).map((x) => x.id).sort(), t.title);
      assert.equal(links, t.edges.length, t.title);
      assert.equal(refs, t.edges.length - (expanded.length - roots), t.title);
    }
  });
  test(`${sys}: 新しい 大分類×中分類 は未割当になる`, () => {
    const extra = [...rows.slice(0, 3), { '大分類': '新商品', '中分類': '新画面' }];
    assert.equal(unassignedRows(extra, tabs).length, 1);
  });
  test(`${sys}: 前後の空白は無視して集計`, () => {
    const r = rows[0];
    assert.equal(countByKey([{ '大分類': ` ${r['大分類']} `, '中分類': r['中分類'] + ' ' }]).get(nodeKey(r['大分類'], r['中分類'])), 1);
  });
}
test('buildTree: 合流は1回だけ展開し、2つ目の親には参照ノード', () => {
  const N = (id: string) => ({ id, dai: 'X', chu: id });
  const tab = { title: 't', groups: [{ title: 'g', nodes: [N('m'), N('a'), N('b'), N('c'), N('d')] }],
    edges: [['m', 'a', 'Step1'], ['m', 'b', 'Step1'], ['a', 'c', 'Step2'], ['b', 'c', 'Step2', true], ['c', 'd', '']] as any };
  const [sec] = buildTree(tab);
  assert.equal(sec.roots.length, 1);
  const [a, b] = sec.roots[0].children;
  assert.equal(a.children[0].node.id, 'c');
  assert.equal(a.children[0].ref, false);
  assert.equal(a.children[0].children[0].node.id, 'd');
  assert.equal(b.children[0].ref, true);
  assert.equal(b.children[0].dotted, true);
  assert.equal(b.children[0].children.length, 0);
});
test('buildTree: 循環だけの部分も欠けずに出る', () => {
  const N = (id: string) => ({ id, dai: 'X', chu: id });
  const tab = { title: 't', groups: [{ title: null, nodes: [N('a'), N('b')] }], edges: [['a', 'b', ''], ['b', 'a', '']] as any };
  const ids: string[] = [];
  buildTree(tab).forEach((s) => walk(s.roots, (x) => { if (!x.ref) ids.push(x.node.id); }));
  assert.deepEqual(ids.sort(), ['a', 'b']);
});
console.log(`${n} tests passed`);
