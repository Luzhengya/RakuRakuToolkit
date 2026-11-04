# TestCase Library のフロー表示用データを、ケースの「大分類×中分類」から組み立てる。
#
# 使い方（リポジトリ直下で）:
#   node scripts/library-flow/dump-combos.mjs      … Notion から combos/*.tsv を取り直す
#   python scripts/library-flow/gen_flow.py         … src/data/libraryFlows.ts と temp/ の確認用 md/HTML を出力
#   npx tsx scripts/library-flow/check.ts           … 出力データの整合チェック
#
# ノード＝大分類×中分類。共通タブ＋商品(大分類)ごとのタブ。遷移（矢印）はケースに情報が無いため
# report_client / wreport_admin のソースと既存 system_flow.md から推定し、下の各関数に手で書いている。
# 新しい 大分類×中分類 が増えたら、商品タブは role() の判定で自動配置される。共通の画面は base_common / admin_common に追記する。
import sys, re, json, collections, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
S = os.path.join(HERE, 'combos')
OUT = os.path.join(ROOT, 'temp')
TS_OUT = os.path.join(ROOT, 'src', 'data', 'libraryFlows.ts')


def load(n):
    cnt = collections.Counter()
    for i, l in enumerate(open(f'{S}/{n}_combos.tsv', encoding='utf-8')):
        if i == 0:
            continue
        c, a, b = l.rstrip('\n').split('\t')[:3]
        cnt[(a, b)] += int(c)
    return cnt


# ── 役割の判定（商品タブ用） ─────────────────────────────
def role(chu):
    if '以前の入力フォーム' in chu:
        return 'S1OLD'
    if '調査対象先入力' in chu:
        return 'S1'
    if '貴社連絡先' in chu:
        return 'S2'
    if '外部直接遷移' in chu:
        return 'S3EXT'
    if chu.startswith('お申し込み内容の確認'):
        return 'S3'
    if chu.startswith('お申し込み完了'):
        return 'S4'
    if chu.startswith('信用調査サービスメニュー') or chu == 'リスモン信用調査サービス':
        return 'MENU'
    if 'その他詳細' in chu or 'サービスについて' in chu:
        return 'DETAIL'
    if chu.startswith('信用調書管理ファイル'):
        return 'FILE'
    if chu == '信用調書申込履歴':
        return 'RIREKI'
    if chu == '信用調書管理':
        return 'KANRI'
    if chu == 'CSVインポート':
        return 'CSV'
    return None


# 商品タブの申込チェーン。存在しない段は 共通 の同じ段を点線ノードで補う
CHAIN = ['MENU', 'S1', 'S2', 'S3', 'S4']
STEP_LABEL = {'MENU': '', 'S1': 'Step1', 'S2': 'Step2', 'S3': 'Step3', 'S4': 'Step4'}


class Tab:
    def __init__(self, title):
        self.title = title
        self.nodes = {}      # id -> (大, 中, shared)
        self.groups = collections.OrderedDict()  # group title -> [ids]
        self.edges = []      # (a, b, label, dotted)

    def node(self, nid, dai, chu, group=None, shared=False):
        self.nodes[nid] = (dai, chu, shared)
        self.groups.setdefault(group, []).append(nid)
        return nid

    def edge(self, a, b, label='', dotted=False):
        if a in self.nodes and b in self.nodes and a != b:
            self.edges.append((a, b, label, dotted))


def mermaid(tab, cnt, direction='TD'):
    out = [f'flowchart {direction}']
    ids = {}
    for i, nid in enumerate(tab.nodes):
        ids[nid] = nid

    def decl(nid):
        dai, chu, shared = tab.nodes[nid]
        n = cnt.get((dai, chu), 0)
        lab = chu if not shared else f'［共通］{chu}'
        return f'    {nid}["{lab}<br>{n}件"]'
    gi = 0
    for g, members in tab.groups.items():
        if g is None:
            out += [decl(m) for m in members]
        else:
            gi += 1
            out.append(f'    subgraph G{gi}["{g}"]')
            out += ['    ' + decl(m) for m in members]
            out.append('    end')
    for a, b, lab, dotted in tab.edges:
        arrow = '-.->' if dotted else '-->'
        out.append(f'    {a} {arrow}{"|" + lab + "|" if lab else ""} {b}')
    for nid, (dai, chu, shared) in tab.nodes.items():
        if shared:
            out.append(f'    style {nid} fill:#f3f3f3,stroke:#999,stroke-dasharray:4 3')
        elif role(chu) in ('MENU',) or chu in ('メニュー', 'ログイン'):
            out.append(f'    style {nid} fill:#c5d9f1,stroke:#5b9bd5')
        elif role(chu) in CHAIN or role(chu) in ('S1OLD', 'S3EXT'):
            out.append(f'    style {nid} fill:#fbd5b5,stroke:#e6a56c')
    return '\n'.join(out)


def product_tabs(cnt, common_role_node, extra=None):
    """大分類ごとのタブ。common_role_node: role -> 共通の中分類"""
    tabs = []
    prods = sorted({d for d, _ in cnt if d != '共通'})
    for p in prods:
        t = Tab(p)
        chus = [c for d, c in cnt if d == p]
        by_role = collections.defaultdict(list)
        others = []
        for c in chus:
            r = role(c)
            (by_role[r].append(c) if r else others.append(c))
        nid = {}
        k = 0

        def add(c, group, shared=False):
            nonlocal k
            k += 1
            i = f'n{k}'
            t.node(i, '共通' if shared else p, c, group, shared)
            return i
        user_g = '申込画面' if 'KANRI' in by_role or 'RIREKI' in by_role else None
        # 申込チェーン
        prev = None
        for r in CHAIN:
            ids = [add(c, user_g) for c in by_role.get(r, [])]
            if not ids and r in common_role_node and (prev or r == 'MENU'):
                # 後続の段が商品側にあるときだけ共通で補う
                later = any(by_role.get(x) for x in CHAIN)
                if later:
                    ids = [add(common_role_node[r], user_g, shared=True)]
            for i in ids:
                if prev:
                    for pi in prev:
                        t.edge(pi, i, STEP_LABEL[r])
            if r == 'S1':
                for c in by_role.get('S1OLD', []):
                    o = add(c, user_g)
                    for i in ids:
                        t.edge(i, o, '以前の入力フォーム', dotted=True)
                    nid.setdefault('S1OLD', []).append(o)
            if r == 'S3':
                for c in by_role.get('S3EXT', []):
                    o = add(c, user_g)
                    for i in ids or []:
                        t.edge(o, i, '外部直接遷移', dotted=True)
            if ids:
                nid[r] = ids
                if r == 'S2':
                    for o in nid.get('S1OLD', []):
                        for i in ids:
                            t.edge(o, i)
                prev = ids
        menu = nid.get('MENU', [])
        for c in by_role.get('DETAIL', []):
            i = add(c, user_g)
            for m in menu:
                t.edge(m, i, 'その他詳細', dotted=True)
        files = by_role.get('FILE', [])
        if files and not menu:
            menu = [add(common_role_node['MENU'], user_g, shared=True)]
        for c in files:
            i = add(c, user_g)
            for m in menu:
                t.edge(m, i)
        # 管理DB側
        g = '管理画面'
        kanri = [add(c, g) for c in by_role.get('KANRI', [])]
        rireki = [add(c, g) for c in by_role.get('RIREKI', [])]
        csv = [add(c, g) for c in by_role.get('CSV', [])]
        if csv and not rireki:
            rireki = [add('信用調書申込履歴', g, shared=True)]
        for a in rireki:
            for b in kanri + csv:
                t.edge(a, b)
        rest = []
        for c in others:
            rest.append((c, add(c, g if (kanri or rireki) else None)))
        if extra and p in extra:
            extra[p](t, collections.defaultdict(lambda: None, rest), kanri, menu)
        else:
            for c, i in rest:
                for a in kanri:
                    t.edge(a, i)
        tabs.append(t)
    return tabs


def check(tabs, cnt, name):
    seen = collections.Counter()
    for t in tabs:
        for dai, chu, shared in t.nodes.values():
            if not shared:
                seen[(dai, chu)] += 1
    missing = [k for k in cnt if k not in seen]
    dup = [k for k, v in seen.items() if v > 1]
    ghost = [k for t in tabs for k in [(d, c) for d, c, _ in t.nodes.values()] if k not in cnt]
    isolated = []
    for t in tabs:
        linked = {a for a, *_ in t.edges} | {b for _, b, *_ in t.edges}
        isolated += [(t.title, t.nodes[n][1]) for n in t.nodes if n not in linked and len(t.nodes) > 1]
    print(f'[{name}] tabs={len(tabs)} nodes={sum(len(t.nodes) for t in tabs)} missing={missing} dup={dup} ghost={ghost}')
    print(f'[{name}] isolated={isolated}')
    return isolated


# ════ wreport_base ════════════════════════════════════════════
def base_common(cnt):
    t = Tab('共通（主干）')
    C = lambda i, c, g=None: t.node(i, '共通', c, g)
    C('entry', '入口画面（テスト用ログイン入口）', '入口')
    C('jLimo', '連携ジャンプ（LIMO）', '入口')
    C('jRm', '連携ジャンプ（RM会員・非会員）', '入口')
    C('jFna', '連携ジャンプ（FNA）', '入口')
    C('jS3', '連携ジャンプ（Step3直接遷移）', '入口')
    C('menu', '信用調査サービスメニュー')
    C('s1', '調査対象先入力およびレポート種類決定', '申込（共通画面）')
    C('s2a', '貴社連絡先の入力', '申込（共通画面）')
    C('s2b', 'お申し込み（貴社連絡先の入力）', '申込（共通画面）')
    C('s3', 'お申し込み内容の確認', '申込（共通画面）')
    C('s4', 'お申し込み完了', '申込（共通画面）')
    C('file', '信用調書管理ファイル')
    C('fileOs', '信用調書管理ファイル（海外）')
    C('pdf', 'PDFが表示されない場合')
    C('seme', '中国企業攻めモン')
    C('semeD', '中国企業攻めモン（企業詳細）')
    C('compl', '簡易版コンプラチェック')
    C('guard', '画面遷移ガード', 'エラー・ガード')
    C('err', 'エラー画面', 'エラー・ガード')
    C('errRm', 'エラー画面（RM会員）', 'エラー・ガード')
    C('e404', '404画面', 'エラー・ガード')
    for i, c in [('hdr', '共通ヘッダ'), ('ftr', '共通フッタ'), ('exjHdr', 'exj共通レイアウト（ヘッダ）'),
                 ('step', '共通部品（ステップ表示）'), ('title', '共通部品（タイトルバー）'),
                 ('inPart', '申込入力画面（共通部品）'), ('cfPart', '申込確認画面（共通部品）')]:
        C(i, c, '共通部品（全画面に配置）')
    for i, c in [('srv', 'サーバ共通処理'), ('net', '通信共通処理'), ('sess', 'セッション管理')]:
        C(i, c, '非画面（処理）')
    for j in ['jLimo', 'jRm', 'jFna', 'jS3']:
        t.edge('entry', j)
    for j in ['jLimo', 'jRm', 'jFna']:
        t.edge(j, 'menu', 'SSO')
    t.edge('jS3', 's3', '直接遷移')
    t.edge('menu', 's1', 'Step1')
    t.edge('s1', 's2a', 'Step2')
    t.edge('s1', 's2b', 'Step2')
    t.edge('s2a', 's3', 'Step3')
    t.edge('s2b', 's3', 'Step3')
    t.edge('s3', 's4', 'Step4')
    t.edge('menu', 'file')
    t.edge('menu', 'fileOs', '非会員')
    t.edge('file', 'pdf', dotted=True)
    t.edge('menu', 'seme')
    t.edge('seme', 'semeD')
    t.edge('menu', 'compl')
    t.edge('s1', 'inPart', dotted=True)
    t.edge('s3', 'cfPart', dotted=True)
    t.edge('guard', 'err', '不正遷移')
    t.edge('menu', 'hdr', dotted=True)
    t.edge('hdr', 'ftr', dotted=True)
    t.edge('hdr', 'exjHdr', dotted=True)
    t.edge('hdr', 'title', dotted=True)
    t.edge('inPart', 'step', dotted=True)
    t.edge('err', 'errRm', dotted=True)
    t.edge('err', 'e404', dotted=True)
    t.edge('srv', 'net', dotted=True)
    t.edge('net', 'sess', dotted=True)
    return t


def base_extra():
    def fuan(t, rest, kanri, menu):
        t.edge(rest['中国企業不安情報（検索）'], rest['中国企業不安情報（詳細）'])
        t.edge(rest['中国企業不安情報（詳細）'], rest['信用調書管理ファイル'], '変動通知ボタン', dotted=True) if '信用調書管理ファイル' in rest else None

    def seme(t, rest, kanri, menu):
        k = [c for c in rest if '企業検索' in c][0]
        for c, i in rest.items():
            if c != k:
                t.edge(rest[k], i)

    def hendo(t, rest, kanri, menu):
        info = rest['変動通知情報（信用調書管理ファイル）']
        t.edge(info, rest['変動通知申込（お申し込み内容の確認）'], '申込')
        t.edge(rest['変動通知申込（お申し込み内容の確認）'], rest['変動通知申込完了（お申し込み完了）'])
        t.edge(info, rest['変動通知再開（お申し込み内容の確認）'], '再開')
        t.edge(info, rest['変動通知メール受信設定（全社適用）'], dotted=True)
        t.edge(rest['変動通知申込（お申し込み内容の確認）'], rest['サーバAPI（/apply/monitor）'], 'API', dotted=True)
    return {'中国企業不安情報': fuan, '中国企業攻めモン': seme, '中国日系企業攻めモン': seme, '変動通知': hendo}


# ════ wreport_admin_base ══════════════════════════════════════
def admin_common(cnt):
    t = Tab('共通（主干）')
    C = lambda i, c, g=None: t.node(i, '共通', c, g)
    G1, G2 = '管理DB（/inner）', '利用者向け申込画面（/apply, /J_apply）'
    for i, c in [('login', 'ログイン'), ('pw', 'パスワード再発行'), ('jlogin', 'ログイン遷移画面（innerJumpLogin）'),
                 ('menu', 'メニュー'), ('kanri', '信用調書管理'), ('detail', '信用調書申込内容詳細情報'),
                 ('past', '申込管理詳細（過去の調査案件一覧）'), ('hist', '信用調書管理更新履歴'),
                 ('eval', '評価詳細情報'), ('evalU', '評価詳細（利用者）'), ('data', '調書データ詳細情報表示'),
                 ('xml1', '評価XML ファイル アップロード（ダイアログ）'), ('xml2', '評価XML/HTML ファイル アップロード（ダイアログ）'),
                 ('member', '会員検索ダイアログ'), ('youbou', '調書要望画面（統一format）'), ('toc', '調書PDF（目次付き出力）'),
                 ('hyoka', '調書評価書（PDF帳票）'), ('pdfp', 'PDFページ画面'), ('rireki', '信用調書申込履歴'),
                 ('csv', 'CSVインポート'), ('month', '月次チェック項目'), ('confirm', '信用調書管理再鑑待ち一覧'),
                 ('limit', '限度額設定'), ('limitN', '限度額設定（数値設定画面）'), ('staff', 'スタッフ管理'),
                 ('staffNew', 'スタッフ新規作成'), ('staffD', 'スタッフ情報詳細'), ('staffC', 'スタッフ情報変更'),
                 ('db', 'DB管理画面')]:
        C(i, c, G1)
    for i, c in [('ix22', 'テスト用入口（index22.html）'), ('ix33', 'テスト用入口（index33.html）'), ('ix34', 'テスト用入口（index34.html）'),
                 ('auth', '認証連携（encrypt/decrypt）'), ('umenu', '信用調査サービスメニュー'),
                 ('s1a', '調査対象先入力およびレポート種類決定'), ('s1b', 'お申し込み（調査対象先入力およびレポート種類決定）'),
                 ('s1old', 'お申し込み（以前の入力フォーム）'), ('s2a', '貴社連絡先の入力'), ('s2b', 'お申し込み（貴社連絡先の入力）'),
                 ('s3', 'お申し込み内容の確認'), ('s4', 'お申し込み完了'), ('ufile', '信用調書管理ファイル'),
                 ('updf', 'PDFが表示されない場合'), ('kaniPdf', '中国簡易ナビ調書PDF'), ('useme', '中国企業攻めモン'),
                 ('asp', '海外（中国）企業一覧（asp_Detail）'), ('udet', 'RM中国企業情報ナビ その他詳細')]:
        C(i, c, G2)
    for i, c in [('errP', 'エラーページ'), ('e1', 'エラー画面（error.html）'), ('e404', 'エラー画面（error404.html）'),
                 ('e418', 'エラー画面（error418.html）'), ('e500', 'エラー画面（error500.html）'), ('dle', 'ダウンロードエラー画面'),
                 ('dleJ', 'ダウンロードエラー画面（J）'), ('dleD', 'ダウンロードエラー画面（詳細）')]:
        C(i, c, 'エラー画面')
    for i, c in [('acl', '共通（ログインチェック・アクセス制御）'), ('exc', '共通（例外処理）'), ('lang', '言語切替'),
                 ('pdfhf', 'PDF共通ヘッダ・フッタ')]:
        C(i, c, '非画面・共通部品')
    E = t.edge
    E('login', 'menu'); E('login', 'pw', dotted=True); E('jlogin', 'menu')
    for x in ['kanri', 'rireki', 'confirm', 'limit', 'staff', 'db', 'month']:
        E('menu', x)
    E('rireki', 'kanri', '詳細'); E('rireki', 'csv', 'CSVインポート'); E('confirm', 'kanri', '選択')
    for x in ['detail', 'past', 'hist', 'eval', 'data', 'xml1', 'xml2', 'member', 'youbou', 'toc', 'hyoka', 'pdfp']:
        E('kanri', x)
    E('eval', 'evalU'); E('limit', 'limitN'); E('staff', 'staffNew'); E('staff', 'staffD'); E('staffD', 'staffC')
    for x in ['ix22', 'ix33', 'ix34']:
        E(x, 'auth')
    E('auth', 'umenu', 'SSO')
    E('umenu', 's1a', 'Step1'); E('umenu', 's1b', 'Step1'); E('s1b', 's1old', '以前の入力フォーム', dotted=True)
    for a in ['s1a', 's1b', 's1old']:
        for b in ['s2a', 's2b']:
            E(a, b, 'Step2' if a != 's1old' else '')
    E('s2a', 's3', 'Step3'); E('s2b', 's3', 'Step3'); E('s3', 's4', 'Step4')
    E('umenu', 'ufile'); E('ufile', 'updf', dotted=True); E('ufile', 'kaniPdf', dotted=True)
    E('umenu', 'useme'); E('useme', 'asp'); E('umenu', 'udet', 'その他詳細', dotted=True)
    E('errP', 'e1', dotted=True); E('e1', 'e404', dotted=True); E('e1', 'e418', dotted=True); E('e1', 'e500', dotted=True)
    E('dle', 'dleJ', dotted=True); E('dle', 'dleD', dotted=True)
    E('acl', 'errP', 'NG'); E('exc', 'e500', dotted=True); E('lang', 'pdfhf', dotted=True)
    return t


def admin_extra():
    def to_kanri(t, rest, kanri, menu):
        for c, i in rest.items():
            src = kanri or menu
            for a in src:
                t.edge(a, i)

    def fuan(t, rest, kanri, menu):
        a = rest['中国企業不安情報-企業情報']
        t.edge(a, rest['中国企業不安情報-企業情報詳細'])
        t.edge(a, rest['中国企業不安情報-データ更新'], 'CSV取込')
        t.edge(a, rest['不安情報'], 'API', dotted=True)

    def nikkei(t, rest, kanri, menu):
        a = rest['中国日系企業DB-企業情報']
        t.edge(a, rest['中国日系企業DB-企業情報詳細'])
        t.edge(a, rest['中国日系企業DB-データ更新'], 'CSV取込')

    def seme(t, rest, kanri, menu):
        t.edge(rest['中国企業攻めモン'], rest['中国企業攻めモン（企業詳細情報）'])
        for m in menu:
            t.edge(m, rest['中国企業攻めモン'])

    def hendo(t, rest, kanri, menu):
        for a in kanri:
            t.edge(a, rest['モニタリング情報'])

    def kani(t, rest, kanri, menu):
        for a in kanri:
            t.edge(a, rest['申込管理詳細画面'])
            t.edge(a, rest['中国簡易ナビ調書要望画面'])
        t.edge(rest['中国簡易ナビ調書要望画面'], rest['中国簡易ナビ調書PDF'])
        for a in kanri:
            t.edge(a, rest['調書データ詳細情報表示'])
            t.edge(a, rest['信用調書申込内容詳細情報'])

    def chugoku(t, rest, kanri, menu):
        for a in kanri:
            t.edge(a, rest['申込管理一覧画面'])
        t.edge(rest['申込管理一覧画面'], rest['申込管理詳細画面'])
        for x in ['信用調書申込内容詳細情報', '評価詳細情報', '調書データ詳細情報表示', '調書要望画面（統一format）', '調書要望画面（統一format2）']:
            for a in kanri:
                t.edge(a, rest[x])
        t.edge(rest['調書要望画面（統一format）'], rest['調書PDF（目次付き出力）'])
        t.edge(rest['調書要望画面（統一format）'], rest['PDFページ画面'])
    return {'中国企業不安情報': fuan, '中国日系企業攻めモン': nikkei, '中国企業攻めモン': seme, '変動通知': hendo,
            '中国企業簡易情報ナビ': kani, '中国信用調書（RM格付有）': chugoku}


def render(name, title, common, prod_tabs, cnt, desc):
    tabs = [common] + prod_tabs
    check(tabs, cnt, name)
    md = [f'# {title} 画面遷移図（ケース準拠・初稿）', '', desc, '']
    for i, t in enumerate(tabs):
        md += [f'### {i}. {t.title}', '', '```mermaid', mermaid(t, cnt), '```', '']
    open(f'{OUT}/case_flow_{name}.md', 'w', encoding='utf-8').write('\n'.join(md))
    return tabs


DESC = ('- ノード＝ケースの「大分類×中分類」。ノード内の件数はそのノードに紐づくケース数（2026-11-04 時点）。\n'
        '- タブ0「共通（主干）」は 大分類=共通 の画面。商品タブで商品側に画面が無い段は、灰色点線の［共通］ノードで補っている。\n'
        '- 遷移（矢印）はケースに情報が無いため、ソースコードと既存 system_flow.md から推定。点線＝補助遷移・付属関係。')

os.makedirs(OUT, exist_ok=True)
bc = load('wreport_base')
base_cr = {'MENU': '信用調査サービスメニュー', 'S1': '調査対象先入力およびレポート種類決定', 'S2': 'お申し込み（貴社連絡先の入力）',
           'S3': 'お申し込み内容の確認', 'S4': 'お申し込み完了'}
bt = render('wreport_base', '海外調書利用者システム', base_common(bc), product_tabs(bc, base_cr, base_extra()), bc, DESC)
ac = load('wreport_admin_base')
admin_cr = dict(base_cr, S1='お申し込み（調査対象先入力およびレポート種類決定）')
at = render('wreport_admin_base', '海外調書管理システム', admin_common(ac), product_tabs(ac, admin_cr, admin_extra()), ac, DESC)

# 確認用 HTML（mermaid CDN）
html = ['<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>Case Flow Preview</title>',
        '<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>',
        '<style>body{font-family:sans-serif;margin:16px}h2{border-bottom:2px solid #333;margin-top:40px}h3{margin-top:28px}.mermaid{overflow-x:auto}</style>',
        '</head><body><h1>ケース準拠 画面遷移図（初稿プレビュー）</h1>']
for name, title, tabs, cnt in [('wreport_base', '海外調書利用者システム', bt, bc), ('wreport_admin_base', '海外調書管理システム', at, ac)]:
    html.append(f'<h2>{title}（{name}）</h2>')
    for i, t in enumerate(tabs):
        html.append(f'<h3>{i}. {t.title}</h3><pre class="mermaid">{mermaid(t, cnt)}</pre>')
html.append('<script>mermaid.initialize({startOnLoad:true,securityLevel:"loose",flowchart:{useMaxWidth:false}});</script></body></html>')
open(f'{OUT}/case_flow_preview.html', 'w', encoding='utf-8').write('\n'.join(html))


# ── アプリ用データ（src/data/libraryFlows.ts） ─────────────────
def tab_json(t):
    groups = [{'title': g, 'nodes': [dict(id=n, dai=t.nodes[n][0], chu=t.nodes[n][1], **({'shared': True} if t.nodes[n][2] else {}))
                                     for n in ms]} for g, ms in t.groups.items()]
    return {'title': t.title, 'groups': groups,
            'edges': [[a, b, lab, *([True] if d else [])] for a, b, lab, d in t.edges]}


data = {'wreport_base': [tab_json(t) for t in bt], 'wreport_admin_base': [tab_json(t) for t in at]}
J = lambda o: json.dumps(o, ensure_ascii=False)
lines = ['{']
for sysname, tabs in data.items():
    lines.append(f'  {J(sysname)}: [')
    for t in tabs:
        lines.append(f'    {{ title: {J(t["title"])}, groups: [')
        for g in t['groups']:
            lines.append(f'      {{ title: {J(g["title"])}, nodes: [')
            lines += [f'        {J(n)},' for n in g['nodes']]
            lines.append('      ] },')
        lines.append('    ], edges: [')
        lines += [f'      {J(e)},' for e in t['edges']]
        lines.append('    ] },')
    lines.append('  ],')
lines.append('}')
body = chr(10).join(lines)
open(TS_OUT, 'w', encoding='utf-8', newline='\n').write(
    '// TestCase Library のフロー表示用データ（ケースの 大分類×中分類 を1ノードとする画面遷移図）。\n'
    '// scripts/library-flow/gen_flow.py で生成（手で編集しない）。遷移（edges）はケースに情報が無いため、ソースと既存 system_flow.md から推定。\n'
    "import type { FlowTab } from '../utils/libraryFlow';\n\n"
    f'export const LIBRARY_FLOWS: Record<string, FlowTab[]> = {body};\n')
