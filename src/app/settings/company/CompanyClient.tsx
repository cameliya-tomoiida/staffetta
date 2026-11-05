"use client";
import { useState, useTransition } from "react";
import type { Company } from "@/lib/company";
import { useStaffNames } from "@/components/ui/staff";
import { saveCompanyAction } from "./actions";

const FIELDS: { key: keyof Company; label: string; placeholder: string; wide?: boolean }[] = [
  { key: "name", label: "会社名（工場名）", placeholder: "例: 〇〇製パン株式会社", wide: true },
  { key: "postalCode", label: "郵便番号", placeholder: "000-0000" },
  { key: "address", label: "住所", placeholder: "例: 愛知県名古屋市〇〇区…", wide: true },
  { key: "tel", label: "電話", placeholder: "000-000-0000" },
  { key: "fax", label: "FAX", placeholder: "000-000-0000" },
  { key: "email", label: "メール（発注・返事の差出人）", placeholder: "order@example.com", wide: true },
  { key: "contact", label: "発注書に載せる担当（空なら載せない）", placeholder: "例: 購買 こばやし" },
];

export function CompanyClient({ initial }: { initial: Company }) {
  const STAFF = useStaffNames();
  const [c, setC] = useState(initial);
  const [who, setWho] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const field = "min-h-12 w-full rounded-lg border-2 border-rule-strong bg-sheet px-3 text-[18px]";
  const save = () =>
    start(async () => {
      const r = await saveCompanyAction(c, who);
      if (r.ok) {
        setC(r.company);
        setMsg({ ok: true, text: "保存しました。次に作る発注書・返事から、この差出人になります" });
      } else setMsg({ ok: false, text: r.error });
    });
  return (
    <div className="space-y-4">
      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className={`block text-[18px] font-bold ${f.wide ? "sm:col-span-2" : ""}`}>
            {f.label}
            <input className={`${field} mt-1 font-normal`} value={c[f.key]} placeholder={f.placeholder} onChange={(e) => setC({ ...c, [f.key]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="card p-5">
        <div className="text-[18px] font-bold">発注書の差出人の見本</div>
        <div className="mt-2 rounded-lg border border-rule bg-cream px-4 py-3 text-[18px] leading-relaxed">
          <div className="font-bold">{c.name || "（会社名）"}</div>
          {(c.postalCode || c.address) && <div>{c.postalCode && `〒${c.postalCode} `}{c.address}</div>}
          <div>TEL {c.tel}　FAX {c.fax}</div>
          {c.contact && <div>担当 {c.contact}</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <label className="flex items-center gap-2 text-[18px]">
          保存する人
          <select className="min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 text-[18px]" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">（選んでください）</option>
            {STAFF.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <button type="button" className="btn-primary min-h-14 px-6 text-[20px]" disabled={pending || !who} onClick={save}>{pending ? "保存中…" : "保存する"}</button>
      </div>
      {msg && <div role="status" className={`rounded-lg px-4 py-3 text-[18px] font-bold ${msg.ok ? "bg-ok-bg text-ok-ink" : "bg-alert-bg text-alert-ink"}`}>{msg.text}</div>}
    </div>
  );
}
