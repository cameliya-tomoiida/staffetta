// FAX の自動確定のスイッチ（設定画面）。既定は「する」。
import { kvGet, kvSet } from "./db/sqlite";

const KEY = "fax_auto_confirm";

export function autoConfirmEnabled(): boolean {
  return kvGet<{ enabled: boolean }>(KEY)?.enabled ?? true;
}

export function setAutoConfirmEnabled(enabled: boolean, who: string) {
  kvSet(KEY, { enabled, who, at: new Date().toISOString() });
}
