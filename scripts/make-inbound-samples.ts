// 外部の入口（メール・スプレッドシート・専用サイトCSV・インフォマートCSV）の架空サンプルを作る。
// 実行: npx tsx scripts/make-inbound-samples.ts
// できるもの: public/samples/inbound/ 以下。社名・品名・数量はすべて架空。
import ExcelJS from "exceljs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildEml } from "../src/lib/channels/eml";
import { KIRARA_ITEMS } from "../src/lib/channels/kirara/config";
import { makeSimplePdf } from "../src/lib/channels/pdf";

const OUT = path.join(process.cwd(), "public", "samples", "inbound");
const HUB = "あさひ製パン工場 受注係 <order@asahi-bakery.example>";

async function write(rel: string, data: string | Uint8Array) {
  const p = path.join(OUT, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, data);
  console.log("作成:", path.relative(process.cwd(), p));
}

// ───────── メール ─────────
async function emails() {
  // ① PDF の発注書（ピザ店）
  const pdf = await makeSimplePdf({
    title: "発 注 書",
    headerRight: ["発注番号 YM-261105-01", "発注日 2026年11月5日"],
    to: ["あさひ製パン工場 御中"],
    from: ["ピッツェリア やまのて（デモ）", "購買担当 たなか", "TEL 000-0000-0001"],
    lead: ["下記のとおり発注いたします。", "納品場所：セントラルキッチン（工場直送）"],
    table: {
      columns: [
        { label: "納品日", width: 90 },
        { label: "品名", width: 200 },
        { label: "入数", width: 60, align: "right" },
        { label: "数量", width: 60, align: "right" },
        { label: "単位", width: 50, align: "center" },
      ],
      rows: [
        ["11/9(月)", "ピザクラスト 23cm", "10", "48", "ケース"],
        ["11/11(水)", "ピザクラスト 23cm", "10", "36", "ケース"],
        ["11/11(水)", "ピザクラスト 27cm（試作）", "5", "4", "ケース"],
      ],
    },
    notes: ["※27cm は試作分です。単価は別途ご相談ください。", "※ケース＝10枚入（27cm は 5枚入）"],
  });
  await write("email/pdf-order.pdf", pdf);
  await write(
    "email/01_PDF注文書_ピッツェリアやまのて.eml",
    buildEml({
      from: "ピッツェリア やまのて 購買 <kobai@yamanote-pizza.example>",
      to: HUB,
      subject: "【発注】11月第2週 ピザクラスト（YM-261105-01）",
      date: new Date("2026-11-05T09:20:00+09:00"),
      messageId: "<ym-261105-01@yamanote-pizza.example>",
      text: "あさひ製パン工場 ご担当者様\n\nいつもお世話になっております。\n11月第2週分の発注書を添付いたします。\nご確認のほど、よろしくお願いいたします。\n\nピッツェリア やまのて（デモ） 購買 たなか",
      attachments: [{ filename: "発注書_YM-261105-01.pdf", contentType: "application/pdf", content: pdf }],
    }),
  );

  // ② Excel の注文書（社員食堂）
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("注文書");
  ws.addRow(["パン注文書"]);
  ws.addRow(["注文者", "とうわ工業 社員食堂（デモ）", "", "注文日", "2026/11/5"]);
  ws.addRow(["納品先", "第2工場 食堂（裏口）"]);
  ws.addRow([]);
  ws.addRow(["品名", "11/9(月)", "11/10(火)", "11/11(水)", "11/12(木)", "11/13(金)", "単位"]);
  ws.addRow(["バターロール", 120, 120, 100, 120, 150, "個"]);
  ws.addRow(["黒糖ロール", 40, "", 40, "", 40, "個"]);
  ws.addRow(["食パン 8枚切", 6, 6, 6, 6, 8, "斤"]);
  ws.addRow(["ごまバンズ（10個入）", 3, "", "", 3, "", "袋"]);
  ws.addRow([]);
  ws.addRow(["備考", "金曜は行事のためバターロール多め。空欄は注文なし。"]);
  ws.getColumn(1).width = 22;
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  await write("email/excel-order.xlsx", xlsx);
  await write(
    "email/02_Excel注文書_とうわ工業.eml",
    buildEml({
      from: "とうわ工業 総務課 <soumu@towa-kogyo.example>",
      to: HUB,
      subject: "11/9週 パン注文書",
      date: new Date("2026-11-05T10:02:00+09:00"),
      messageId: "<towa-1109@towa-kogyo.example>",
      text: "あさひ製パン工場 様\n\n来週分の注文書をお送りします。\nよろしくお願いします。\n\nとうわ工業 総務課 すずき",
      attachments: [
        { filename: "注文書_1109週.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content: xlsx },
      ],
    }),
  );

  // ③ 本文の注文 → ④ 本文で数量変更 → ⑤ キャンセル（材料卸）
  await write(
    "email/03_本文注文_まるしょう食品.eml",
    buildEml({
      from: "まるしょう食品 受発注 <juhacchu@marusho-foods.example>",
      to: HUB,
      subject: "11/11納品分 注文",
      date: new Date("2026-11-05T11:15:00+09:00"),
      messageId: "<ms-1111-a@marusho-foods.example>",
      text: "お世話になっております。まるしょう食品です。\n\n11月11日（水）納品で下記お願いします。\n\n・ピザクラスト 23cm　300枚\n・バターロール　200個\n・ミニロール（黒糖）　150個\n\n以上、よろしくお願いします。\nまるしょう食品（デモ） 受発注担当 やまだ",
    }),
  );
  await write(
    "email/04_本文変更_まるしょう食品.eml",
    buildEml({
      from: "まるしょう食品 受発注 <juhacchu@marusho-foods.example>",
      to: HUB,
      subject: "Re: 11/11納品分 注文【数量変更】",
      date: new Date("2026-11-05T15:40:00+09:00"),
      messageId: "<ms-1111-b@marusho-foods.example>",
      text: "たびたびすみません。先ほどお電話した件です。\n\n11/11納品分、ピザクラスト 23cm を 300枚 → 360枚 に変更お願いします。\nほかは変更ありません。\n\nまるしょう食品（デモ） やまだ\n\n> 11月11日（水）納品で下記お願いします。\n> ・ピザクラスト 23cm　300枚\n> ・バターロール　200個\n> ・ミニロール（黒糖）　150個",
    }),
  );
  await write(
    "email/05_本文キャンセル_まるしょう食品.eml",
    buildEml({
      from: "まるしょう食品 受発注 <juhacchu@marusho-foods.example>",
      to: HUB,
      subject: "11/11 ミニロール キャンセル",
      date: new Date("2026-11-06T08:05:00+09:00"),
      messageId: "<ms-1111-c@marusho-foods.example>",
      text: "おはようございます。\n11/11納品分のミニロール（黒糖）150個は、先方の行事中止のためキャンセルでお願いします。\nピザクラストとバターロールはそのままです。\n\nまるしょう食品（デモ） やまだ",
    }),
  );
}

// ───────── Google スプレッドシート（ベーグル店本部） ─────────
// 店舗別・月別のシート。行＝納品日、列＝商品、セル＝ケース数。
// v1 = 前回読んだときの中身、v2 = 本部が書き換えたあと（差分のデモ用）
async function sheets() {
  const head = ["納品日", "曜日", "バターロール（10個入）", "ミニロール白（20個入）", "食パン8枚切（1斤）", "ピザクラスト23cm（10枚入）", "備考"];
  const v1 = [
    ["2026/11/9", "月", "4", "2", "6", "", ""],
    ["2026/11/10", "火", "3", "2", "6", "1", ""],
    ["2026/11/11", "水", "4", "", "6", "", ""],
    ["2026/11/12", "木", "3", "2", "6", "1", ""],
    ["2026/11/13", "金", "5", "3", "8", "", "週末多め"],
    ["2026/11/14", "土", "", "", "", "", "定休"],
  ];
  const v2 = v1.map((r) => [...r]);
  v2[1][2] = "5"; // 11/10 バターロール 3 → 5
  v2[3][5] = ""; // 11/12 ピザクラスト 1 → なし
  v2[4][4] = "10"; // 11/13 食パン 8 → 10
  v2.push(["2026/11/16", "月", "4", "2", "6", "", "追加"]);
  const csv = (rows: string[][]) => [head, ...rows].map((r) => r.join(",")).join("\r\n");
  await write("sheet/ベーグル工房みなみ_2026年11月_さかえ店_v1.csv", csv(v1));
  await write("sheet/ベーグル工房みなみ_2026年11月_さかえ店_v2.csv", csv(v2));
}

// ───────── 取引先の発注サイト（デモ: あおい医療フードサービス）の EDI CSV ─────────
// 実物と同じ 23列・ヘッダーなし。数量は100倍の値（400 = 4パック）。
async function kirara() {
  const sites = [
    { code: "420D101   ", name: "老健 みどりの丘（デモ）" },
    { code: "420D102   ", name: "有料 ひだまりの家（デモ）" },
    { code: "420D103   ", name: "病院 つばさ病院（デモ）" },
    { code: "420D104   ", name: "特養 さくらの里（デモ）" },
  ];
  const plan: Record<string, Record<string, number>> = {
    "420D101   ": { "910001": 30, "910002": 12, "910010": 4, "910030": 5, "910050": 2 },
    "420D102   ": { "910003": 20, "910011": 3, "910031": 18, "910041": 6 },
    "420D103   ": { "910001": 65, "910004": 3, "910010": 8, "910020": 25, "910040": 2 },
    "420D104   ": { "910002": 40, "910032": 15, "910011": 5, "910030": 3 },
  };
  const make = (slip: string, orderDate: string, tweak?: (site: string, code: string, q: number) => number) => {
    const rows: string[] = [];
    for (const s of sites) {
      let line = 0;
      for (const [code, q0] of Object.entries(plan[s.code.trim()] ?? plan[s.code])) {
        const q = tweak ? tweak(s.code.trim(), code, q0) : q0;
        if (q <= 0) continue;
        const item = KIRARA_ITEMS.find((i) => i.code === code)!;
        line++;
        rows.push(
          [
            "2", "0", slip, "900R000001", "あさひ製パン工場（デモ）", "900S01      ", "北部物流センター（デモ）",
            "1", "１便", orderDate, "20261110", "20261111", String(line).padStart(4, "0"), code.padEnd(9, " "), "C",
            item.name, "PA", "ﾊﾟｯｸ", s.code, s.name, String(q * 100).padStart(9, "0"), "000000000", String(q * 100).padStart(9, "0"),
          ].join(","),
        );
      }
    }
    return rows.join("\r\n") + "\r\n";
  };
  // 朝の分と、昼に数が変わった分（現役のマクロの「前回数量」「数量差」に当たる）
  await write("kirara/SR900S01_20261108_朝.csv", make("077500101", "20261108"));
  await write(
    "kirara/SR900S01_20261108_昼.csv",
    make("077500102", "20261108", (site, code, q) => (site === "420D103" && code === "910001" ? 70 : site === "420D102" && code === "910041" ? 0 : q)),
  );
}

// ───────── インフォマート（受注）の CSV ─────────
// 実物の形は、担当者のログイン後の画面で確認してから合わせる（docs/infomart-notes.md）。
async function infomart() {
  const head = ["伝票番号", "発注日", "納品予定日", "発注元企業コード", "発注元企業名", "納品先コード", "納品先名", "明細行", "商品コード", "商品名", "規格", "入数", "数量", "単位", "備考"];
  const rows = [
    ["IMD-0001201", "2026/11/05", "2026/11/10", "IM-0007", "やまびこ給食（デモ）", "N01", "東センター", "1", "P01", "バターロール", "35g", "1", "180", "個", ""],
    ["IMD-0001201", "2026/11/05", "2026/11/10", "IM-0007", "やまびこ給食（デモ）", "N01", "東センター", "2", "P03", "食パン 8枚切", "1斤", "1", "12", "斤", ""],
    ["IMD-0001201", "2026/11/05", "2026/11/10", "IM-0007", "やまびこ給食（デモ）", "N01", "東センター", "3", "P10", "超じゅくロール 6個入", "6個入", "6", "15", "袋", ""],
    ["IMD-0001202", "2026/11/05", "2026/11/11", "IM-0007", "やまびこ給食（デモ）", "N02", "西センター", "1", "P02", "黒糖ロール", "35g", "1", "90", "個", ""],
    ["IMD-0001202", "2026/11/05", "2026/11/11", "IM-0007", "やまびこ給食（デモ）", "N02", "西センター", "2", "P07", "ピザクラスト 23cm", "10枚入", "10", "6", "ケース", "午前着希望"],
    ["IMD-0001202", "2026/11/05", "2026/11/11", "IM-0007", "やまびこ給食（デモ）", "N02", "西センター", "3", "X99", "季節の菓子パン", "", "1", "20", "個", "新商品"],
  ];
  await write("infomart/受注明細_20261105.csv", "﻿" + [head, ...rows].map((r) => r.join(",")).join("\r\n"));
}

async function main() {
  await emails();
  await sheets();
  await kirara();
  await infomart();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
