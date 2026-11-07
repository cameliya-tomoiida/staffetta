import NextLink from "next/link";
import type { ComponentProps } from "react";

// アプリの中のリンク。Next.js の「先読み」を、ふだんは止める（11/8 担当者「押してから反応するまでが遅い」）。
// 先読みがあると、画面を1つ開くたびに、メニューや日付のリンク先（製造計画など重い画面）を裏で 40〜50件も計算させていた。
// 手元の PC で測ると、ホームを開くだけで先読み 53件。Render の無料枠（CPU が弱い）では、これが全体を遅くする。
// 先読みしたい所は prefetch を付ければ、そのとおりになる。
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
