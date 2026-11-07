# 審査員向けの見本を Render（無料枠）で動かす

11/8 担当者の決定（費用ゼロ）。本番（3100）とは別。架空の見本だけ・LINE やメールなどの送る口は無し。

## しくみ

| もの | 中身 |
|---|---|
| `render.yaml` | Render の Blueprint。Web Service・無料枠・シンガポール（東京は無い）・枝 `render-build` |
| `.github/workflows/render-build.yml` | master に push すると、GitHub の上でビルドし、`.next` 入りの写しを枝 `render-build` に置く（公開の `cameliya-tomoiida/staffetta` か、名前が `staffetta-demo` のリポジトリだけで動く） |
| `scripts/start-demo-render.mjs` | 起動のたびに `/tmp` に見本を作り（demo:reset ＋ demo:scale）、`JUDGE_USER`・`JUDGE_PASSWORD` から管理者を作って `next start -p $PORT` |
| `scripts/demo-judge.ts` | 審査員の管理者を作る（パスワードは画面・ログに出さない） |

- **Render の上ではビルドしない。** 無料枠はメモリ 512MB。`next build` は手元で測ると合計 1.7GB 使う（Node の上限を 400MB にしても、Turbopack が Node の外で使う）。そこで GitHub Actions（Linux・7GB）でビルドし、Render は `npm ci` と起動だけにした。
- 起動は約15秒（見本づくり 7秒＋起動）。使われないと 15分で眠り、次に開いた人は起きるまで待つ（約1分）。**起きるたびに見本は新品**（ディスクが無いので、審査員が触った分は残らない）。
- 動いている間のメモリは、3人同時に触って約 350MB（手元で測った）。
- 外からの判定: `*.onrender.com` は「外」。見本（`HUB_DEMO=1`）なので、外からでも ID・パスワードでログインできる。全データの書き出し・戻しは外から閉じたまま。
- AI の月の上限は 3000円（約20ドル）で固定（画面で変えられない）。プリンターには送らない。
- 公開の期限 `DEMO_PUBLIC_UNTIL`（既定 11/11 23:59:59）を過ぎると、「審査用の見本の公開は終了しました」の1画面だけになる。

## 手順（管理役2）

1. 公開のリポジトリ `staffetta`（名前を置きかえた写し）を最新の master から作り直して push する。`render-build` の枝も公開になるが、中は見本のビルドだけ（秘密は入らない。GitHub には `.env.local` が無い）。
2. GitHub の Actions で「render-build」が動き、枝 `render-build` ができるのを待つ（数分。Actions の画面で緑になる）。
   - リポジトリの Settings → Actions → General → Workflow permissions を「Read and write」にしておく（枝に push するため）。
3. Render: New → Blueprint → 公開の `staffetta` を選ぶ（サービスの名前は render.yaml の `staffetta-demo`）。`render.yaml` が読まれる。
4. 画面で2つ入れる: `JUDGE_PASSWORD`（審査員に知らせるパスワード・8文字以上）・`ANTHROPIC_API_KEY`。
5. デプロイが終わったら `https://staffetta-demo.onrender.com/login` を開き、`judge` と上のパスワードで入れることを確かめる。URL が違ったら `HUB_PUBLIC_URL` を直す。
6. 新しくしたいときは、master に push するだけ（Actions がビルド → `render-build` が変わる → Render が自動でデプロイ）。

## うまくいかないとき

- Render の記録（Logs）に `[見本] 作れませんでした` → 見本づくりの失敗。その下の行を見る。
- `JUDGE_PASSWORD が無い` → 画面で入れて、Manual Deploy。
- 別の道（Render の上でビルドする）: `render.yaml` の `branch` を消し、`buildCommand: npm ci && npm run build`、環境に `HUB_LOW_MEM_BUILD=1`（型の確かめを飛ばし、作業のプロセスを1つにする）。手元で Node の上限 400MB では通ったが、合計のメモリが 512MB を超えるので、落ちるおそれが高い。
