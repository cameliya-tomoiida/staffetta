import Link from "next/link";
import { hasAiKey } from "@/lib/hygiene/ai-chat";
import { getSheet } from "@/lib/hygiene/store";
import { SheetChat } from "./SheetChat";

export const metadata = { title: "AI と衛生チェックシートを作る｜STAFFETTA" };
export const dynamic = "force-dynamic";

// 衛生チェックシートを AI とのチャットで作る・直す（⑦の(24)）。?sheet= で今あるシートを直す。
export default async function SheetAiPage(props: PageProps<"/hygiene/ai">) {
  const q = await props.searchParams;
  const editing = typeof q.sheet === "string" ? getSheet(q.sheet) : undefined;
  const ai = hasAiKey();
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <Link href="/hygiene" className="link text-xl">
        ← 衛生管理
      </Link>
      <h1 className="text-3xl font-bold">{editing ? `AI と「${editing.title}」を直す` : "AI と衛生チェックシートを作る"}</h1>
      <p className="text-xl text-ink-soft">
        声か文章で、どんなチェックをしたいか話してください（例：「ピザの冷蔵庫、1日2回、5℃以下」）。AI が下書きを作り、右に印刷の見本を出します。「ここを変えて」と何度でも直せます。できたら「登録する」。
      </p>
      {ai ? (
        <SheetChat initial={editing} />
      ) : (
        <div className="card space-y-2 p-6 text-xl">
          <p className="font-bold">AI を使うには、Claude の API キーが要ります。</p>
          <p><Link href="/settings/ai">設定 → AI</Link> でキーを入れると、ここで AI と話してシートを作れるようになります（キーが無いときは、このアプリを動かす環境の ANTHROPIC_API_KEY を使います）。</p>
          <p>
            キーが無くても、<Link href="/hygiene">衛生管理</Link>の各シートの「項目・記入する曜日を直す」で、手で直せます。
          </p>
        </div>
      )}
    </main>
  );
}
