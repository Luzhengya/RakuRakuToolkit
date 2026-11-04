// libraryFlow ユーティリティと src/data/libraryFlows.ts の整合チェック（combos/*.tsv の実件数で検証）。
// 実行: npx tsx scripts/library-flow/check.ts
//（入口別ツリーの件数照合は、gen_flow.py が出す temp/entry_flow_wreport_base.md と突き合わせる）
import fs from 'fs';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { LIBRARY_ENTRY_TREES, LIBRARY_FLOWS } from '../../src/data/libraryFlows';
import {
  buildTree, countByKey, entryToView, graphToView, nodeCases, nodeKey, pathIds, ruleHit, tabNodes,
  unassignedOf, unassignedRows, walkNodes, type TreeItem,
} from '../../src/utils/libraryFlow';

const walk = (items: TreeItem[], f: (x: TreeItem) => void) => items.forEach((x) => { f(x); walk(x.children, f); });

const S = fileURLToPath(new URL('./combos', import.meta.url));
const TEMP = fileURLToPath(new URL('../../temp', import.meta.url));
let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('OK', name); };

// combos/*.tsv（件数 大分類 中分類 小分類 機能名）を1件ずつのケースに展開する
function loadRows(sys: string) {
  const lines = fs.readFileSync(`${S}/${sys}_combos.tsv`, 'utf8').split(/\r?\n/);
  const total = +lines[0].split('\t')[1];
  const rows: Record<string, string>[] & { id: string }[] = [];
  for (const l of lines.slice(1).filter(Boolean)) {
    const [c, dai, chu, sho, kino] = l.split('\t');
    for (let i = 0; i < +c; i++) rows.push({ id: `r${rows.length}`, '大分類': dai, '中分類': chu, '小分類': sho ?? '', '機能名': kino ?? '' });
  }
  return { rows, total };
}

// ── 遷移図（wreport_admin_base） ──
for (const sys of Object.keys(LIBRARY_FLOWS)) {
  const tabs = LIBRARY_FLOWS[sys];
  const { rows, total } = loadRows(sys);
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
  test(`${sys}: 表示用ツリーに変換しても件数が一致・未割当 0 件`, () => {
    const views = tabs.map(graphToView);
    assert.equal(unassignedOf(views, rows).length, 0);
    let sum = 0;
    for (const v of views) {
      const cases = nodeCases(v, rows);
      walkNodes(v.sections.flatMap((s) => s.roots), (x) => {
        if (!x.ref && x.tone !== 'shared') sum += cases.get(x.id)!.own.length;
      });
    }
    assert.equal(sum, total);
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

// ── 入口別ツリー（wreport_base） ──
for (const sys of Object.keys(LIBRARY_ENTRY_TREES)) {
  const views = LIBRARY_ENTRY_TREES[sys].map(entryToView);
  const { rows, total } = loadRows(sys);

  test(`${sys}: 件数合計 = 総ケース数 (${total})・未割当件数が gen_flow.py と一致`, () => {
    assert.equal(rows.length, total);
    const un = unassignedOf(views, rows).length;
    const md = `${TEMP}/entry_flow_${sys}.md`;
    if (fs.existsSync(md)) {
      const m = fs.readFileSync(md, 'utf8').match(/どのノードにも出ないケース（(\d+)件）/);
      assert.equal(un, +m![1]);
    }
    if (un > 0) console.log(`  WARN 未割当 ${un} 件（ケースのデータを確認。内訳は temp/entry_flow_${sys}.md の末尾）`);
  });
  test(`${sys}: ノードID一意・id が親のパスで始まる`, () => {
    for (const v of views) {
      const ids: string[] = [];
      const visit = (ns: typeof v.sections[0]['roots'], parent: string | null) => ns.forEach((x) => {
        ids.push(x.id);
        if (parent) assert.ok(x.id.startsWith(parent + '.'), x.id);
        visit(x.kids || [], x.id);
      });
      visit(v.sections.flatMap((s) => s.roots), null);
      assert.equal(new Set(ids).size, ids.length, v.title);
    }
  });
  const md = `${TEMP}/entry_flow_${sys}.md`;
  if (fs.existsSync(md)) {
    test(`${sys}: 各ノードの件数が gen_flow.py の確認用 MD と一致`, () => {
      const expected = fs.readFileSync(md, 'utf8').split(/\r?\n/)
        .map((l) => l.match(/\*\*(.+?)\*\*（(\d+)件(?:＋共通(\d+)件)?）/)).filter(Boolean)
        .map((m) => `${m![1]} ${m![2]} ${m![3] ?? '-'}`);
      const actual: string[] = [];
      for (const v of views) {
        const cases = nodeCases(v, rows);
        walkNodes(v.sections.flatMap((s) => s.roots), (x) => {
          const c = cases.get(x.id)!;
          actual.push(`${x.label} ${c.own.length} ${x.com ? c.com.length : '-'}`);
        });
      }
      assert.deepEqual(actual, expected);
    });
  } else {
    console.log(`SKIP ${md} が無いため件数照合を省略（先に gen_flow.py を実行）`);
  }
}

test('ruleHit: 完全一致・小分類の部分一致/前方一致・前後空白', () => {
  const r = { '大分類': ' 共通 ', '中分類': '信用調書管理ファイル', '小分類': '［ファイル一括出力］失敗', '機能名': 'X' };
  assert.ok(ruleHit(r, { '大': '共通', '中': '信用調書管理ファイル' }));
  assert.ok(ruleHit(r, { '小~': 'ファイル一括出力' }));
  assert.ok(ruleHit(r, { '小^': '［ファイル' }));
  assert.ok(!ruleHit(r, { '小^': 'ファイル' }));
  assert.ok(!ruleHit(r, { '機': 'Y' }));
});
test('ruleHit: 入口後缀（後方一致）・含まない・「A または B」の未確定値は当てない', () => {
  const k = (v: string) => ({ '大分類': 'P', '中分類': 'F', '小分類': 'メール配信（RM会員）', '機能名': v });
  assert.ok(ruleHit(k('海外信用調書申込（内容確認）（非会員）'), { '機^': '海外信用調書申込（内容確認）', '機$': '（非会員）' }));
  assert.ok(!ruleHit(k('海外信用調書申込（内容確認）（RM会員）'), { '機$': '（非会員）' }));
  assert.ok(!ruleHit(k('X（RM会員） または X（非会員）'), { '機$': '（非会員）' }));
  assert.ok(!ruleHit(k(''), { '小!~': '（利墨）|メール配信' }));
  assert.ok(ruleHit(k(''), { '小!~': '（利墨）|変動通知' }));
});
test('nodeCases: 画面＝残り（子・機能ノードの分を除く）、共通は別集計', () => {
  const rows = [
    { id: 'a', '大分類': 'P', '中分類': 'F', '小分類': '検索', '機能名': '' },
    { id: 'b', '大分類': 'P', '中分類': 'F', '小分類': '一括出力', '機能名': '' },
    { id: 'c', '大分類': '共通', '中分類': 'F', '小分類': '', '機能名': '' },
  ];
  const tab = { title: 't', roots: [{ id: 'n0', label: 'F', tone: 'screen' as const, own: [{ '大': 'P' }], kids: [
    { id: 'n0.0', label: '検索', tone: 'screen' as const, own: [{ '中': 'F', '大': 'P' }], rest: true },
    { id: 'n0.1', label: '一括出力', tone: 'action' as const, own: [{ '小~': '一括出力' }] },
    { id: 'n0.2', label: '共通', tone: 'screen' as const, com: [{ '大': '共通' }] },
  ] }] };
  const c = nodeCases(entryToView(tab), rows);
  assert.deepEqual(c.get('n0')!.own.map((r) => r.id), []);
  assert.deepEqual(c.get('n0.0')!.own.map((r) => r.id), ['a']);
  assert.deepEqual(c.get('n0.1')!.own.map((r) => r.id), ['b']);
  assert.deepEqual(c.get('n0.2')!.com.map((r) => r.id), ['c']);
});
test('pathIds: 祖先から自分まで', () => {
  assert.deepEqual(pathIds('n0.2.1'), ['n0', 'n0.2', 'n0.2.1']);
  assert.deepEqual(pathIds('s1r0'), ['s1r0']);
});
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
