"use client";
// 取引先マスタの管理画面に置く、LINE のひも付けと注文方法の入力部品（画面側）。
import { useState, useTransition } from "react";
import type { OrderChannel } from "@/data/types";
import { addCustomerAndLinkAction, linkLineUserAction, saveCustomerSettingsAction, unlinkLineUserAction } from "@/lib/channels/line/actions";
import { Button, Notice } from "@/components/ui";
import { ConfirmInline } from "@/components/ui/ConfirmInline";

const WHO = "事務"; // ログインの仕組みができたら、その人の名前にする

export type CustomerOption = { id: string; name: string };
export type ChannelOption = { value: OrderChannel; label: string };
type Settings = { name: string; channel: OrderChannel; cutoff: string; deliveryTime: string; course: string };

const field = "min-h-12 w-full rounded-lg border border-rule-strong bg-sheet px-3 text-base text-ink focus:border-crust-600 focus:outline-none";

/** 1人分: 既存の取引先を選んでひも付ける ／ 新しい取引先として登録してひも付ける */
export function LinkRow({ userId, suggestedName, customers, channels }: { userId: string; suggestedName: string; customers: CustomerOption[]; channels: ChannelOption[] }) {
  const [mode, setMode] = useState<"pick" | "new">("pick");
  const [customerId, setCustomerId] = useState("");
  const [error, setError] = useState("");
  const [s, setS] = useState<Settings>({ name: suggestedName, channel: "line", cutoff: "17:00", deliveryTime: "08:00", course: "" });
  const [pending, start] = useTransition();
  const picked = customers.find((c) => c.id === customerId);

  if (mode === "new")
    return (
      <div className="space-y-3 rounded-lg border border-rule bg-sheet p-4">
        <div className="font-bold">新しい取引先として登録して、ひも付ける</div>
        <SettingsFields value={s} onChange={setS} channels={channels} />
        {error && <Notice tone="alert">{error}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError("");
                try {
                  await addCustomerAndLinkAction(userId, s, WHO);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              })
            }
          >
            {pending ? "登録しています…" : "登録してひも付ける"}
          </Button>
          <Button variant="quiet" disabled={pending} onClick={() => setMode("pick")}>
            やめる
          </Button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="ひも付ける取引先" className={`${field} max-w-xs`} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
        <option value="">取引先を選ぶ…</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {picked ? (
        <ConfirmInline
          variant="primary"
          label="ひも付ける"
          message={`このLINEの人を「${picked.name}」にひも付けます。お店が不明の要確認の注文にも、このお店が入ります。`}
          yesLabel="ひも付ける"
          noLabel="やめる"
          busyLabel="ひも付けています…"
          onConfirm={() => linkLineUserAction(userId, picked.id, WHO)}
        />
      ) : (
        <Button variant="primary" disabled>
          ひも付ける
        </Button>
      )}
      <Button variant="ghost" onClick={() => setMode("new")}>
        ＋ 新しい取引先として登録
      </Button>
    </div>
  );
}

/** ひも付けを外す */
export function UnlinkButton({ userId, customerName }: { userId: string; customerName: string }) {
  return (
    <ConfirmInline
      variant="ghost"
      label="解除"
      message={`「${customerName}」とのひも付けを外します。これから届く注文は「お店が不明」になります（もう入っている注文はそのままです）。`}
      yesLabel="解除する"
      noLabel="やめる"
      busyLabel="解除しています…"
      onConfirm={() => unlinkLineUserAction(userId, WHO)}
    />
  );
}

function SettingsFields({ value, onChange, channels, withName = true }: { value: Settings; onChange: (s: Settings) => void; channels: ChannelOption[]; withName?: boolean }) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {withName && (
        <label className="space-y-1 sm:col-span-2">
          <span className="text-sm font-bold text-ink-soft">取引先の名前</span>
          <input className={field} value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="例）喫茶こもれび" />
        </label>
      )}
      <div className="space-y-1 sm:col-span-2">
        <span className="text-sm font-bold text-ink-soft">主な注文の入口</span>
        <div className="flex flex-wrap gap-2">
          {channels.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={value.channel === c.value}
              onClick={() => set("channel", c.value)}
              className={`min-h-12 rounded-lg border px-4 font-bold ${value.channel === c.value ? "border-crust-600 bg-crust-600 text-white" : "border-rule-strong bg-sheet text-ink hover:bg-crust-50"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <label className="space-y-1">
        <span className="text-sm font-bold text-ink-soft">締め時刻（前日）</span>
        <input type="time" className={field} value={value.cutoff} onChange={(e) => set("cutoff", e.target.value)} />
      </label>
      <label className="space-y-1">
        <span className="text-sm font-bold text-ink-soft">納品時刻</span>
        <input type="time" className={field} value={value.deliveryTime} onChange={(e) => set("deliveryTime", e.target.value)} />
      </label>
      <label className="space-y-1 sm:col-span-2">
        <span className="text-sm font-bold text-ink-soft">配送コース</span>
        <input className={field} value={value.course} onChange={(e) => set("course", e.target.value)} placeholder="例）Aコース・売店" />
      </label>
    </div>
  );
}

/** 取引先1社分の注文方法（入口・締め・納品時刻・配送コース）の編集 */
export function OrderSettingsForm({ customerId, initial, channels }: { customerId: string; initial: Settings; channels: ChannelOption[] }) {
  const [s, setS] = useState<Settings>(initial);
  const [msg, setMsg] = useState<{ tone: "ok" | "alert"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const changed = JSON.stringify(s) !== JSON.stringify(initial);
  return (
    <div className="space-y-3">
      <SettingsFields value={s} onChange={(v) => (setS(v), setMsg(null))} channels={channels} withName={false} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Button
        variant="primary"
        disabled={pending || !changed}
        onClick={() =>
          start(async () => {
            try {
              await saveCustomerSettingsAction(customerId, s, WHO);
              setMsg({ tone: "ok", text: "注文方法を保存しました" });
            } catch (e) {
              setMsg({ tone: "alert", text: e instanceof Error ? e.message : String(e) });
            }
          })
        }
      >
        {pending ? "保存しています…" : "注文方法を保存"}
      </Button>
    </div>
  );
}
