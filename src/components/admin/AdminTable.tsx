"use client";
// マスタの一覧（②）。上の検索で絞り込み、見出しを押すと並べ替え。行を押すと編集。
import { useMemo, useState } from "react";
import type { ColumnDef, Row } from "./types";

export function cellText(c: ColumnDef, v: Row[string]): string {
  if (v === null || v === undefined || v === "") return "—";
  if (c.type === "bool") return v ? "はい" : "いいえ";
  if (c.type === "select") return c.options?.find((o) => o.value === String(v))?.label ?? String(v);
  if (c.type === "number" && typeof v === "number") return `${v.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}${c.unit ? ` ${c.unit}` : ""}`;
  return `${v}${c.unit && c.type !== "number" ? ` ${c.unit}` : ""}`;
}

export function AdminTable({
  columns, rows, idKey, selectedId, onPick,
}: {
  columns: ColumnDef[];
  rows: Row[];
  idKey: string;
  selectedId?: string | null;
  onPick?: (row: Row) => void;
}) {
  const cols = columns.filter((c) => c.list !== false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (r: Row) => {
      const text = cols.map((c) => cellText(c, r[c.key])).join(" ").toLowerCase() + " " + String(r[idKey] ?? "").toLowerCase();
      return words.every((w) => text.includes(w));
    };
    const list = rows.filter(hit);
    if (!sort) return list;
    return [...list].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir;
      return String(x ?? "").localeCompare(String(y ?? ""), "ja", { numeric: true }) * sort.dir;
    });
  }, [rows, q, sort, cols, idKey]);

  return (
    <div className="rounded-lg border border-rule bg-sheet">
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-3 py-2">
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-sm font-bold text-ink-soft">さがす</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="名前・コードなど"
            className="min-h-12 w-full max-w-md rounded-lg border-2 border-rule-strong bg-sheet px-3"
          />
        </label>
        <span className="text-sm text-ink-soft">
          <b className="num text-base text-ink">{shown.length}</b> / {rows.length} 件
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b-2 border-rule-strong bg-cream text-left text-sm">
              {cols.map((c) => {
                const on = sort?.key === c.key;
                return (
                  <th key={c.key} className="px-3 py-0 font-bold whitespace-nowrap" aria-sort={on ? (sort!.dir === 1 ? "ascending" : "descending") : undefined}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center gap-1 text-left"
                      onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}
                    >
                      {c.label}
                      <span className={`text-xs ${on ? "text-crust-700" : "text-ink-faint"}`}>{on ? (sort!.dir === 1 ? "▲" : "▼") : "↕"}</span>
                    </button>
                  </th>
                );
              })}
              {onPick && <th className="w-24 px-3" />}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const id = String(r[idKey] ?? "");
              const on = selectedId === id;
              return (
                <tr key={id} className={`border-b border-rule last:border-b-0 ${on ? "bg-crust-50" : "hover:bg-cream"}`}>
                  {cols.map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${c.type === "number" ? "num text-right whitespace-nowrap" : c.type === "textarea" ? "min-w-48" : "whitespace-nowrap"}`}>
                      {cellText(c, r[c.key])}
                    </td>
                  ))}
                  {onPick && (
                    <td className="px-3 py-1 text-right">
                      <button type="button" onClick={() => onPick(r)} className="btn-ghost min-h-11 px-3 text-sm">
                        {on ? "編集中" : "編集"}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={cols.length + 1} className="px-3 py-8 text-center text-ink-soft">
                  {rows.length === 0 ? "まだ登録がありません。右上の「新しく登録」か「CSVで一括登録」から入れてください。" : "見つかりませんでした。"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
