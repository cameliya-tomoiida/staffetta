"use server";
// 配送スタッフのスマホ画面（/driver）の口。注文の保存は事務の「電話・ドライバーの注文」と同じ lib/orders/manual-order。
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { STAFF_COOKIE, verifyStaffSession } from "@/lib/auth/staff-session";

export interface DriverItem { productId: string; name: string; unit: string; quantity: number }
export interface DriverContext {
  /** いつもの注文（その曜日の定期注文。無ければ前回の注文） */
  items: DriverItem[];
  source: "standing" | "last" | "none";
  /** 足せる商品（よく頼む順） */
  products: { id: string; name: string; unit: string }[];
  /** 届けない曜日などの注意 */
  closed?: string;
}

/** 取引先と納品日を選んだら呼ぶ: いつもの注文と、足せる商品 */
export async function driverContextAction(customerId: string, deliveryDate: string): Promise<DriverContext> {
  const [{ readRecentDb }, { loadMasters }, { withMasters, allProducts, findProduct }, { deliveryDayProblem }] = await Promise.all([
    import("@/lib/store"),
    import("@/lib/masters/seed-db"),
    import("@/lib/catalog"),
    import("@/lib/leadtime"),
  ]);
  const [db, masters] = await Promise.all([readRecentDb(), loadMasters()]);
  return withMasters(masters, () => {
    const all = allProducts();
    const known = new Set(all.map((p) => p.id));
    const wd = new Date(`${deliveryDate}T00:00:00Z`).getUTCDay();
    const standing = masters.standingOrders.filter((s) => s.active && s.customerId === customerId && s.weekday === wd
      && (!s.from || s.from <= deliveryDate) && (!s.to || deliveryDate <= s.to) && known.has(s.productId) && s.quantity > 0);
    const mine = db.orders
      .filter((o) => o.customerId === customerId && o.status !== "cancelled" && (o.intent ?? "new") === "new" && o.lines.some((l) => l.quantity > 0))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const last = mine.find((o) => o.status === "confirmed") ?? mine[0];
    const item = (productId: string, quantity: number): DriverItem => {
      const p = findProduct(productId)!;
      return { productId, name: p.name, unit: p.unit, quantity };
    };
    const items = standing.length
      ? standing.map((s) => item(s.productId, s.quantity))
      : last ? last.lines.filter((l) => l.quantity > 0 && known.has(l.productId)).map((l) => item(l.productId, l.quantity)) : [];
    const count = new Map<string, number>();
    for (const o of mine) for (const l of o.lines) count.set(l.productId, (count.get(l.productId) ?? 0) + 1);
    const products = [...all].sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0)).map((p) => ({ id: p.id, name: p.name, unit: p.unit }));
    return { items, source: standing.length ? "standing" : last ? "last" : "none", products, closed: deliveryDayProblem(customerId, deliveryDate) };
  });
}

/**
 * 注文を送る。受けた人は、スタッフの LINE ログインの名前（無ければ画面で選んだ名前）。
 * 端末で作った送信ID が同じものは1回だけ保存する（電波が切れて送り直しても二重にならない）
 */
export async function driverSendAction(input: {
  clientId: string;
  customerId: string;
  deliveryDate: string;
  items: { productId: string; quantity: number }[];
  who?: string;
}): Promise<{ ok: true; orderId: string; late: string[]; duplicate?: boolean } | { ok: false; error: string }> {
  const session = verifyStaffSession((await cookies()).get(STAFF_COOKIE)?.value, Date.now());
  const { createManualOrder } = await import("@/lib/orders/manual-order");
  const r = await createManualOrder({ ...input, channel: "driver", who: session?.n ?? input.who ?? "" });
  if (r.ok && !r.duplicate) revalidatePath("/", "layout");
  return r;
}

export interface DriverNews { customerId: string; customerName: string; deliveryDate: string; kind: "取消" | "変更"; text: string; at: string }

/** お知らせ: 自分のコースの取引先の、今日・明日の納品の変更と取消 */
export async function driverNewsAction(customerIds: string[]): Promise<DriverNews[]> {
  const [{ readRecentDb }, { customerById }, { todayJst }, { loadMasters }, { withMasters, findProduct }] = await Promise.all([
    import("@/lib/store"),
    import("@/data/master"),
    import("@/lib/clock"),
    import("@/lib/masters/seed-db"),
    import("@/lib/catalog"),
  ]);
  const [db, masters] = await Promise.all([readRecentDb(), loadMasters()]);
  const days = [todayJst(), todayJst(1)];
  const ids = new Set(customerIds);
  return withMasters(masters, () => {
    const out: DriverNews[] = [];
    for (const o of db.orders) {
      if (!o.customerId || !ids.has(o.customerId) || !days.includes(o.deliveryDate)) continue;
      const customerName = customerById(o.customerId)?.name ?? o.customerId;
      if (o.status === "cancelled") {
        out.push({ customerId: o.customerId, customerName, deliveryDate: o.deliveryDate, kind: "取消", text: "この日の注文は取り消しになりました", at: o.edits.at(-1)?.at ?? o.createdAt });
        continue;
      }
      for (const l of o.lines)
        for (const e of l.edits)
          if (e.field === "quantity")
            out.push({ customerId: o.customerId, customerName, deliveryDate: o.deliveryDate, kind: "変更", text: `${findProduct(l.productId)?.name ?? l.productId}：${e.from} → ${e.to}`, at: e.at });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
  });
}

/** 配送タブ: その日のコースの回る順・着く時刻の目安・各先に渡す商品と数・納品の仕方 */
export async function driverDayAction(courseId: string, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日付が違います");
  const [{ readRecentDb }, { loadMasters }, { withMasters, findProduct }, { getDepot, getRouteSettings }, { driverDay }] = await Promise.all([
    import("@/lib/store"),
    import("@/lib/masters/seed-db"),
    import("@/lib/catalog"),
    import("@/lib/routes/store"),
    import("@/lib/driver/day"),
  ]);
  const [db, masters] = await Promise.all([readRecentDb(), loadMasters()]);
  const course = masters.courses.find((c) => c.id === courseId);
  if (!course) throw new Error("コースが見つかりません");
  return withMasters(masters, () =>
    driverDay({
      course,
      customers: masters.customers,
      orders: db.orders,
      customerProducts: masters.customerProducts ?? [],
      date,
      depot: getDepot(),
      settings: getRouteSettings(),
      product: (id) => {
        const p = findProduct(id);
        return p ? { name: p.name, unit: p.unit } : undefined;
      },
    }),
  );
}
