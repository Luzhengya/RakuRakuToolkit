import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 transition-colors"
        >
          <ArrowLeft size={16} />
          ホーム
        </button>
        <span className="text-neutral-300">/</span>
        <span className="text-sm font-medium text-neutral-900">データ収集</span>
      </div>

      <div className="border-b border-neutral-200">
        <div className="flex">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
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
        <JijiSokuho />
      ) : (
        <div className="flex items-center justify-center py-20 text-neutral-400 text-sm">
          界面新聞 — 開発中
        </div>
      )}
    </div>
  );
}
