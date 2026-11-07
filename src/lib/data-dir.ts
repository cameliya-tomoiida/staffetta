// データの置き場（DB の外のファイル: 受け取った FAX の PDF・発注の出力・印刷の PDF・翻訳の控え など）。
// ふだんは <アプリ>/data。HUB_DATA_DIR があればそこ（審査員向けの見本 3118 は data/demo-public。本番 3100 の FAX などが見えないように。11/8 管理役2）
import path from "node:path";

export const DATA_DIR = process.env.HUB_DATA_DIR ? path.resolve(process.env.HUB_DATA_DIR) : path.join(process.cwd(), "data");

/** 審査員向けの見本（HUB_DEMO=1）で動いているか */
export const isPublicDemo = () => process.env.HUB_DEMO === "1";

/** 審査員向けの見本を公開する期限（11/8 担当者: 審査終了 11/10 の翌日いっぱい）。.env の DEMO_PUBLIC_UNTIL で変えられる */
export const demoPublicUntil = () => process.env.DEMO_PUBLIC_UNTIL || "2026-11-11T23:59:59+09:00";

/** 見本の公開の期限を過ぎたか（HUB_DEMO=1 のときだけ。日付が読めなければ過ぎていない扱い） */
export function demoPublicClosed(nowMs = Date.now()): boolean {
  if (!isPublicDemo()) return false;
  const t = Date.parse(demoPublicUntil());
  return Number.isFinite(t) && nowMs > t;
}

/** 期限の日（日本時間の「11/11」の形） */
export function demoPublicUntilLabel(): string {
  const t = Date.parse(demoPublicUntil());
  if (!Number.isFinite(t)) return "";
  const j = new Date(t + 9 * 3600_000);
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()}`;
}
