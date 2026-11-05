// 現場の帳票（製造計画書・人員配置表・製造日報・設備の時間割）の見出しの辞書。
// 現場条件_20261105.md「7. 帳票の見た目」の列に合わせる。日本語以外は Claude の下書き（dict.ts と同じく、人の確認前は「機械翻訳」の扱い）。
// 無い言葉は日本語で出す。
import type { Lang } from "./langs";

const ja = {
  form_plan: "製造計画書",
  form_staff: "人員配置表",
  form_daily: "製造日報",
  equipment_tt: "設備の時間割",
  made_on: "製造日",
  dow: "曜日",
  item: "品名",
  customer: "取引先",
  qty: "数量",
  bags: "袋数",
  cases: "ケース",
  best_before: "賞味期限",
  recipe: "レシピ（生地）",
  gram: "生地g",
  note: "備考",
  step: "工程",
  name: "名前",
  need: "必要な人数",
  have: "班の人数",
  short: "足りない",
  weight: "重量",
  taste: "味",
  made: "製造数",
  metal: "金検",
  loss: "ロス",
  writer: "記入者名",
  wait: "設備待ち",
  in_use: "使っている",
  no_equipment: "設備の登録がありません（マスタ管理の「設備と人員」）",
  people: "人",
  write_here: "（記入）",
  plan_count: "予定",
};
export type FormKey = keyof typeof ja;

const dicts: Record<Exclude<Lang, "ja">, Partial<Record<FormKey, string>>> = {
  "ja-easy": {
    item: "しなもの", form_plan: "つくる けいかくの かみ", form_staff: "ひとの ならべかた", form_daily: "きょう つくった きろく", equipment_tt: "きかいの じかんわり",
    made_on: "つくる ひ", dow: "ようび", customer: "おみせ", qty: "かず", bags: "ふくろ", cases: "はこ", best_before: "しょうみきげん",
    recipe: "きじ", gram: "きじ g", note: "メモ", step: "さぎょう", name: "なまえ", need: "いる ひと", have: "いる ひと（はん）", short: "たりない",
    weight: "おもさ", taste: "あじ", made: "つくった かず", metal: "きんぞく けんさ", loss: "ロス", writer: "かいた ひと", wait: "きかい まち",
    in_use: "つかっている", no_equipment: "きかいが とうろく されて いません", people: "にん", write_here: "（かく）", plan_count: "よてい",
  },
  vi: {
    item: "Tên hàng", form_plan: "Kế hoạch sản xuất", form_staff: "Bảng phân công nhân sự", form_daily: "Báo cáo sản xuất hằng ngày", equipment_tt: "Lịch dùng thiết bị",
    made_on: "Ngày sản xuất", dow: "Thứ", customer: "Khách hàng", qty: "Số lượng", bags: "Số túi", cases: "Thùng", best_before: "Hạn dùng",
    recipe: "Công thức (bột)", gram: "Bột (g)", note: "Ghi chú", step: "Công đoạn", name: "Tên", need: "Số người cần", have: "Số người trong ca", short: "Thiếu",
    weight: "Trọng lượng", taste: "Vị", made: "Số đã làm", metal: "Dò kim loại", loss: "Hao hụt", writer: "Người ghi", wait: "Chờ thiết bị",
    in_use: "Đang dùng", no_equipment: "Chưa đăng ký thiết bị", people: "người", write_here: "(ghi)", plan_count: "Kế hoạch",
  },
  id: {
    item: "Nama barang", form_plan: "Rencana produksi", form_staff: "Tabel penempatan staf", form_daily: "Laporan produksi harian", equipment_tt: "Jadwal alat",
    made_on: "Tanggal produksi", dow: "Hari", customer: "Pelanggan", qty: "Jumlah", bags: "Kantong", cases: "Kardus", best_before: "Baik digunakan sebelum",
    recipe: "Resep (adonan)", gram: "Adonan (g)", note: "Catatan", step: "Proses", name: "Nama", need: "Orang yang dibutuhkan", have: "Orang di shift", short: "Kurang",
    weight: "Berat", taste: "Rasa", made: "Jumlah dibuat", metal: "Cek logam", loss: "Rugi", writer: "Penulis", wait: "Menunggu alat",
    in_use: "Dipakai", no_equipment: "Alat belum didaftarkan", people: "orang", write_here: "(isi)", plan_count: "Rencana",
  },
  zh: {
    item: "品名", form_plan: "生产计划书", form_staff: "人员配置表", form_daily: "生产日报", equipment_tt: "设备时间表",
    made_on: "生产日", dow: "星期", customer: "客户", qty: "数量", bags: "袋数", cases: "箱数", best_before: "保质期",
    recipe: "配方（面团）", gram: "面团 g", note: "备注", step: "工序", name: "姓名", need: "需要人数", have: "班组人数", short: "不足",
    weight: "重量", taste: "味道", made: "生产数", metal: "金属检测", loss: "损耗", writer: "填写人", wait: "等待设备",
    in_use: "使用中", no_equipment: "未登记设备", people: "人", write_here: "（填写）", plan_count: "计划",
  },
  ko: {
    item: "품명", form_plan: "제조 계획서", form_staff: "인원 배치표", form_daily: "제조 일보", equipment_tt: "설비 시간표",
    made_on: "제조일", dow: "요일", customer: "거래처", qty: "수량", bags: "봉지 수", cases: "박스", best_before: "유통기한",
    recipe: "레시피(반죽)", gram: "반죽 g", note: "비고", step: "공정", name: "이름", need: "필요 인원", have: "조 인원", short: "부족",
    weight: "중량", taste: "맛", made: "제조 수", metal: "금속 검사", loss: "손실", writer: "기록자", wait: "설비 대기",
    in_use: "사용 중", no_equipment: "등록된 설비가 없습니다", people: "명", write_here: "(기입)", plan_count: "예정",
  },
  fil: {
    item: "Produkto", form_plan: "Plano ng produksyon", form_staff: "Talaan ng tauhan", form_daily: "Araw-araw na ulat ng produksyon", equipment_tt: "Iskedyul ng makina",
    made_on: "Araw ng paggawa", dow: "Araw", customer: "Kustomer", qty: "Dami", bags: "Supot", cases: "Kahon", best_before: "Best before",
    recipe: "Resipe (masa)", gram: "Masa (g)", note: "Tala", step: "Proseso", name: "Pangalan", need: "Kailangang tao", have: "Tao sa shift", short: "Kulang",
    weight: "Timbang", taste: "Lasa", made: "Nagawa", metal: "Metal check", loss: "Sayang", writer: "Sumulat", wait: "Naghihintay ng makina",
    in_use: "Ginagamit", no_equipment: "Walang nakarehistrong makina", people: "tao", write_here: "(isulat)", plan_count: "Plano",
  },
  my: {
    item: "ပစ္စည်းအမည်", form_plan: "ထုတ်လုပ်မှု အစီအစဉ်", form_staff: "ဝန်ထမ်း နေရာချထားမှု ဇယား", form_daily: "နေ့စဉ် ထုတ်လုပ်မှု မှတ်တမ်း", equipment_tt: "စက်ပစ္စည်း အချိန်ဇယား",
    made_on: "ထုတ်လုပ်သည့်နေ့", dow: "နေ့", customer: "ဖောက်သည်", qty: "အရေအတွက်", bags: "အိတ်", cases: "သေတ္တာ", best_before: "သက်တမ်းကုန်ရက်",
    recipe: "ချက်ပြုတ်နည်း (မုန့်ညက်)", gram: "မုန့်ညက် g", note: "မှတ်ချက်", step: "အဆင့်", name: "အမည်", need: "လိုအပ်သူ", have: "အဆိုင်းရှိသူ", short: "မလုံလောက်",
    weight: "အလေးချိန်", taste: "အရသာ", made: "ထုတ်ပြီး", metal: "သတ္တုစစ်", loss: "အရှုံး", writer: "ရေးသူ", wait: "စက်စောင့်",
    in_use: "သုံးနေ", no_equipment: "စက် မှတ်ပုံမတင်ရသေး", people: "ဦး", write_here: "(ရေးရန်)", plan_count: "အစီအစဉ်",
  },
  ne: {
    item: "सामान", form_plan: "उत्पादन योजना", form_staff: "कर्मचारी तालिका", form_daily: "दैनिक उत्पादन रिपोर्ट", equipment_tt: "मेसिन समय तालिका",
    made_on: "उत्पादन मिति", dow: "बार", customer: "ग्राहक", qty: "संख्या", bags: "झोला", cases: "बाकस", best_before: "म्याद",
    recipe: "रेसिपी (आटा)", gram: "आटा g", note: "टिप्पणी", step: "काम", name: "नाम", need: "चाहिने मान्छे", have: "सिफ्टका मान्छे", short: "कम",
    weight: "तौल", taste: "स्वाद", made: "बनाएको", metal: "धातु जाँच", loss: "नोक्सानी", writer: "लेख्ने", wait: "मेसिन पर्खाइ",
    in_use: "प्रयोगमा", no_equipment: "मेसिन दर्ता छैन", people: "जना", write_here: "(लेख्नुहोस्)", plan_count: "योजना",
  },
  en: {
    item: "Item", form_plan: "Production plan", form_staff: "Staff assignment", form_daily: "Daily production report", equipment_tt: "Equipment schedule",
    made_on: "Production date", dow: "Day", customer: "Customer", qty: "Qty", bags: "Bags", cases: "Cases", best_before: "Best before",
    recipe: "Recipe (dough)", gram: "Dough (g)", note: "Notes", step: "Step", name: "Name", need: "People needed", have: "People on shift", short: "Short",
    weight: "Weight", taste: "Taste", made: "Made", metal: "Metal check", loss: "Loss", writer: "Written by", wait: "Waiting for equipment",
    in_use: "In use", no_equipment: "No equipment registered", people: "people", write_here: "(write)", plan_count: "Planned",
  },
};

/** 帳票の見出しを引く（無ければ日本語） */
export function tf(lang: Lang, key: FormKey): string {
  return lang === "ja" ? ja[key] : (dicts[lang][key] ?? ja[key]);
}
