// 架空FAXを本番と同じ指示文で読ませ、生の結果を raw-<ラベル>.json に保存する（1枚につき API を1回呼ぶ）。
// 使い方（docs/fax-accuracy.md）:
//   set HUB_DB_PATH=:memory:
//   npx tsx --env-file=.env.local --conditions=react-server --tsconfig tsconfig.json scripts/fax-accuracy/measure.mts <ラベル> [fax1,fax10]
// そのあと python -I scripts/fax-accuracy/score.py <ラベル> で正解と比べる。
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readFax } from "../../src/lib/fax-reader";

const here = import.meta.dirname;
const expected = JSON.parse(readFileSync(path.join(here, "expected.json"), "utf8")) as Record<string, { file: string }>;
const label = process.argv[2] ?? "run";
const only = process.argv[3]?.split(",");
const names = Object.keys(expected).filter((n) => !only || only.includes(n));
const out: Record<string, unknown> = {};
let next = 0;
async function worker() {
  while (next < names.length) {
    const n = names[next++];
    const t0 = Date.now();
    try {
      // 承認済みの品名の対応は渡さない（初めての取引先として読む＝いちばん厳しい条件）
      const { read, model } = await readFax(expected[n].file, "2026-11-05T09:00:00+09:00", {});
      out[n] = { read, model, ms: Date.now() - t0 };
    } catch (e) {
      out[n] = { error: String(e), ms: Date.now() - t0 };
    }
    console.log(n, Date.now() - t0, "ms");
  }
}
await Promise.all([worker(), worker(), worker(), worker()]); // 同時に4枚まで
writeFileSync(path.join(here, `raw-${label}.json`), JSON.stringify(out, null, 2));
console.log(`保存しました: raw-${label}.json（API ${names.length} 回）`);
