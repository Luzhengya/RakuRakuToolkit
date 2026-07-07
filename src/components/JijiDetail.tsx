import { ExternalLink } from 'lucide-react';
import { CAT_COLOR, toBigCategory, type JijiItem } from './jijiShared';

interface JijiDetailProps {
  item: JijiItem;
}

function catBadgeClass(raw: string): string {
  return CAT_COLOR[toBigCategory(raw)] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200';
}

export default function JijiDetail({ item }: JijiDetailProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-bold text-neutral-900">{item.title || '(無題)'}</h2>
        <p className="text-sm text-neutral-400">{item.publishedAt ? item.publishedAt.slice(0, 10) : '-'}</p>
      </div>

      {/* 本文 */}
      <section className="bg-white border border-neutral-200 rounded-xl p-6 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-700">本文</h3>
        <p className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed">
          {item.body || '本文がありません'}
        </p>
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
          >
            <ExternalLink size={14} />
            原文リンク
          </a>
        )}
      </section>

      {/* AI総括 */}
      <section className="bg-white border border-neutral-200 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-neutral-700">AI総括</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DetailField label="関連企業名" value={item.companyName} />
          <DetailField label="統一会社信用コード" value={item.creditCode} />
        </div>
        <DetailField label="関連企業概要" value={item.companyProfile} block />
        <div className="space-y-1">
          <p className="text-xs font-medium text-neutral-400">不安情報分類</p>
          {item.category.trim() ? (
            <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${catBadgeClass(item.category)}`}>
              {item.category.trim()}
            </span>
          ) : (
            <p className="text-sm text-neutral-400">-</p>
          )}
        </div>
      </section>
    </div>
  );
}

function DetailField({ label, value, block }: { label: string; value: string; block?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-neutral-400">{label}</p>
      <p className={`text-sm text-neutral-700 whitespace-pre-wrap ${block ? '' : 'break-all'}`}>
        {value?.trim() ? value : ''}
      </p>
    </div>
  );
}
