"use client";
// マスタ管理の1画面（②）: 見出し＋CSV のボタン＋一覧（検索・並べ替え）＋編集フォーム（個別の登録・修正）。
// 各マスタの画面（/admin/products など）は、列の定義（③）と保存・取り込みの server action（①⑤）を渡すだけで作れる。
//
//   <AdminPage title="商品" name="products" idKey="id" columns={cols} rows={rows}
//     onSave={saveProduct} onImport={importProducts} top={<LineLinkPanel />} formExtra={{ C01: <CustomerOrderSettings … /> }} />
import { useRef, useState } from "react";
import { Button, PageHeader } from "@/components/ui";
import { AdminTable } from "./AdminTable";
import { AdminForm } from "./AdminForm";
import { CsvTools } from "./CsvTools";
import type { ColumnDef, ImportResult, Row, SaveResult } from "./types";

export function AdminPage({
  title, lead, name, idKey, columns, rows, onSave, onImport, exportHref, top, formExtra, note,
}: {
  title: string;
  lead?: string;
  /** CSV のファイル名のもと */
  name: string;
  idKey: string;
  columns: ColumnDef[];
  rows: Row[];
  onSave?: (row: Row) => Promise<SaveResult>;
  onImport?: (fd: FormData) => Promise<ImportResult>;
  exportHref?: string;
  /** 一覧の上に置く部品（取引先の LINE ひも付けなど） */
  top?: React.ReactNode;
  /** 行ごとに、編集フォームの下へ置く部品（キーは行の ID） */
  formExtra?: Record<string, React.ReactNode>;
  /** ページの下の注記（データの出どころなど） */
  note?: React.ReactNode;
}) {
  const [editing, setEditing] = useState<{ row: Row; isNew: boolean } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const open = (e: { row: Row; isNew: boolean }) => {
    setEditing(e);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const empty = () => Object.fromEntries(columns.map((c) => [c.key, c.type === "bool" ? false : ""])) as Row;

  return (
    <div>
      <PageHeader title={title} lead={lead}>
        <Button variant="primary" size="lg" onClick={() => open({ row: empty(), isNew: true })}>
          ＋ 新しく登録
        </Button>
      </PageHeader>

      <div className="mb-4">
        <CsvTools name={name} columns={columns} rows={rows} onImport={onImport} exportHref={exportHref} />
      </div>

      {top && <div className="mb-4">{top}</div>}

      {/* 編集フォームは一覧の上に出す（横に並べると一覧がつぶれて読みにくいため） */}
      {editing && (
        <div ref={formRef} className="mb-4 scroll-mt-24">
          <AdminForm
            key={`${String(editing.row[idKey] ?? "new")}-${editing.isNew}`}
            columns={columns.map((c) => (c.key === idKey && !editing.isNew ? { ...c, readOnly: true } : c))}
            initial={editing.row}
            isNew={editing.isNew}
            onSave={onSave}
            onCancel={() => setEditing(null)}
            extra={!editing.isNew ? formExtra?.[String(editing.row[idKey])] : undefined}
          />
        </div>
      )}

      <AdminTable
        columns={columns}
        rows={rows}
        idKey={idKey}
        selectedId={editing && !editing.isNew ? String(editing.row[idKey]) : null}
        onPick={(r) => open({ row: r, isNew: false })}
      />

      {note && <div className="mt-6 text-sm text-ink-soft">{note}</div>}
    </div>
  );
}
