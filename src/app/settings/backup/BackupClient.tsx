"use client";
// バックアップの画面（②）。書き出しは①の GET /api/backup、取り込みは①の importBackupAction。
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importBackupAction } from "@/app/settings/actions";
import type { ImportReport } from "@/lib/db/backup";
import { buttonClass, fmtDateTime, Notice, SectionTitle } from "@/components/ui";
import { ConfirmInline } from "@/components/ui/ConfirmInline";

const STAFF = ["事務 たなか", "課長 こばやし", "専務 はやし"];
const field = "min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 font-bold text-ink focus:border-crust-600 focus:outline-none";

type Last = { at: string; who: string; exportedAt: string; report: ImportReport } | null;

export function BackupClient({ last }: { last: Last }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [who, setWho] = useState(STAFF[0]);
  const [result, setResult] = useState<{ ok: true; report: ImportReport } | { ok: false; error: string } | null>(null);

  const doImport = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("who", who);
    const r = await importBackupAction(fd);
    setResult(r);
    if (r.ok) {
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } else {
      throw new Error(r.error);
    }
  };

  return (
    <div className="space-y-8">
      {/* 書き出し */}
      <section>
        <SectionTitle>1. ファイルに書き出す（毎日の終わりに）</SectionTitle>
        <p className="mb-3 text-ink-soft">
          注文・受信したFAX・発注書・マスタを、1つのファイルにまとめてパソコンに保存します。USBメモリなど、別の場所にも写しておくと安心です。
        </p>
        <div className="flex flex-wrap gap-3">
          <a href="/api/backup" download className={buttonClass("primary", "lg")}>
            全部を書き出す（FAXのPDFも入れる）
          </a>
          <a href="/api/backup?files=0" download className={buttonClass("ghost", "lg")}>
            データだけ書き出す（軽い）
          </a>
        </div>
      </section>

      {/* 取り込み */}
      <section>
        <SectionTitle>2. 書き出したファイルから戻す</SectionTitle>
        <Notice tone="alert">
          戻すと、いまの注文・FAX・発注書・マスタは、ファイルの中身に<strong>入れ替わります</strong>。パソコンを入れ替えたときや、データがこわれたときだけ使ってください。
        </Notice>
        <div className="mt-4 flex flex-wrap items-end gap-4 rounded-lg border border-rule bg-sheet p-4">
          <label className="flex flex-col gap-1 text-sm font-bold text-ink-soft">
            戻すファイル（.json）
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                setResult(null);
                setFile(e.target.files?.[0] ?? null);
              }}
              className="min-h-12 rounded-lg border-2 border-rule-strong bg-sheet px-3 py-2 font-bold text-ink file:mr-3 file:rounded-md file:border-2 file:border-crust-600 file:bg-sheet file:px-3 file:py-1 file:font-bold file:text-crust-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold text-ink-soft">
            戻す人
            <select value={who} onChange={(e) => setWho(e.target.value)} className={field}>
              {STAFF.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {file ? (
            <ConfirmInline
              label="このファイルで戻す"
              variant="primary"
              message={
                <>
                  「{file.name}」の中身に入れ替えます。いまのデータは消えます。よろしいですか？
                </>
              }
              yesLabel="入れ替える"
              noLabel="やめる"
              busyLabel="戻しています…"
              onConfirm={doImport}
            />
          ) : (
            <span className="pb-3 text-sm text-ink-faint">ファイルを選ぶと「戻す」ボタンが出ます</span>
          )}
        </div>
        {result?.ok && (
          <div className="mt-3">
            <Notice tone="ok">
              戻しました。表 {result.report.tables.length} 個（{result.report.tables.reduce((n, t) => n + t.rows, 0)} 行）、FAXのPDF {result.report.files} 枚。
              {result.report.skipped.length > 0 && <>（この画面ではまだ使っていない表 {result.report.skipped.length} 個は飛ばしました）</>}
            </Notice>
          </div>
        )}
        {result && !result.ok && (
          <div className="mt-3">
            <Notice tone="alert">戻せませんでした：{result.error}</Notice>
          </div>
        )}
      </section>

      {/* 記録 */}
      <section>
        <SectionTitle>前に戻したとき</SectionTitle>
        {last ? (
          <p>
            <span className="num font-bold">{fmtDateTime(last.at)}</span>　{last.who} さんが、
            <span className="num">{fmtDateTime(last.exportedAt)}</span> に書き出したファイルから戻しました。
          </p>
        ) : (
          <p className="text-ink-soft">まだ戻したことはありません。</p>
        )}
      </section>
    </div>
  );
}
