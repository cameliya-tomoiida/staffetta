import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { accountsExist, publicStaff, STAFF_ROLES } from "@/lib/staff";
import { loadMasters } from "@/lib/masters/seed-db";
import { StaffClient } from "./StaffClient";

export const metadata = { title: "スタッフの登録｜設定" };

// スタッフの登録（作者の指示 11/5 夜 (9)）: 名前・役割・担当のコース・有効／無効。
export default async function StaffPage() {
  await connection();
  const masters = await loadMasters();
  return (
    <div className="space-y-5">
      <PageHeader
        title="スタッフの登録"
        lead="名前・役割・担当のコースを入れます。配送の人は、配送の画面（スマホ）を開くと担当のコースが最初に出ます。やめた人は「無効」にすると、選ぶ所に出なくなります。"
      />
      <StaffClient initial={publicStaff(true)} roles={STAFF_ROLES} courses={masters.courses.filter((c) => c.active).map((c) => c.id)} loginOn={accountsExist()} />
    </div>
  );
}
