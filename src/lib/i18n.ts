// 現場向け画面（工程表・計量）の表示言語。
// ベトナム語は機械翻訳の下書き。現場のベトナム人スタッフに確認してもらう前提。
export type Lang = "ja" | "vi";

const dict = {
  ja: {
    schedule: "今日の工程表", weighing: "計量表", line_bread: "パンライン", line_pizza: "ピザライン",
    dough: "生地", start: "開始", end: "終了", total_dough: "仕込み量", pieces: "個数", piece_g: "分割",
    material: "材料", amount: "量", water: "水", check: "済", flour_base: "粉", deliver: "納品日",
    mix: "ミキシング", ferment: "一次発酵", divide: "分割", shape: "成形", proof: "ホイロ", bake: "焼成", cool: "冷却", pack: "包装",
  },
  vi: {
    schedule: "Lịch sản xuất hôm nay", weighing: "Bảng cân nguyên liệu", line_bread: "Dây chuyền bánh mì", line_pizza: "Dây chuyền pizza",
    dough: "Bột", start: "Bắt đầu", end: "Kết thúc", total_dough: "Lượng bột", pieces: "Số cái", piece_g: "Chia",
    material: "Nguyên liệu", amount: "Lượng", water: "Nước", check: "Xong", flour_base: "Bột mì", deliver: "Ngày giao",
    mix: "Trộn bột", ferment: "Ủ lần 1", divide: "Chia bột", shape: "Tạo hình", proof: "Ủ lần 2", bake: "Nướng", cool: "Làm nguội", pack: "Đóng gói",
  },
} as const;

export type Key = keyof (typeof dict)["ja"];
export const t = (lang: Lang, key: Key) => dict[lang][key];

const names: Record<string, string> = {
  // 生地
  D01: "Bột bánh cuộn", D02: "Bột bánh cuộn đường đen", D03: "Bột bánh mì sandwich", D04: "Bột pizza",
  // 商品
  P01: "Bánh cuộn bơ", P02: "Bánh cuộn đường đen", P03: "Bánh mì sandwich (8 lát)", P04: "Bánh mì sandwich (6 lát)",
  P05: "Bánh cuộn nhỏ (trắng)", P06: "Bánh cuộn nhỏ (đường đen)", P07: "Đế pizza 23cm",
  // 材料
  M01: "Bột mì cứng", M02: "Bột mì trung", M03: "Đường trắng", M04: "Đường đen", M05: "Muối", M06: "Bơ",
  M07: "Trứng", M08: "Men khô", M09: "Sữa bột tách béo", M10: "Shortening", M11: "Dầu ô liu",
};

/** マスターの名前をベトナム語に（なければ日本語のまま） */
export const nameIn = (lang: Lang, id: string, ja: string) => (lang === "vi" && names[id] ? names[id] : ja);
