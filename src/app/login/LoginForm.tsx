"use client";
import { useActionState } from "react";
import { loginAction, setupAction } from "./actions";

const field = "mt-1 h-14 w-full rounded-xl border-2 border-[#838b83] bg-white px-4 text-[20px]";
const label = "block text-[18px] font-bold";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className={label}>ユーザー名<input key={state?.username ?? ""} name="username" defaultValue={state?.username ?? ""} autoComplete="username" required className={field} /></label>
      <label className={label}>パスワード<input name="password" type="password" autoComplete="current-password" required autoFocus={!!state?.error} className={field} /></label>
      {state?.error && <p role="alert" className="rounded-xl bg-[#fff0f1] px-4 py-3 text-[18px] font-bold text-[#a51e28]">{state.error}</p>}
      <button disabled={pending} className="min-h-16 w-full rounded-xl bg-[#8b1a1a] text-[22px] font-bold text-white disabled:bg-[#c5cac5]">{pending ? "確かめています…" : "ログイン"}</button>
    </form>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, null);
  return (
    <form action={action} className="space-y-4">
      <label className={label}>名前（画面に出る名前）<input name="name" required className={field} /></label>
      <label className={label}>ユーザー名（半角の英数字 3〜32文字）<input name="username" autoComplete="username" required pattern="[A-Za-z0-9._\-]{3,32}" className={field} /></label>
      <label className={label}>パスワード（8文字以上）<input name="password" type="password" autoComplete="new-password" required minLength={8} className={field} /></label>
      <label className={label}>パスワード（もう一度）<input name="password2" type="password" autoComplete="new-password" required minLength={8} className={field} /></label>
      {state?.error && <p role="alert" className="rounded-xl bg-[#fff0f1] px-4 py-3 text-[18px] font-bold text-[#a51e28]">{state.error}</p>}
      <button disabled={pending} className="min-h-16 w-full rounded-xl bg-[#8b1a1a] text-[22px] font-bold text-white disabled:bg-[#c5cac5]">{pending ? "作っています…" : "管理者を作ってログイン"}</button>
    </form>
  );
}
