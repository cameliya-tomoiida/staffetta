"use client";
// まだ読み取っていない FAX（⑧の見直し 2回目 #10: 白い箱1つだけだった）。最初から FAX の絵と、読むボタン2つを出す。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { readFaxAction } from "@/app/actions";
import { ReadFaxButton } from "@/app/price-changes/ReadFaxButton";
import { PdfView } from "@/components/PdfView";

export function UnreadFax({ faxId, file, rotation }: { faxId: string; file: string; rotation: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const read = () =>
    start(async () => {
      await readFaxAction(faxId).catch(() => undefined);
      router.refresh();
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/fax" className="btn-ghost">‹ 受信箱</Link>
        <button type="button" className="btn-primary" disabled={pending} onClick={read}>
          {pending ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Claude が読み取り中…
            </>
          ) : (
            "Claude で読み取る"
          )}
        </button>
        <ReadFaxButton faxId={faxId} label="値上げのお知らせとして読む" />
      </div>
      <div className="h-[70vh] min-h-96 overflow-hidden rounded-lg border-2 border-rule-strong bg-sheet">
        <PdfView url={file} rotation={rotation} />
      </div>
    </div>
  );
}
