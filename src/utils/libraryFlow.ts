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

// ── 表示用の共通ツリー ───────────────────────────────
// 入口別ツリー (EntryTab) も、遷移図から作った木 (buildTree) も、この形にそろえて描画・集計する。
// 条件のキー：列（大 中 小 機）＋演算子。演算子なし＝完全一致、~ ＝含む、^ ＝前方一致、$ ＝後方一致、
//   !~ ＝「|」区切りのどれも含まない。$ は「A または B」の未確定値（修正案の貼り付け）には当てない
type Field = '大' | '中' | '小' | '機';
export type Rule = Partial<Record<Field | `${Field}${'~' | '^' | '$' | '!~'}`, string>>;
export type Tone = 'entry' | 'menu' | 'screen' | 'action' | 'shared';
export type EntryNode = {
  id: string;           // タブ内のパス (親の id + '.' + 連番)。祖先は id の前方一致で求まる
  label: string;
  tone: Tone;
  own?: Rule[];
  com?: Rule[];         // 大分類=共通 側。件数を「n件＋共通m件」で出す
  rest?: boolean;       // 画面の残り：兄弟の機能ノード (tone=action) に当たるケースを除く
  note?: string;
  edgeLabel?: string;   // 親からの遷移ラベル (Step1 など)
  dotted?: boolean;
  ref?: boolean;        // 別の場所で展開済みの画面への参照
  kids?: EntryNode[];
};
export type EntryTab = { title: string; roots: EntryNode[] };
export type ViewTab = { title: string; sections: { title: string | null; roots: EntryNode[] }[] };

const FIELD = { '大': '大分類', '中': '中分類', '小': '小分類', '機': '機能名' } as const;
const val = (r: CaseLike, k: keyof typeof FIELD) => (r[FIELD[k]] || '').trim();

export function ruleHit(r: CaseLike, rule: Rule): boolean {
  for (const [k, v] of Object.entries(rule) as [keyof Rule, string][]) {
    const x = val(r, k[0] as Field);
    const op = k.slice(1);
    if (op === '~') { if (!x.includes(v)) return false; }
    else if (op === '^') { if (!x.startsWith(v)) return false; }
    else if (op === '$') { if (!x.endsWith(v) || x.includes(' または ')) return false; }
    else if (op === '!~') { if (v.split('|').some((w) => x.includes(w))) return false; }
    else if (x !== v) return false;
  }
  return true;
}

export const entryToView = (t: EntryTab): ViewTab => ({ title: t.title, sections: [{ title: null, roots: t.roots }] });

// 遷移図 (大分類×中分類 ノード) の木を表示用ツリーへ。色は中分類の名前とグループで決める
export function graphToView(tab: FlowTab): ViewTab {
  const groupOf = new Map(tab.groups.flatMap((g) => g.nodes.map((n) => [n.id, g.title] as const)));
  const tone = (n: FlowNode): Tone => {
    if (n.shared) return 'shared';
    if (/メニュー|ログイン$|サービス$/.test(n.chu)) return 'menu';
    if (/入口|連携ジャンプ|認証連携/.test(n.chu)) return 'entry';
    if (/非画面|共通部品/.test(groupOf.get(n.id) || '')) return 'action';
    return 'screen';
  };
  const conv = (x: TreeItem, id: string): EntryNode => ({
    id,
    label: (x.node.shared ? '［共通］' : '') + x.node.chu,
    tone: tone(x.node),
    own: [{ '大': x.node.dai, '中': x.node.chu }],
    edgeLabel: x.label || undefined,
    dotted: x.dotted || undefined,
    ref: x.ref || undefined,
    kids: x.children.map((c, i) => conv(c, `${id}.${i}`)),
  });
  return {
    title: tab.title,
    sections: buildTree(tab).map((s, si) => ({ title: s.title, roots: s.roots.map((r, ri) => conv(r, `s${si}r${ri}`)) })),
  };
}

export const walkNodes = (nodes: EntryNode[], f: (n: EntryNode, siblings: EntryNode[]) => void): void =>
  nodes.forEach((n) => { f(n, nodes); walkNodes(n.kids || [], f); });

export type NodeCases<T> = { own: T[]; com: T[] };

// 条件 → 当たる行番号。絞り込みのたびに呼ばれるので、行の値の trim は1回だけ行い、
// 完全一致のキー (中 / 機 / 大) で索引を引いて候補だけを判定する
function ruleIndex(rows: CaseLike[]) {
  const norm = rows.map((r) => ({ '大分類': val(r, '大'), '中分類': val(r, '中'), '小分類': val(r, '小'), '機能名': val(r, '機') }));
  const index = new Map<string, number[]>();
  norm.forEach((r, i) => {
    for (const k of ['大', '中', '機'] as const) {
      const key = `${k}\u0000${r[FIELD[k]]}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key)!.push(i);
    }
  });
  const all = norm.map((_, i) => i);
  const memo = new Map<string, Set<number>>();
  return (rules?: Rule[]): Set<number> => {
    if (!rules) return new Set();
    const mk = JSON.stringify(rules);
    let s = memo.get(mk);
    if (!s) {
      s = new Set();
      for (const rule of rules) {
        const k = (['中', '機', '大'] as const).find((x) => rule[x] !== undefined);
        for (const i of k ? index.get(`${k}\u0000${rule[k]}`) || [] : all) if (ruleHit(norm[i], rule)) s.add(i);
      }
      memo.set(mk, s);
    }
    return s;
  };
}

function casesOf<T extends CaseLike>(tab: ViewTab, rows: T[], hits: ReturnType<typeof ruleIndex>) {
  const out = new Map<string, NodeCases<T>>();
  walkNodes(tab.sections.flatMap((s) => s.roots), (n, siblings) => {
    const ex = [...(n.kids || []), ...(n.rest ? siblings.filter((s) => s.tone === 'action') : [])];
    const pick = (rules: Rule[] | undefined, key: 'own' | 'com') => {
      const excl = ex.map((k) => hits(k[key]));
      return [...hits(rules)].filter((i) => !excl.some((e) => e.has(i))).map((i) => rows[i]);
    };
    out.set(n.id, { own: pick(n.own, 'own'), com: pick(n.com, 'com') });
  });
  return out;
}

// 各ノードのケース。ノード = 条件に当たるケース − 直下の子が持つケース (画面＝残り)
export function nodeCases<T extends CaseLike>(tab: ViewTab, rows: T[]): Map<string, NodeCases<T>> {
  return casesOf(tab, rows, ruleIndex(rows));
}

// どのタブのノードにも出ないケース
export function unassignedOf<T extends CaseLike & { id: string }>(tabs: ViewTab[], rows: T[]): T[] {
  const hits = ruleIndex(rows);
  const seen = new Set<string>();
  for (const t of tabs) for (const c of casesOf(t, rows, hits).values()) for (const r of [...c.own, ...c.com]) seen.add(r.id);
  return rows.filter((r) => !seen.has(r.id));
}

// ノード自身とその祖先 (login からの経路)
export const pathIds = (id: string) => id.split('.').map((_, i, a) => a.slice(0, i + 1).join('.'));
