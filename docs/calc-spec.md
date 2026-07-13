# 戦略MG 自動決算 — 計算ロジック仕様書（TS移植用）

本書は `mock/index.html` の `<script>`（L632–2607）から抽出した**完全な計算・ゲームロジック仕様**である。TypeScript 移植時に**同一の数値**を再現できるよう、疑似コード・数式・テーブルとして正確に記述する。行番号は `mock/index.html` を指す。

> 通貨単位はすべて「千円」。`fmt(n) = Math.round(n).toLocaleString('ja-JP')`（四捨五入・表示のみ）。内部計算はJSの浮動小数。四捨五入が明示された箇所（`Math.round`）以外は生値。`Math.round` はJSの丸め（0.5→切り上げ／負値は`Math.round(-2.5)=-2`）に注意。

---

## 1. State shape（`st` オブジェクト）

初期化は `newState()`（L660–673）。`const st = newState()`（L659）。

```js
function newState() {
  return {
    // --- 会社情報 ---
    name:'サンプル製菓', president:'', org:'', period:1,   // 期は1..5
    // --- 期首繰越（前期決算からセット。第1期は0） ---
    openingCash:0, openingCapital:0, retained:0,           // retained=利益剰余金（前期繰越、▲可）
    openingMatQty:0, openingMatVal:0,                       // 期首在庫（材料+製品の合計 個数/金額）
    openingProducts:0,                                     // 上記のうち製品個数
    openingEquipVal:0, openingMachines:0,
    openingStaffMfg:0, openingStaffSales:0, openingLoan:0,
    openingDev:0, openingAds:0,                            // 期首の開発/広告チップ（2枚以上あれば1枚繰越）
    // --- 期中の盤面（recompute で tx から再導出） ---
    matQty:0, matVal:0,        // 材料合計 個数/金額（期首繰越 + 当期仕入）※販売/廃棄では減らさない
    rawCubes:0, products:0,    // 未加工材料の在庫個数 / 製品(店舗陳列)の在庫個数
    machines:0, equipVal:0,    // 機械台数 / 什器簿価
    staffMfg:0, staffSales:0,  // 製造/販売スタッフ人数
    ads:0, dev:0, insurance:0, edu:0, loan:0,  // 広告/開発/保険/教育チップ枚数, 借入残高
    salesQty:0, salesAmt:0,    // 当期の販売個数/売上額（PQ）
    scrapQty:0,                // 当期の廃棄個数（異物混入=製品/水害=材料）
    // --- インストラクター設定（期ごと） ---
    loanMult:1,                // 借入枠の倍率（純資産×倍率）
    repayRate:0,               // 期末強制返済率（%）（期首借入残高×%）
    // --- 記帳・状態フラグ ---
    tx:[], seq:1,              // 現金出納帳の行配列 / ID採番カウンタ
    settled:false,             // 決算確定済み
    closingPrep:false,         // 期末処理（給与/家賃/自動返済）計上済み
    started:false,             // 会社情報「開始」済み
    result:null,               // 決算結果オブジェクト（§7）
  };
}
```

グローバル `const history = []`（L674）は確定済みの各期 `result` を蓄積。

### tx 行（トランザクション）の形

`st.tx` の各要素は次のフィールドを持つ（生成箇所により一部）:

| フィールド | 意味 |
|---|---|
| `id` | 一意ID（`st.seq++`、または借入金利は `'bi'+親id`） |
| `key` | ACTION キー（自動行=給料/家賃/資本金/期首納税等は無し） |
| `fvals` | 入力フィールド値（`{qty, unit, ...}` または `{items:[...]}`） |
| `label` | 表示名 |
| `col` | 出納帳の列 0..10（`null`=現金移動なし） |
| `amount` | 金額（列に加算される絶対値） |
| `noCash` | true=現金移動なし（col=null） |
| `note` | 明細メモ（`rownote`） |
| `isCapital` | 資本金の初期行 |
| `isClosing` | 期末自動計上（給料/家賃/自動返済）→個別削除不可・金額編集可 |
| `isOpeningTax` | 期首の法人税納付（col10） |
| `isOpeningInterest` | 期首の支払金利（col8） |
| `isBorrowInterest` | 借入時金利の派生行（col8、recomputeで再生成） |
| `isAutoRepay` | 期末強制返済（keyは`hensai`） |
| `linkedTo` | 借入金利の親id |

---

## 2. 定数

| 定数 | 値 | 出典 | 意味 |
|---|---|---|---|
| `SALARY_TABLE` | `{1:25, 2:28, 3:31, 4:34, 5:37}` | L635 | 1人あたり給料（期別） |
| `COLS` | `11` | L638 | 出納帳の列数 |
| `IN_COLS` | `[0,1,2,3]` | L639 | 入金列（ア/イ/ウ/A）。それ以外は出金 |
| `LOAN_RATE` | `0.05` | L1167 | 金利5% |
| 家賃（rent） | `25`（固定） | L1368 | 期末家賃 |
| 減価償却/台 | `10` | L1398 `dep = machines*10` | 什器1台あたり |
| 機械単価 | `100`/台 | L695–696 | col=エ什器 |
| 材料市場価格 | `10〜16`（プルダウン `[10,11,12,13,14,15,16]`） | L682 | 仕入単価 |
| 採用費 | `5`/人（失敗分も） | L699 | |
| 広告費 | `10`/枚 | L702 | 販売能力+2 |
| 商品開発費 | `20`/枚（失敗でも発生・1ターン1枚） | L706 | |
| 保険料 | `5`/枚（期末返却） | L710 | |
| 教育費 | `20`/枚（最大1枚・製造能力+1） | L713, L1022 | |
| 配置転換費 | `5`/人 | L717 | |
| 退職金 | `5`/人（人件費 col6） | L751 | |
| クレーム/故障/労災 | `5`（それぞれ販売費/管理費/管理費） | L758,760,762 | |
| 材料在庫上限 | `15`（`rawCubes`） | L965, L996 | |
| 店舗陳列上限 | `15`（`products`） | L1002 | |
| 特別サービス上限 | `5`個 | L1042 | |
| 景気上昇上限 | `3`個 | L1046 | |
| 法人税率 | `30%`、最低 `5` | L1406–1409 | |
| 税抜き資本金既定 | `300` | L142, L1262, L2597 | |

### 能力ルール `caps()`（L1172–1178）

```js
function caps() {
  const workers  = Math.min(st.staffMfg, st.machines * 2);   // 稼働人数：機械1台=製造2人。機械or人が0なら0
  const mfgCap   = workers * (st.edu > 0 ? 3 : 2);           // 製造能力：1人2個・教育チップあれば3個
  const salesCap = st.staffSales*2 + Math.min(st.ads, st.staffSales*2)*2;
                   // 販売能力：販売1人2個 ＋ 広告(販売×2まで有効)×2
  const priceComp= st.dev * 2;                               // 価格競争力：開発チップ1枚=2（表示のみ）
  return { workers, mfgCap, salesCap, priceComp };
}
```

---

## 3. ACTIONS レジストリ（L679–775）

複数行ヘルパー `rowsOf(f)`（L678）:
```js
function rowsOf(f){ return (f && f.items && f.items.length) ? f.items : [{qty: f?f.qty:undefined, unit: f?f.unit:undefined}]; }
```
`multi:true` のアクション（`shiire`/`hanbai`）は `fvals.items = [{qty,unit},...]`。旧形式 `{qty,unit}` は1行扱い。

### 3.1 ルールA

| key | label | rule | col | side | badge | multi | fields | amount | apply（副作用） | rownote |
|---|---|---|---|---|---|---|---|---|---|---|
| `shiire` | 仕入れ | A | 5(オ材料) | out | オ 材料仕入 | ✔ | qty(d0,個), unit(choice[10..16] d10) | `Σ qty*unit` | 各行: `rawCubes+=qty; matQty+=qty; matVal+=qty*unit` | `qty×unit ＋ …` |
| `seizo` | 製造 | A | null | null | 製造（現金移動なし） noCash | | qty(d1,個) | `0` | `n=min(qty,rawCubes); rawCubes-=n; products+=n` | `製品+qty` |
| `hanbai` | 販売 | A | 2(ウ売上) | in | ウ 売上 | ✔ | qty(d1,個), unit(売価P d30) | `Σ qty*unit` | 各行: `n=min(qty,products); products-=n; salesQty+=n; salesAmt+=n*unit`（会計側も実売数n。幽霊販売で期末在庫が負になるのを防ぐ） | `qty×unit ＋ …` |
| `kikai` | 機械購入 | A | 4(エ什器) | out | エ 什器 | | n(d1,台) | `n*100` | `machines+=n; equipVal+=n*100` | — |
| `saiyo` | スタッフ採用 | A | 6(カ人件費) | out | カ 人件費 | | mfg(d0),sales(d0),fail(d0) | `(mfg+sales+fail)*5` | `staffMfg+=mfg; staffSales+=sales`（failは受け取れず加算しない） | `製造mfg・販売sales[・失敗fail]` |
| `koukoku` | 広告 | A | 7(キ販売費) | out | キ 販売費 | | n(d1,枚) | `n*10` | `ads+=n` | — |
| `kaihatsu` | 商品開発 | A | 7(キ販売費) | out | キ 販売費 | | n(d1,枚,fixed), result(choice[成功,失敗] d成功) | `n*20` | `if(result!=='失敗') dev+=n`（失敗でも費用は発生） | `開発 失敗` or `開発+n` |

- 販売販売の `unit`（売価P）は0以上でも可。`qty` は1以上（バリデーション）。
- `saiyo` の `fail` は費用は取られるがスタッフは増えない。

### 3.2 ルールB（1ターン1度まで — §7）

| key | label | rule | col | side | badge | fields | amount | apply | rownote |
|---|---|---|---|---|---|---|---|---|---|
| `hoken` | 保険加入 | B | 8(ク管理費) | out | ク 管理費 | n(d1,枚) | `n*5` | `insurance+=n` | — |
| `kyoiku` | 教育 | B | 8(ク管理費) | out | ク 管理費 | n(d1,枚,fixed) | `n*20` | `edu+=n`（最大1・製造能力+1） | — |
| `haichi` | 配置転換 | B | 8(ク管理費) | out | ク 管理費 | n(d1,人), dir(choice[製造→販売,販売→製造] d製造→販売) | `n*5` | `製造→販売`: `m=min(n,staffMfg); staffMfg-=m; staffSales+=m` ／ 逆方向は対称 | dir |
| `kariire` | 借入 | B | 1(イ借入金) | in | イ 借入金 | a(d100,千, dynMax:loanRoom) | `a` | `loan+=a` | — |
| `hensai` | 借入返済 | B | 9(ケ返済) | out | ケ 返済 | a(d0,千) | `a` | `loan=max(0, loan-a)` | — |

- `kariire`: 第1期は不可。借入額は `loanRoom()` でクランプ（§9）。**借入時、recompute で借入額×5%の金利行（col8）を自動生成**（§5）。

### 3.3 イベントカード（rule='X'）

カテゴリ表示順 `EVENT_CATS = ['販売機会','仕入機会','在庫被害','退職','費用・トラブル','手番のみ']`（L777）。

#### 販売機会

| key | label | cat | col | side | fields | amount | apply | rownote |
|---|---|---|---|---|---|---|---|---|
| `kaihatsu_win` | 商品開発成功！ | 販売機会 | 2(ウ売上) | in | qty(d0,個,min0) | `qty*32` | `n=min(qty,products); products-=n; salesQty+=n; salesAmt+=n*32` | `qty×32` or `効果なし`(qty=0) |
| `dokusen` | 独占販売！ | 販売機会 | 2(ウ売上) | in | qty(d0,個,min0), unit(d30,min0) | `qty*unit` | `n=min(qty,products); products-=n; salesQty+=n; salesAmt+=n*unit` | `独占 qty×unit` or `効果なし` |

- `kaihatsu_win` 上限: `2*st.dev`（開発チップ×2）かつ `salesCap`・`products`。qty=0は記帳可。
- `dokusen` 上限: `2*staffSales`（販売×2）かつ `products`。qty=0は記帳可。

#### 仕入機会

| key | label | cat | col | side | fields | amount | apply | rownote |
|---|---|---|---|---|---|---|---|---|
| `tokubai` | 特別サービス！ | 仕入機会 | 5(オ材料) | out | qty(d0,個,min0) | `qty*10` | `rawCubes+=qty; matQty+=qty; matVal+=qty*10` | `qty×10` or `効果なし` |
| `keiki` | 景気上昇 | 仕入機会 | 5(オ材料) | out | qty(d0,個,min0) | `qty*12` | `rawCubes+=qty; matQty+=qty; matVal+=qty*12` | `qty×12` or `効果なし` |

- `tokubai` 上限5個、`keiki` 上限3個。どちらも `rawCubes+qty<=15`。

#### 在庫被害（`custom:true` — 専用ダイアログ `eventCard`、§3.5）

| key | label | cat | col | side | fields | amount | apply | rownote |
|---|---|---|---|---|---|---|---|---|
| `ibutsu` | 異物混入 | 在庫被害 | 3(A保険金)※ | in※ | (custom) | `f.payout||0` | `d=min(discard,products); products-=d; scrapQty+=d; if(insuredUsed) insurance=max(0,insurance-insuredUsed)` | `製品破棄d[・保険金]` |
| `suigai` | 水害発生 | 在庫被害 | 3(A保険金)※ | in※ | (custom) | `f.payout||0` | `d=min(discard,rawCubes); rawCubes-=d; scrapQty+=d; if(insuredUsed) insurance=max(0,insurance-insuredUsed)` | `材料破棄d[・保険金]` |

※ 保険金が出るとき（`payout>0`）のみ col=3・side=in。保険なし（payout=0）は `col=null, noCash=true`（L1138）。

#### 退職

| key | label | cat | col | side | fields | amount | apply | rownote |
|---|---|---|---|---|---|---|---|---|
| `taishoku_mfg` | 製造スタッフ退職 | 退職 | 6(カ人件費) | out | [] | `5` | `if(staffMfg>0) staffMfg--` | `製造 退職` |
| `taishoku_sales` | 販売スタッフ退職 | 退職 | 6(カ人件費) | out | [] | `5` | `if(staffSales>0) staffSales--` | `販売 退職` |

- 退職金5（人件費）。**期末に給料の半額(切上)を追加支払う**（§6）。

#### 費用・トラブル

| key | label | cat | col | side | fields | amount | apply | rownote |
|---|---|---|---|---|---|---|---|---|
| `claim` | クレーム発生 | 費用・トラブル | 7(キ販売費) | out | [] | `5` | なし | `処理費5` |
| `kitchen` | 厨房機器故障 | 費用・トラブル | 8(ク管理費) | out | [] | `5` | なし | `修理費5` |
| `rousai` | 労災発生 | 費用・トラブル | 8(ク管理費) | out | [] | `5` | なし | `治療費5` |

#### 手番のみ（noCash・記録のみ）

| key | label | cat | col | side | fields | amount | apply | rownote |
|---|---|---|---|---|---|---|---|---|
| `kansen` | 感染症の流行 | 手番のみ | null | null | [] | `0` | なし | `今回休み` |
| `chiiki` | 地域行事参加 | 手番のみ | null | null | [] | `0` | なし | `今回休み` |
| `fuhyo` | 風評被害発生 | 手番のみ | null | null | [] | `0` | なし | `今回休み` |
| `gyaku` | 逆回り | 手番のみ | null | null | [] | `0` | なし | `逆回り` |
| `kaihatsu_fail` | 商品開発失敗 | 手番のみ | null | null | [] | `0` | `if(dev>0) dev--` | `開発 −1` |

### 3.4 フィールド属性まとめ

- `d`: 既定値。`s`: 単位ラベル。`min`: 最小。`max`: 最大。`fixed:true`: 編集不可（既定値固定）。`choice`: プルダウン選択肢（`num:true`なら数値化）。`dynMax:'loanRoom'`: 上限を `loanRoom()` 動的算出。`dyn:'loan'`: 既定値を `st.loan`。

### 3.5 在庫被害の専用ロジック `eventCard(key)`（L1125–1160）

```
recompute()   // 最新の盤面を反映
if key==='ibutsu': discard = min(2, products); target='製品'
else /*suigai*/:   discard = rawCubes;          target='材料'  // 材料を全破棄
insured   = (insurance > 0)
payout    = insured ? discard*10 : 0            // 破棄個数 × 10（保険加入時のみ）
insuredUsed = insured ? 1 : 0                   // 保険チップ1枚返却
col  = payout>0 ? 3 : null
noCash = payout<=0
tx.push({key, fvals:{discard, payout, insuredUsed}, col, amount:payout, noCash, ...})
```

---

## 4. 列（col）セマンティクス

`COLS=11`, `IN_COLS=[0,1,2,3]`（入金）。それ以外（4..10）は出金。

| col | 記号 | 名称 | 区分 | 意味 |
|---|---|---|---|---|
| 0 | ア | 資本金 | 入金 | 出資・増資 |
| 1 | イ | 借入金 | 入金 | 借入 |
| 2 | ウ | 売上 | 入金 | 販売収入（PQ） |
| 3 | A | 受取保険金 | 入金 | 在庫被害の保険金 |
| 4 | エ | 什器 | 出金 | 機械購入 |
| 5 | オ | 材料仕入 | 出金 | 材料仕入 |
| 6 | カ | 人件費 | 出金 | 採用/退職金/給料 |
| 7 | キ | 販売費 | 出金 | 広告/商品開発/クレーム |
| 8 | ク | 管理費 | 出金 | 保険/教育/配置転換/借入金利/家賃/厨房故障/労災 |
| 9 | ケ | 借入金返済 | 出金 | 返済 |
| 10 | コ | 納税 | 出金 | 期首の法人税納付 |

集計:
```js
function colTotals(){ const t=Array(11).fill(0); st.tx.forEach(x=>{ if(x.col!=null) t[x.col]+=x.amount; }); return t; }  // L1163
function flows(){ let inS=0,outS=0; st.tx.forEach(x=>{ if(x.col==null) return; (IN_COLS.includes(x.col)? inS+=x.amount : outS+=x.amount); }); return {inS,outS}; }  // L1164
function cashNow(){ const {inS,outS}=flows(); return st.openingCash + inS - outS; }  // L1165
```

---

## 5. `recompute()`（L1233–1250）— 盤面をtxから再導出

```js
function recompute() {
  // (A) 借入金利の派生行を作り直す（借入行の直後に挿入）
  rebuilt = []
  for t of st.tx:
    if t.isBorrowInterest: continue                      // 旧派生行を捨てる
    rebuilt.push(t)
    if t.key==='kariire':
      bi = Math.round((t.amount||0) * 0.05)              // 借入額×5%（四捨五入）
      if bi>0: rebuilt.push({ id:'bi'+t.id, col:8, amount:bi,
                              label:'借入金利', note:`借入{fmt(amount)}×5%`,
                              isBorrowInterest:true, linkedTo:t.id })
  st.tx = rebuilt

  // (B) 期首繰越在庫を材料/製品に分けてセット
  op = Math.min(st.openingProducts||0, st.openingMatQty)  // 製品の期首個数
  st.matQty = st.openingMatQty
  st.matVal = st.openingMatVal
  st.products = op
  st.rawCubes = st.openingMatQty - op                     // 残りが未加工材料

  // (C) 盤面を期首値で初期化
  st.machines   = st.openingMachines
  st.equipVal   = st.openingEquipVal
  st.staffMfg   = st.openingStaffMfg
  st.staffSales = st.openingStaffSales
  st.loan       = st.openingLoan
  st.ads = st.openingAds||0
  st.dev = st.openingDev||0
  st.insurance = 0; st.edu = 0                            // 保険/教育は繰越しない（毎期リセット）
  st.salesQty = 0; st.salesAmt = 0; st.scrapQty = 0

  // (D) tx を順に再生（apply）
  for t of st.tx:
    if t.key && ACTIONS[t.key]: ACTIONS[t.key].apply(t.fvals || {})
}
```

**重要**: `matQty`/`matVal` は仕入・仕入イベントで**増加のみ**する（販売・製造・廃棄では減らさない）。これは期末の平均単価計算（§7）の基礎になる。`rawCubes`/`products` は盤面上の物理在庫として増減する。

---

## 6. `doClosingPrep()`（L1356–1374）— 期末処理の計上

給料の退職者半額ルール・家賃・期末強制返済を tx に追加する。

```js
function doClosingPrep() {
  if (st.settled || st.closingPrep) return
  recompute()
  SAL   = SALARY_TABLE[st.period] || 28
  head  = st.staffMfg + st.staffSales                     // 期末在籍者数
  retired = count(tx where key ∈ {taishoku_mfg, taishoku_sales})  // 当期退職イベント数
  halfPer = Math.ceil(SAL / 2)                            // 退職者1人あたり半額(切上)
  retSalary = retired * halfPer
  salary = head * SAL + retSalary                         // ★給料 = 在籍×給料表 + 退職者×半額

  if salary>0: tx.push({label:'給料(期末)', col:6, amount:salary,
                        note: retired>0 ? `在籍{head}×{SAL}＋退職{retired}×{halfPer}(半額)` : `{head}×{SAL}`,
                        isClosing:true})
  tx.push({label:'家賃(期末)', col:8, amount:25, isClosing:true})   // 家賃固定25（管理費）

  // 期末強制返済 = min( round(期首借入残高 × 返済率% / 100), 現在の借入残高 )
  repay = Math.min( Math.round(st.openingLoan * st.repayRate / 100), st.loan )
  if repay>0: tx.push({key:'hensai', fvals:{a:repay}, label:'借入金返済(期末)', col:9,
                       amount:repay, note:`期首残高{fmt(openingLoan)}×{repayRate}%`,
                       isClosing:true, isAutoRepay:true})
  st.closingPrep = true
  recompute()
}
```

`undoClosingPrep()`（L1375–1380）: `tx` から `isClosing` を全除去し `closingPrep=false`、`recompute()`。

---

## 7. `settle()`（L1381–1448）— 決算アルゴリズム

```js
function settle() {
  if (st.settled) return
  if (!st.closingPrep) doClosingPrep()      // 給料/家賃/返済が未計上なら先に計上
  recompute()

  salRow  = tx.find(isClosing && col===6);  salary = salRow ? salRow.amount : 0
  rentRow = tx.find(isClosing && col===8);  rent   = rentRow ? rentRow.amount : 25
  tot = colTotals()                          // 長さ11
  {inS, outS} = flows()

  // ---- STRAC / 原価計算 ----
  PQ  = tot[2]                                                  // 売上高（col ウ）
  avg = st.matQty ? Math.round(st.matVal / st.matQty) : 0       // ④平均単価（四捨五入）
  scrapQ   = st.scrapQty || 0                                   // 破棄個数（異物=製品/水害=材料）
  scrapVal = avg * scrapQ                                       // ⑥廃棄損 = 平均単価×破棄個数
  endInvQty = st.matQty - st.salesQty - scrapQ                  // ⑤次期繰越 個数
  endInvVal = avg * endInvQty                                   // ⑤次期繰越 金額
  vPQ = st.matVal - scrapVal - endInvVal                        // ⑦売上原価（残余法で整数一致）
  mPQ = PQ - vPQ                                                // 粗利益
  dep = st.machines * 10                                        // 減価償却
  F   = tot[6] + tot[7] + tot[8] + dep                          // 固定費 = 人件費+販売費+管理費+減価償却
  G   = mPQ - F                                                 // 経常利益

  // ---- 特別損益 → 税引前 → 法人税 ----
  special = tot[3] - scrapVal                                   // ①特別損益 = 受取保険金(A) − 廃棄損
  pretax  = G + special                                         // ②税引前当期純利益
  ret0b   = st.retained                                         // ③前期繰越利益剰余金（▲可）
  total4  = pretax + ret0b                                      // ④合計

  // ⑤法人税等（来期の期首納税額）
  if (pretax<0 || total4<0)  tax = 5                            // ②か④が▲なら5
  else if (ret0b<0)          tax = Math.round(total4 * 0.3)     // 前繰▲・合計+ なら 合計×30%
  else                       tax = Math.round(pretax * 0.3)     // それ以外 税引前×30%
  tax = Math.max(tax, 5)                                        // 最低5

  net = pretax - tax                                            // ⑥当期純利益

  // ---- ターン数・意思決定回数 ----
  decisions = count(tx where ACTIONS[key].rule==='A')          // 意思決定回数（ルールA）
  events    = count(tx where ACTIONS[key].rule==='X')          // イベント回数
  // turns = decisions + events

  // ---- 期末残高 ----
  cashEnd  = st.openingCash + inS - outS
  equipEnd = st.equipVal - dep
  loanEnd  = st.loan
  capEnd   = st.openingCapital + tot[0]
  retEnd   = st.retained + net
  assets   = cashEnd + endInvVal + equipEnd
  liabEq   = tax + loanEnd + capEnd + retEnd                    // 未払法人税+借入+資本+剰余金
  // diff = assets - liabEq（貸借一致チェック）

  st.result = { ... }        // §10 参照
  st.settled = true
  history.push(st.result)
  // saveOrg（localStorage）, 再描画
}
```

### 税の分岐（要点）

| 条件 | tax |
|---|---|
| `pretax<0` または `total4<0` | 5 |
| 上記以外かつ `ret0b<0`（前繰▲だが合計+） | `round(total4*0.3)` |
| それ以外 | `round(pretax*0.3)` |
| すべて後、`tax = max(tax, 5)` | 最低5 |

### 在庫の整合（残余法）

- `matVal`（材料合計金額）と `matQty`（合計個数）は仕入だけで積み上がる。
- `avg = round(matVal/matQty)`。
- `endInvVal = avg*endInvQty`、`scrapVal = avg*scrapQ` は整数化。
- `vPQ = matVal - scrapVal - endInvVal`（残余）→ `endInvVal+scrapVal+vPQ = matVal` が厳密に一致（丸め誤差を売上原価に吸収）。

---

## 8. `nextPeriod()`（L1870–1890）— 次期へ繰越

```js
function nextPeriod() {
  if (!st.settled) { alert('先に決算を'); return }
  r = st.result
  // 期首残高へ繰越
  st.openingCash    = r.cashEnd
  st.openingCapital = r.capEnd
  st.retained       = r.retEnd
  st.openingMatQty  = r.endInvQty
  st.openingMatVal  = r.endInvVal
  st.openingProducts= Math.min(r.prodEnd||0, r.endInvQty)   // 製品を製品として引継（残りが材料）
  st.openingEquipVal= r.equipEnd
  st.openingMachines= r.machines
  st.openingStaffMfg= r.staffMfg
  st.openingStaffSales= r.staffSales
  st.openingLoan    = r.loanEnd
  st.openingDev = (r.dev >= 2) ? 1 : 0       // 開発チップ2枚以上なら1枚繰越、それ未満は0
  st.openingAds = (r.ads >= 2) ? 1 : 0       // 広告チップも同様

  st.period = Math.min(5, st.period + 1)     // 期は最大5でキャップ
  st.tx = []; st.settled = false; st.closingPrep = false; st.result = null

  // 期首自動記帳（第5期の決算後＝r.period<5 のときのみ生成）
  if (r.period<5 && r.tax>0)
    tx.push({label:'法人税納付(期首)', col:10, amount:r.tax, note:'前期確定', isOpeningTax:true})
  if (r.period<5 && r.loanEnd>0) {
    intr = Math.round(r.loanEnd * 0.05)      // 期首支払金利 = 期首借入残高×5%
    if (intr>0)
      tx.push({label:'支払金利(期首)', col:8, amount:intr, note:`残高{fmt(loanEnd)}×5%`, isOpeningInterest:true})
  }
  recompute()
  // 描画・opening タブへ
}
```

- **期首納税**（col10, `isOpeningTax`）と**期首支払金利**（col8, `isOpeningInterest`）は前期 `result` から生成。`r.period<5` のガードにより、第5期の決算後（＝6期は無い）は生成しない。
- チップ繰越: 開発・広告のみ「2枚以上→1枚」。保険・教育は繰越なし（recompute で毎期0）。

---

## 9. 借入枠 `loanCap` / `loanRoom` / `equityNow`（L1166–1170）

```js
const LOAN_RATE = 0.05
function equityNow(){ return st.openingCapital + colTotals()[0] + st.retained; }  // 純資産 = 期首資本+当期資本(ア)+期首剰余金
function loanCap(){  return st.period<=1 ? 0 : Math.max(0, Math.round(equityNow() * st.loanMult)); }  // 借入枠。第1期は0
function loanRoom(excludeAmt=0){ return Math.max(0, loanCap() - (st.loan - excludeAmt)); }  // 今期借入可能額 = 枠 − 残高（編集中の行分は除外）
```

- **第1期は借入不可**（`loanCap()=0`、`openModal` でも `period<=1` を弾く L842）。
- `openModal('kariire')`: `curMaxA = loanRoom(編集中の借入額)`。`curMaxA<=0` ならアラート。
- バリデーション: `a > curMaxA` でエラー（L1013）。

---

## 10. `result` フィールド（`st.result`、L1421–1441）

`settle()` が生成し `history` に積む。全フィールド:

| フィールド | 定義 | 用途 |
|---|---|---|
| `period` | `st.period` | 期 |
| `PQ` | `tot[2]` | 売上高 |
| `vPQ` | 売上原価（残余） | 変動費 |
| `mPQ` | `PQ-vPQ` | 粗利益 |
| `F` | `tot[6]+tot[7]+tot[8]+dep` | 固定費 |
| `G` | `mPQ-F` | 経常利益 |
| `tax` | 法人税等 | 来期期首納税 |
| `net` | `pretax-tax` | 当期純利益 |
| `dep` | `machines*10` | 減価償却 |
| `salary` | 給料合計 | 表示 |
| `avg` | `round(matVal/matQty)` | 平均単価 |
| `rent` | `25`（または期末行金額） | 家賃 |
| `special` | `tot[3]-scrapVal` | 特別損益 |
| `pretax` | `G+special` | 税引前 |
| `total4` | `pretax+ret0b` | 合計 |
| `Q` | `st.salesQty` | 販売個数 |
| `laborF` | `tot[6]` | 人件費（固定費内訳） |
| `sellF` | `tot[7]` | 販売費 |
| `adminF` | `tot[8]` | 管理費 |
| `depF` | `dep` | 減価償却 |
| `cashEnd` | `openingCash+inS-outS` | 期末現金 |
| `endInvQty` | `matQty-salesQty-scrapQ` | 次期繰越個数 |
| `endInvVal` | `avg*endInvQty` | 次期繰越金額（B/S在庫） |
| `equipEnd` | `equipVal-dep` | 期末什器 |
| `loanEnd` | `st.loan` | 期末借入 |
| `capEnd` | `openingCapital+tot[0]` | 期末資本金 |
| `retEnd` | `retained+net` | 次期繰越利益剰余金 |
| `assets` | `cashEnd+endInvVal+equipEnd` | 資産合計 |
| `liabEq` | `tax+loanEnd+capEnd+retEnd` | 負債・純資産合計 |
| `diff` | `assets-liabEq` | 貸借差（≒0が正） |
| `ret0` | `st.retained` | 前期繰越剰余金 |
| `cashFlow` | `inS-outS` | 現金増減 |
| `openCash` | `st.openingCash` | 期首現金 |
| `eq0` | `st.openingEquipVal` | 期首什器 |
| `loan0` | `st.openingLoan` | 期首借入 |
| `salesQty` | `st.salesQty` | 販売個数 |
| `machines` | `st.machines` | 機械台数 |
| `staffMfg`/`staffSales` | 期末スタッフ | 繰越用 |
| `inSum`/`outSum` | `inS`/`outS` | 入金/出金合計 |
| `openMatQty`/`openMatVal` | 期首在庫 個数/金額 | 棚卸 |
| `matBoughtQty` | `matQty-openingMatQty` | 当期仕入個数 |
| `matBoughtVal` | `matVal-openingMatVal` | 当期仕入金額 |
| `totMatQty` | `st.matQty` | 材料合計個数 |
| `totMatVal` | `st.matVal` | 材料合計金額 |
| `scrap` | `scrapQ` | 破棄個数 |
| `boardInvQty` | `rawCubes+products` | 盤面在庫数 |
| `diffQty` | `(matQty-salesQty-scrapQ)-(rawCubes+products)` | 棚卸差異（理論上0） |
| `rawEnd`/`prodEnd` | `rawCubes`/`products` | 期末 材料/製品 |
| `dev`/`ads` | 期末チップ | 繰越判定用 |
| `turns` | `decisions+events` | ターン数（A＋イベント） |
| `decisions` | ルールA件数 | 意思決定回数 |
| `equipTotal` | `st.equipVal` | 什器合計 |
| `equipBought` | `equipVal-openingEquipVal` | 当期什器購入 |
| `loanBorrow` | `tot[1]` | 当期借入 |
| `loanRepay` | `tot[9]` | 当期返済 |
| `name`/`president` | 会社名/社長 | PDF |
| `colTot` | `tot.slice()` | 列別内訳（CF/PDF） |
| `rows` | `tx.map({label,note,col,amount})` | 出納帳明細 |
| `capStart` | `st.openingCapital` | 期首資本 |
| `loanMult`/`repayRate` | インストラクター設定 | 表示 |
| `openInterest` | `round(openingLoan*0.05)` | 期首支払金利 |

### histLite（L2295）— 組織/管理者ビュー用の軽量サマリ

```js
histLite(hs) = hs.map(r => ({ period, G, PQ, mPQ, F, net, capEnd, retEnd, cashEnd,
                              turns: r.turns||0, decisions: r.decisions||0 }))
```

---

## 11. 派生表示値（display-only）

これらは表示用で、決算結果 `r` を入力に画面上で算出する。移植時は同一式で再現。

### 11.1 STRAC 数値・比率（`renderStatement` L1659–1665, `renderStrac` L1810–1811）

```js
原価率      = r.PQ ? Math.round(r.vPQ / r.PQ * 100) + '%' : '–'    // st-cr
粗利率      = r.PQ ? Math.round(r.mPQ / r.PQ * 100) + '%' : '–'    // st-gp
損益分岐点   = r.mPQ ? Math.round(r.F / r.mPQ * 100) + '%' : '–'    // st-bep（FM比率）
// 単価 P = V + M（STRAC図）
P = r.Q ? Math.round(r.PQ / r.Q) : 0     // 売上単価
V = r.Q ? Math.round(r.vPQ / r.Q) : 0    // 変動単価
M = r.Q ? Math.round(r.mPQ / r.Q) : 0    // 粗利単価
```
KPIヘルパー（L2207–2209）:
```js
mRate(r)   = r.PQ ? r.mPQ/r.PQ*100 : 0                    // 粗利率（MQ率）
bepRate(r) = r.mPQ>0 ? r.F/r.mPQ*100 : (r.G<0 ? 150 : 0)  // 損益分岐点比率（FM比率）
equityOf(r)= r.capEnd + r.retEnd                          // 自己資本
```
FM比率の推移（L2273 / L2346）は `r.mPQ>0 ? r.F/r.mPQ*100 : (r.G<0?150:0)`（粗利0以下かつ赤字なら150%固定）。

### 11.2 P/L ウォーターフォール（`plWaterfall` L1742–1755）

累積バー。`run` は累積残高、各バーは `[lo,hi]=[min(s,run),max(s,run)]`:
```
売上高  : +PQ
変動費  : -vPQ         → run=PQ-vPQ
粗利    : リセット表示 mPQ（=PQ-vPQ）
人件費  : -laborF
減価償却: -depF
販売費  : -sellF
管理費  : -adminF
経常利益: G（=mPQ-laborF-depF-sellF-adminF、赤字なら赤色）
```

### 11.3 STRAC 図の高さ計算（`renderStrac` L1796–1811）

```
PQ_=max(PQ,1); MAXH=240; maxVal=max(PQ, vPQ+F, 1); sc=MAXH/maxVal
hpx(v)=max(2, round(|v|*sc)); loss = (G<0)
pqH=max(36, round(PQ*sc)); vH=hpx(vPQ); mH=max(2, pqH-vH)
黒字: fH=min(mH, hpx(F)); gH=max(2, mH-fH)
赤字: lossH=hpx(-G); fHloss=mH+lossH
```

### 11.4 B/S 図（`bsFigHTML` L1687–1702）

- 資産列: 現金 `cashEnd` / 在庫 `endInvVal` / 什器 `equipEnd`。
- 負債・純資産列: 未払税 `tax` / 借入 `loanEnd` / （`retEnd>=0` なら 資本金 `capEnd`＋剰余金 `retEnd`、`retEnd<0` なら「純資産 `capEnd+retEnd`」を1セグメント）。
- 一致判定 `ok = |diff| < 0.5`。

### 11.5 キャッシュフロー（`renderCF` L1756–1779 / `cfWaterfall` L1730–1740）

`c = r.colTot`（長さ11）から:
```js
営業CF opCF = c[2] + c[3] − c[5] − c[6] − c[7] − c[8] − c[10]
             (売上 + 受取保険金 − 材料仕入 − 人件費 − 販売費 − 管理費 − 納税)
投資CF invCF = − c[4]                    (什器購入)
財務CF finCF = c[0] + c[1] − c[9]        (資本金 + 借入 − 返済)
現金増減 netCF = opCF + invCF + finCF
期末現金 = r.openCash + netCF            (＝ r.cashEnd に一致)
```
CF内訳の各明細行は上式の各項をそのまま表示。

### 11.6 棚卸（個数）整合（`renderFigs` fig1 L1602–1605）

```
① 前期繰越   = openMatQty
② 材料仕入個数 = matBoughtQty        (= totMatQty − openMatQty)
③ 合計       = totMatQty            (= ①+②)
④ 売上個数   = salesQty
⑤ 廃棄等     = scrap
⑥ 会社盤在庫 = boardInvQty          (= rawEnd + prodEnd)
⑦ 差異数     = diffQty              (= ③−④−⑤−⑥、理論上0)
```
在庫金額計算（fig2 L1608–1611）:
```
④ 平均単価 = avg = round(totMatVal / totMatQty)
⑤ 次期繰越 = endInvVal (= avg×endInvQty)
⑥ 廃棄等   = scrap×avg
⑦ 売上原価 = vPQ (= ③totMatVal − ⑤ − ⑥)
```

### 11.7 補助勘定（`renderStatement` L1677–1680）

```
現金: 前期繰越 openCash ／ ±増減 cashFlow ／ 次期繰越 cashEnd
什器: 前期繰越 eq0     ／ −減価償却 dep    ／ 次期繰越 equipEnd
借入: 前期繰越 loan0   ／ ±(loanEnd−loan0) ／ 次期繰越 loanEnd
在庫: 平均単価 avg / 売上原価 vPQ / 次期繰越 (endInvQty 個 / endInvVal)
```

### 11.8 利益構造バー（`renderStructure` L2211–2225）

各期 `r`:
```
v    = vPQ
fCov = min(F, max(0, PQ − v))        (粗利で賄えた固定費部分)
prof = max(0, G)                     (利益)
loss = max(0, −G)                    (損失)
```
`変動費(緑) | 固定費(青) | 利益(橙 or 損失赤)`、PQ位置に基準線。

### 11.9 履歴テーブル行（`renderHistory` L1896–1901）

各 `r`: 期 / PQ / vPQ / mPQ / F / G / net / **自己資本 `capEnd+retEnd`** / cashEnd / 決算書ボタン。

### 11.10 ハイライトカード（`renderScore` L2226–2244）

経常利益G, 売上PQ, 粗利率 `round(mRate)`%, 自己資本 `equityOf`。前期比 delta 付き。

### 11.11 組織ランキング指標（`ORG_METRICS` L2340–2349）

| k | label | get(h) | good |
|---|---|---|---|
| EQ | 純資産 | `capEnd+retEnd` | desc |
| G | 経常利益G | `G` | desc |
| net | 当期純利益 | `net` | desc |
| PQ | 売上PQ | `PQ` | desc |
| MR | 粗利率 | `PQ? mPQ/PQ*100 : 0` | desc |
| FM | FM比率 | `mPQ>0? F/mPQ*100 : (G<0?150:0)` | asc |
| turns | ターン数 | `turns||0` | desc |
| dec | 意思決定 | `decisions||0` | desc |

---

## 12. バリデーション要点（`actionErrors` L945–1050）

移植時、記帳可否判定に必要。`baseCounts(editId)`（L939–944）は編集中行を除いた盤面スナップ（`rawCubes,products,ads,edu,staffMfg,staffSales,loan`）。`caps()` は §2。

- **数値フォーマット**: 数量系は整数≥1、金額系（`a`, `hanbai.unit`）は整数≥0。`fl.min`/`fl.max` があればそれを優先。`choice` はスキップ。
- **複数行（shiire/hanbai）**: 各行フォーマット＋合計判定。`shiire`: `baseRawCubes + Σqty ≤ 15`。`hanbai`: `Σqty ≤ salesCap` かつ `Σqty ≤ products`。
- **ルールB 1ターン1回**: 直近のルールA/イベント（手番主行動）以降に既にルールBがあれば不可（自動行は無視、L985–992）。
- **単票アクション別**:
  - `shiire`: `rawCubes + qty ≤ 15`
  - `seizo`: `machines>0` かつ `staffMfg>0` かつ `qty ≤ mfgCap` かつ `qty ≤ rawCubes` かつ `products + qty ≤ 15`
  - `hanbai`: `qty ≤ salesCap` かつ `qty ≤ products`
  - `haichi`: 方向側スタッフ数 ≥ n
  - `kariire`: `a ≤ curMaxA(=loanRoom)`
  - `hensai`: `a ≤ loan`
  - `saiyo`: `mfg+sales+fail ≥ 1`
  - `kyoiku`: `edu + n ≤ 1`
  - `kaihatsu_win`（qty>0時）: `qty ≤ 2*dev` かつ `≤ salesCap` かつ `≤ products`
  - `dokusen`（qty>0時）: `qty ≤ 2*staffSales` かつ `≤ products`
  - `tokubai`: `qty ≤ 5` かつ（qty>0時）`rawCubes+qty ≤ 15`
  - `keiki`: `qty ≤ 3` かつ（qty>0時）`rawCubes+qty ≤ 15`

### 12.1 台帳の再検証と決算前チェック（app実装 game.ts / calc.ts）

記帳の新規追加時だけでなく、**過去にさかのぼって前提を崩す操作**の後にも台帳全体を検証する。

- **`revalidateLedger(st)`**（game.ts）: 各アクション行を「その行より前の行だけを適用した状態」で `validate` し直す。エラーがあれば行ラベル付きで全件返す。
- 呼び出し箇所（いずれもエラー時は**操作を取り消して**エラーを返す）:
  - `deleteRow` … 行削除（例：販売済みの仕入・製造行の削除を拒否）
  - `editActionRow` … アクション行の編集（編集行自身も前置状態で検証）
  - `editAmountRow` … キーレス行の金額変更（増資は借入枠に影響）
  - `setBoard`（期首処理の盤面変更）・`setInstr`（借入倍率変更）
- **イベント行の再検証**: `kaihatsu_win`/`dokusen`/`tokubai`/`keiki`/`taishoku_*` は §12 の各チェックがそのまま適用される。`suigai`/`ibutsu` は記帳時に盤面から fvals（discard/payout/insuredUsed）を自動算出・固定するため記帳時チェックは不要だが、前方の行を消すと根拠が消える（幽霊保険金）ため、再検証用のチェックを追加: `discard ≤ 在庫（rawCubes/products）`・ibutsu は `discard ≤ 2`・`payout>0 → insurance>0`・`payout ≤ discard×10`。
- **`undoSettle(st, history)`**（game.ts）: 決算の取り消し。当期の `result`・履歴エントリを破棄し、期末の自動行（`isClosing`）を外して `closingPrep=false` に戻す。「次の期へ進む」前のみ（進んだ後は `settled=false` のため対象外）。サーバー `saveState` はクライアントが送る全履歴に無い期の `period_results` を削除するため、取り消しはリロード後・成績一覧にも反映される。UI では期末処理・決算・決算取り消しの各ボタンに確認モーダル（ConfirmModal）を挟む。
- **`settleBlockReason(st)`**（calc.ts）: 決算実行前に `期末在庫個数 = matQty − salesQty − scrapQty` が負、または盤面個数 `rawCubes+products` と不一致なら理由文字列を返し、決算をブロックする（正常な台帳では常に null。旧データ破損への安全網）。

---

## 13. 会社開始・期セレクタ・初期化（補足）

- **開始 `c-apply`（L2411–2424）**: 会社名/社長名/組織コード必須。`period`・`capital`（既定300）を設定し、資本金行（`isCapital`, col0）の金額を更新（無ければ先頭に追加）。`started=true`。以後 `opening` タブへ。
- **`ledger-clear`（L1252）**: `isCapital`/`isOpeningTax`/`isOpeningInterest` 以外を全消去、`closingPrep=false`。
- **初期化（L2597）**: 未復元時、資本金行 `{label:'資本金', col:0, amount:300, isCapital:true}` を先頭に置いて開始。
- 期セレクタは到達済みの期のみ。過去期選択で `stmtView` にその期の `result` を入れて決算書を閲覧（データ変更なし）。

---

## 付録: 数値追跡例（第1期・SEED_PROFIT L1271–1276）

参考テストデータ（`kariire` は第1期不可のため実際は借入枠0で弾かれるが、seed は直接txに積む点に注意）:
```
kariire 200 → kikai 1 → saiyo(mfg2,sales1) → shiire(10×13) → koukoku 1
→ kaihatsu(1,成功) → hoken 1 → kyoiku 1 → seizo 8 → hanbai(8×50)
```
（seed は `add()` で直接 `tx.push` するためバリデーションを通らない。通常UIでは第1期の借入は不可。）

移植の検証は、同一 tx 列を投入して `recompute()`→`doClosingPrep()`→`settle()` を実行し、`st.result` の全フィールドがビット単位でなくとも `Math.round` 後に一致することを確認する。特に `avg`・`vPQ`（残余）・`tax`（分岐）・`diff`（貸借一致=0）を重点確認。
