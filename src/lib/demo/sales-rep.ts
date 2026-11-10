// 見本の DB の取引先に「担当の営業」を入れる（⑧・管理役2 11/7「営業の見本の人に 10社くらい」）。見本の DB だけに書く。
// 営業の見本の人（src/lib/staff.ts の SAMPLE_STAFF: すずき SX80・よしだ SX81）に、使っている取引先を 10社ずつ順に割り当てる。
import { upsertMasters } from "@/lib/db/masters";
import { loadMasters } from "@/lib/masters/seed-db";
import { listStaff } from "@/lib/staff";

export async function assignSalesReps(per = 10): Promise<Record<string, number>> {
  const reps = listStaff().filter((s) => s.role === "営業").map((s) => s.id);
  if (!reps.length) return {};
  const m = await loadMasters();
  const list = (m.customers ?? []).filter((c) => c.active !== false).sort((a, b) => a.id.localeCompare(b.id));
  const out: Record<string, number> = {};
  const changed = list.slice(0, per * reps.length).map((c, i) => {
    const rep = reps[Math.floor(i / per)];
    out[rep] = (out[rep] ?? 0) + 1;
    return { ...c, salesRep: rep };
  });
  if (changed.length) await upsertMasters("customers", changed as never[], "見本の準備（⑧）");
  return out;
}
