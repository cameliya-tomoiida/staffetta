import type { LeadTimeCheck } from "@/lib/leadtime";

// 締めの判定（③の checkLeadTime）を行の下に出す。late＝黄、warn＝薄い黄。reason の文はそのまま。
// ok・unknown は出さない（画面が埋まるので）。②の受注一覧でも同じ見た目で使えるように、ここだけで完結させる。
export function LeadTimeNote({ check }: { check?: LeadTimeCheck }) {
  if (!check || (check.status !== "late" && check.status !== "warn")) return null;
  const cls =
    check.status === "late"
      ? "border-review-line bg-review-bg text-review-ink"
      : "border-review-line/50 bg-review-bg/40 text-review-ink";
  return (
    <div className={`mt-1 rounded-md border px-2 py-1 text-sm font-bold ${cls}`} data-leadtime={check.status}>
      {check.status === "late" ? "締め切り後 " : "仮発注・締め後 "}
      <span className="font-normal">{check.reason}</span>
    </div>
  );
}
