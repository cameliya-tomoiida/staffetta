// 機能の ON/OFF（社内の PC からだけ。トンネル経由は proxy で 403）
//   GET /api/features … { flags: 全部の機能といまの状態, hidden: 左メニューから隠すページ, log: 変えた記録（新しい順） }
// 変えるのは server action（src/app/settings/actions.ts の setFlagAction）
import { flagLog, hiddenMenuHrefs, listFlags } from "@/lib/settings/features";
import { ensureStore } from "@/lib/db/hub-store";

export async function GET() {
  await ensureStore();
  return Response.json({ flags: listFlags(), hidden: hiddenMenuHrefs(), log: flagLog(50) }, { headers: { "cache-control": "no-store" } });
}
