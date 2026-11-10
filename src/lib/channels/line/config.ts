import "server-only";

// LINE の設定値はすべて .env.local から読む（gitには入れない）。
// 値が空のときは「デモモード」: 署名チェックを省き、LINEへの送信は data/line.json の送信記録に残すだけにする。

export const lineConfig = {
  /** Messaging API チャネルの「チャネルシークレット」 */
  channelSecret: process.env.LINE_CHANNEL_SECRET ?? "",
  /** Messaging API チャネルの「チャネルアクセストークン（長期）」 */
  accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
  /** LINEログインチャネルの「チャネルID」（LIFFのIDトークンの確認に使う） */
  loginChannelId: process.env.LINE_LOGIN_CHANNEL_ID ?? "",
  /** LIFFアプリの「LIFF ID」 */
  liffId: process.env.NEXT_PUBLIC_LIFF_ID ?? "",
};

/** 本物のLINEにつながっているか（false ならデモモード） */
export const isLineLive = () => Boolean(lineConfig.channelSecret && lineConfig.accessToken);

/** デモの架空のお客さん（U_demo_… / U-demo-…）か。本番のLINEでも、この人たちには送らない */
export const isDemoLineUser = (userId: string) => /^U[-_]demo[-_]/i.test(userId);

/** LIFFのURL（お客さんに送るリンク）。未設定ならローカルの画面 */
export const liffUrl = () => (lineConfig.liffId ? `https://liff.line.me/${lineConfig.liffId}` : "/liff/order");
