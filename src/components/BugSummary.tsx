import { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

interface BugItem {
  id: string;
  no: string;
  system: string;
  module: string;
  priority: string;
  testCaseName: string;
  bugDesc: string;
  judgment: string;
  status: string;
  execDate: string;
  reproSteps: string;
  expectedResult: string;
  actualResult: string;
  remarks: string;
  caseNumber: string;
  browserVersion: string;
  appVersion: string;
}

// 長文は改行を保ちたい項目
const LONG = new Set(['再現ステップ', '予定結果', '実際結果', 'Bug説明', '備考']);

export default function BugSummary({ bugId }: { bugId: string }) {
  const [item, setItem] = useState<BugItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/test-center/bugs/single/${encodeURIComponent(bugId)}`)
      .then(async (res) => {
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error((b as { error?: string }).error || '取得に失敗しました');
        }
        return res.json() as Promise<{ item: BugItem }>;
      })
      .then((d) => { if (alive) setItem(d.item); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : '取得に失敗しました'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [bugId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-500 py-3">
        <Loader2 size={15} className="animate-spin" />
        BUG を読み込み中...
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-red-600 text-sm flex items-start gap-2">
        <AlertCircle size={15} className="mt-0.5 shrink-0" />
        {error}
      </div>
    );
  }
  if (!item) return null;

  const rows: [string, string][] = [
    ['No', item.no],
    ['判定', item.judgment],
    ['ステータス', item.status],
    ['テスト案件名', item.testCaseName],
    ['システム', item.system],
    ['ケース番号', item.caseNumber],
    ['モジュール', item.module],
    ['優先度', item.priority],
    ['実施日', item.execDate],
    ['Bug説明', item.bugDesc],
    ['再現ステップ', item.reproSteps],
    ['予定結果', item.expectedResult],
    ['実際結果', item.actualResult],
    ['ブラウザ / バージョン', item.browserVersion],
    ['アプリバージョン', item.appVersion],
    ['備考', item.remarks],
  ];

  return (
    <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-100 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="px-3 py-2 flex items-start gap-3">
          <span className="text-neutral-400 w-28 shrink-0">{k}</span>
          <span className={`flex-1 min-w-0 ${LONG.has(k) ? 'whitespace-pre-wrap text-neutral-800' : 'text-neutral-700'}`}>
            {v || '-'}
          </span>
        </div>
      ))}
    </div>
  );
}
