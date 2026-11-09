# 利用者システム（wreport_base）の入口別フロー（ツリー）定義。gen_flow.py から読み込む。
# case の大分類は「商品【入口】」「共通【入口】」「共通」「開発確認用」。入口は大分類の【】で決まる。
# ノード：label / own=条件 / com=共通側の条件（件数を「n件＋共通m件」で出す） / fn=画面内の機能・遷移 / rest / kids
# 条件 dict のキー：列（大 中 小 機）＋演算子。演算子なし＝完全一致、~ ＝含む、^ ＝前方一致、$ ＝後方一致、
#   !~ ＝「|」区切りのどれも含まない。$ は「A または B」の未確定値（修正案の貼り付け）には当てない
# ノードのケース = 条件に当たるケース − 直下の子が持つケース（own・com とも）。
#   rest ノードは兄弟の機能ノード分も除く（画面＝残り）
import collections


def hit(r, rule):
    for k, v in rule.items():
        x, op = r[k[0]], k[1:]
        if op == '~':
            if v not in x: return False
        elif op == '^':
            if not x.startswith(v): return False
        elif op == '$':
            if not x.endswith(v) or ' または ' in x: return False
        elif op == '!~':
            if any(w in x for w in v.split('|')): return False
        elif x != v:
            return False
    return True


def N(label, own=(), com=(), kids=(), fn=False, note='', rest=False):
    return {'label': label, 'own': list(own), 'com': list(com), 'kids': list(kids), 'fn': fn, 'note': note, 'rest': rest}


def F(label, own=(), com=(), kids=(), note=''):
    return N(label, own=own, com=com, kids=kids, fn=True, note=note)


def C(**kw):
    """キーワード引数で演算子つきキーを書くための別名（小c=小~, 機c=機~, 大s=大$ など）"""
    alias = {'c': '~', 'p': '^', 's': '$', 'n': '!~'}
    return {(k[0] + alias[k[1:]] if k[1:] in alias else k): v for k, v in kw.items()}


S1 = 'お申し込み（調査対象先入力およびレポート種類決定）'
OLD = 'お申し込み（調査対象先入力およびレポート種類決定）（以前の入力フォーム）'
S2 = 'お申し込み（貴社連絡先の入力）'
S3 = 'お申し込み内容の確認'
S4 = 'お申し込み完了'
MENU = '信用調査サービスメニュー'
KANRI = '信用調書管理ファイル'


def P(prod, ent):
    return f'{prod}【{ent}】'


# ── 申込チェーン（商品ノード配下） ──────────────────────
def chain(prod, ent, s1_fns=(), old_fns=(), s1_com=(), old_com=(), s2_com=(), s3_com=(), s4_com=(), detail=False):
    """商品：Step1→2→3→4、旧の申込画面→2→3→4、その他詳細"""
    p = P(prod, ent)
    ce = P('共通', ent)

    def tail():
        s4 = N(S4, own=[C(大=p, 中=S4)], com=[C(大=ce, 中=S4)] + list(s4_com))
        s3 = N(S3, own=[C(大=p, 中=S3)], com=[C(大=ce, 中=S3, 機n='外部連携')] + list(s3_com), kids=[s4])
        return N(S2, own=[C(大=p, 中=S2)], com=[C(大=ce, 中=S2)] + list(s2_com), kids=[s3])

    remind = F('リマインダーメールからの再申込', own=[C(大=p, 機c='リマインダーメール')], com=[C(大=ce, 中=S1, 機c='リマインダーメール')])
    reapply = F('再申込（信用調書管理ファイルから）', own=[C(大=p, 中=S1, 機c='再申込', 機n='リマインダー')],
                com=[C(大=ce, 中=S1, 機c='再申込', 機n='リマインダー')])
    s1 = N(S1, own=[C(大=p, 中=S1), C(大=p, 機c='申込（調査対象先入力）')],
           com=[C(大=ce, 中=S1, 機n='以前の入力フォーム|再申込|リマインダー')] + list(s1_com),
           kids=[remind, reapply] + list(s1_fns) + [tail()])
    kids = [s1, N('旧の申込画面（以前の入力フォーム）', own=[C(大=p, 中=OLD)],
                  com=[C(大=ce, 中=S1, 機c='以前の入力フォーム')] + list(old_com), kids=list(old_fns) + [tail()])]
    if detail:
        kids.append(N('その他詳細', own=[C(大=p, 中s='その他詳細')]))
    return kids


def product(label, prod, ent, **kw):
    """TOP の商品欄（大分類=商品【入口】 の 信用調査サービスメニュー）と、その下の申込チェーン"""
    return N(label, own=[C(大=P(prod, ent), 中=MENU)], kids=chain(prod, ent, **kw))


def kanri(ent, com_kanri=True, extra=()):
    """信用調書管理ファイル：検索＝画面の残り、機能＝履歴一括出力・ファイル一括出力・再申込 ほか"""
    ce = P('共通', ent)
    base = C(大=ce, 中=KANRI)
    cbase = C(大='共通', 中=KANRI)
    com = lambda **kw: [dict(cbase, **C(**kw))] if com_kanri else []
    return N(KANRI, kids=[
        N('検索', own=[base], com=[cbase] if com_kanri else [], rest=True,
          note='信用調書管理ファイル画面のうち、右の機能に当たらないケース'),
        F('履歴一括出力', own=[dict(base, **C(小c='履歴一括出力'))], com=com(小c='履歴一括出力')),
        F('ファイル一括出力', own=[dict(base, **C(小c='ファイル一括出力'))], com=com(小c='ファイル一括出力')),
        F('再申込', own=[C(大s=f'【{ent}】', 中=KANRI, 機c='再申込')], com=com(小c='再申込')),
        F('メール・連携リンクからの遷移', own=[dict(base, **C(機c='からの遷移'))]),
    ] + list(extra))


def header(ent, extra=()):
    return N(f'共通ヘッダ（{ent}）', own=[C(大=P('共通', ent), 中='共通ヘッダ')], kids=list(extra))


def errors(ent):
    return N(f'エラー画面（{ent}）', own=[C(大=P('共通', ent), 中='エラー画面')])


# ════ 利墨 ════
LMC = P('共通', '利墨')
LM_S1_COM = [C(大=LMC, 中='申込入力画面')]
lm_kaigai_fns = [
    F('企業検索', own=[C(大=P('海外信用調書', '利墨'), 機c='（企業検索）')]),
    F('企業情報資料アップロード', own=[C(大=P('海外信用調書', '利墨'), 中=S1, 機c='企業情報資料アップロード')]),
    F('確認事項', own=[C(大=P('海外信用調書', '利墨'), 機c='（確認事項）')]),
]
lm_kaigai_old_fns = [F('企業情報資料アップロード', own=[C(大=P('海外信用調書', '利墨'), 中=OLD, 機c='企業情報資料アップロード')])]
HD = P('変動通知', '利墨')
LM = N('利墨 login', own=[C(大=LMC, 機c='利墨連携ログイン')], kids=[
    N('トップページ', own=[C(大=LMC, 中=MENU, 機n='連携ログイン')], kids=[
        F('リマインダーメールからの再申込（再申込不可）', own=[C(大=LMC, 中=MENU, 機c='リマインダーメール')]),
        product('１．中国企業信用調査サービス', '中国企業信用調査サービス', '利墨', s1_com=LM_S1_COM),
        product('２．中国企業簡易情報ナビ', '中国企業簡易情報ナビ', '利墨', s1_com=LM_S1_COM),
        product('３．中国企業コンプラチェックレポート', '中国企業コンプラチェックレポート', '利墨', s1_com=LM_S1_COM),
        product('４．海外信用調書', '海外信用調書', '利墨', s1_com=LM_S1_COM, s1_fns=lm_kaigai_fns, old_fns=lm_kaigai_old_fns),
        kanri('利墨', extra=[
            F('メール配信設定', own=[C(大=LMC, 中=KANRI, 機c='メール配信')]),
            N('簡易版コンプラチェック', own=[C(大=LMC, 中='簡易版コンプラチェック')]),
            N('不安情報確認', own=[C(大=P('中国企業不安情報', '利墨'), 中=KANRI)]),
            N('変動通知', own=[C(大=HD, 中=KANRI)], kids=[
                N('変動通知申込（お申し込み内容の確認）', own=[C(大=HD, 中='お申し込み内容の確認（変動通知申込）')], kids=[
                    N('変動通知申込完了（お申し込み完了）', own=[C(大=HD, 中='お申し込み完了（変動通知）')])]),
                N('変動通知情報', own=[C(大=HD, 中='信用調書管理ファイル（変動通知情報）')], kids=[
                    F('メール・モニタリング再開リンクからの遷移', own=[C(大=HD, 中='変動通知情報')])]),
                N('変動通知再開（お申し込み内容の確認）', own=[C(大=HD, 中='お申し込み内容の確認（変動通知再開）')]),
            ]),
        ]),
        N('中国日系企業攻めモン', own=[C(大=P('中国日系企業攻めモン', '利墨'), 中=MENU)], kids=[
            N('企業検索', own=[C(大=P('中国日系企業攻めモン', '利墨'), 中='中国日系企業攻めモン（企業検索）')], kids=[
                N('企業詳細', own=[C(大=P('中国日系企業攻めモン', '利墨'), 中='中国日系企業攻めモン（企業詳細）')])])]),
        N('中国企業不安情報', own=[C(大=P('中国企業不安情報', '利墨'), 中=MENU)], kids=[
            N('検索', own=[C(大=P('中国企業不安情報', '利墨'), 中='中国企業不安情報（検索）')], kids=[
                N('詳細', own=[C(大=P('中国企業不安情報', '利墨'), 中='中国企業不安情報（詳細）')])]),
            F('連携リンクからの遷移', own=[C(大=P('中国企業不安情報', '利墨'), 中='中国企業不安情報')])]),
        header('利墨', extra=[F('通知設定（変動通知）', own=[C(大=HD, 中='共通ヘッダ（通知設定）')])]),
    ]),
    N('外部連携からの申込内容確認への直接遷移', own=[C(大=LMC, 機c='外部連携')]),
    errors('利墨'),
])

# ════ RM会員 ════
RMC = P('共通', 'RM')


def rm_products(ent):
    """RM会員・非会員 共通の RM三商品（入口ごとに別の case）"""
    return [
        product('RM中国企業情報ナビ', 'RM中国企業情報ナビ', ent, detail=True),
        product('RM中国簡易情報ナビ（簡易ナビ）', 'RM中国簡易情報ナビ（簡易ナビ）', ent),
        product('RM中国企業コンプラチェックレポート', 'RM中国企業コンプラチェックレポート', ent),
    ]


J = N('RM会員 login', own=[C(大=RMC, 機c='RM会員連携ログイン（TOP）'), C(大=RMC, 機c='RM会員連携ログイン（表示言語）')], kids=[
    N('トップページ', own=[C(大=RMC, 中=MENU, 機n='連携ログイン')], kids=[
        F('リマインダーメールからの再申込（再申込不可）', own=[C(大=RMC, 中=MENU, 機c='リマインダーメール')]),
    ] + rm_products('RM') + [
        product('リスモン AI与信管理PDF', 'リスモン AI与信管理PDF', 'RM', detail=True),
        product('信用交換所（クリフ社） 海外信用調書', '信用交換所（クリフ社） 海外信用調書', 'RM', detail=True),
        product('信用交換所（ACP社） 海外信用調書', '信用交換所（ACP社） 海外信用調書', 'RM'),
        kanri('RM'),
        N('中国企業攻めモン', own=[C(大=P('中国企業攻めモン', 'RM'), 中=MENU)], kids=[
            N('企業検索', own=[C(大=P('中国企業攻めモン', 'RM'), 中='中国企業攻めモン（企業検索）')], rest=True),
            F('CSV出力', own=[C(大=P('中国企業攻めモン', 'RM'), 中='中国企業攻めモン（企業検索）', 小c='CSV出力')]),
            N('企業詳細', own=[C(大=P('中国企業攻めモン', 'RM'), 中='中国企業攻めモン（企業詳細）')])]),
        header('RM'),
    ]),
    errors('RM'),
])

# ════ FNA ════
FC = P('共通', 'FNA')
FP = P('中国企業信用調査サービス', 'FNA')
FNA = N('FNA login', own=[C(大=FC, 機c='FNA連携ログイン')], kids=[
    N('トップページ（リスモン信用調査サービス）', own=[C(大=FC, 中='リスモン信用調査サービス（TOP）', 機n='連携ログイン')], kids=[
        N(S1, own=[C(大=FP, 中=S1)], kids=[
            F('申込への不正遷移', own=[C(大=FP, 機c='不正遷移')]),
            N(S2, own=[C(大=FP, 中=S2)], kids=[
                N(S3, own=[C(大=FP, 中=S3)], kids=[N(S4, own=[C(大=FP, 中=S4)])])])],
          note='FNA の商品は 中国企業信用調査サービス のみのため、商品ノードを置かない'),
        N('信用調書管理ファイル（FNA）', own=[C(大=FC, 中=KANRI)], kids=[
            F('メールからの遷移', own=[C(大=FC, 中=KANRI, 機c='からの遷移')])]),
        header('FNA'),
    ]),
    errors('FNA'),
])

# ════ 非会員 ════
XC = P('共通', '非会員')
XS1 = [C(大=XC, 中='申込 Step1／Step2（入力画面）')]
XS2 = [C(大=XC, 中='申込 Step2／Step3')]


def x_product(label, prod, detail=False):
    return product(label, prod, '非会員', s1_com=XS1, s2_com=XS2, detail=detail)


X = N('非会員 login', own=[C(大=XC, 機c='非会員連携ログイン（TOP）')], kids=[
    N('トップページ', own=[C(大=XC, 中=MENU, 機n='連携ログイン')], kids=[
        x_product('RM中国企業情報ナビ', 'RM中国企業情報ナビ', detail=True),
        x_product('RM中国簡易情報ナビ（簡易ナビ）', 'RM中国簡易情報ナビ（簡易ナビ）'),
        x_product('RM中国企業コンプラチェックレポート', 'RM中国企業コンプラチェックレポート', detail=True),
        kanri('非会員', com_kanri=False),
        N('中国企業攻めモン', own=[C(大=P('中国企業攻めモン', '非会員'), 中=MENU)], kids=[
            N('企業検索', own=[C(大=P('中国企業攻めモン', '非会員'), 中='中国企業攻めモン')], rest=True),
            F('CSV出力', own=[C(大=P('中国企業攻めモン', '非会員'), 中='中国企業攻めモン', 小c='CSV出力')]),
            N('企業詳細', own=[C(大=P('中国企業攻めモン', '非会員'), 中='中国企業攻めモン（企業詳細）')])]),
        header('非会員'),
    ]),
    errors('非会員'),
])

# ════ 共通（全入口で共用） ════
COMMON = [
    N('エラー画面', own=[C(大='共通', 中='エラー画面')], kids=[N('404画面', own=[C(大='共通', 中='404画面')])]),
    N('共通ヘッダ', own=[C(大='共通', 中='共通ヘッダ')], kids=[
        F('ログアウト', own=[C(大='共通', 中='共通ヘッダ', 機='ログアウト')]),
        F('言語切替', own=[C(大='共通', 中='共通ヘッダ', 機='言語切替')])]),
    N('共通フッタ', own=[C(大='共通', 中='共通フッタ')]),
    N('共通（全画面）', own=[C(大='共通', 中='共通（全画面）')]),
    N('申込ステップ表示', own=[C(大='共通', 中=S2, 機='申込ステップ表示')]),
    N('信用調書管理ファイル（利墨・RM会員 で共用）', own=[C(大='共通', 中=KANRI)],
      note='利墨・RM会員 の 信用調書管理ファイル にも「＋共通」として出る'),
    N('PDF表示ヘルプ画面（PDFが表示されない場合）', own=[C(大='共通', 中='PDF表示ヘルプ画面（PDFが表示されない場合）')]),
]

ENTRY_TABS = [('利墨', [LM]), ('RM会員', [J]), ('FNA', [FNA]), ('非会員', [X]), ('共通', COMMON)]


def tabs(rows):
    """開発確認用 は遷移を持たないので、データにある中分類ごとに1ノードを作る。
    ケースが1件も無いノード（子孫も含めて0件）は出さない（case が増えたら再生成で出る）"""
    chus = sorted({r['中'] for _, r in rows if r['大'] == '開発確認用'})
    dev = [N(c, own=[C(大='開発確認用', 中=c)]) for c in chus]
    has = lambda n: any(hit(r, x) for _, r in rows for x in n['own'] + n['com'])

    def prune(nodes):
        out = []
        for n in nodes:
            kids = prune(n['kids'])
            # 旧の申込画面 の下の Step2〜4 は本線と同じなので、その商品の旧の申込画面の case が無ければ枝ごと出さない
            if n['label'].startswith('旧の申込画面') and not has(dict(n, com=[])):
                continue
            if kids or has(n):
                out.append(dict(n, kids=kids))
        return out
    return [(t, prune(roots)) for t, roots in ENTRY_TABS + [('開発確認用', dev)]]


# ── 出力 ────────────────────────────────────
def _tone(n, depth, tab):
    if n['fn']:
        return 'action'
    if depth == 0 and tab not in ('共通', '開発確認用'):
        return 'entry'
    if n['label'].startswith('トップページ'):
        return 'menu'
    return 'screen'


def to_json(rows):
    """アプリ用：タブ → ルートノード列。id はタブ内のパス"""
    def conv(n, nid, depth, tab):
        o = {'id': nid, 'label': n['label'], 'tone': _tone(n, depth, tab)}
        for k in ('own', 'com'):
            if n[k]:
                o[k] = n[k]
        if n['rest']:
            o['rest'] = True
        if n['note']:
            o['note'] = n['note']
        if n['kids']:
            o['kids'] = [conv(k, f'{nid}.{i}', depth + 1, tab) for i, k in enumerate(n['kids'])]
        return o
    return [{'title': t, 'roots': [conv(r, f'n{i}', 0, t) for i, r in enumerate(roots)]} for t, roots in tabs(rows)]


def write_draft(rows, path):
    """確認用 MD（件数つき）。rows = [(件数, {大,中,小,機})]"""
    match = lambda rules: {i for i, (c, r) in enumerate(rows) if any(hit(r, x) for x in rules)}
    ncount = lambda ids: sum(rows[i][0] for i in ids)
    covered, lines = set(), []

    def walk(n, depth, siblings=()):
        own = match(n['own']); com = match(n['com'])
        exclude = list(n['kids']) + ([sb for sb in siblings if sb['fn']] if n['rest'] else [])
        for k in exclude:
            own -= match(k['own']); com -= match(k['com'])
        covered.update(own | com)
        cnt = f"{ncount(own)}件" + (f"＋共通{ncount(com)}件" if n['com'] else '')
        lines.append(f"{'  ' * depth}- {'［機能］' if n['fn'] else ''}**{n['label']}**（{cnt}）" + (f"　※{n['note']}" if n['note'] else ''))
        for k in n['kids']:
            walk(k, depth + 1, n['kids'])

    out = ['# 利用者システム（wreport_base）入口別フロー', '',
           '- 入口は大分類の【】（【利墨】【RM】【FNA】【非会員】）で決まる。',
           '- 「n件＋共通m件」＝商品自身のケース＋共通【入口】（または共通）の同じ画面のケース。',
           '- ［機能］＝画面内の機能・遷移。画面ノードの件数は、子ノードに当たらない残り。', '']
    for title, roots in tabs(rows):
        out.append(f'## Tab：{title}\n')
        for r in roots:
            walk(r, 0)
        out += lines; lines.clear(); out.append('')
    agg = collections.Counter()
    for i, (c, r) in enumerate(rows):
        if i not in covered:
            agg[(r['大'], r['中'], r['機'])] += c
    out.append(f'## どのノードにも出ないケース（{sum(agg.values())}件）\n')
    out.append('| 件数 | 大分類 | 中分類 | 機能名 |\n|---:|---|---|---|')
    out += [f'| {c} | {a} | {b} | {f} |' for (a, b, f), c in sorted(agg.items())]
    open(path, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
    return sum(agg.values())
