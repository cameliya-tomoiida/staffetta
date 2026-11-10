# STAFFETTA をサーバーで動かす（ConoHa VPS 東京・Ubuntu 24.04・2GB）

11/8 担当者の決定。本番と見本（審査員向け）を同じサーバーで、別々の systemd として動かす。台本は `scripts/server/`。
名前・ホスト名は引数で渡す（下の `<...>` を置きかえる）。

| もの | 置き場・名前 |
|---|---|
| アプリ（git の写し） | `/srv/staffetta/app`（人 `staffetta`・ログイン不可） |
| 本番のデータ | `/srv/staffetta/data`（`hub.sqlite`・`fax-inbox/`・`outbound/` など） |
| 見本のデータ | `/srv/staffetta/demo`（毎日 4:00 に作り直す） |
| 秘密 | `/etc/staffetta/env`（本番）・`/etc/staffetta/demo.env`（見本）・`/etc/staffetta/backup-pass`（バックアップの合言葉） |
| 常駐 | `staffetta.service`（127.0.0.1:3100）・`staffetta-demo.service`（3118）・`caddy`（443） |
| バックアップ | `staffetta-backup.timer`（毎日 4:00）・`staffetta-backup-hourly.timer`（1時間ごと） |

## 1. 初期設定（1回だけ）

```bash
# サーバーに root で入り、台本だけ先に取ってくる
git clone https://github.com/<持ち主>/staffetta.git /root/staffetta-setup
sudo bash /root/staffetta-setup/scripts/server/setup.sh \
  --admin <管理の人の名前> --pubkey "ssh-ed25519 AAAA... <名前>" \
  --app-host <本番のホスト名> --demo-host <見本のホスト名> --email <証明書の連絡先>
```

- SSH は鍵だけ・root では入れなくなる。**閉じる前に、別の端末で `ssh <管理の人>@<サーバー>` が通ることを確かめる。**
- ファイアウォールは 22 と 443 だけ。証明書（Let's Encrypt）は 443 で取る。LINE の Webhook のため **RSA の証明書** にしている（ECDSA だと LINE が TLS の交渉に失敗した。11/7）。
- Node.js は 24（`node:sqlite` を使うため 22.13 以上が要る。手元と同じ 24）。2GB のメモリで `next build` を通すため、スワップを 2GB 作る。
- DNS で、本番・見本のホスト名をサーバーの IP に向ける。

## 2. 秘密を入れる

```bash
sudoedit /etc/staffetta/env        # ANTHROPIC_API_KEY・LINE・FAX_INBOUND_TOKEN・STAFF_SESSION_SECRET など（手元の .env.local と同じ項目）
sudoedit /etc/staffetta/demo.env   # 見本は ANTHROPIC_API_KEY だけ。DEMO_PUBLIC_UNTIL（公開の期限）もここ
```

- 本番の `HUB_PASSWORD_LOGIN_OUTSIDE=1` は消さない。サーバーではどのアクセスも「外から」になるので、これが無いと ID・パスワードでログインできない（LINE のログインだけになる）。
- 全データの書き出し・戻し（設定 → バックアップ）は、外からは使えない（サーバーでは使えない）。代わりに下の backup.sh・restore.sh を使う。

## 3. アプリを入れる・新しくする

```bash
sudo bash /srv/staffetta/app/scripts/server/deploy.sh --repo https://github.com/<持ち主>/staffetta.git            # 公開のリポジトリ
sudo bash /srv/staffetta/app/scripts/server/deploy.sh --repo git@github.com:<持ち主>/<本番>.git --deploy-key /etc/staffetta/deploy_key   # private
```

- 初めては `/srv/staffetta/app` がまだ空なので、`/root/staffetta-setup/scripts/server/deploy.sh` を使う。
- 取得 → `npm ci` → 別の場所でビルド → 入れかえ → 再起動。止まるのは再起動の数秒。`--target app|demo` で片方だけ。
- サーバーの写しは手で直さない（毎回 origin にそろえるので消える）。
- 本番の DB を手元（3100）から移すときは、手元で「設定 → バックアップ」の書き出し、または `sqlite3 data/hub.sqlite ".backup hub.sqlite"` で写しを作る。サーバーで `systemctl stop staffetta` → `/srv/staffetta/data/hub.sqlite` に置く（持ち主 staffetta）→ `systemctl start staffetta`。FAX の PDF（`data/fax-inbox/`）も同じ場所へ。

## 4. 見本（審査員向け）

- `staffetta-demo.service` が `scripts/demo-public.mjs serve` を動かす。架空の見本だけを作り、毎日 4:00 に作り直す。LINE・メール・FAX の秘密は入れない。
- 最初の管理者（judge）は、サーバーの中から作る（外からは /setup を開けない）:
  `ssh -L 3118:127.0.0.1:3118 <管理の人>@<サーバー>` でつなぎ、手元のブラウザで `http://localhost:3118/setup`。
  作ったら `sudo -u staffetta env HUB_DEMO_PUBLIC_DIR=/srv/staffetta/demo node /srv/staffetta/app/scripts/demo-public.mjs save-accounts`（作り直しのあとも同じパスワードで入れる）。
- 公開の期限は `/etc/staffetta/demo.env` の `DEMO_PUBLIC_UNTIL`。過ぎたら「審査用の見本の公開は終了しました」の1画面だけになる。

## 5. バックアップ（AWS S3 東京）

**S3 の側（AWS の画面で1回だけ）**
1. バケットを東京（ap-northeast-1）に作る。**作るときに「オブジェクトロック」を有効にする**（あとからは付けられない）。既定の保持: ガバナンス 30日。
2. ライフサイクルのルール: `daily/` は 30日、`monthly/` は 365日、`hourly/` は 2日で期限切れ。古い版は 1日あとに消す（ロック中の物は、ロックが切れてから消える）。
3. このサーバー用の IAM ユーザーは、このバケットの `PutObject`・`GetObject`・`ListBucket` だけ（**消す権限は付けない**。乗っ取られても消されない）。

**サーバーの側**
```bash
sudo rclone config        # 名前 s3tokyo・Amazon S3・region ap-northeast-1・上の IAM のキー
echo 'DEST=s3tokyo:<バケット名>/hub' | sudo tee /etc/staffetta/backup.conf
sudo install -m 600 /dev/null /etc/staffetta/backup-pass && sudoedit /etc/staffetta/backup-pass   # 合言葉（担当者が決める。紙にも残す。無くすと戻せない）
sudo bash /srv/staffetta/app/scripts/server/backup.sh --kind daily     # 1回ためす
sudo bash /srv/staffetta/app/scripts/server/restore.sh --check-only    # 取ってきて件数を見る（本番は変えない）
sudo systemctl enable --now staffetta-backup.timer staffetta-backup-hourly.timer
```

- 毎日 4:00: DB（`sqlite3 .backup`＝書き込み途中の分も含めた安全な写し）＋ FAX の PDF ＋ 発注の出力 → tar → gpg（AES256・合言葉）→ S3 の `daily/`。毎月1日の分は `monthly/` にも。
- 1時間ごと: DB だけ → `hourly/`。WAL の差分を送り続ける形ではなく、1時間ごとの DB 全体の写し（DB は小さいので足りる）。
- 記録は `/var/log/staffetta-backup.log`（件数・大きさ）。

## 6. 戻す

```bash
sudo bash /srv/staffetta/app/scripts/server/restore.sh --list                    # 世代を見る
sudo bash /srv/staffetta/app/scripts/server/restore.sh --check-only              # いちばん新しい daily を取って件数を見るだけ
sudo bash /srv/staffetta/app/scripts/server/restore.sh --kind hourly             # いちばん新しい hourly に戻す（yes で実行）
sudo bash /srv/staffetta/app/scripts/server/restore.sh --name staffetta-daily-20261108-0400.tar.gz.gpg
```

戻す前のデータは `/srv/staffetta/data.before-restore-<日時>` に残る。戻したあと、注文・FAX・取引先の件数が出る。

## 困ったとき

- 動いているか: `systemctl status staffetta staffetta-demo caddy`・記録 `journalctl -u staffetta -n 100`
- 証明書が取れない: DNS がこのサーバーを向いているか・443 が開いているか（`journalctl -u caddy`）
- LINE の Webhook: LINE の管理画面で URL を `https://<本番のホスト名>/api/line/webhook` にして「検証」
