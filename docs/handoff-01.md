# ① 土台・FAX受信 — 引き継ぎ書（2026-11-05 0:45）

前任の①セッションから、新しい①への引き継ぎ。くわしい経緯は `docs/dev-log/01-fax.md`。

## 1. ①が持つファイル

| 場所 | 中身 |
|---|---|
| `src/data/types.ts` | 全担当の共通の型（Order / OrderLine / OrderSource(SourceRef) / PurchaseOrder…）。③が末尾にマスタの型を追加済み。**型の変更依頼は管理役経由で①に来る** |
| `src/data/master.ts` | 架空マスター（③の production.ts / catalog.ts と、DB の masters に移行中） |
| `src/lib/types.ts` | FAX まわりの型。`FaxReadSchema`（Claude の構造化出力の Zod）、`FaxDoc`、`FaxTemplate`、`Db` |
| `src/lib/fax-reader.ts` | **Claude で FAX を読む指示文と呼び出し**（後述） |
| `src/lib/fax-inbound.ts` | Gmail(GAS) から届いた PDF を受信箱に入れる（メッセージIDで二重防止） |
| `src/lib/store.ts` | `readDb` / `updateDb` / `resetDb` / `faxFilePath`（中身は SQLite。他の担当はこの口を使う） |
| `src/lib/db/sqlite.ts` | `getDb` / `ensureTables` / `transaction` / `kvGet`・`kvSet` / `tableNames` |
| `src/lib/db/hub-store.ts` | faxes / orders / purchase_orders / imported_messages の表、`loadDb` / `saveDiff` / `replaceAll` / `resetToDemo` / 初回移行 |
| `src/lib/db/masters.ts` | マスタの共通の口（`listMaster` / `getMaster` / `upsertMasters` / `deleteMaster` / `restoreMaster` / `getMasterHistory` / `seedMastersIfEmpty` / `masterNames` / `initMasters`） |
| `src/lib/db/search.ts` | 検索（`searchOrders` / `searchFaxes` / `searchPurchaseOrders` / `periodRange` / `paramsToSearch`） |
| `src/lib/db/backup.ts` | 全データの書き出し・取り込み |
| `src/lib/db/initial.ts` | デモの初期データ（受信箱 F001〜F005、いつもの3社の様式） |
| `src/app/actions.ts` | FAX の server action（読み取り・まとめて読み取り・様式承認・仕分け・確定・変更FAXの反映・手入力・リセット） |
| `src/app/page.tsx` | 受信箱 |
| `src/app/fax/[id]/` | 確認画面（左: 元のFAX / 右: 読み取り結果、テンキー、様式承認パネル、変更・仮発注の表示） |
| `src/app/api/fax/inbound` `fax-file/[id]` `fax/status` | 受け口・PDF配信・受信箱の自動更新 |
| `src/app/api/search/*` `api/backup` `settings/actions.ts` | 検索 API・バックアップ API・取り込みの server action（画面は②） |
| `src/components/PdfView.tsx` `PdfThumb.tsx` `NumPad.tsx` `ReadButton.tsx` `InboxWatcher.tsx` `ResetButton.tsx` | 画面部品（**見た目は②が直している最中。①は処理だけ**） |
| `src/lib/pdfjs.ts` `public/pdfjs-wasm/` `public/pdf.worker.min.mjs` | pdf.js の準備（後述の CCITT） |
| `src/proxy.ts` | トンネル経由は受け口だけ通す（`/api/fax/inbound` `/api/line/` `/liff` `/_next/`） |
| `gas/fax-forwarder.gs` `docs/gmail-setup.md` `docs/tunnel.md` | Gmail → ハブの転送（GAS）と手順 |
| `scripts/fax-simulate.mjs` `scripts/faxify.py` `scripts/fax-samples/` `public/samples/` | 架空FAXと、受け口へのテスト送信 |

## 2. SQLite の構成（data/hub.sqlite、.gitignore 済み）
- Node 24 標準の `node:sqlite`。`HUB_DB_PATH` で場所を変えられる（テストは `":memory:"` を import 前に設定）
- 表
  - `faxes(id, received_at, status, customer_id, json)` 索引: 受信日・取引先
  - `orders(id, customer_id, delivery_date, status, channel, intent, created_at, json)` 索引: 納品日・取引先・状態
  - `purchase_orders(id, supplier_id, delivery_date, status, created_at, json)`
  - `imported_messages(message_id, at)` … Gmail の二重取り込み防止
  - `masters(name, id, json, disabled, updated_at, updated_by)` ＋ `master_history` … 全マスタ共通。FAX の様式は `name = "fax_formats"`（id = 取引先ID）
  - `kv(key, json)` … `fax_mappings`（得意先ごとの品名→商品）、`loss_rates`、`store_initialized`、`last_import`
  - ほかの担当の表（④ `line_users` など）は各自が `ensureTables` で作る
- `store.updateDb(fn)` は「読む → structuredClone → fn → 変わった行だけ保存（消えた行は削除）」。直列化済み
- 初回移行: `kv.store_initialized` が無ければ、`data/db.json` を取り込んで `db.json.migrated-日付` に改名（無ければデモの状態）。**3100 では 11/5 0:14 に移行済み（件数一致を確認）**
- デモのリセット: `resetToDemo()`（ボタン「デモを最初から」と `npm run demo:reset` の両方）
- **未対応**: ③の `seedSampleMasters()`（`src/lib/masters/seed-db.ts`、③のブランチ）が master に入ったら、`hub-store.ts` の `resetToDemo()` と `migrateOnce()` の最後で `await seedSampleMasters()` を呼ぶ

## 3. FAX 読み取り（Claude）
- 場所: `src/lib/fax-reader.ts`。モデル `claude-opus-5-5`、adaptive thinking・effort high、PDF を document で渡す、`client.beta.messages.parse` + `betaZodOutputFormat(FaxReadSchema)`、`fallbacks: "default"`（beta `server-side-fallback-2026-07-01`）
- 指示文の工夫: 役割を「書いてあるとおり読む＋怪しい所に印」に限定（換算はプログラム）、訂正の跡は後の数＋attention、丸で選ぶ欄、空欄は注文なし、種類（order / change / provisional_order / supplier_reply / not_order）の見分け方、`layout_summary` に1枚だけの事情（向き等）を書かない
- プロンプトに渡すもの: 得意先一覧・仕入先一覧・商品一覧（③の `allProducts()`）・**承認済みの品名の対応（mappings）**
- 1行ごとに `confidence` / `attention` / `y_percent`（確認画面で元のFAXの同じ行に帯）

## 4. 様式承認と確定の流れ
- 読み取り → 取引先に承認済みの様式が無ければ `status: "template"` → 確認画面の紫パネル（①下書き→②品名の対応→③承認）→ `approveTemplateAction`（masters に保存・mappings に追加）→ 確定できるようになる
- 注文/仮発注: 読み取り時に `needs_review` の Order を納品日ごとに作る → 確定で `confirmed` / `provisional`。本発注の確定で同じ取引先・納品日の仮発注を `cancelled` ＋ `supersededBy`
- 変更FAX: `intent: "change"`・`changeOf` の Order（needs_review）を作る。確定するまで元の注文は書き換えない。確定で元の行を書き換え、edits に記録。集計は `intent: new` だけ（③と取り決め）
- 広告・仕入先の返信: 人が「注文以外として仕分ける」→ `status: "other"`

## 5. 運用（Gmail / GAS / トンネル / 3100）
- fax-inbox@example.com（Chrome の /u/4）。Apps Script「受発注ハブ FAX転送」、1分おき（forwardFaxes）、setup 済み（11/4 22:47 以降のメールだけ送る）
- スクリプトプロパティ `HUB_URL`（トンネルの URL）・`HUB_TOKEN`（= `.env.local` の `FAX_INBOUND_TOKEN`）。`data/gas-properties.txt` に控え（git に入らない）
- トンネル: 作者がターミナルのタブ「tunnel 3100」で起動中（`cloudflared tunnel --url http://localhost:3100`）。**Claude からの起動は自動モードの安全ルールで止められる**。URL が変わったら HUB_URL を貼り直す
- 11/4 夜、テストメールで Gmail→GAS→トンネル→受け口→読み取り が通った（迷惑メールに入っていたので解除済み）。本物の FAX はまだ来ていない
- 3100: **本番の LINE（④）も使っているので、再起動の前に④（受発注ハブ ④LINE注文）へ一言**。`.next` を消すと最初の1〜2分つながらない
- **3100 の `.env.local` に DEMO_NOW を入れない**（撮影は `.claude/worktrees/video` の 3106 で⑥が行う）
- 開発サーバーは `.claude/launch.json` の「juhacchu-hub」（preview_start）

## 6. 残っている作業（優先順）
1. ~~FAX の様式の管理~~ **済（src/lib/fax-formats.ts・src/app/formats/actions.ts。画面は②が載せる）**。読み取りで様式の型 format_kind（週間表・発注書・印字＋手書き訂正・複数枚つづり・変更連絡票）と page_note も取るようにした。元のメモ: 一覧（`listMaster("fax_formats", { includeDisabled: true })`）・無効化（`deleteMaster`）・戻す・下書き（`status: "template"` の FAX）を承認。実物の様式の種類（印字＋手書き訂正、仮発注13枚つづり、週間表）が扱えること。実物は `オンラインハッカソン\00_元データ\06_注文書写真（ここに入れてください）\`、CCP は `衛生検査資料\工程表\`
2. **名寄せ辞書**（masters の `"aliases"`：取引先ID・呼び名・商品ID・出どころ・承認者）を全入口で共通に。確認画面で商品を選んだら「辞書に登録しますか」1タップ、次回から候補の一番上。今の `kv.fax_mappings` をここへ移す。⑤④にも見てもらう
3. **自信度の色分け**（高=そのまま、中=黄、低=赤枠）と、**その取引先の直近の修正を数件、読み取りの指示文に添える**簡易学習
4. ③の seed を初期化とリセットから呼ぶ（上記2章）

## 7. 注意点（はまりどころ）
- **Turbopack のキャッシュ**: マージ途中の壊れた package.json などを覚えて 500 になる → 3100 を止めて `.next` を消して起動
- **Tailwind v4 と worktree**: `.claude/worktrees/` がリポジトリ内にあるので、`globals.css` の `@source not "../../.claude";` を消さない（消すと全画面 500）
- **CCITT（白黒2値）の PDF**: pdf.js v6 は wasm で読む。`getDocument({ url, ...pdfDocOptions })`（`wasmUrl: "/pdfjs-wasm/"`）を必ず通す。無いと真っ白
- **プレビュー（アプリ内ブラウザ）が裏に隠れると描画が止まる**ので、画面の確認は Chrome（claude-in-chrome）で
- **作業フォルダは管理役がマージに使う**: 未コミットを残さない。マージ中（「これからマージします」〜「終わりました」）は触らない
- 実在の取引先名・社名は、コード・データ・文書に入れない（公開リポジトリ）
- Bash で `for … $(…)` のような入り組んだコマンドは安全チェックに止められることがある。ファイルは Write で1つずつ作る
