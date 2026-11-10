// 「自動で確定した注文か」の判定（サーバー・画面のどちらからでも使える。"use client" の部品の中に置くと、サーバーの画面から呼べないため）
export const isAutoConfirmed = (o: { status: string; confirmedBy?: string }) => o.status === "confirmed" && !!o.confirmedBy?.startsWith("自動");
