import { Route } from 'lucide-react';
import type { EntryNode, NodeCases, Tone, ViewTab } from '../utils/libraryFlow';
import type { TcRow } from './testcaseFields';

// 画面遷移をツリーで表示する (親を左、子を右に縦並び。system_flow.html と同じ見た目)。
// 最深 7 階層でも横スクロールが出ないよう、ノード幅 128px・字下げ 24px に抑えている

// system_flow.html の凡例に合わせた色
const TONE: Record<Tone, string> = {
  entry: 'bg-[#fbd5b5] border-[#e6a56c]',
  menu: 'bg-[#c5d9f1] border-[#5b9bd5]',
  screen: 'bg-[#fff2cc] border-[#d4a017]',
  action: 'bg-white border-neutral-500',
  shared: 'bg-neutral-50 border-neutral-400 border-dashed',
};

type Props = {
  cases: Map<string, NodeCases<TcRow>>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onPath: (id: string) => void;
};

function Branch({ n, cases, selected, onToggle, onPath }: Props & { n: EntryNode }) {
  const c = cases.get(n.id);
  const own = c?.own.length ?? 0;
  const com = c?.com.length ?? 0;
  const on = selected.has(n.id);
  const kids = n.kids || [];
  return (
    <div className="flex items-start">
      <div
        className={`relative shrink-0 w-fit max-w-[128px] rounded-[3px] border-[1.5px] text-[11px] leading-snug text-neutral-900
          ${n.ref ? 'bg-white border-neutral-400 border-dashed' : TONE[n.tone]}
          ${on ? 'ring-2 ring-amber-500 ring-offset-1' : ''} ${own + com === 0 ? 'opacity-50' : ''}`}
      >
        <button
          type="button"
          onClick={() => onToggle(n.id)}
          title={n.note ? `${n.label}\n※${n.note}` : n.label}
          className="block w-full text-left px-1.5 pt-1 pb-0.5 pr-4 hover:brightness-95"
        >
          {n.edgeLabel && <span className="block text-[10px] text-neutral-500">{n.dotted ? '┄ ' : ''}{n.edgeLabel}</span>}
          <span className={`break-words ${n.ref ? '' : 'font-bold'}`}>
            {n.ref ? '→ ' : ''}{n.tone === 'action' && !n.ref ? '［機能］' : ''}{n.label}
          </span>
          <span className="block text-[10px] text-neutral-500 tabular-nums">
            {own}件{n.com ? `＋共通${com}件` : ''}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onPath(n.id)}
          title="ここまでの経路をまとめて選択"
          className="absolute right-0.5 top-0.5 p-0.5 rounded text-neutral-400 hover:text-neutral-800 hover:bg-white/70"
        >
          <Route size={11} />
        </button>
      </div>
      {kids.length > 0 && (
        <div className="flex flex-col">
          {kids.map((k, i) => {
            const first = i === 0;
            const last = i === kids.length - 1;
            return (
              <div key={k.id} className="relative pl-6 py-[3px]">
                {/* 縦線：最初の子は中央から、最後の子は中央まで */}
                {!(first && last) && (
                  <span
                    className="absolute left-0 border-l-[1.5px] border-neutral-500"
                    style={{ top: first ? 17 : 0, bottom: last ? undefined : 0, height: last ? 17 : undefined }}
                  />
                )}
                <span className="absolute left-0 top-[17px] w-[18px] border-t-[1.5px] border-neutral-500" />
                <span className="absolute left-[15px] top-[11px] text-[10px] text-neutral-500 leading-none">▸</span>
                <Branch n={k} cases={cases} selected={selected} onToggle={onToggle} onPath={onPath} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function LibraryFlow({ tabs, tabIndex, onTab, ...props }: Props & {
  tabs: ViewTab[];
  tabIndex: number;
  onTab: (i: number) => void;
}) {
  const tab = tabs[tabIndex];
  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
      <div className="flex flex-wrap gap-1.5 p-3 border-b border-neutral-200">
        {tabs.map((t, i) => (
          <button
            key={t.title}
            type="button"
            onClick={() => onTab(i)}
            className={`px-2.5 py-1 rounded-lg text-xs border ${i === tabIndex ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'}`}
          >
            {t.title}
          </button>
        ))}
      </div>
      <div className="overflow-auto max-h-[60vh] p-4 space-y-3">
        {tab?.sections.map((s, i) => (
          <div key={i}>
            {s.title && (
              <p className="text-xs font-bold mb-1.5 px-2.5 py-0.5 border-l-4 border-[#5b9bd5] bg-neutral-100">{s.title}</p>
            )}
            <div className="space-y-1.5">
              {s.roots.map((r) => <Branch key={r.id} n={r} {...props} />)}
            </div>
          </div>
        ))}
      </div>
      <p className="px-4 py-2 border-t border-neutral-100 text-[11px] text-neutral-400">
        ノードをクリックで選択／解除（複数選択可）。<Route size={10} className="inline -mt-0.5" /> でそのノードまでの経路をまとめて選択。
        件数は現在の絞り込み条件で数えています。「＋共通」は大分類「共通」の同じ画面のケースです。
      </p>
    </div>
  );
}
