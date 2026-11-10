// 取り込んだ実データ（ID が R- で始まる商品）で、工程表・材料が計算できるか確かめる。DB には書かない。
//
//   HUB_DB_PATH=<DBファイル> npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/import-real/check.ts [個数=200] [出力ファイル]
//
// - R- の商品を 1つずつ、その個数だけ注文したことにして runPipeline を回す（得意先は見本の C01）。
// - 工程の時間（最初の工程の開始〜最後の終わり）・人の時間・注意を一覧にする。出力には商品名が入るので data/ の下に書く。
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Order } from "../../src/data/types";

const hm = (m: number) => `${m < 0 ? "前日" : ""}${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String((((m % 1440) + 1440) % 1440) % 60).padStart(2, "0")}`;

async function main() {
  const pieces = Number(process.argv[2] ?? 200);
  const out = process.argv[3] ?? path.join("data", "import-real", "check.txt");
  const { loadMasters } = await import("../../src/lib/masters/seed-db");
  const { runPipeline } = await import("../../src/lib/pipeline");
  const masters = await loadMasters();
  const date = "2026-11-10";
  const lines: string[] = [];
  let ok = 0;
  let bad = 0;
  for (const p of masters.products.filter((x) => x.id.startsWith("R-"))) {
    const order: Order = {
      id: `CHK-${p.id}`, customerId: "C01", deliveryDate: date, status: "confirmed", intent: "new", source: { channel: "phone", refs: [], receivedAt: "2026-11-05T09:00:00+09:00" } as unknown as Order["source"],
      createdAt: "2026-11-05T09:00:00+09:00", edits: [],
      lines: [{ id: "1", productId: p.id, quantity: pieces, unit: "個", piecesPerUnit: 1, pieces, confidence: 1, edits: [] }],
    };
    try {
      const r = runPipeline([order], date, { masters, now: "2026-11-05T09:00:00+09:00" });
      const rows = r.schedule.filter((s) => s.doughId === p.doughId);
      const steps = rows.flatMap((s) => s.steps);
      if (!steps.length) {
        lines.push(`${p.id}\t${p.name}\t工程なし\t${r.warnings.slice(0, 2).join(" / ")}`);
        bad++;
        continue;
      }
      const start = Math.min(...steps.map((s) => s.start));
      const end = Math.max(...steps.map((s) => s.end));
      const labor = steps.reduce((a, s) => a + (s.end - s.start) * (s.people ?? 0), 0);
      const flour = r.materials.reduce((a, m) => a + m.needKg, 0);
      lines.push(`${p.id}\t${p.name}\t${hm(start)}〜${hm(end)}（${Math.round((end - start) / 6) / 10}時間）\t人の時間 ${Math.round(labor)}分\t材料 ${flour.toFixed(1)}kg\t${rows.flatMap((x) => x.warnings).slice(0, 2).join(" / ")}`);
      ok++;
    } catch (e) {
      lines.push(`${p.id}\t${p.name}\tエラー\t${(e as Error).message}`);
      bad++;
    }
  }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${pieces}個ずつ（納品 ${date}）\t計算できた ${ok} / できない ${bad}\n` + lines.join("\n") + "\n", "utf-8");
  console.log(`計算できた ${ok} / できない ${bad}（くわしくは ${out}）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
