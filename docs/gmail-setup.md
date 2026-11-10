# FAX の自動取り込み（Gmail → ハブ）の設定

複合機 → fax-inbox@example.com（ラベル「FAX受信」）までは設定済み（2026-10-15）。
ここでは「Gmail に届いたら、1分以内にハブの受信箱に出る」ようにする。

## しくみ
```
複合機 ──PDF──▶ Gmail（ラベル FAX受信）──GAS 1分おき──▶ POST /api/fax/inbound ──▶ 受信箱（自動で読み取り・通知音）
```
- GAS は Gmail を読むだけ。既読・ラベル・削除はさわらない。送ったメールは ID で記録して二重に送らない。
- 受け口の合言葉: ヘッダー `X-Hub-Token` = `.env.local` の `FAX_INBOUND_TOKEN`。
- setup を実行した時刻より前のメールは送らない（過去の実FAXを流し込まない）。

## 手順（作者の操作は ★）
1. ハブを起動し、トンネルで公開URLを出す（docs/tunnel.md）。
2. ★ Chrome で fax-inbox@example.com にログインした状態で script.google.com → 新しいプロジェクト。
3. ★ `gas/fax-forwarder.gs` の中身を貼り付けて保存（プロジェクト名: 受発注ハブ FAX転送）。
4. ★ プロジェクトの設定 → スクリプト プロパティに `HUB_URL`（トンネルのURL）と `HUB_TOKEN`（`.env.local` の FAX_INBOUND_TOKEN）を追加。
5. ★ 関数 `setup` を選んで実行 → 権限の確認で「許可」（Gmail の読み取りと外部への送信）。
6. 複合機にテストFAXを送り、1〜2分で受信箱に出ることを確認。

## 注意
- トンネルの URL は起動のたびに変わる（クイックトンネルの場合）。変わったら HUB_URL を貼り直す。
- GAS が動く前でもデモできる: `npm run fax:simulate`（架空FAXを受け口に送る）。
- 止めたいとき: GAS のトリガー画面で forwardFaxes のトリガーを削除。
