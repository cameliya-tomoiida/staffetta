// お知らせ（アラート）の一覧（②の画面）。保存・判定・API は①（src/lib/db/alerts-store.ts・src/app/alerts/actions.ts・scheduler）。
// 大事な順（急ぎ→注意→お知らせ、期限の近い順）。1件ごとに、何が起きたか・いつまでに・次にすることのボタン・担当者に回す・あとで・済み。
import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { nowIso } from "@/lib/clock";
import { listAlerts } from "@/lib/db/alerts-store";
import { ensureStore } from "@/lib/db/hub-store";
import { lastTick } from "@/lib/scheduler";
import { isOn } from "@/lib/settings/features";
import { AlertsClient } from "./AlertsClient";

export const metadata = { title: "お知らせ｜STAFFETTA" };

export default async function AlertsPage() {
  await connection();
  await ensureStore();
  const on = isOn("alerts");
  const open = on ? listAlerts() : [];
  const done = on ? listAlerts({ states: ["done"], limit: 30 }) : [];
  const last = lastTick();
  return (
    <div className="space-y-5">
      <PageHeader
        title="お知らせ"
        lead="忘れていること・ふだんと違うこと・足りなくなりそうなものを、急ぐ順に出します。ボタンで次の仕事へ進めます。済んだら「済み」を押します。"
      />
      <AlertsClient open={open} done={done} now={nowIso()} lastAt={last?.at ?? null} enabled={on} />
    </div>
  );
}
