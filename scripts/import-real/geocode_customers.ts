// 取引先の住所 → 地図の位置（⑧）。国土地理院の住所検索（今ある geocode。キー不要）で、位置の無い取引先に位置を出す。
// DB には書かない: 位置の CSV（43_positions.csv）と、付かなかった・おおまかな物の一覧（49_位置の要確認.csv）を出す。入れるのは import-masters.ts で。
//   - おおまか: 見つかった名前に番地が無い（区・町の名前までしか合っていない）
//   - 遠い: 工場から 80km より遠い（ほかの県の住所・写しまちがいかもしれない）
// 使い方:
//   HUB_DB_PATH=<DB のコピー> npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/import-real/geocode_customers.ts <出力フォルダ> [--courses Aコース,Bコース] [--ids R-1,R-2] [--ids-from <取引先の CSV>]
// 実名・住所・出力は data/（git の外）。
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadMasters } from "@/lib/masters/seed-db";
import { geocode, getDepot } from "@/lib/routes/store";

const args = process.argv.slice(2);
const outDir = args[0];
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371, t = Math.PI / 180;
  const x = (b.lng - a.lng) * t * Math.cos(((a.lat + b.lat) / 2) * t), y = (b.lat - a.lat) * t;
  return Math.sqrt(x * x + y * y) * R;
};
const csv = (rows: (string | number)[][]) => "﻿" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";

(async () => {
  if (!outDir) throw new Error("出力フォルダを渡してください");
  const m = await loadMasters();
  const courses = opt("--courses")?.split(",");
  const ids = new Set(opt("--ids")?.split(",") ?? []);
  const idsFrom = opt("--ids-from");
  if (idsFrom) for (const line of (await fs.readFile(idsFrom, "utf8")).replace(/^﻿/, "").split(/\r?\n/).slice(1)) if (line.split(",")[0]) ids.add(line.split(",")[0].replace(/"/g, ""));
  const targets = m.customers.filter((c) => c.active !== false && ((courses && courses.includes(c.course ?? "")) || ids.has(c.id)));
  const depot = getDepot();
  const pos: (string | number)[][] = [["得意先ID", "緯度", "経度"]];
  const check: (string | number)[][] = [["得意先ID", "名前", "住所", "見つかった名前", "わけ"]];
  let got = 0, skipped = 0;
  for (const c of targets) {
    if (c.lat != null && c.lng != null) { skipped++; continue; }
    if (!c.address) { check.push([c.id, c.name, "", "", "住所が無い"]); continue; }
    try {
      const p = await geocode(c.address);
      await sleep(400); // 住所検索に負担をかけない
      if (!p) { check.push([c.id, c.name, c.address, "", "住所が見つからない"]); continue; }
      const far = km(depot, p);
      // 番地（数字・漢数字）が無い＝区・町の名前までしか合っていない
      const rough = !/[0-9一二三四五六七八九十]/.test(p.title.normalize("NFKC")) || /(区|市|町|村)$/.test(p.title);
      if (far > 80) { check.push([c.id, c.name, c.address, p.title, `工場から ${Math.round(far)}km（入れていない）`]); continue; }
      pos.push([c.id, Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6]);
      got++;
      if (rough) check.push([c.id, c.name, c.address, p.title, "おおまか（町の名前までしか合っていないかも。入れた）"]);
    } catch (e) {
      check.push([c.id, c.name, c.address, "", `住所検索が使えなかった: ${(e as Error).message}`]);
    }
  }
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "43_positions.csv"), csv(pos));
  await fs.writeFile(path.join(outDir, "49_位置の要確認.csv"), csv(check));
  console.log(`対象 ${targets.length}件・もう位置がある ${skipped}件・位置が付いた ${got}件・要確認 ${check.length - 1}件`);
})();
