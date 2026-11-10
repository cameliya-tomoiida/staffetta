// ②の /admin/* のうち、⑤の /masters/* に同じマスタの画面ができたものは、そちらへ移す（保存・CSV は⑤の仕組み）。
// ⑤の画面がまだ無いあいだは、②の画面をそのまま出す。
import { redirect } from "next/navigation";
import { SCREEN_NAMES } from "@/lib/masters/screens";

/** 候補の名前のうち、⑤の画面があるものへ移る（なければ何もしない） */
export function toMastersIfReady(candidates: string[]): void {
  const hit = candidates.find((n) => (SCREEN_NAMES as string[]).includes(n));
  if (hit) redirect(`/masters/${hit}`);
}
