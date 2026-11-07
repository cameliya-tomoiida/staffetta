// データの置き場（DB の外のファイル: 受け取った FAX の PDF・発注の出力・印刷の PDF・翻訳の控え など）。
// ふだんは <アプリ>/data。HUB_DATA_DIR があればそこ（審査員向けの見本 3118 は data/demo-public。本番 3100 の FAX などが見えないように。11/8 管理役2）
import path from "node:path";

export const DATA_DIR = process.env.HUB_DATA_DIR ? path.resolve(process.env.HUB_DATA_DIR) : path.join(process.cwd(), "data");

/** 審査員向けの見本（HUB_DEMO=1）で動いているか */
export const isPublicDemo = () => process.env.HUB_DEMO === "1";
