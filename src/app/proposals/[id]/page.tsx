import Link from "next/link";
import { ProposalFix } from "@/components/ProposalFix";

export const metadata = { title: "AI の案｜STAFFETTA" };

// AI の案を見て、OK するか、言葉で直す（ホームの確認の行の［直す］から）
export default async function ProposalPage(props: PageProps<"/proposals/[id]">) {
  const { id } = await props.params;
  return (
    <main className="mx-auto max-w-2xl space-y-3">
      <Link href="/home" className="link text-base">‹ ホーム</Link>
      <ProposalFix proposalId={id} />
    </main>
  );
}
