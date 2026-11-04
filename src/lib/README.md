# src/lib の計算（③内部ロジック）

ここにあるのは、すべて**ふつうの計算（純関数）**です。AI は使いません。同じ入力なら必ず同じ結果になります。
画面（/orders・/plan・/purchase）はこの関数を呼んで表示するだけにしてください。

テスト: `npm test`（vitest）

## まず使うもの: 通し計算

```ts
import { runPipeline } from "@/lib/pipeline";
const r = runPipeline(db.orders, "2026-11-06");
```

| 戻り値 | 中身 | 使う画面 |
|---|---|---|
| `r.totals` | 納品日の集計（商品ごとの個数・得意先の内訳） | /orders・/plan |
| `r.productPurchaseOrders` | 仕入品の発注書の**下書き**（仕入先×便ごと） | /purchase |
| `r.production` | 製造計画（生地kg・ミキサー回数・材料kg・ライン別の数と上限の警告・包み直し） | /plan |
| `r.schedule` / `r.scheduleSummary` | 工程表（工程ごとの開始・終了の分）／ラインごとの開始・終了・のべ作業分 | /plan |
| `r.materials` | 材料の所要量（kg と材料の単位） | /plan |
| `r.shortages` | その日1日分の、在庫と比べた不足・発注数 | /purchase |
| `r.materialPlan` | 何日か先まで（既定3日）の材料の計画。材料ごとに日ごとの 使う量・在庫・発注・届く日 | /purchase |
| `r.materialPurchaseOrders` | 材料の発注書の**下書き**（`materialDays` 日分を見て、仕入先 × 届く日ごと） | /purchase |
| `r.warnings` | 注意（集計の食い違い・ピザの上限超え など） | どこでも |

オプション: `productionOffsetDays`（製造日=納品日+n、初期値0）、`materialArriveDaysBefore`（材料は製造日のn日前に届ける、初期値1）、
`materialDays`（材料の発注を何日先まで見るか、初期値3）、`now`（今の時刻。締めを過ぎた材料の発注書に注意）、`purchase.mode`（`"per_customer"` 得意先ごとに袋を分ける＝初期値 / `"total"` まとめて割る）、`production.lineCaps`、`schedule.startMinute`・`schedule.deliveryMinute`・`schedule.mode`、`shortage.stock`（棚卸の在庫で上書き）。

## 関数の一覧

### 集計 `aggregate.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `totalsForDate(orders, date)` | → `DayTotals`（1日分。注文が無ければ空） |
| `aggregateOrders(orders, {date?, from?, to?})` | → `DayTotals[]`（日付の昇順） |
| `provisionalForDate(orders, date)` / `provisionalTotals(orders, opts)` | → 仮発注の合計（「仮：○個」の別枠表示用。確定の集計には入らない） |
| `countsInTotals(order)` | 集計に数える注文か（`confirmed` かつ `intent` が `new` か未設定） |
| `countsAsProvisional(order)` | 仮発注として別枠に出す注文か（`provisional`、置き換え済みは除く） |
| `linePieces(line)` | 1行の個数（数量×入数）。保存値と違えば warning |
| `deliveryDatesOf(orders)` | 集計に数える注文がある納品日の一覧 |

**集計の決まり**: `intent: "change"` と `"cancel"` は数えない（人が確定すると元の注文が書き換わるので、数えると二重になる）。`provisional` も数えない。

### 単位 `units.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `unitKind("c/s")` | → `"piece" \| "bag" \| "case" \| null` |
| `piecesPerUnitFor(productId, unit)` | → 1単位の個数（個=1、P=袋入数、c/s=ケース入数）。確認画面の初期値に |
| `toPieces(quantity, unit, productId, piecesPerUnit?)` | → `{pieces, piecesPerUnit, kind, warning?}` |

### 入数変換 `packing.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `packFor(65, 6)` | → `{packs: 11, surplus: 1, packsFloor: 10, shortage: 5, ...}` |
| `bestPack(need, [6, 8])` | → 余りがいちばん少ない入数（同じなら袋が少ない方） |
| `slicePlan([{slicesPerPack: 1, packs: 40}], 30)` | → 食パン3斤（30枚）を何本買うか・余る枚数 |
| `packLabel(result)` | → `"6個入 × 11袋（余り1）"` |

### 発注書 `purchase.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `buildProductPurchaseOrders(dayTotals, {mode?})` | → 仕入品の `PurchaseOrderDraft[]`（仕入先×便。得意先ごとの袋数の内訳つき） |
| `buildMaterialPurchaseOrders(shortages, deliveryDate)` | → 材料の `PurchaseOrderDraft[]`（仕入先ごと） |
| `approveDraft(po, who)` | 人が承認ボタンを押したときだけ呼ぶ。`draft` → `approved`。名前が空ならエラー |
| `cutoffIso(date, "11:00", 1)` | → 締めの日時（未設定なら `""`） |
| `methodLabel(method)` | → 発注方法の表示名 |
| `addDays(date, n)` | 日付の足し算 |

`PurchaseOrderDraft` は types.ts の `PurchaseOrder` に、画面用の項目（`supplierName`・`siteName`・`deliveryName`・`cutoffSet`・`kind`・行ごとの `needQuantity`/`surplus`/`customers`）を足したもの。
**状態は必ず `draft`**。送信は人の承認のあと（⑤の担当）。

### 発注書の保存 `purchase-store.ts`（サーバー側だけ）／ `purchase-records.ts`（決まり・純関数）
保存先は data/db.json の `purchaseOrders`。状態は **下書き → 承認 → 送信済み** の順にしか進まない。

| 関数 | 入力 → 出力 |
|---|---|
| `listPurchaseOrders({deliveryDate?, status?, supplierId?, kind?})` | → 保存されている発注書 |
| `getPurchaseOrder(id)` | → 1件 |
| `savePurchaseOrder(po)` / `savePurchaseOrders(pos)` | 下書きを保存（同じ id は置き換え）。**承認済み・送信済みは上書きしない**（`saved: false`） |
| `approvePurchaseOrder(id, who)` | 人が承認ボタンを押したときだけ。`approvedBy`・`approvedAt` と履歴を残す。名前が空・下書きでない・品目が無いとエラー |
| `markSent(id, who, note?)` | 送れたあとに呼ぶ（⑤）。**承認済みだけ**。`sentAt`・`sentBy` と履歴を残す |

保存される形は `StoredPurchaseOrder` = `PurchaseOrder` ＋ `approvedAt`・`sentBy`・`history`（いつ・誰が・saved/approved/sent）。
エラーは `PurchaseRuleError`（日本語のメッセージ。画面にそのまま出せる）。
純関数版（テスト・画面の試し用）: `upsertDraft` / `approveRecord` / `markSentRecord` / `filterRecords`。

### 製造計画・工程表 `production.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `planProduction(dayTotals, {lineCaps?})` | → `ProductionPlan`（生地ごとの kg・ロス込み・粉kg・材料kg・ミキサー回数、ライン別の数・上限・超過、トッピング、食パンの包み直し） |
| `doughBatch(doughId, items)` | 生地1種類分の計算 |
| `buildSchedule(plan, {startMinute?, prevDayStartMinute?, deliveryMinute?, mode?})` | → `ScheduleRow[]`（工程ごとの start/end は 0:00 からの分。`prevDay: true` は前日の仕込み） |
| `scheduleWarnings(rows)` | → 工程表の注意（開始が前日にかかる など） |
| `scheduleSummary(rows)` | → ラインごとの開始・終了・のべ作業分 |
| `fmtTime(分)` | → `"4:05"` / `"翌1:00"` / `"前日22:00"` |
| `toppingDetail(toppingId)` | → トッピングの材料（1枚あたり g） |

- 生地kg = 分割g × 個数 ÷ (1 − ロス率)。材料kg = 粉kg × ベーカーズ％。
- ピザラインの上限は 1日 1,800枚。27cm がある日は 1,200枚、OEM の高加水ピザがある日は 1,500枚（商品ごとの `dailyCap`）。超えたら `warnings` に出る。
- 工程の `key`（`mix`・`bake` など）は多言語の表示に使える。
- **工程表の組み方**（ライン設定 `scheduleFrom`）:
  - パン（`"delivery"`）: **納品時刻から逆算**。生地ごとに、その商品を頼んだ得意先のいちばん早い納品時刻 − 積み込み・配送60分 に最後の工程（金属検出）が終わるよう、後ろから並べる。
    納品時刻は `production.ts` の `customerDeliveryTime`、**無ければ 8:00**。工程はすき間なく続け（発酵が延びない）、ミキサー・オーブンが重なるときは生地全体を前にずらす。
    `ScheduleRow` に `from: "delivery"`・`deliveryMinute`・`deliveryCustomerId`・`deadline` が入る。0:00 より前にかかると `warnings`。
  - ピザ（`"start"`）: 冷凍で在庫にするので、当日 8:00 から順に。生地の仕込みは前日 13:00 から。
  - `mode: "forward"` で全部「開始時刻から順に」にできる。

### 材料 `materials.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `materialRequirements(plans[])` | → 材料ごとの所要量（生地＋トッピング。何日分でも合計できる） |
| `materialShortages(reqs, {stock?, ignoreSafetyStock?})` | → 1日分の不足（必要量＋安全在庫−在庫）と発注数（発注単位で切り上げ、最小ロット以上）。水は除く |

### 材料の発注計画（何日先まで） `material-plan.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `planMaterialOrders(orders, fromDate, {days?, productionOffsetDays?, arriveDaysBefore?, stock?, now?})` | → `MaterialPlan`（`rows`: 材料ごとの日別の 使う量・在庫・発注・届く日、`purchaseOrders`: 仕入先 × 届く日ごとの下書き、`warnings`） |

- `days` 既定 **3日**（納品日 fromDate から）。在庫を日ごとに減らし、安全在庫を割る日の製造日の前日に届くように頼む。
- **リードタイム**: 仕入先マスタの `leadDays`（無ければ **1日**）。締め = 届く日の leadDays 日前の締め時刻。発注書の `notes` に「リードタイム ○日」。
- **最小ロット**: 材料（`materialExtras` / 新しい材料の `minLot`）→ 仕入先（`supplierExtras` / 新しい仕入先の `minLot`）→ **1** の順。デモではまるやま食材が 2袋から。
- `now` を渡すと、締めを過ぎた発注書に「締めを過ぎています」の注意。

### 商品ごとのリードタイム判定 `leadtime.ts`
全社一律の締めは作らない。商品ごとに締めを出し、受注の確認画面で「この商品はもう間に合わない」を黄色で出す元データにする（判定だけ。注文は変えない）。

| 関数 | 入力 → 出力 |
|---|---|
| `checkLeadTime(order, now)` | → 行ごとの `{ lineId, productId, status, deadline, reason }`。`status`: `ok` 間に合う / `late` もう間に合わない（黄色）/ `warn` 間に合わないが仮発注なので警告だけ / `unknown` 締めを決められない |
| `leadTimeSummary(checks)` | → 注文全体でいちばん悪い状態 |
| `orderDeadline(productId, customerId, deliveryDate)` | → `{ deadline, basis }`（締めの ISO と、その根拠の説明） |

締めの出し方:
- **自社製造**: 納品日の `leadDays` 日前（既定 **1日**）の `cutoffTime`。`cutoffTime` が無ければ得意先マスタの締め、それも無ければ 17:00。
  デモ: 食パンは前日 12:00、ピザクラスト27cm は2日前、OEM のピザは3日前。
- **仕入品**: その得意先が受ける**仕入先の便の締め**（例: ふじみ製パン 前日 11:00）。仕入先に頼む締めより前に、お客さんの注文が要るため。商品に `leadDays` があればそちらを使う。
- **食パンの包み直し**: 元の食パン（3斤）の仕入先の締め。
- **仮発注（provisional）**: 病院の「概数 → 当日確定」の運用なので、締めを過ぎても `late` にせず `warn`（警告だけ）。

### 棚卸でロス率を補正 `stocktake.ts`（3か月に1回）
**ロス率は書き換えない。補正案を返すだけ。** 人が承認した分だけを使う。

| 関数 | 入力 → 出力 |
|---|---|
| `theoreticalPlans(orders, from, to, opts?)` | → 期間中の毎日の製造計画（理論の使用量の元） |
| `applyStocktake(materials, counted, period)` | `materials`: 材料ごとの `{ materialId, startStock（期首在庫）, received（期間中の入荷） }`、`counted`: 棚卸の実数 `{ materialId, qty }`、`period`: `{ from, to, plans }` → `{ adjustments（材料ごとの 帳簿・実数・差・実際/理論）, newStock（実数に合わせた在庫）, proposals（生地ごとの補正案）, warnings }` |
| `approveLossProposals(proposals, doughIds, who, at?, current?)` | 人がチェックした生地だけを承認 → `{ lossRates, approvedBy, approvedAt, approved }`。名前が空ならエラー |
| `planProduction(day, { lossRates })` | 承認したロス率を渡したときだけ、生地kg の計算に入る |

補正案 `{ doughId, currentLoss, suggestedLoss, change, needsCheck, basis }` の式:
```
実際の使用量  A_m = 期首在庫 + 期間中の入荷 − 棚卸の実数        （材料 m ごと）
理論の使用量  T_m = 期間中の製造計画から出した使用量（今のロス率込み・トッピング込み）
材料の比      r_m = A_m ÷ T_m
生地の比      R_d = Σ(w_dm × r_m) ÷ Σ w_dm
              w_dm = 生地 d で使う材料 m の理論kg（水など発注しない材料・棚卸の数が無い材料は除く）
補正案        L' = 1 − (1 − L) ÷ R_d        （L = 今のロス率。0〜30% におさめる）
```
- 実際の生地量 = 正味 ÷ (1 − L') = 理論の生地量 × R_d になるロス率、という意味。
- ±0.5% 未満の差は `change: "same"`（変えない）。
- R_d が 0.8 未満か 1.3 超えなら `needsCheck: true`（数え間違い・入荷の記録もれを疑う）。
- 材料を複数の生地・トッピングで使っているときは、どれも同じ比で多く（少なく）使ったとみなす（材料ごとの使い分けは棚卸ではわからないため）。
- 承認したロス率（`lossRates`）を保存する場所は Db にまだ無い（①に相談）。

### 原価・利益 `cost.ts`
| 関数 | 入力 → 出力 |
|---|---|
| `dayCostSummary(runPipelineの結果)` | → その日の **材料費**（`materialCost`）・**仕入額**（`purchaseCost`、仕入先ごと）・**商品ごとの粗利**（`margins`）をまとめて。/plan・/purchase はまずこれ |
| `productionMaterialCost(r.production)` | → 今日の製造の材料費の合計（`total`）と、材料ごと（`lines`、金額の大きい順）・生地ごと（`byDough`）・トッピングごと（`byTopping`）。水は0円 |
| `productMargins(r.totals, r.productPurchaseOrders?)` | → 商品ごとの 売上・原価・粗利・粗利率（`products`）と合計（`total`）。発注書を渡すと、仕入品は**実際に買う袋数 × 仕入値**（余りの分も入る。173個に 6個入×29袋＝174個分）、食パンの包み直しは 3斤の仕入額を枚数の割合で分ける |
| `productCost(productId)` | → 1個の 材料費（ロス込み）・包材費・人件費・原価・粗利・粗利率・未入力の項目 |
| `buyUnitCost(spec, packSize?)` | → 仕入品の1個の仕入値。入数ごとの仕入値（`packPrices`: 円/袋）があれば 袋の値段 ÷ 入数、無ければ `unitCost` |
| `buyPackCost(spec, packs, packSize)` | → 袋数 × 入数 で買ったときの金額 |
| `costTable()` | → 全商品の原価表 |
| `dailyProfit(totals.products)` | → 1日の売上・原価・粗利（1個の原価 × 個数。仕入の余りは見ない簡易版） |
| `doughYenPerGram(doughId)` | → 生地1gの材料費 |

### マスターを引く `catalog.ts`
master.ts（①）と production.ts（③）の両方を見る窓口。商品名・仕入先名・材料名はここから引いてください。
`findProduct` / `findSupplier` / `findMaterial` / `findDough` / `findTopping` / `allProducts` / `allSuppliers` / `allMaterials` / `deliveryFor(supplierId, customerId)` /
`customerDeliveryMinute(customerId)`（納品時刻。無ければ 8:00）/ `hhmmToMinute("07:30")`
（①の FAX 読み取りが `allProducts` / `findProduct` を使っているので、関数名と引数は変えない）

## データ（src/data/）
- `production.ts`（③）: 架空の製造マスター。生地（ベーカーズ％・ロス率・ミキサー上限・工程）、トッピング、商品ごとの作り方・仕入れ方（入数・袋/ケース入数）、仕入先の便（ふじみ製パンの1便・2便）、ピザ用の材料と仕入先、ラインの上限。
  - 便ごとの締め時刻・日数は空でよい。空なら master.ts の仕入先の締めを使う。日数も無ければ 1日。
  - 得意先の納品時刻 `customerDeliveryTime`（無い得意先は 8:00）、仕入先・材料の最小ロット `minLot`、ラインの工程表の組み方 `scheduleFrom`・積み込み時間 `shipBufferMinutes`。
- `demo-orders.ts`（③）: 通し確認・画面デモ用の架空注文。**あした 11/6（金）分**の、もう確定した注文（11/2〜11/5朝に届いたもの）。
  - 今日 11/5 に届いた FAX（F001〜F005）・メール・インフォマート・シートは来週（11/9〜）分なので、ここには入れていない。
  - 得意先・品目・単位の書き方は各入口の見本にそろえた（病院=3個入り・2個入りの袋、保育園=週間表の個・斤、給食センター=ケ・P・c/s、インフォマート=6個入の袋、ピッツェリア=PDFのケース、食品会社=本文）。
  - 変更（病院の超じゅくロール 60→65、edits に跡あり）・取り消し（カフェのLINE）・仮発注（医療食の概数）・仮→本発注の置き換え（めぐみ給食）も入っている。
  - あしたの合計: パン 1,134個、ピザ 1,650枚（27cm がある日の上限 1,200枚を超える → 警告が出る）、超じゅくロール 173個 → 1便 18袋＋2便 11袋。
- 実在の取引先・単価・レシピは入れていない。数字は実際の資料の「形」だけをまねた架空の値。

## 古いもの
`plan.ts` は最初の下書き。集計の決まり（intent・仮発注）だけは合わせてあるが、新しい画面は上の関数を使ってください。画面が移ったら消します。
