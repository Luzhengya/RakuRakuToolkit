interface DailyNewsProps {
  onBack: () => void;
}

export default function DailyNews({ onBack }: DailyNewsProps) {
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
      <span className="text-neutral-900 font-medium">毎日ニュース</span>
    </nav>
  );

  return (
    <div className="space-y-6">
      {breadcrumb}

      <div className="flex items-center justify-center py-20 text-neutral-400 text-sm">
        毎日ニュース — 開発中
      </div>

      <div className="pt-4 border-t border-neutral-200">
        {breadcrumb}
      </div>
    </div>
  );
}
