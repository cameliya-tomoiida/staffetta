// 仕込みの回数（作者 11/6 工場長の話 P1）。純関数。
// ミキサーは 大・中・小 で、1回に入る「粉の量」で決まる（例 大 粉 50kg まで・中 18〜25kg・小 1〜7kg）。
// 硬い生地は中で 25kg 回らない → 生地ごとに「1回の粉の上限」を決められる（どのミキサーでもその上限まで）。
// 決め方: 1回で回せるいちばん小さいミキサー。1回で入らなければ、いちばん大きいミキサーで、同じ量ずつ何回かに分ける（大で回りきらない分は2回）。
export interface MixerSpec {
  id: string;
  name: string;
  /** 1回に入れる粉の下限・上限 kg */
  minFlourKg?: number;
  maxFlourKg: number;
}

export interface MixerPlan {
  mixerId: string;
  mixerName: string;
  batches: number;
  /** 1回の粉 kg */
  flourPerBatch: number;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function planMixers(flourKg: number, mixers: MixerSpec[], doughMaxFlourKg?: number): MixerPlan | undefined {
  if (!(flourKg > 0)) return undefined;
  const cap = (m: MixerSpec) => Math.min(m.maxFlourKg, doughMaxFlourKg && doughMaxFlourKg > 0 ? doughMaxFlourKg : Infinity);
  const usable = mixers.filter((m) => m.maxFlourKg > 0 && cap(m) > 0).sort((a, b) => cap(a) - cap(b) || a.maxFlourKg - b.maxFlourKg);
  if (!usable.length) return undefined;
  // 1回で回せるいちばん小さいミキサー（下限より少ないと回らない）
  const one = usable.find((m) => flourKg <= cap(m) && flourKg >= (m.minFlourKg ?? 0));
  if (one) return { mixerId: one.id, mixerName: one.name, batches: 1, flourPerBatch: r1(flourKg) };
  // 入らなければ、いちばん大きいミキサーで同じ量ずつ
  const big = usable[usable.length - 1];
  const batches = Math.ceil(flourKg / cap(big));
  return { mixerId: big.id, mixerName: big.name, batches, flourPerBatch: r1(flourKg / batches) };
}

/** 画面の1行（「ミキサー（大） 粉 20kg × 2回」） */
export const mixerText = (p: MixerPlan) => `${p.mixerName} 粉 ${p.flourPerBatch}kg${p.batches > 1 ? ` × ${p.batches}回` : ""}`;
