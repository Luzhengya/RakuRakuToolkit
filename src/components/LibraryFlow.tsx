import { useMemo } from 'react';
import { buildTree, countByKey, nodeKey, type FlowNode, type FlowTab, type TreeItem } from '../utils/libraryFlow';
import type { TcRow } from './testcaseFields';

// 画面遷移図をツリーで表示する (親を左、子を右に縦並び。system_flow.html と同じ見た目)。
// 最深 7 階層でも横スクロールが出ないよう、ノード幅 128px・字下げ 24px に抑えている

// 中分類の名前でノードの色を決める (system_flow.html の凡例に合わせる)
function tone(n: FlowNode, group: string | null | undefined): string {
  if (n.shared) return 'bg-neutral-50 border-neutral-400 border-dashed';
  if (/メニュー|ログイン$|サービス$/.test(n.chu)) return 'bg-[#c5d9f1] border-[#5b9bd5]';
  if (/入口|連携ジャンプ|認証連携/.test(n.chu)) return 'bg-[#fbd5b5] border-[#e6a56c]';
  if (group && /非画面|共通部品/.test(group)) return 'bg-white border-neutral-500';
  return 'bg-[#fff2cc] border-[#d4a017]';
}

function Branch({ item, groupOf, counts, selectedId, onSelect }: {
  item: TreeItem;
  groupOf: Map<string, string | null>;
  counts: Map<string, number>;
  selectedId: string | null;
  onSelect: (n: FlowNode) => void;
}) {
  const n = item.node;
  const c = counts.get(nodeKey(n.dai, n.chu)) || 0;
  const selected = n.id === selectedId;
  return (
    <div className="flex items-start">
      <button
        type="button"
        onClick={() => onSelect(n)}
        title={`${n.dai} / ${n.chu}`}
        className={`shrink-0 max-w-[128px] text-left rounded-[3px] border-[1.5px] px-1.5 py-1 text-[11px] font-bold leading-snug text-neutral-900 hover:brightness-95
          ${item.ref ? 'bg-white border-neutral-400 border-dashed font-normal' : tone(n, groupOf.get(n.id))}
          ${selected ? 'ring-2 ring-amber-500 ring-offset-1' : ''} ${c === 0 ? 'opacity-50' : ''}`}
      >
        {item.label && <span className="block text-[10px] font-normal text-neutral-500">{item.dotted ? '┄ ' : ''}{item.label}</span>}
        <span className="break-words">{item.ref ? '→ ' : n.shared ? '［共通］' : ''}{n.chu}</span>
        <span className="ml-1 text-[10px] font-normal text-neutral-500 tabular-nums">{c}件</span>
      </button>
      {item.children.length > 0 && (
        <div className="flex flex-col">
          {item.children.map((ch, i) => {
            const first = i === 0;
            const last = i === item.children.length - 1;
            return (
              <div key={`${ch.node.id}-${i}`} className="relative pl-6 py-[3px]">
                {/* 縦線：最初の子は中央から、最後の子は中央まで */}
                {!(first && last) && (
                  <span
                    className="absolute left-0 border-l-[1.5px] border-neutral-500"
                    style={{ top: first ? 17 : 0, bottom: last ? undefined : 0, height: last ? 17 : undefined }}
                  />
                )}
                <span className="absolute left-0 top-[17px] w-[18px] border-t-[1.5px] border-neutral-500" />
                <span className="absolute left-[15px] top-[11px] text-[10px] text-neutral-500 leading-none">▸</span>
                <Branch item={ch} groupOf={groupOf} counts={counts} selectedId={selectedId} onSelect={onSelect} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function LibraryFlow({ tabs, tabIndex, onTab, rows, selectedId, onSelect }: {
  tabs: FlowTab[];
  tabIndex: number;
  onTab: (i: number) => void;
  rows: TcRow[];
  selectedId: string | null;
  onSelect: (node: FlowNode) => void;
}) {
  const tab = tabs[tabIndex];
  const counts = useMemo(() => countByKey(rows), [rows]);
  const sections = useMemo(() => (tab ? buildTree(tab) : []), [tab]);
  const groupOf = useMemo(
    () => new Map((tab?.groups ?? []).flatMap((g) => g.nodes.map((n) => [n.id, g.title] as const))),
    [tab],
  );

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
        {sections.map((s, i) => (
          <div key={i}>
            {s.title && (
              <p className="text-xs font-bold mb-1.5 px-2.5 py-0.5 border-l-4 border-[#5b9bd5] bg-neutral-100">{s.title}</p>
            )}
            <div className="space-y-1.5">
              {s.roots.map((r) => (
                <Branch key={r.node.id} item={r} groupOf={groupOf} counts={counts} selectedId={selectedId} onSelect={onSelect} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="px-4 py-2 border-t border-neutral-100 text-[11px] text-neutral-400">
        ノードをクリックすると関連ケースを下に表示します。件数は現在の絞り込み条件で数えています。
        ［共通］は大分類「共通」の画面、「→」付きの点線ノードは別の場所で展開済みの画面です。
      </p>
    </div>
  );
}
