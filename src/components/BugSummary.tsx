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

// 左に大きく出す項目 (長文)。ケース情報の配置と揃える
const PRIMARY: [string, keyof BugItem][] = [
  ['Bug説明', 'bugDesc'],
  ['再現ステップ', 'reproSteps'],
  ['予定結果', 'expectedResult'],
  ['実際結果', 'actualResult'],
  ['備考', 'remarks'],
];
// 右上に強調して出す項目
const HIGHLIGHT: [string, keyof BugItem][] = [
  ['判定', 'judgment'],
  ['ステータス', 'status'],
];
// 右に一覧で出す項目
const SECONDARY: [string, keyof BugItem][] = [
  ['No', 'no'],
  ['テスト案件名', 'testCaseName'],
  ['システム', 'system'],
  ['ケース番号', 'caseNumber'],
  ['モジュール', 'module'],
  ['優先度', 'priority'],
  ['実施日', 'execDate'],
  ['ブラウザ / バージョン', 'browserVersion'],
  ['アプリバージョン', 'appVersion'],
];

const JUDGMENT_COLOR: Record<string, string> = {
  NG: 'bg-red-50 text-red-700 border-red-200',
  '確認OK': 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

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

  // ケース情報と同じ配置。長文を左に大きく、付随情報を右にまとめる
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-4">
        {PRIMARY.map(([label, key]) => (
          <div key={label} className="space-y-1">
            <p className="text-xs font-bold text-neutral-700">{label}</p>
            <p className="text-sm text-neutral-800 whitespace-pre-wrap border border-neutral-200 rounded-lg p-3 bg-neutral-50 min-h-[3rem]">
              {item[key] || '-'}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {HIGHLIGHT.map(([label, key]) => (
            <div key={label} className="border border-neutral-200 rounded-lg p-3 space-y-1.5">
              <p className="text-[11px] font-semibold text-neutral-400">{label}</p>
              {label === '判定' && item[key] ? (
                <span className={`inline-block rounded-full border px-3 py-1 text-sm font-bold ${JUDGMENT_COLOR[item[key]] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200'}`}>
                  {item[key]}
                </span>
              ) : (
                <p className="text-sm font-bold text-neutral-900 break-words">{item[key] || '-'}</p>
              )}
            </div>
          ))}
        </div>

        <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-100 text-xs">
          {SECONDARY.map(([label, key]) => (
            <div key={label} className="px-3 py-2 flex items-start gap-3">
              <span className="text-neutral-400 w-24 shrink-0">{label}</span>
              <span className="text-neutral-700 flex-1 min-w-0 break-words">{item[key] || '-'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
