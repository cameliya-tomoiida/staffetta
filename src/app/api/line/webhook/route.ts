import { after } from "next/server";
import { isLineLive, lineConfig, liffUrl } from "@/lib/channels/line/config";
import { getDisplayName, replyText, verifySignature } from "@/lib/channels/line/client";
import { ingestTalkMessage } from "@/lib/channels/line/orders";
import { touchUser } from "@/lib/channels/line/state";

// LINE公式アカウントの Webhook。LINE Developers の「Webhook URL」に https://（公開URL）/api/line/webhook を入れる。
// 受け取ったらすぐ「受け付けました（確認中）」と返し、Claude の読み取りと保存は応答のあとで行う。

export const maxDuration = 120;

type LineEvent = {
  type: string;
  replyToken?: string;
  timestamp: number;
  source?: { type: string; userId?: string };
  message?: { id: string; type: string; text?: string };
  deliveryContext?: { isRedelivery?: boolean };
};

const ACK = "ご注文を受け付けました（確認中）。\n確認ができましたら、あらためてご連絡します。";
const NOT_TEXT = "ありがとうございます。\nご注文は、文章でお送りいただくか、下の「注文する」からお願いします。";
const welcome = () =>
  `友だち追加ありがとうございます。\nパンのご注文は、この画面からできます。\n\n▼注文フォーム（数を選ぶだけ）\n${liffUrl()}\n\n文章でも受け付けます。\n例）明日 食パン6枚切り 3本、ロール 20個`;

export async function POST(request: Request) {
  const raw = await request.text();

  // 本番は署名で LINE からの通信か確かめる。デモモード（シークレット未設定）は開発中のテスト送信だけ受ける
  if (lineConfig.channelSecret) {
    if (!verifySignature(raw, request.headers.get("x-line-signature"))) {
      return new Response("bad signature", { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return new Response("LINE is not configured", { status: 503 });
  }

  let events: LineEvent[] = [];
  try {
    events = (JSON.parse(raw) as { events?: LineEvent[] }).events ?? [];
  } catch {
    return new Response("bad json", { status: 400 });
  }

  for (const ev of events) {
    const userId = ev.source?.userId;
    if (!userId) continue;

    if (ev.type === "follow") {
      after(async () => {
        await touchUser(userId, { displayName: await getDisplayName(userId) });
        if (ev.replyToken) await replyText(ev.replyToken, userId, welcome());
      });
      continue;
    }
    if (ev.type !== "message" || !ev.message) continue;

    if (ev.message.type !== "text" || !ev.message.text) {
      if (ev.replyToken) after(() => replyText(ev.replyToken!, userId, NOT_TEXT).then(() => undefined));
      continue;
    }

    const message = { id: ev.message.id, text: ev.message.text };
    const receivedAt = new Date(ev.timestamp || Date.now()).toISOString();
    after(async () => {
      // お客さんへは「受け付けました（確認中）」だけを返す（読み取り結果は伝えない）
      if (ev.replyToken && !ev.deliveryContext?.isRedelivery) await replyText(ev.replyToken, userId, ACK);
      if (isLineLive()) await touchUser(userId, { displayName: await getDisplayName(userId) });
      await ingestTalkMessage({ messageId: message.id, userId, text: message.text, receivedAt });
    });
  }
  return Response.json({ ok: true });
}

/** 動作確認用（ブラウザで開くと設定の状態が分かる。秘密の値は出さない） */
export async function GET() {
  return Response.json({
    ok: true,
    mode: isLineLive() ? "live" : "demo",
    hasSecret: Boolean(lineConfig.channelSecret),
    hasToken: Boolean(lineConfig.accessToken),
    hasLiffId: Boolean(lineConfig.liffId),
    hasLoginChannelId: Boolean(lineConfig.loginChannelId),
  });
}
