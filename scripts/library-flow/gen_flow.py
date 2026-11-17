# TestCase Library のフロー表示用データを組み立てる。
#   wreport_base       … 入口別ツリー（entry_tree.py）
#   wreport_admin_base … 管理業務・旧申込画面のツリー（admin_tree.py。書き方は entry_tree.py と同じ）
#
# 使い方（リポジトリ直下で）:
#   node scripts/library-flow/dump-combos.mjs      … Notion から combos/*.tsv を取り直す
#   python scripts/library-flow/gen_flow.py         … src/data/libraryFlows.ts と temp/ の確認用 md を出力
#   npx tsx scripts/library-flow/check.ts           … 出力データの整合チェック
#
# ノードの条件（大分類・中分類・小分類・機能名）でケースを割り当てる。遷移はケースに情報が無いため
# report_client / wreport_admin のソースから推定し、各ツリー定義に手で書いている。
import sys, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
S = os.path.join(HERE, 'combos')
OUT = os.path.join(ROOT, 'temp')
TS_OUT = os.path.join(ROOT, 'src', 'data', 'libraryFlows.ts')

sys.path.insert(0, HERE)
import entry_tree
import admin_tree


def load_rows(name):
    rows = []
    for i, l in enumerate(open(os.path.join(S, f'{name}_combos.tsv'), encoding='utf-8')):
        if i == 0:
            continue
        c, d, m, sm, f = (l.rstrip('\n').split('\t') + [''] * 5)[:5]
        rows.append((int(c), {'大': d, '中': m, '小': sm, '機': f}))
    return rows


os.makedirs(OUT, exist_ok=True)
entry = {}
for name, tabs, head in [('wreport_base', None, None), ('wreport_admin_base', admin_tree.TABS, admin_tree.HEAD)]:
    rows = load_rows(name)
    print(f'[{name}] uncovered =', entry_tree.write_draft(rows, os.path.join(OUT, f'entry_flow_{name}.md'), tabs, head))
    entry[name] = entry_tree.to_json(rows, tabs)

open(TS_OUT, 'w', encoding='utf-8', newline='\n').write(
    '// TestCase Library のフロー表示用データ。\n'
    '// scripts/library-flow/gen_flow.py で生成（手で編集しない）。\n'
    "import type { EntryTab, FlowTab } from '../utils/libraryFlow';\n\n"
    '// 大分類×中分類 を1ノードとする画面遷移図（現在は使用するシステムなし）\n'
    'export const LIBRARY_FLOWS: Record<string, FlowTab[]> = {};\n\n'
    '// システムごとのツリー（entry_tree.py / admin_tree.py）。ノードの条件でケースを割り当てる\n'
    f'export const LIBRARY_ENTRY_TREES: Record<string, EntryTab[]> = {json.dumps(entry, ensure_ascii=False, indent=1)};\n')
