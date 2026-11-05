// 1日分の工程表を文字で出す（実際の配置表と比べるため）。DB には書かない。
//
//   HUB_DB_PATH=<DBファイル> npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/import-real/day.ts <納品日> <商品ID>:<個数> [<商品ID>:<個数> ...] [--sample] [--out <ファイル>]
//   --sample … DB ではなく見本のマスタで計算する
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Order } from "../../src/data/types";

const hm = (m: number) => {
  const d = Math.floor(m / 1440);
  const r = ((m % 1440) + 1440) % 1440;
  return `${d < 0 ? "前日" : d > 0 ? "翌" : ""}${String(Math.floor(r / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}`;
};

async function main() {
  const args = process.argv.slice(2);
  const outI = args.indexOf("--out");
  const out = outI >= 0 ? args[outI + 1] : undefined;
  const rest = args.filter((a, i) => !a.startsWith("--") && (outI < 0 || i !== outI + 1));
  const [date, ...items] = rest;
  const { loadMasters } = await import("../../src/lib/masters/seed-db");
  const { sampleMasters } = await import("../../src/lib/masters/seed");
  const { runPipeline } = await import("../../src/lib/pipeline");
  const masters = args.includes("--sample") ? sampleMasters() : await loadMasters();
  const order: Order = {
    id: "DAY", customerId: "C01", deliveryDate: date, status: "confirmed", intent: "new", createdAt: `${date}T00:00:00+09:00`, edits: [],
    source: { channel: "phone", refs: [], receivedAt: `${date}T00:00:00+09:00` } as unknown as Order["source"],
    lines: items.map((s, i) => {
      const [productId, q] = s.split(":");
      return { id: String(i), productId, quantity: Number(q), unit: "個", piecesPerUnit: 1, pieces: Number(q), confidence: 1, edits: [] };
    }),
  };
  const r = runPipeline([order], date, { masters, now: `${date}T00:00:00+09:00` });
  const lines: string[] = [`納品 ${date}・製造日 ${r.productionDate}・${items.join(" ")}`];
  for (const row of r.schedule) {
    lines.push(`■ ${row.doughName}（${row.line}・${row.pieces}個・組み方 ${row.from}）`);
    for (const s of row.steps) lines.push(`  ${hm(s.start)}〜${hm(s.end)}  ${String(s.end - s.start).padStart(4)}分  ${s.people ?? 0}人  ${s.name}`);
    for (const w of row.warnings) lines.push(`  ！${w}`);
  }
  for (const pl of r.production.lines) lines.push(`ライン ${pl.line}: ${pl.pieces}${pl.capPieces !== undefined ? `（上限に数える ${pl.capPieces}）` : ""} / 上限 ${pl.cap ?? "なし"}`);
  for (const w of r.production.warnings) lines.push(`！${w}`);
  const text = lines.join("\n") + "\n";
  if (out) {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, text, "utf-8");
    console.log(`出力: ${out}`);
  } else process.stdout.write(text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
