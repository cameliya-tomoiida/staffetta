#!/usr/bin/env bash
# STAFFETTA をサーバーに入れる・新しくする（11/8 管理役2）。root で流す（中の作業は staffetta の人で行う）。
#
#   sudo bash scripts/server/deploy.sh --repo <GitHub の URL> [--branch master] [--target both|app|demo] [--deploy-key <秘密鍵のファイル>]
#
#   --repo        公開の staffetta なら https://github.com/<持ち主>/staffetta.git。本番を private にするなら git@github.com:<持ち主>/<名前>.git
#   --deploy-key  private のときの「読むだけ」の鍵（GitHub の Deploy key）。/etc/staffetta/ に置き、root と staffetta だけが読めるように
#   --target      app＝本番だけ・demo＝見本だけ・both＝両方（既定）
#
# すること: 取得（いつも origin の --branch にそろえる）→ npm ci → next build（別の場所に作ってから入れかえる。止まるのは再起動の数秒）→ systemd を再起動
# 本番の画面は .next、見本の画面は .next-demo（見本は LIFF などの公開の値を空にして作る）。環境（秘密）は /etc/staffetta/env から読む。
set -euo pipefail

REPO="" BRANCH=master TARGET=both KEY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --deploy-key) KEY="$2"; shift 2 ;;
    *) echo "知らない引数: $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo "root で流してください（sudo）" >&2; exit 1; }
[ -n "$REPO" ] || { echo "--repo は必ず" >&2; exit 2; }
case "$TARGET" in both|app|demo) ;; *) echo "--target は both・app・demo" >&2; exit 2 ;; esac

APP_USER=staffetta
APP=/srv/staffetta/app
as_app() { sudo -u "$APP_USER" -H env HOME=/srv/staffetta "$@"; }
GIT_SSH=""
if [ -n "$KEY" ]; then
  [ -r "$KEY" ] || { echo "鍵が読めません: $KEY" >&2; exit 1; }
  GIT_SSH="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
fi
git_app() { as_app env ${GIT_SSH:+GIT_SSH_COMMAND="$GIT_SSH"} git -C "$APP" "$@"; }

echo "== 取得（$REPO の $BRANCH）"
if [ ! -d "$APP/.git" ]; then
  as_app env ${GIT_SSH:+GIT_SSH_COMMAND="$GIT_SSH"} git clone --branch "$BRANCH" "$REPO" "$APP.tmp"
  shopt -s dotglob; mv "$APP.tmp"/* "$APP"/; rmdir "$APP.tmp"; shopt -u dotglob
else
  git_app remote set-url origin "$REPO"
  git_app fetch --prune origin "$BRANCH"
  # サーバーの写しは手で直さない決まり。いつも origin にそろえる（ここで直したものは消える）
  git_app checkout -B "$BRANCH" "origin/$BRANCH"
fi
echo "いまの版: $(git_app log --oneline -1)"

echo "== npm ci"
as_app bash -c "cd '$APP' && npm ci --no-audit --no-fund"

# 本番の環境（NEXT_PUBLIC_… はビルドのときに画面に埋め込まれる）
load_env() { set -a; . /etc/staffetta/env; set +a; }

build() { # $1=作る場所 $2=入れかえる先 $3=見本か
  local stage="$1" dest="$2" demo="$3"
  as_app bash -c "cd '$APP' && rm -rf '$stage'"
  if [ "$demo" = 1 ]; then
    # 見本: 本番の秘密は読まない。LIFF などの公開の値も空
    as_app env -i PATH="$PATH" HOME=/srv/staffetta NODE_ENV=production HUB_DIST_DIR="$stage" \
      NEXT_PUBLIC_LIFF_ID= NEXT_PUBLIC_LIFF_STAFF_ID= NEXT_PUBLIC_DEMO_NOW= NODE_OPTIONS=--max-old-space-size=1536 \
      bash -c "cd '$APP' && npx next build"
  else
    ( load_env; as_app env HUB_DIST_DIR="$stage" NEXT_PUBLIC_LIFF_ID="${NEXT_PUBLIC_LIFF_ID:-}" NEXT_PUBLIC_LIFF_STAFF_ID="${NEXT_PUBLIC_LIFF_STAFF_ID:-}" \
        NODE_OPTIONS=--max-old-space-size=1536 bash -c "cd '$APP' && npx next build" )
  fi
  [ -f "$APP/$stage/BUILD_ID" ] || { echo "ビルドができませんでした（$stage）" >&2; exit 1; }
  as_app bash -c "cd '$APP' && rm -rf '$dest.old' && { [ -d '$dest' ] && mv '$dest' '$dest.old' || true; } && mv '$stage' '$dest'"
}

if [ "$TARGET" != demo ]; then
  echo "== 本番の画面を作る（.next）"
  build .next-stage .next 0
  systemctl restart staffetta.service
  sleep 5
  curl -fsS -o /dev/null -w "本番 3100: %{http_code}\n" http://127.0.0.1:3100/login || { echo "本番が答えません: journalctl -u staffetta -n 50" >&2; exit 1; }
fi
if [ "$TARGET" != app ]; then
  echo "== 見本の画面を作る（.next-demo）"
  build .next-demo-stage .next-demo 1
  systemctl restart staffetta-demo.service
  sleep 8
  curl -fsS -o /dev/null -w "見本 3118: %{http_code}\n" http://127.0.0.1:3118/login || echo "見本がまだ答えません（初めては見本の DB を作るので 1分ほどかかる）: journalctl -u staffetta-demo -n 50"
fi
echo "== できました"
