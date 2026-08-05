import { useEffect, useState } from 'react';
import { ChevronDown, Loader2, AlertCircle, Bug } from 'lucide-react';
import { type Lang } from '../i18n/testcenter';

type CaseBug = {
  id: string;
  no: string;
  priority: string;
  bugDesc: string;
  judgment: string;
  status: string;
  execDate: string;
  assignee: string;
  reproSteps: string;
  expectedResult: string;
  actualResult: string;
  caseNumber: string;
  browserVersion: string;
};

const JUDGMENT_COLOR: Record<string, string> = {
  '確認OK': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'NG': 'bg-red-50 text-red-700 border-red-200',
  'NG確認要': 'bg-orange-50 text-orange-700 border-orange-200',
  '想定以外NG': 'bg-purple-50 text-purple-700 border-purple-200',
};
const STATUS_COLOR: Record<string, string> = {
  '対応待ち': 'bg-neutral-100 text-neutral-600 border-neutral-200',
  '対応中': 'bg-blue-50 text-blue-700 border-blue-200',
  '確認中': 'bg-amber-50 text-amber-700 border-amber-200',
  '対応不要': 'bg-neutral-50 text-neutral-500 border-neutral-200',
  '対応完了': 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
function badge(value: string, palette: Record<string, string>): string {
  return palette[value] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200';
}
function fmtDate(value: string): string {
  return value ? value.slice(0, 10) : '-';
}

const GRID = '64px 130px minmax(0,1fr) 120px 120px 40px';

// caseId 単位のキャッシュ (案件切替時の重複リクエスト回避)
const cache = new Map<string, CaseBug[]>();

function Field({ label, value, pre }: { label: string; value: string; pre?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-neutral-400">{label}</p>
      <p className={`text-sm text-neutral-700 ${pre ? 'whitespace-pre-wrap' : ''}`}>{value || '-'}</p>
    </div>
  );
}

export default function CaseBugList({ caseId, lang }: { caseId: string; lang: Lang }) {
  const zh = lang === 'zh';
  const L = {
    title: zh ? '关联BUG一览' : '関連バグ一覧',
    no: 'NO',
    caseNo: zh ? '案例编号' : 'ケース番号',
    desc: zh ? 'BUG概要' : 'BUG説明',
    judg: zh ? '判定' : '判定',
    status: zh ? '状态' : 'ステータス',
    priority: zh ? '优先度' : '優先度',
    repro: zh ? '重现步骤' : '再現ステップ',
    expected: zh ? '预期结果' : '予定結果',
    actual: zh ? '实际结果' : '実際結果',
    browser: zh ? '浏览器 / 版本' : 'ブラウザ・バージョン',
    date: zh ? '实施日' : '実施日',
    assignee: zh ? '实施者' : '実施者',
    empty: zh ? '没有关联的BUG' : '関連バグはありません',
    loading: zh ? '加载中...' : '読み込み中...',
    unit: zh ? '件' : '件',
  };

  const [items, setItems] = useState<CaseBug[]>(() => cache.get(caseId) ?? []);
  const [loading, setLoading] = useState(!cache.has(caseId));
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setOpenId(null);
    if (cache.has(caseId)) {
      setItems(cache.get(caseId)!);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/test-center/bugs/by-case/${caseId}`)
      .then(async (res) => {
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error((b as { error?: string }).error || (zh ? '获取失败' : '取得失敗'));
        }
        return res.json();
      })
      .then((data) => {
        if (!alive) return;
        const list = (data.items ?? []) as CaseBug[];
        cache.set(caseId, list);
        setItems(list);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : zh ? '获取失败' : '取得失敗');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));

  return (
    <section className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <Bug size={16} className="text-neutral-500" />
        <h3 className="text-sm font-bold text-neutral-800">{L.title}</h3>
        {!loading && !error && (
          <span className="text-xs text-neutral-400 tabular-nums">{items.length}{L.unit}</span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-neutral-400 flex items-center gap-2 py-4">
          <Loader2 size={14} className="animate-spin" />
          {L.loading}
        </p>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 flex items-center gap-2 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-400 py-4">{L.empty}</p>
      ) : (
        <div className="border border-neutral-200 rounded-lg overflow-hidden">
          <div
            className="grid bg-neutral-50/80 border-b border-neutral-200 text-xs font-medium text-neutral-500"
            style={{ gridTemplateColumns: GRID }}
          >
            <div className="px-3 py-2.5">{L.no}</div>
            <div className="px-3 py-2.5">{L.caseNo}</div>
            <div className="px-3 py-2.5">{L.desc}</div>
            <div className="px-3 py-2.5">{L.judg}</div>
            <div className="px-3 py-2.5">{L.status}</div>
            <div />
          </div>

          {items.map((bug) => {
            const isOpen = openId === bug.id;
            return (
              <div key={bug.id} className="border-b border-neutral-100 last:border-b-0">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(bug.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle(bug.id);
                    }
                  }}
                  className={`grid items-center cursor-pointer transition-colors ${isOpen ? 'bg-neutral-50' : 'bg-white hover:bg-neutral-50/60'}`}
                  style={{ gridTemplateColumns: GRID }}
                >
                  <div className="px-3 py-3 text-xs font-semibold text-blue-600 tabular-nums">{bug.no || '-'}</div>
                  <div className="px-3 py-3 text-xs text-neutral-500 truncate" title={bug.caseNumber}>{bug.caseNumber || '-'}</div>
                  <div className="px-3 py-3 text-sm text-neutral-800 truncate" title={bug.bugDesc}>{bug.bugDesc || '-'}</div>
                  <div className="px-3 py-3">
                    {bug.judgment ? (
                      <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge(bug.judgment, JUDGMENT_COLOR)}`}>{bug.judgment}</span>
                    ) : '-'}
                  </div>
                  <div className="px-3 py-3">
                    {bug.status ? (
                      <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge(bug.status, STATUS_COLOR)}`}>{bug.status}</span>
                    ) : '-'}
                  </div>
                  <div className="flex items-center justify-center text-neutral-400">
                    <ChevronDown size={16} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                  </div>
                </div>

                {isOpen && (
                  <div className="bg-neutral-50/60 border-t border-neutral-100 px-5 py-4 space-y-4">
                    <div className="border border-neutral-200 rounded-lg bg-white overflow-hidden">
                      <div className="px-4 py-3 border-b border-neutral-100">
                        <Field label={L.repro} value={bug.reproSteps} pre />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-neutral-100">
                        <div className="px-4 py-3"><Field label={L.expected} value={bug.expectedResult} /></div>
                        <div className="px-4 py-3"><Field label={L.actual} value={bug.actualResult} /></div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <Field label={L.priority} value={bug.priority} />
                      <Field label={L.date} value={fmtDate(bug.execDate)} />
                      <Field label={L.assignee} value={bug.assignee} />
                      <Field label={L.browser} value={bug.browserVersion} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
