# ローカルのハブを外から届くようにする（Cloudflare クイックトンネル）

> いまの使い分け（11/7〜）: LIFF・外からの画面は Tailscale Funnel（固定 URL）、LINE の Webhook だけ quick tunnel。quick tunnel の URL は `scripts/start-3100.ps1` → `scripts/line-webhook-sync.mjs` が自動で LINE に登録し直す（README の「外からの入口」）。

GAS（FAX転送）や LINE の Webhook は、インターネットからハブに届く URL が必要。
開発中は cloudflared のクイックトンネルを使う（アカウント不要・無料）。

## 初回だけ: cloudflared を入れる
```
winget install --id Cloudflare.cloudflared
```

## 毎回: ハブを起動してトンネルを開く
```
npm run dev -- -p 3100
cloudflared tunnel --url http://localhost:3100
```
- 表示される `https://xxxx-xxxx.trycloudflare.com` が公開URL。
- FAX: GAS のスクリプトプロパティ `HUB_URL` に貼る（docs/gmail-setup.md）。
- LINE: Webhook URL に `https://xxxx.trycloudflare.com/api/line/webhook` などを設定（④の担当が決める）。
- クイックトンネルの URL は起動のたびに変わる。固定したいときは Cloudflare アカウントで名前付きトンネルを作る。

## 安全のために
- 外から届くのは URL を知っている人だけだが、受け口は必ず合言葉（ヘッダー）で守る。
  - FAX: `X-Hub-Token`（`.env.local` の FAX_INBOUND_TOKEN）
- デモが終わったらトンネルを閉じる（Ctrl+C）。
