// FAX の確認画面の「くわしく」を短くする（作者 11/5 夜 (14)「長くならないよう要約して3行程度に」）。純関数。
// 読み取りのときも Claude に短く書くよう頼んでいる（types.ts の FaxReadSchema）が、前に読んだ FAX の長い文もここで縮める。

/** 最初の1文だけ（「。」まで）。長ければ max 文字で切って「…」 */
export function firstSentence(text: string, max = 50): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const m = t.match(/^.*?[。！？!?](?=\s|$|[^」』）)])/);
  const s = (m ? m[0] : t).trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** くわしくの要約（3行まで）。空のものは出さない。自動で確定しなかった理由があれば、それを先に */
export function faxDetailSummary(input: { evidence: string; kindReason: string; notes: string; autoReasons?: string[] }): string[] {
  const lines = [
    ...(input.autoReasons?.length ? [`止めた理由: ${firstSentence(input.autoReasons[0], 46)}${input.autoReasons.length > 1 ? `（ほか${input.autoReasons.length - 1}件）` : ""}`] : []),
    input.notes ? `メモ: ${firstSentence(input.notes)}` : "",
    input.evidence ? `送り主: ${firstSentence(input.evidence, 40)}` : "",
    input.kindReason ? `種類: ${firstSentence(input.kindReason, 40)}` : "",
  ].filter(Boolean);
  return lines.slice(0, 3);
}
