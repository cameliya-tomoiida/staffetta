#!/usr/bin/env bash
# STAFFETTA をバックアップから戻す（11/8 管理役2）。root で流す。
#
#   sudo bash scripts/server/restore.sh [--kind daily|hourly|monthly] [--name <ファイル名>|latest] [--dest <rclone の送り先>] [--list] [--check-only]
#
#   --list        S3 にある世代を見るだけ
#   --check-only  取ってきて、中の件数（注文・FAX・取引先）を見せるだけ。本番は変えない（試しの復元）
#   それ以外      本番を止める → いまのデータを data.before-restore-<日時> に残す → 戻す → 起動 → 件数を見せる
# daily は DB ＋ FAX の PDF ＋ 発注の出力。hourly は DB だけ（FAX の PDF・発注の出力はいまのまま）。
set -euo pipefail

KIND=daily NAME=latest DEST="" LIST=0 CHECK=0
[ -f /etc/staffetta/backup.conf ] && . /etc/staffetta/backup.conf
while [ $# -gt 0 ]; do
  case "$1" in
    --kind) KIND="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    --list) LIST=1; shift ;;
    --check-only) CHECK=1; shift ;;
    *) echo "知らない引数: $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo "root で流してください（sudo）" >&2; exit 1; }
case "$KIND" in daily|hourly|monthly) ;; *) echo "--kind は daily・hourly・monthly" >&2; exit 2 ;; esac
[ -n "$DEST" ] || { echo "送り先（--dest か /etc/staffetta/backup.conf の DEST）がありません" >&2; exit 2; }
PASS=/etc/staffetta/backup-pass
[ -s "$PASS" ] || { echo "合言葉のファイルがありません: $PASS" >&2; exit 1; }

if [ "$LIST" = 1 ]; then rclone lsl "$DEST/$KIND/" | sort -k2,3; exit 0; fi
if [ "$NAME" = latest ]; then
  NAME=$(rclone lsf "$DEST/$KIND/" --include 'staffetta-*.tar.gz.gpg' | sort | tail -1)
  [ -n "$NAME" ] || { echo "$DEST/$KIND/ に世代がありません" >&2; exit 1; }
fi
echo "戻す世代: $DEST/$KIND/$NAME"

TMP=$(mktemp -d /var/backups/staffetta-restore.XXXXXX)
trap 'rm -rf "$TMP"' EXIT
rclone copyto "$DEST/$KIND/$NAME" "$TMP/b.tar.gz.gpg"
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASS" -o "$TMP/b.tar.gz" -d "$TMP/b.tar.gz.gpg"
mkdir "$TMP/x"; tar -C "$TMP/x" -xzf "$TMP/b.tar.gz"
[ "$(sqlite3 "$TMP/x/hub.sqlite" 'PRAGMA integrity_check;')" = ok ] || { echo "戻す DB が壊れています" >&2; exit 1; }

counts() {
  sqlite3 -header -column "$1" "SELECT (SELECT count(*) FROM orders) AS 注文, (SELECT count(*) FROM faxes) AS FAX, (SELECT count(*) FROM masters WHERE name='customers') AS 取引先, (SELECT max(created_at) FROM orders) AS いちばん新しい注文;"
}
echo "== バックアップの中身"; counts "$TMP/x/hub.sqlite"
[ -d "$TMP/x/fax-inbox" ] && echo "FAX の PDF: $(find "$TMP/x/fax-inbox" -type f | wc -l) 枚"
if [ "$CHECK" = 1 ]; then echo "（--check-only なので、本番は変えていません）"; exit 0; fi

DATA=/srv/staffetta/data
DB=$DATA/hub.sqlite
[ -f "$DB" ] && { echo "== いまの本番"; counts "$DB"; }
read -r -p "本番をこの世代に戻します。いまのデータは data.before-restore に残します。よければ yes: " ans
[ "$ans" = yes ] || { echo "やめました"; exit 1; }

SAVE=/srv/staffetta/data.before-restore-$(TZ=Asia/Tokyo date +%Y%m%d-%H%M)
systemctl stop staffetta.service
cp -a "$DATA" "$SAVE"
rm -f "$DB" "$DB-wal" "$DB-shm"
install -o staffetta -g staffetta -m 640 "$TMP/x/hub.sqlite" "$DB"
for d in fax-inbox outbound; do
  if [ -d "$TMP/x/$d" ]; then rm -rf "${DATA:?}/$d"; cp -a "$TMP/x/$d" "$DATA/$d"; chown -R staffetta:staffetta "$DATA/$d"; fi
done
systemctl start staffetta.service
sleep 5
echo "== 戻したあとの本番"; counts "$DB"
curl -fsS -o /dev/null -w "本番 3100: %{http_code}\n" http://127.0.0.1:3100/login || echo "本番が答えません: journalctl -u staffetta -n 50"
echo "前のデータ: $SAVE（確かめて要らなければ消す）"
