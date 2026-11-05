// FAX の自動確定のスイッチ。中身は機能の一覧（src/lib/settings/features.ts の fax_auto_confirm）を読むだけ。
import { isOn, setFlag } from "./settings/features";

export function autoConfirmEnabled(): boolean {
  return isOn("fax_auto_confirm");
}

export function setAutoConfirmEnabled(enabled: boolean, who: string) {
  setFlag("fax_auto_confirm", enabled, who);
}
