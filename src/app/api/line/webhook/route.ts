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
  postback?: { data: string };
};

const ACK = "受け付けました（確認中）。";
const NOT_TEXT = "ありがとうございます。\nご注文は、下の「パンを注文する」か、文章でお送りください。";
const HOWTO = [
  "【ご注文のしかた】",
  "",
  "① 下の「パンを注文する」を押します。",
  "② お届け日をえらび、パンの「＋」を押して数を入れます。数字を押すと、まとめて入れられます。",
  "③「確認する」→「この内容で注文する」で完了です。",
  "",
  "・いつもと同じなら「前回と同じ」が便利です。",
  "・このトークに文章で送っても受け付けます。",
  "　例）明日 食パン6枚切り 3本、ロール 20個",
  "・内容を確認して確定したら、このLINEでお知らせします。",
].join("\n");
const welcome = () =>
  `友だち追加ありがとうございます。\nパンのご注文は、画面の下の「パンを注文する」からどうぞ。数をえらぶだけです。\n\n▼注文フォーム\n${liffUrl()}\n\n文章でも受け付けます。\n例）明日 食パン6枚切り 3本、ロール 20個`;

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
    // リッチメニューの「使いかた」
    if (ev.type === "postback" && ev.postback?.data === "howto") {
      if (ev.replyToken) after(() => replyText(ev.replyToken!, userId, HOWTO).then(() => undefined));
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
