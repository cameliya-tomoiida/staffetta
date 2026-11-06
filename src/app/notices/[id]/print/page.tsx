import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/app/plan/PrintButton";
import { PrintButton as FactoryPrint } from "@/components/ui/PrintButton";
import { todayJst } from "@/lib/clock";
import { getCompany } from "@/lib/company";
import { getNotice } from "@/lib/notices/store";

export const dynamic = "force-dynamic";

const jd = (d: string) => `${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

// お知らせの FAX・手渡しの紙（A4 縦・1取引先1枚・白い紙）。複合機で FAX するか、印刷して手渡しする
export default async function NoticePrint(props: PageProps<"/notices/[id]/print">) {
  const { id } = await props.params;
  const n = getNotice(id);
  if (!n) notFound();
  const c = getCompany();
  const list = n.recipients.filter((r) => r.channel !== "line");
  const today = todayJst();
  return (
    <main className="space-y-4 p-4 print:p-0 sm:p-6">
      <style>{`@page { size: A4 portrait; margin: 15mm 18mm; }`}</style>
      <div className="no-print flex flex-wrap items-center gap-3">
        <Link href={`/notices/${id}`} className="link text-xl">← もどる</Link>
        <PrintButton label={`印刷する（${list.length}枚）`} primary />
        <FactoryPrint path={`/notices/${id}/print`} label={`お知らせ ${n.draft.title}（${list.length}枚）`} />
      </div>
      {list.map((r, i) => (
        <section key={r.customerId} className={`theme-paper mx-auto w-[174mm] bg-white text-[11pt] leading-relaxed text-black ${i ? "break-before-page" : ""}`}>
          <div className="text-right">{jd(today)}</div>
          <div className="mt-4 text-[13pt] font-bold">{r.name} 御中{r.channel === "fax" ? `（FAX ${r.to.join("・")}）` : ""}</div>
          <div className="mt-2 text-right text-[10pt]">
            <div className="text-[12pt] font-bold">{c.name}</div>
            {(c.postalCode || c.address) && <div>{c.postalCode && `〒${c.postalCode} `}{c.address}</div>}
            <div>{c.tel && `TEL ${c.tel}`}{c.fax && `　FAX ${c.fax}`}</div>
          </div>
          <h1 className="my-6 text-center text-[16pt] font-bold tracking-widest">{n.draft.title}</h1>
          <pre className="font-[inherit] whitespace-pre-wrap">{n.draft.body}</pre>
        </section>
      ))}
      {list.length === 0 && <p className="no-print text-xl">FAX・手渡しの先はありません（全部 LINE で送ります）。</p>}
    </main>
  );
}
