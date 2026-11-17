# 調書管理ツール（wreport_admin_base）のフロー（ツリー）定義。gen_flow.py から読み込む。
# 書き方は entry_tree.py と同じ（N=画面 / F=［機能］ / C=条件）。
# case の大分類は「共通」「調査機関名」「付帯サービス名」「商品【入口】」（旧申込画面）「開発確認用」。
#   ・画面ノード = 大分類=共通 のその画面のケース（子ノードの分を除く）
#   ・［調査機関切替］X = 大分類=X のその画面のケース ＋ 共通m件（その画面の 共通 全体）。X のケースが無ければ出さない
#   ・［付帯サービス］ = 大分類=付帯サービス名 のケース
#   ・同じ画面へ複数の画面から行ける場合は、それぞれの親の下に同じノードを置く（件数も同じ）
from entry_tree import N, F, C, P, MENU, KANRI, S1, OLD, S2, S3, S4

ORGS = ['JSBIZ(グループウェア)', '利墨(グループウェア)', 'JSBIZ(FNA)', 'JSBIZ.CTC.WS(RM)', '利墨(RM)',
        '信用交換所(クリフ)', '信用交換所(ACP社)', 'リスモン AI与信管理PDF', 'SDI']


def org_nodes(chu):
    out = []
    for o in ORGS:
        n = N(f'［調査機関切替］{o}', own=[C(大=o, 中=chu)], com=[C(大='共通', 中=chu)])
        n['need_own'] = True
        out.append(n)
    return out


def fn(label, chu, names):
    return F(label, own=[C(大='共通', 中=chu, 機=x) for x in names])


def screen(chu, label=None, fns=(), kids=()):
    return N(label or chu, own=[C(大='共通', 中=chu)], kids=org_nodes(chu) + list(fns) + list(kids))


def addon(label, dai, chu, kids=()):
    return N(label, own=[C(大=dai, 中=chu)], kids=list(kids))


# ════ 管理業務 ════
K = '信用調書管理'
EV = '評価詳細情報'


def evaluate():
    return screen(EV, fns=[
        fn('評点・RM格付編集', EV, ['評点編集', 'RM格付編集']),
        fn('評点計算', EV, ['評点計算']),
        fn('限度額算出', EV, ['限度額算出']),
        fn('格付', EV, ['格付']),
        fn('ワークフロー', EV, ['ワークフロー']),
        fn('添付資料', EV, ['添付資料']),
        fn('評価データ取込・保存', EV, ['評価データ取込', '評価データ保存']),
    ], kids=[
        screen('評価詳細（利用者）'),
        screen('調書評価書（PDF帳票）'),
        addon('［付帯サービス］不安情報', '中国企業不安情報', '不安情報'),
    ])


def kanri():
    return screen(K, fns=[
        fn('調書情報入力', K, ['調書情報入力', '調書情報のみの登録／更新']),
        fn('課金情報', K, ['課金情報入力', '課金計算', '課金情報表示', '課金情報の登録/更新']),
        fn('申込情報', K, ['申込情報の更新', '申込情報入力', '申込追加情報入力', '申込追加情報の登録／更新', '申込キャンセル']),
        fn('完了情報の登録／更新', K, ['完了情報の登録／更新', '完了情報の削除', '再鑑完了']),
        fn('PDF・ファイル登録', K, ['PDF登録', 'アップロード通知', '企業情報資料登録', '調書PDF出力', 'PDFダウンロード', 'ファイルダウンロード']),
        fn('格付XML登録', K, ['格付XML登録', '格付XML', '格付XMLダウンロード', '格付sheet']),
        fn('調査会社納品予定日算出', K, ['調査会社納品予定日算出']),
        fn('変動通知有効期間変更', K, ['変動通知有効期間変更', '変動通知再開', '変動通知内容詳細', '変動通知CSV出力', '変動通知']),
        fn('担当者・権限・ボタン制御', K, ['工場評価担当者と工場評価承認者の設定', '評価詳細権限', '調書管理権限', 'ボタン表示制御', '承認状況']),
        fn('受付番号検索', K, ['受付番号検索', '直前の申込の再表示']),
    ], kids=[
        addon('［付帯サービス］変動通知', '変動通知', K),
        screen('信用調書申込内容詳細情報', fns=[
            fn('申込会員連絡先更新', '信用調書申込内容詳細情報', ['申込会員連絡先更新']),
            fn('与信指標の出力更新', '信用調書申込内容詳細情報', ['与信指標の出力更新']),
            fn('自己資本比率補正値算出', '信用調書申込内容詳細情報', ['自己資本比率補正値算出']),
        ]),
        screen('調書データ詳細情報表示'),
        screen('信用調書管理更新履歴', fns=[fn('更新履歴CSV出力', '信用調書管理更新履歴', ['更新履歴CSV出力'])]),
        screen('信用調書管理（過去の調査案件一覧）'),
        evaluate(),
        screen('評価詳細（統一format）', label='調書要望（統一format）', kids=[screen('調書評価書PDF（統一format）')]),
        screen('評価詳細（統一format2）', label='調書要望（統一format2）', kids=[screen('調書評価書PDF（統一format2）')]),
        screen('評価詳細（PDFページ）', label='PDFページ', kids=[screen('調書評価書PDF（PDFページ）')]),
        screen('評価詳細（中国簡易ナビ）', label='中国簡易ナビ 調書要望', kids=[screen('調書評価書PDF（中国簡易ナビ）')]),
        screen('調書データ ファイル アップロード（統一format）'),
        screen('調書データ ファイル アップロード（統一format2）'),
        addon('モニタリング情報', '変動通知', 'モニタリング情報'),
        addon('コンプライアンスチェック報告', '簡易版コンプラチェック', 'コンプライアンスチェック報告'),
    ])


def db_screen(dai, top, detail, update):
    return addon(top, dai, top, kids=[addon(detail, dai, detail), addon(update, dai, update)])


ADMIN = N('ログイン', own=[C(大='共通', 中='ログイン')], kids=[
    fn('ログイン保持', 'ログイン', ['ログイン保持']),
    fn('ログアウト', 'ログイン', ['ログアウト']),
    screen('ログイン画面への切替画面（/report/innerJumpLogin.html）'),
    screen('メニュー', kids=[
        kanri(),
        screen('信用調書申込履歴', kids=[
            kanri(),
            evaluate(),
            screen('CSVインポート'),
            screen('月次チェック項目', fns=[fn('月次チェック（一括登録）', '月次チェック項目', ['月次チェック（一括登録）'])]),
            screen('会員検索（ダイアログ）'),
            screen('評価XML ファイル アップロード（ダイアログ）'),
        ]),
        screen('信用調書管理再鑑待ち一覧', kids=[kanri()]),
        screen('限度額設定', kids=[screen('限度額設定（数値設定画面）'), screen('会員検索（ダイアログ）')]),
        screen('DB管理画面', kids=[
            db_screen('中国日系企業攻めモン', '中国日系企業DB-企業情報', '中国日系企業DB（企業情報詳細）', '中国日系企業DB（データ更新）'),
            db_screen('中国企業不安情報', '中国企業不安情報-企業情報', '中国企業不安情報（企業情報詳細）', '中国企業不安情報（データ更新）'),
        ]),
        screen('スタッフ管理', fns=[
            fn('スタッフCSV出力', 'スタッフ管理', ['スタッフCSV出力']),
            fn('スタッフ削除・恢復', 'スタッフ管理', ['スタッフ削除', 'スタッフ恢復']),
        ], kids=[
            screen('スタッフ新規作成'),
            screen('スタッフ情報詳細', kids=[screen('スタッフ情報変更')]),
            screen('パスワード再発行'),
        ]),
    ]),
])

ADMIN_COMMON = N('全画面共通', kids=[
    screen('未ログイン時の制御（全画面共通）'),
    N('エラー画面', own=[C(大='共通', 中p='エラー画面')]),
    N('ダウンロードエラー画面', own=[C(大='共通', 中p='ダウンロードエラー画面')]),
    screen('調書PDF（共通ヘッダ・フッタ）'),
    N('テスト用入口画面', own=[C(大='共通', 中p='テスト用入口画面')]),
])


# ════ 旧申込画面（利用者向け。利用者端と同じ 商品【入口】） ════
def chain(prod, ent, s1_kids=()):
    p, ce = P(prod, ent), P('共通', ent)
    s4 = N(S4, own=[C(大=p, 中=S4)], com=[C(大=ce, 中=S4)])
    s3 = N(S3, own=[C(大=p, 中=S3)], com=[C(大=ce, 中=S3)], kids=[s4])
    s2 = lambda: N(S2, own=[C(大=p, 中=S2)], com=[C(大=ce, 中=S2)], kids=[s3])
    return [N(S1, own=[C(大=p, 中=S1)], com=[C(大=ce, 中=S1)], kids=list(s1_kids) + [s2()]),
            N('旧の申込画面（以前の入力フォーム）', own=[C(大=p, 中=OLD)], com=[C(大=ce, 中=OLD)], kids=[s2()])]


def product(label, prod, ent, detail=(), s1_kids=()):
    return N(label, own=[C(大=P(prod, ent), 中=MENU)], kids=chain(prod, ent, s1_kids) + list(detail))


LMC = P('共通', '利墨')
OLD_LM = N('利墨 連携ログイン', own=[C(大=LMC, 中='連携ログイン')], kids=[
    N('トップページ', own=[C(大=LMC, 中=MENU)], kids=[
        product('１．中国企業信用調査サービス', '中国企業信用調査サービス', '利墨'),
        product('２．中国企業簡易情報ナビ', '中国企業簡易情報ナビ', '利墨'),
        product('３．中国企業コンプラチェックレポート', '中国企業コンプラチェックレポート', '利墨'),
        product('４．海外信用調書', '海外信用調書', '利墨'),
        N(KANRI, own=[C(大s='【利墨】', 中=KANRI)]),
        N('中国企業攻めモン', own=[C(大=P('中国企業攻めモン', '利墨'), 中=MENU)], kids=[
            N('企業検索', own=[C(大s='【利墨】', 中='中国企業攻めモン')], kids=[
                N('企業詳細', own=[C(大=P('中国企業攻めモン', '利墨'), 中='中国企業攻めモン（企業詳細）')])])]),
    ]),
    N('外部連携からの申込内容確認への直接遷移', own=[C(大=P('中国企業信用調査サービス', '利墨'), 中='お申し込み内容の確認（外部直接遷移）')]),
])

RMC = P('共通', 'RM')
DT = lambda prod, chus, com=(): [N('その他詳細', own=[C(大=P(prod, 'RM'), 中=c) for c in chus], com=list(com))]
OLD_RM = N('RM会員 トップページ', own=[C(大=RMC, 中=MENU)], kids=[
    product('RM中国企業情報ナビ', 'RM中国企業情報ナビ', 'RM',
            detail=DT('RM中国企業情報ナビ', ['RM中国企業情報ナビ その他詳細'], com=[C(大=RMC, 中='RM中国企業情報ナビ その他詳細')])),
    product('RM中国簡易情報ナビ（簡易ナビ）', 'RM中国簡易情報ナビ（簡易ナビ）', 'RM'),
    product('リスモン AI与信管理PDF', 'リスモン AI与信管理PDF', 'RM', detail=DT('リスモン AI与信管理PDF', ['リスモン AI与信管理PDF その他詳細'])),
    product('信用交換所（クリフ社） 海外信用調書', '信用交換所（クリフ社） 海外信用調書', 'RM',
            detail=DT('信用交換所（クリフ社） 海外信用調書', ['信用交換所（クリフ社） 海外信用調書 その他詳細'])),
    product('信用交換所（ACP社） 海外信用調書', '信用交換所（ACP社） 海外信用調書', 'RM'),
    product('SDI', 'SDI', 'RM', detail=DT('SDI', ['SDI その他詳細', 'SDI中国企業詳細調査サービスについて', 'SDI海外企業詳細調査サービスについて'])),
    N(KANRI, own=[C(大=RMC, 中=KANRI)]),
    N('海外（中国）企業一覧', own=[C(大=RMC, 中='海外（中国）企業一覧')]),
    N('PDF表示ヘルプ画面（PDFが表示されない場合）', own=[C(大=RMC, 中='PDF表示ヘルプ画面（PDFが表示されない場合）')]),
    N('エラー画面（RM会員）', own=[C(大=RMC, 中='エラー画面')]),
])

FC, FP = P('共通', 'FNA'), P('中国企業信用調査サービス', 'FNA')
OLD_FNA = N('FNA トップページ', own=[C(大=FC, 中=MENU)], kids=[
    N(S1, own=[C(大=FP, 中=S1)], kids=[
        N(S2, own=[C(大=FP, 中=S2)], kids=[N(S3, own=[C(大=FP, 中=S3)], kids=[N(S4, own=[C(大=FP, 中=S4)])])])],
      note='FNA の商品は 中国企業信用調査サービス のみのため、商品ノードを置かない'),
    N(KANRI, own=[C(大=FC, 中=KANRI)]),
])

TABS = [('管理業務', [ADMIN, ADMIN_COMMON]), ('旧申込画面', [OLD_LM, OLD_RM, OLD_FNA])]
HEAD = ['# 調書管理ツール（wreport_admin_base）フロー', '',
        '- ［調査機関切替］＝その画面で調査機関を切り替えて確認するケース。「n件＋共通m件」＝その調査機関のケース＋その画面の 共通 のケース。',
        '- ［付帯サービス］＝付帯サービス（変動通知・不安情報 等）のケース。［機能］＝画面内の機能。',
        '- 同じ画面へ複数の画面から行ける場合は、それぞれの親の下に同じノードを置く（件数も同じ）。',
        '- 旧申込画面＝利用者側プロファイル（report-mvc.xml）で動く旧版の申込画面。大分類は利用者端と同じ 商品【入口】。', '']
