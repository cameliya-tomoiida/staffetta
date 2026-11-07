"use server";
// AI の案: 見る・言葉で直す・OK（そのまま実行）
import { revalidatePath } from "next/cache";
import { approveProposal, getProposal, planLines, reviseProposal } from "@/lib/proposals";

export interface ProposalView { id: string; kind: "purchase" | "schedule"; title: string; lines: string[]; status: "open" | "done" | "dropped"; rev: number; history: { at: string; who: string; what: string; text?: string }[] }

const view = (id: string): ProposalView | null => {
  const p = getProposal(id);
  return p ? { id: p.id, kind: p.kind, title: p.title, lines: planLines(p), status: p.status, rev: p.rev, history: p.history } : null;
};

export async function getProposalAction(id: string) {
  return view(id);
}

type R = { ok: true; view: ProposalView; message?: string; href?: string } | { ok: false; error: string };

export async function reviseProposalAction(id: string, text: string, who: string): Promise<R> {
  try {
    if (!who.trim()) throw new Error("直す人を選んでください");
    await reviseProposal(id, text, who);
    const { checkAlertsSoon } = await import("@/lib/scheduler");
    checkAlertsSoon();
    revalidatePath("/", "layout");
    return { ok: true, view: view(id)! };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function approveProposalAction(id: string, who: string): Promise<R> {
  try {
    const r = await approveProposal(id, who);
    const { checkAlertsSoon } = await import("@/lib/scheduler");
    checkAlertsSoon();
    revalidatePath("/", "layout");
    return { ok: true, view: view(id)!, message: r.message, href: r.href };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
