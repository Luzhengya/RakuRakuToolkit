# 利用者システム（wreport_base）の入口別フロー（ツリー）定義。gen_flow.py から読み込む。
# ノード：label / own=条件 / com=大分類=共通 側の条件（件数を「n件＋共通m件」で出す） / fn=画面内の機能 / rest / kids
# 条件 dict のキー：列（大 中 小 機）＋演算子。演算子なし＝完全一致、~ ＝含む、^ ＝前方一致、$ ＝後方一致、
#   !~ ＝「|」区切りのどれも含まない。$ は「A または B」の未確定値（修正案の貼り付け）には当てない
# ノードのケース = 条件に当たるケース − 直下の子が持つケース。rest ノードは兄弟の機能ノード分も除く（画面＝残り）
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


def F(label, *rules, note=''):
    return N(label, own=rules, fn=True, note=note)


# キーワード引数で 小~ / 小^ を書くための別名
def C(**kw):
    out = {}
    for k, v in kw.items():
        out[{'小c': '小~', '小p': '小^'}.get(k, k)] = v
    return out


# RM会員・非会員の case は機能名の末尾の入口後缀で分ける（RM会員 と 非会員 で別の case）
SUF = {'RM会員': '（RM会員）', '非会員': '（非会員）'}


def E(rule, ent):
    """ent があれば機能名の入口後缀を条件に加える"""
    return dict(rule, **{'機$': SUF[ent]}) if ent else rule


# ── 申込チェーン ────────────────────────────────
def chain(prod, s1_chu, old_chu, s2c, s3c, s4c, s1_fns=(), s1_extra=(), detail=None, ent=None):
    """商品ノード配下：Step1→2→3→4 と 旧の申込画面→2→3→4"""
    def tail():
        s2 = N('お申し込み（貴社連絡先の入力）', own=[E(C(大=prod, 中='お申し込み（貴社連絡先の入力）'), ent)], com=s2c)
        s3 = N('お申し込み内容の確認', own=[E(C(大=prod, 中='お申し込み内容の確認'), ent)], com=s3c)
        s4 = N('お申し込み完了', own=[E(C(大=prod, 中='お申し込み完了'), ent)], com=s4c)
        s3['kids'] = [s4]; s2['kids'] = [s3]
        return s2
    s1 = N('お申し込み（調査対象先入力およびレポート種類決定）', own=[E(C(大=prod, 中=x), ent) for x in s1_chu] + list(s1_extra),
           kids=list(s1_fns) + [tail()])
    kids = [s1]
    if old_chu:
        kids.append(N('旧の申込画面（以前の入力フォーム）', own=[E(C(大=prod, 中=x), ent) for x in old_chu], kids=[tail()]))
    if detail:
        kids.append(detail)
    return kids


LM_S2 = [C(大='共通', 機='信用調査申込（貴社連絡先の入力）')]
LM_S3 = [C(大='共通', 機='信用調査申込（お申し込み内容の確認）'), C(大='共通', 機='信用調査申込（申込確定・登録処理）')]
LM_S4 = [C(大='共通', 機='信用調査申込（お申し込み完了）')]
J_S = lambda prefix, ent: [{'大': '共通', '機^': prefix, '機$': SUF[ent]}]
J_S2 = lambda ent: J_S('海外信用調書申込（貴社連絡先', ent)  # 「の入力」「入力」の両方
J_S3 = lambda ent: J_S('海外信用調書申込（内容確認）', ent)
J_S4 = lambda ent: J_S('海外信用調書申込（申込完了）', ent)
S1 = 'お申し込み（調査対象先入力およびレポート種類決定）'
OLD = '調査対象先入力およびレポート種類決定（以前の入力フォーム）'

TOP_LM = C(大='共通', 機='サービスメニュー（TOPページ）')
TOP_J = C(大='共通', 機='信用調査サービスメニュー（J入口TOP）')
TOP_X = C(大='共通', 機='海外信用調査サービスメニュー（非会員）')
KANRI = C(大='共通', 中='信用調書管理ファイル', 機='信用調書管理ファイル')
KANRI_LM = dict(KANRI, **{'小!~': '（RM会員）'})
# RM会員 には 変動通知・簡易版コンプラチェック・不安情報・メール配信 は無い（（RM会員）付きは除く）
KANRI_RM = [dict(KANRI, **{'小~': '（RM会員）'}), dict(KANRI, **{'小!~': '（RM会員）|（利墨）|変動通知|簡易版コンプラ|不安情報|メール配信|再開'})]
KANRI_X = C(中='信用調書管理ファイル（海外）', 機='信用調書管理ファイル検索（非会員）')


def kanri_fns(base):
    k = lambda kw: dict(base, **{'小~': kw})
    return [F('履歴一括出力', k('履歴一括出力')), F('ファイル一括出力', k('ファイル一括出力')), F('再申込', k('再申込'))]


# ════ 利墨 ════
lm_products = [
    ('１．中国企業信用調査サービス', '中国信用調書（RM格付有）', [S1], [OLD], ['１．', '一括申込依頼書（中国企業信用調査）'], ()),
    ('２．中国企業簡易情報ナビ', '中国企業簡易情報ナビ', [S1], [OLD], ['２．', '一括申込依頼書（中国企業簡易情報ナビ）', '簡易情報ナビ サンプルPDF'], ()),
    ('３．中国企業コンプラチェックレポート', '中国企業コンプラチェックレポート', [S1], [OLD], ['３．', 'コンプラチェック サンプルPDF'], ()),
    ('４．海外信用調書', '海外信用調書', [S1], [OLD], ['４．', '海外信用調書 サンプルPDF'],
     [F('企業検索', C(大='海外信用調書', 機='海外信用調書申込（企業検索）')),
      F('企業情報資料アップロード', C(大='海外信用調書', 中=S1, 機='海外信用調書申込（企業情報資料アップロード）')),
      F('確認事項', C(大='海外信用調書', 機='海外信用調書申込（確認事項）'))]),
]


def lm_product(label, prod, s1, old, top_keys, fns):
    own = [dict(TOP_LM, **{'小^': k}) for k in top_keys if k.endswith('．')] + \
          [dict(TOP_LM, 小=k) for k in top_keys if not k.endswith('．')]
    n = N(label, own=own, kids=chain(prod, s1, old, LM_S2, LM_S3, LM_S4, s1_fns=fns))
    return n


lm_kanri = N('信用調書管理ファイル', own=[dict(TOP_LM, 小='［信用調書管理ファイル］')], kids=[
    N('検索', own=[KANRI_LM], rest=True, note='信用調書管理ファイル画面のうち、右の機能に当たらないケース'),
] + kanri_fns(KANRI_LM) + [
    F('メール配信', dict(KANRI_LM, **{'小~': 'メール配信'}), C(大='共通', 中='信用調書管理ファイル', 機='メール配信設定（通知リマインド）')),
    F('簡易版コンプラチェック（遷移）', dict(KANRI_LM, 小='簡易版コンプラチェック')),
    F('不安情報確認', dict(KANRI_LM, **{'小~': '不安情報'}), C(大='中国企業不安情報', 機='不安情報確認ボタン表示（信用調書管理ファイル）')),
    F('変動通知（申込・確認・再開）', dict(KANRI_LM, **{'小~': '変動通知'}), dict(KANRI_LM, 小='再開')),
])
next(k for k in lm_kanri['kids'] if k['label'].startswith('変動通知'))['kids'] = [
    N('変動通知申込（お申し込み内容の確認）', own=[C(大='変動通知', 中='変動通知申込（お申し込み内容の確認）')], kids=[
        N('変動通知申込完了（お申し込み完了）', own=[C(大='変動通知', 中='変動通知申込完了（お申し込み完了）')])]),
    N('変動通知情報（信用調書管理ファイル）', own=[C(大='変動通知', 中='変動通知情報（信用調書管理ファイル）')], kids=[
        N('変動通知メール受信設定（全社適用）', own=[C(大='変動通知', 中='変動通知メール受信設定（全社適用）')])]),
    N('変動通知再開（お申し込み内容の確認）', own=[C(大='変動通知', 中='変動通知再開（お申し込み内容の確認）')]),
]
next(k for k in lm_kanri['kids'] if k['label'] == '簡易版コンプラチェック（遷移）')['kids'] = [N('簡易版コンプラチェック', own=[C(中='簡易版コンプラチェック')])]

LM = N('利墨 login', own=[C(中='連携ジャンプ（LIMO）', 機='LIMO連携ログイン')], kids=[
    N('トップページ', own=[TOP_LM], kids=[lm_product(*p) for p in lm_products] + [
        N('５．利用規約', own=[dict(TOP_LM, **{'小^': '５ ．利用規約'})]),
        lm_kanri,
        N('中国日系企業攻めモン', own=[C(中='中国日系企業攻めモン（企業検索）'), dict(TOP_LM, 小='［中国日系企業攻めモン］')], kids=[
            N('中国日系企業攻めモン（企業詳細）', own=[C(中='中国日系企業攻めモン（企業詳細）')])]),
        N('中国企業不安情報', own=[C(中='中国企業不安情報（検索）'), dict(TOP_LM, 小='［中国企業不安情報］')], kids=[
            N('中国企業不安情報（詳細）', own=[C(中='中国企業不安情報（詳細）')])]),
        N('日本企業情報RMナビ（外部リンク）', own=[dict(TOP_LM, 小='［日本企業情報RMナビ］')]),
    ]),
    N('Step3直接遷移', own=[C(中='連携ジャンプ（Step3直接遷移）'), C(機='信用調査申込（内容確認画面への外部連携遷移）')],
      note='/jumpToStep3：外部から お申し込み内容の確認 へ直接'),
])

# ════ RM会員（J系） ════
RM3 = {'RM中国企業情報ナビ', 'RM中国簡易情報ナビ', 'RM中国企業コンプラチェックレポート'}


def j_product(label, prod, top_kw, s1=(S1,), old=(OLD,), detail=None, top_src=TOP_J):
    ent = 'RM会員' if top_src is TOP_J else '非会員'
    own = [dict(top_src, **{'小~': k}) for k in top_kw] if top_src is TOP_J else [C(大=prod, 機='海外信用調査サービスメニュー（非会員）')]
    # 商品自身の case を入口後缀で分けるのは、両入口にある RM三商品だけ（クリフ社・ACP社・AI与信 は RM会員 のみ）
    own_ent = ent if prod in RM3 else None
    return N(label, own=own, kids=chain(prod, list(s1), list(old), J_S2(ent), J_S3(ent), J_S4(ent), detail=detail, ent=own_ent))


# その他詳細：「RM中国企業情報ナビ【対象国】中国のみ」の商品欄の下にある（両入口とも）
navi_detail_j = N('その他詳細', own=[E(C(中='RM中国企業情報ナビ その他詳細'), 'RM会員')])
navi_detail_x = N('その他詳細', own=[E(C(中='RM中国企業情報ナビ その他詳細'), '非会員')])
KANI_S1 = [S1]
KANI_OLD = [OLD]

semen = lambda top_btn, chu_s, kino_s, kino_d, chu_d, csv: N('中国企業攻めモン', own=[top_btn], kids=[
    N('企業検索', own=[C(中=chu_s, 機=kino_s)], rest=True),
    F('CSV出力', C(中=chu_s, 機=kino_s, **{'小c': 'CSV出力'})),
    N('企業詳細', own=[C(中=chu_d, 機=kino_d)]),
])

J = N('RM会員 login', own=[C(機='RM会員SSOログイン')], kids=[
    N('トップページ', own=[TOP_J], kids=[
        j_product('RM中国企業情報ナビ', 'RM中国企業情報ナビ', ['RM中国企業情報ナビ', '信用調書サンプル', '現地調査報告書サンプル'],
                  old=(OLD,), detail=navi_detail_j),
        j_product('RM中国簡易情報ナビ', 'RM中国簡易情報ナビ', ['RM中国簡易情報ナビ', 'サンプル「中国」'], s1=KANI_S1, old=KANI_OLD),
        j_product('RM中国企業コンプラチェックレポート', 'RM中国企業コンプラチェックレポート', ['コンプラチェック'], old=()),
        j_product('リスモン AI与信管理PDF', 'リスモン AI与信管理PDF', ['AI与信'], old=(),
                  detail=N('その他詳細', own=[C(中='リスモン AI与信管理PDF その他詳細')])),
        j_product('信用交換所（クリフ社） 海外信用調書', '信用交換所(クリフ社) 海外信用調書', ['クリフ社'], old=(),
                  detail=N('その他詳細', own=[C(中='CE その他詳細')])),
        j_product('信用交換所（ACP社） 海外信用調書', '信用交換所(ACP社) 海外信用調書', ['ACP社'], old=()),
        N('信用調書管理ファイル', own=[dict(TOP_J, 小='[信用調書管理ファイル]ボタン')], kids=[N('検索', own=KANRI_RM, rest=True)] + kanri_fns(KANRI),
          note='利墨と同じ画面（/searchIndex）。（RM会員）付きと入口共通の case。変動通知・簡易版コンプラ・不安情報・メール配信は利墨のみ'),
        semen(dict(TOP_J, 小='[中国企業攻めモン]ボタン'), '中国企業攻めモン（企業検索）', '中国企業攻めモン（企業検索）',
              '中国企業攻めモン（企業詳細）', '中国企業攻めモン（企業詳細）', True),
    ]),
])

# ════ FNA ════
FNA = N('FNA login', own=[C(中='連携ジャンプ（FNA）'), C(機='FNA連携ログイン（jump経由）')], kids=[
    N('トップページ（リスモン信用調査サービス）', own=[C(中='リスモン信用調査サービス')], kids=[
        N('お申し込み（調査対象先入力およびレポート種類決定）', own=[C(機='中国信用調書（FNA）申込（調査対象先入力）')], kids=[
            N('お申し込み（貴社連絡先の入力）', own=[C(機='中国信用調書（FNA）申込（貴社連絡先入力）')], kids=[
                N('お申し込み内容の確認', own=[C(機='中国信用調書（FNA）申込（内容確認）')], kids=[
                    N('お申し込み完了', own=[C(機='中国信用調書（FNA）申込（完了）')])])])],
          note='FNA の商品は 中国信用調書（FNA）（RM格付有）のみのため、商品ノードを置かない'),
        N('信用調書管理ファイル（FNA）', own=[C(機='信用調書管理ファイル検索（FNA）')]),
    ]),
])

# ════ 非会員（ExJ） ════
X = N('非会員 login', own=[C(機='非会員SSOログイン')], kids=[
    N('トップページ', own=[TOP_X], kids=[
        j_product('RM中国企業情報ナビ', 'RM中国企業情報ナビ', [], old=(OLD,), detail=navi_detail_x, top_src=TOP_X),
        j_product('RM中国簡易情報ナビ', 'RM中国簡易情報ナビ', [], s1=KANI_S1, old=KANI_OLD, top_src=TOP_X),
        j_product('RM中国企業コンプラチェックレポート', 'RM中国企業コンプラチェックレポート', [], old=(), top_src=TOP_X),
        N('信用調書管理ファイル', own=[dict(TOP_X, 小='［信用調書管理ファイル］')],
          kids=[N('検索', own=[KANRI_X], rest=True)] + kanri_fns(KANRI_X)),
        semen(dict(TOP_X, 小='［中国企業攻めモン］'), '中国企業攻めモン', '中国企業攻めモン検索（非会員）',
              '中国企業攻めモン企業詳細（非会員）', '中国企業攻めモン（企業詳細）', True),
    ]),
])

# 非会員の 再申込 は、中分類=調査対象先入力 側に登録されたケースもある（機能名は 信用調書管理ファイル検索（非会員））
_x_kanri = next(k for k in X['kids'][0]['kids'] if k['label'] == '信用調書管理ファイル')
next(k for k in _x_kanri['kids'] if k['label'] == '再申込')['own'].append(C(機='信用調書管理ファイル検索（非会員）', 小c='再申込'))

# ════ 共通 ════
COMMON = [
    N('テスト用ログイン入口', own=[C(中='入口画面（テスト用ログイン入口）')]),
    N('エラー画面', own=[C(中='エラー画面')], kids=[N('エラー画面（RM会員）', own=[C(中='エラー画面（RM会員）')]), N('404画面', own=[C(中='404画面')])]),
    N('画面遷移ガード', own=[C(中='画面遷移ガード')]),
    N('共通ヘッダ', own=[C(中='共通ヘッダ')], kids=[F('ログアウト', C(機='ログアウト')), F('言語切替', C(中='共通ヘッダ', 機='言語切替')), F('通知設定', C(機='通知設定'))]),
    N('共通フッタ', own=[C(中='共通フッタ')]),
    N('exj共通レイアウト（ヘッダ）', own=[C(中='exj共通レイアウト（ヘッダ）')]),
    N('共通部品', kids=[N('ステップ表示', own=[C(中='共通部品（ステップ表示）')]), N('タイトルバー', own=[C(中='共通部品（タイトルバー）')]),
                        N('申込入力画面（共通部品）', own=[C(中='申込入力画面（共通部品）')]), N('申込確認画面（共通部品）', own=[C(中='申込確認画面（共通部品）')])]),
    N('PDFが表示されない場合', own=[C(中='PDFが表示されない場合')]),
    N('非画面処理', kids=[N('サーバ共通処理', own=[C(中='サーバ共通処理')]), N('通信共通処理', own=[C(中='通信共通処理')]),
                        N('セッション管理', own=[C(中='セッション管理')]), N('変動通知 サーバAPI', own=[C(中='サーバAPI（/apply/monitor）')])]),
]

TABS = [('利墨', [LM]), ('RM会員', [J]), ('FNA', [FNA]), ('非会員', [X]), ('共通', COMMON)]


# ── 出力 ────────────────────────────────────
def _tone(n, depth, tab):
    if n['fn']:
        return 'action'
    if depth == 0 and tab != '共通':
        return 'entry'
    if n['label'].startswith('トップページ'):
        return 'menu'
    return 'screen'


def to_json():
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
    return [{'title': t, 'roots': [conv(r, f'n{i}', 0, t) for i, r in enumerate(roots)]} for t, roots in TABS]


def write_draft(rows, path):
    """確認用 MD（件数つき）。rows = [(件数, {大,中,小,機})]"""
    match = lambda rules: {i for i, (c, r) in enumerate(rows) if any(hit(r, x) for x in rules)}
    ncount = lambda ids: sum(rows[i][0] for i in ids)
    covered, lines = set(), []

    def walk(n, depth, siblings=()):
        own = match(n['own']); com = match(n['com'])
        for k in n['kids']:
            own -= match(k['own'])
        if n['rest']:
            for sb in siblings:
                if sb['fn']:
                    own -= match(sb['own'])
        covered.update(own | com)
        cnt = f"{ncount(own)}件" + (f"＋共通{ncount(com)}件" if n['com'] else '')
        lines.append(f"{'  ' * depth}- {'［機能］' if n['fn'] else ''}**{n['label']}**（{cnt}）" + (f"　※{n['note']}" if n['note'] else ''))
        for k in n['kids']:
            walk(k, depth + 1, n['kids'])

    out = ['# 利用者システム（wreport_base）入口別フロー', '',
           '- 「n件＋共通m件」＝商品自身のケース＋大分類=共通の同じ画面のケース。',
           '- ［機能］＝画面内の機能（小分類で切り出し）。画面ノードの件数は、機能ノードに当たらない残り。', '']
    for title, roots in TABS:
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
