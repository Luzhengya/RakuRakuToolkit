// TestCase Library のフロー表示：ノード＝ケースの「大分類×中分類」。
// shared ノードは商品タブ内で 共通 の画面を補うもの（点線で表示）。

export type FlowNode = { id: string; dai: string; chu: string; shared?: boolean };
export type FlowGroup = { title: string | null; nodes: FlowNode[] };
// [from, to, ラベル, 点線]
export type FlowEdge = [string, string, string, boolean?];
export type FlowTab = { title: string; groups: FlowGroup[]; edges: FlowEdge[] };

type CaseLike = Record<string, string | undefined>;

export const nodeKey = (dai: string, chu: string) => `${dai}\u0000${chu}`;
export const caseKey = (r: CaseLike) => nodeKey((r['大分類'] || '').trim(), (r['中分類'] || '').trim());

export const tabNodes = (tab: FlowTab) => tab.groups.flatMap((g) => g.nodes);

export function countByKey(rows: CaseLike[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = caseKey(r);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

// どのタブのノードにも当たらないケース (新しい 大分類×中分類 が追加された場合など)
export function unassignedRows<T extends CaseLike>(rows: T[], tabs: FlowTab[]): T[] {
  const keys = new Set(tabs.flatMap((t) => tabNodes(t).map((n) => nodeKey(n.dai, n.chu))));
  return rows.filter((r) => !keys.has(caseKey(r)));
}

// ツリー表示用。遷移図 (合流あり) を木に直し、2つ目以降の親の下には参照ノード (ref) を置く
export type TreeItem = {
  node: FlowNode;
  label: string;      // 親からの遷移ラベル (Step1 など)
  dotted: boolean;    // 補助遷移
  ref: boolean;       // 既に別の場所で展開済み → 子は展開しない
  children: TreeItem[];
};
export type TreeSection = { title: string | null; roots: TreeItem[] };

export function buildTree(tab: FlowTab): TreeSection[] {
  const byId = new Map(tabNodes(tab).map((n) => [n.id, n]));
  const out = new Map<string, FlowEdge[]>();
  const hasParent = new Set<string>();
  for (const e of tab.edges) {
    if (e[0] === e[1] || !byId.has(e[0]) || !byId.has(e[1])) continue;
    if (!out.has(e[0])) out.set(e[0], []);
    out.get(e[0])!.push(e);
    hasParent.add(e[1]);
  }
  const done = new Set<string>();
  const expand = (n: FlowNode, label: string, dotted: boolean): TreeItem => {
    done.add(n.id);
    const item: TreeItem = { node: n, label, dotted, ref: false, children: [] };
    for (const [, to, l, d] of out.get(n.id) || []) {
      const c = byId.get(to)!;
      item.children.push(done.has(to)
        ? { node: c, label: l, dotted: !!d, ref: true, children: [] }
        : expand(c, l, !!d));
    }
    return item;
  };
  // 親の無いノードを根にする。根の見出しはそのノードのグループ
  const sections = tab.groups.map((g) => ({
    title: g.title,
    roots: g.nodes.filter((n) => !hasParent.has(n.id)).map((n) => expand(n, '', false)),
  }));
  // 循環だけで構成された部分が残った場合も、必ずどこかに出す
  tab.groups.forEach((g, i) => {
    for (const n of g.nodes) if (!done.has(n.id)) sections[i].roots.push(expand(n, '', false));
  });
  return sections.filter((s) => s.roots.length > 0);
}
