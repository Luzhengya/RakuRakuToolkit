import { useState } from 'react';
import JijiSokuho from './JijiSokuho';

const TABS = [
  { id: 'jiji', label: '時事速報' },
  { id: 'jiemian', label: '界面新聞' },
] as const;

type TabId = (typeof TABS)[number]['id'];

interface DataCollectionProps {
  onBack: () => void;
}

export default function DataCollection({ onBack }: DataCollectionProps) {
  const [activeTab, setActiveTab] = useState<TabId>('jiji');
  const [jijiDetail, setJijiDetail] = useState<{ title: string; back: () => void } | null>(null);

  const truncate = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n)}…` : s);

  const breadcrumb = (
    <nav className="flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={onBack}
        className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors"
      >
        首页
      </button>
      <span className="text-neutral-400">{'>>'}</span>
      {jijiDetail ? (
        <>
          <button
            type="button"
            onClick={jijiDetail.back}
            className="text-neutral-500 hover:text-neutral-900 hover:underline transition-colors"
          >
            不安情報収集
          </button>
          <span className="text-neutral-400">{'>>'}</span>
          <span className="text-neutral-900 font-medium" title={jijiDetail.title}>
            {truncate(jijiDetail.title)}
          </span>
        </>
      ) : (
        <span className="text-neutral-900 font-medium">不安情報収集</span>
      )}
    </nav>
  );

  return (
    <div className="space-y-6">
      {breadcrumb}

      <div className="border-b border-neutral-200">
        <div className="flex">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setJijiDetail(null); }}
              className={[
                'px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeTab === tab.id
                  ? 'border-neutral-900 text-neutral-900'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'jiji' ? (
        <JijiSokuho onDetailChange={setJijiDetail} />
      ) : (
        <div className="flex items-center justify-center py-20 text-neutral-400 text-sm">
          界面新聞 — 開発中
        </div>
      )}

      <div className="pt-4 border-t border-neutral-200">
        {breadcrumb}
      </div>
    </div>
  );
}
