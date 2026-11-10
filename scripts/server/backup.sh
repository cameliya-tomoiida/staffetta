#!/usr/bin/env bash
# STAFFETTA のバックアップ（11/8 管理役2）。root で動く（systemd の時計 staffetta-backup*.timer から）。
#
#   sudo bash scripts/server/backup.sh --kind daily|hourly [--dest <rclone の送り先>] [--keep-local <日数>]
#
#   daily  … 毎日 4:00。DB（sqlite3 の .backup＝書き込み途中の WAL も含めた安全な写し）＋ data/fax-inbox ＋ data/outbound を tar → gpg で暗号化 → S3
#            毎月1日の分は monthly/ にも置く
#   hourly … 1時間ごと。DB だけ（同じく .backup → gpg → S3 の hourly/）。直前の1時間までは戻せる
#            ※ WAL の差分そのものを送る形（litestream など）ではなく、1時間ごとの DB 全体の写し（DB は数 MB〜数十 MB なので、これで足りる）
#
# 暗号化の合言葉: /etc/staffetta/backup-pass（root だけが読める。担当者が決めて入れる。無くすと戻せない）
# 送り先: --dest か /etc/staffetta/backup.conf の DEST（例 s3tokyo:staffetta-backup/hub）。rclone の設定（S3 東京・キー）は rclone config で root に入れる
# 何日残すかは S3 の側で決める（オブジェクトロックと「ライフサイクルのルール」）: daily/ 30日・monthly/ 365日・hourly/ 2日（docs/server.md）
# この台本は S3 の物を消さない（オブジェクトロックで消せない・消さない）。手元の写しだけ --keep-local 日で消す
set -euo pipefail

KIND="" DEST="" KEEP_LOCAL=3
[ -f /etc/staffetta/backup.conf ] && . /etc/staffetta/backup.conf
while [ $# -gt 0 ]; do
  case "$1" in
    --kind) KIND="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    --keep-local) KEEP_LOCAL="$2"; shift 2 ;;
    *) echo "知らない引数: $1" >&2; exit 2 ;;
  esac
done
case "$KIND" in daily|hourly) ;; *) echo "--kind は daily か hourly" >&2; exit 2 ;; esac
[ -n "$DEST" ] || { echo "送り先（--dest か /etc/staffetta/backup.conf の DEST）がありません" >&2; exit 2; }
PASS=/etc/staffetta/backup-pass
[ -s "$PASS" ] || { echo "合言葉のファイルがありません: $PASS" >&2; exit 1; }
[ "$(stat -c %a "$PASS")" = 600 ] || { echo "$PASS は root だけが読めるように（chmod 600）" >&2; exit 1; }

DATA=${HUB_DATA_DIR:-/srv/staffetta/data}
DB=${HUB_DB_PATH:-$DATA/hub.sqlite}
WORK=/var/backups/staffetta
STAMP=$(TZ=Asia/Tokyo date +%Y%m%d-%H%M)
LOG=/var/log/staffetta-backup.log
mkdir -p "$WORK"; chmod 700 "$WORK"
TMP=$(mktemp -d "$WORK/tmp.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
say() { echo "$(TZ=Asia/Tokyo date '+%F %T') [$KIND] $*" | tee -a "$LOG"; }

[ -f "$DB" ] || { say "DB がありません: $DB"; exit 1; }
# 1. DB の安全な写し（動いたままでよい。.backup は書き込みの途中の分も含めて、整った1つのファイルにする）
sqlite3 "$DB" ".timeout 10000" ".backup '$TMP/hub.sqlite'"
[ "$(sqlite3 "$TMP/hub.sqlite" 'PRAGMA integrity_check;')" = ok ] || { say "写しの DB が壊れています（integrity_check）"; exit 1; }
COUNTS=$(sqlite3 "$TMP/hub.sqlite" "SELECT 'orders=' || (SELECT count(*) FROM orders) || ' faxes=' || (SELECT count(*) FROM faxes) || ' customers=' || (SELECT count(*) FROM masters WHERE name='customers');" 2>/dev/null || echo "?")

# 2. まとめる（daily は FAX の PDF と発注の出力も）
NAME="staffetta-$KIND-$STAMP.tar.gz"
if [ "$KIND" = daily ]; then
  ITEMS=(hub.sqlite)
  for d in fax-inbox outbound; do [ -d "$DATA/$d" ] && cp -a "$DATA/$d" "$TMP/$d" && ITEMS+=("$d"); done
  tar -C "$TMP" -czf "$WORK/$NAME" "${ITEMS[@]}"
else
  tar -C "$TMP" -czf "$WORK/$NAME" hub.sqlite
fi

# 3. 暗号化（AES256・合言葉はファイルから。画面やログには出さない）
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASS" --symmetric --cipher-algo AES256 -o "$WORK/$NAME.gpg" "$WORK/$NAME"
rm -f "$WORK/$NAME"
SIZE=$(du -h "$WORK/$NAME.gpg" | cut -f1)

# 4. 送る（S3 東京）。毎月1日の daily は monthly/ にも
rclone copyto "$WORK/$NAME.gpg" "$DEST/$KIND/$NAME.gpg"
if [ "$KIND" = daily ] && [ "$(TZ=Asia/Tokyo date +%d)" = 01 ]; then
  rclone copyto "$WORK/$NAME.gpg" "$DEST/monthly/$NAME.gpg"
fi
say "送りました: $DEST/$KIND/$NAME.gpg（$SIZE・$COUNTS）"

# 5. 手元の写しは数日だけ
find "$WORK" -maxdepth 1 -name 'staffetta-*.tar.gz.gpg' -mtime +"$KEEP_LOCAL" -delete
