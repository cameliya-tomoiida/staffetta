// 点検清掃のはじめのシート（⑦の(21)）。工場の「機械清掃点検表」（区域ごと）の項目・頻度・担当から作った。売店の区域は使っていないので入れない。
// 頻度: daily＝毎日・weekly＝週1（水曜）・biweekly＝2週に1・monthly＝月1・twice＝週2（月・木）。画面で直せる。
import type { SheetDef } from "./sheets";

export const CLEAN_SHEETS: SheetDef[] = [
  {
    "id": "clean-storage",
    "title": "製造機械点検清掃計画（原料保管区域）",
    "kind": "clean",
    "area": "原料",
    "rule": "○は計画。実施したら●。",
    "items": [
      {
        "id": "st1",
        "name": "鼠トラップの点検",
        "freq": "weekly",
        "owner": "資材",
        "group": "粉倉庫"
      },
      {
        "id": "st2",
        "name": "壁際の点検",
        "freq": "weekly",
        "owner": "資材",
        "group": "粉倉庫"
      },
      {
        "id": "st3",
        "name": "ラック下の点検",
        "freq": "weekly",
        "owner": "資材",
        "group": "粉倉庫"
      },
      {
        "id": "st4",
        "name": "床の清掃",
        "freq": "daily",
        "note": "床の清掃",
        "owner": "資材",
        "group": "粉倉庫"
      },
      {
        "id": "st5",
        "name": "床の清掃",
        "freq": "monthly",
        "note": "パレット、スノコを移動して清掃",
        "owner": "資材",
        "group": "粉倉庫"
      },
      {
        "id": "st6",
        "name": "ラックの清掃",
        "freq": "monthly",
        "note": "保管品を取り出して清掃",
        "owner": "資材",
        "group": "粉倉庫"
      },
      {
        "id": "st7",
        "name": "不要原料の点検と廃棄",
        "freq": "monthly",
        "owner": "資材",
        "group": "粉倉庫"
      },
      {
        "id": "st8",
        "name": "長期保管原料の点検",
        "freq": "monthly",
        "owner": "資材",
        "group": "粉倉庫"
      },
      {
        "id": "st9",
        "name": "頭上の点検",
        "freq": "monthly",
        "note": "雨漏、塗装の剥がれ、結露、照明の破損がないか",
        "owner": "資材",
        "group": "粉倉庫"
      },
      {
        "id": "st10",
        "name": "エアコンの点検",
        "freq": "weekly",
        "note": "吸い込み・吹き出し口、フィルター清掃",
        "owner": "資材",
        "group": "粉倉庫"
      },
      {
        "id": "st11",
        "name": "床の清掃",
        "freq": "monthly",
        "note": "パレット、スノコを移動して清掃",
        "owner": "資材",
        "group": "冷蔵庫"
      },
      {
        "id": "st12",
        "name": "ラックの清掃",
        "freq": "monthly",
        "note": "保管品を取り出して清掃",
        "owner": "資材",
        "group": "冷蔵庫"
      },
      {
        "id": "st13",
        "name": "頭上の点検",
        "freq": "monthly",
        "note": "雨漏、塗装の剥がれ、結露、照明の破損がないか",
        "owner": "資材",
        "group": "不要原料の点検と廃棄"
      }
    ]
  },
  {
    "id": "clean-rice",
    "title": "製造機械点検清掃計画（米飯区域）",
    "kind": "clean",
    "area": "米飯",
    "rule": "○は計画。実施したら●。",
    "items": [
      {
        "id": "ri1",
        "name": "鼠トラップの点検",
        "freq": "weekly",
        "owner": "資材",
        "group": "米倉庫"
      },
      {
        "id": "ri2",
        "name": "壁際の点検",
        "freq": "weekly",
        "owner": "資材",
        "group": "米倉庫"
      },
      {
        "id": "ri3",
        "name": "ラック下の点検",
        "freq": "weekly",
        "owner": "資材",
        "group": "米倉庫"
      },
      {
        "id": "ri4",
        "name": "床の清掃",
        "freq": "monthly",
        "note": "パレット、スノコを移動して清掃",
        "owner": "資材"
      },
      {
        "id": "ri5",
        "name": "ラックの清掃",
        "freq": "monthly",
        "note": "保管品を取り出して清掃",
        "owner": "資材"
      },
      {
        "id": "ri6",
        "name": "不要原料の点検と廃棄",
        "freq": "monthly",
        "owner": "資材"
      },
      {
        "id": "ri7",
        "name": "長期保管原料の点検",
        "freq": "monthly",
        "owner": "資材"
      },
      {
        "id": "ri8",
        "name": "頭上の点検",
        "freq": "monthly",
        "note": "雨漏、塗装の剥がれ、結露、照明の破損がないか",
        "owner": "資材"
      },
      {
        "id": "ri9",
        "name": "米搬送パイプ",
        "freq": "weekly",
        "note": "分解清掃",
        "owner": "炊飯",
        "group": "洗米機"
      },
      {
        "id": "ri10",
        "name": "蓋及びタンク内部の清掃",
        "freq": "weekly",
        "owner": "炊飯",
        "group": "浸漬タンク"
      },
      {
        "id": "ri11",
        "name": "米シュート部の清掃",
        "freq": "daily",
        "owner": "炊飯",
        "group": "浸漬タンク"
      },
      {
        "id": "ri12",
        "name": "解し機の始業前点検",
        "freq": "daily",
        "note": "表面のテフロンの剥がれがあれば取り除く",
        "owner": "炊飯"
      },
      {
        "id": "ri13",
        "name": "飯容器の使用前の点検",
        "freq": "daily",
        "note": "毛羽立ち、割れがないか",
        "owner": "炊飯"
      },
      {
        "id": "ri14",
        "name": "コンベアの清掃",
        "freq": "weekly",
        "note": "ローラー、足、フレームの清掃",
        "owner": "炊飯"
      },
      {
        "id": "ri15",
        "name": "足場の裏側の清掃",
        "freq": "weekly",
        "owner": "炊飯"
      },
      {
        "id": "ri16",
        "name": "排水溝と排水ピットの清掃",
        "freq": "weekly",
        "owner": "炊飯"
      },
      {
        "id": "ri17",
        "name": "換気扇の清掃",
        "freq": "monthly",
        "owner": "炊飯"
      },
      {
        "id": "ri18",
        "name": "鼠トラップの点検",
        "freq": "weekly",
        "owner": "炊飯"
      },
      {
        "id": "ri19",
        "name": "器具洗浄機内部の清掃",
        "freq": "weekly",
        "note": "ブラシを使って手洗い",
        "owner": "盛付"
      },
      {
        "id": "ri20",
        "name": "ゴミ箱とゴミ箱周辺の清掃",
        "freq": "weekly",
        "owner": "資材"
      }
    ]
  },
  {
    "id": "clean-mixing",
    "title": "製造機械点検清掃計画（仕込み区域）",
    "kind": "clean",
    "area": "パン",
    "rule": "○は計画。実施したら●。",
    "items": [
      {
        "id": "mi1",
        "name": "ボウル内部の清掃",
        "freq": "daily",
        "note": "特にボウル天井部の清掃し忘れに注意",
        "owner": "仕込",
        "group": "ミキサー"
      },
      {
        "id": "mi2",
        "name": "ミキサーの上の清掃",
        "freq": "biweekly",
        "note": "粉溜まりの除去",
        "owner": "仕込",
        "group": "ミキサー"
      },
      {
        "id": "mi3",
        "name": "ミキサー下のハウジング内の清掃",
        "freq": "biweekly",
        "note": "生地カスの除去",
        "owner": "仕込",
        "group": "ミキサー"
      },
      {
        "id": "mi4",
        "name": "ミキサー下のハウジング内の点検",
        "freq": "biweekly",
        "note": "生地カス、粉溜まりがないか",
        "owner": "仕込",
        "group": "ミキサー"
      },
      {
        "id": "mi5",
        "name": "食洗器の清掃",
        "freq": "daily",
        "note": "庫内及び給排水口の点検清掃",
        "owner": "仕込",
        "group": "ミキサー"
      },
      {
        "id": "mi6",
        "name": "製氷機内部の点検",
        "freq": "weekly",
        "note": "カビの生育がないか",
        "owner": "仕込"
      },
      {
        "id": "mi7",
        "name": "排水溝と排水ピットの清掃",
        "freq": "weekly",
        "owner": "仕込"
      },
      {
        "id": "mi8",
        "name": "鼠トラップの点検",
        "freq": "weekly",
        "owner": "仕込"
      },
      {
        "id": "mi9",
        "name": "頭上の点検",
        "freq": "monthly",
        "note": "雨漏、塗装の剥がれ、結露、照明の破損がないか",
        "owner": "仕込"
      }
    ]
  },
  {
    "id": "clean-shaping",
    "title": "製造機械点検清掃計画（成形区域）",
    "kind": "clean",
    "area": "パン",
    "rule": "○は計画。実施したら●。",
    "items": [
      {
        "id": "sh1",
        "name": "天井の点検",
        "freq": "weekly",
        "note": "カビの生育、塗装の剥がれ、結露、照明の破損がないか",
        "owner": "成型",
        "group": "分割機(レオン)"
      },
      {
        "id": "sh2",
        "name": "天井の清掃",
        "freq": "weekly",
        "note": "カビの生育があれば清掃する",
        "owner": "成型",
        "group": "分割機(レオン)"
      },
      {
        "id": "sh3",
        "name": "エアコン清掃",
        "freq": "weekly",
        "note": "吸い込み・吹き出し口、フィルター清掃",
        "owner": "成型",
        "group": "分割機(レオン)"
      },
      {
        "id": "sh4",
        "name": "生地寝かせ箱の清掃",
        "freq": "weekly",
        "note": "残り生地、粉、生地カスの除去・清掃",
        "owner": "成型",
        "group": "分割機(レオン)"
      },
      {
        "id": "sh5",
        "name": "生地寝かせ箱の点検",
        "freq": "weekly",
        "note": "内部・外部破損がないか",
        "owner": "成型",
        "group": "分割機(レオン)"
      },
      {
        "id": "sh6",
        "name": "機械内部の清掃",
        "freq": "daily",
        "note": "生地カス・粉溜まりの除去・清掃",
        "owner": "成型",
        "group": "分割機(レオン)"
      },
      {
        "id": "sh7",
        "name": "コンベアの点検",
        "freq": "daily",
        "note": "カビの生育、破損がないか",
        "owner": "成型",
        "group": "分割機(レオン)"
      },
      {
        "id": "sh8",
        "name": "秤コンベアの清掃",
        "freq": "daily",
        "note": "粉溜まりの除去",
        "owner": "成型",
        "group": "分割機(レオン)"
      },
      {
        "id": "sh9",
        "name": "カッターの清掃",
        "freq": "daily",
        "note": "生地カスの除去",
        "owner": "成型",
        "group": "分割機(レオン)"
      },
      {
        "id": "sh10",
        "name": "鼠トラップの点検",
        "freq": "weekly",
        "owner": "成型"
      },
      {
        "id": "sh11",
        "name": "頭上の点検",
        "freq": "monthly",
        "note": "雨漏、塗装の剥がれ、結露、照明の破損がないか",
        "owner": "成型"
      }
    ]
  },
  {
    "id": "clean-baking",
    "title": "製造機械点検清掃計画（焼成区域）",
    "kind": "clean",
    "area": "パン",
    "rule": "○は計画。実施したら●。",
    "items": [
      {
        "id": "ba1",
        "name": "床の清掃",
        "freq": "weekly",
        "owner": "仕込",
        "group": "第一発酵室"
      },
      {
        "id": "ba2",
        "name": "天井の点検",
        "freq": "weekly",
        "note": "カビの生育、塗装の剥がれ、結露、照明の破損がないか",
        "owner": "仕込",
        "group": "第一発酵室"
      },
      {
        "id": "ba3",
        "name": "天井の清掃",
        "freq": "weekly",
        "note": "カビの生育があれば清掃する",
        "owner": "仕込",
        "group": "第一発酵室"
      },
      {
        "id": "ba4",
        "name": "天板の清掃",
        "freq": "daily",
        "note": "ダスターを使って清掃",
        "owner": "焼成"
      },
      {
        "id": "ba5",
        "name": "作業台の清掃",
        "freq": "daily",
        "note": "周辺の油の除去",
        "owner": "焼成"
      },
      {
        "id": "ba6",
        "name": "焼成窯入り口の清掃",
        "freq": "daily",
        "note": "煤等除去、汚れ除去",
        "owner": "焼成"
      },
      {
        "id": "ba7",
        "name": "換気扇の清掃",
        "freq": "weekly",
        "note": "埃、粉、油等の除去、フィルターの交換",
        "owner": "焼成"
      },
      {
        "id": "ba8",
        "name": "エアコン清掃",
        "freq": "twice",
        "note": "吸い込み・吹き出し口、フィルター清掃",
        "owner": "焼成"
      },
      {
        "id": "ba9",
        "name": "鼠トラップの点検",
        "freq": "weekly",
        "owner": "焼成"
      },
      {
        "id": "ba10",
        "name": "頭上の点検",
        "freq": "monthly",
        "note": "雨漏、塗装の剥がれ、結露、照明の破損がないか",
        "owner": "焼成"
      }
    ]
  },
  {
    "id": "clean-packing",
    "title": "製造機械点検清掃計画（包装区域）",
    "kind": "clean",
    "area": "パン",
    "rule": "○は計画。実施したら●。",
    "items": [
      {
        "id": "pa1",
        "name": "包装機の清掃",
        "freq": "daily",
        "note": "エアー・アルコールでの清掃",
        "owner": "包装"
      },
      {
        "id": "pa2",
        "name": "包装機の点検",
        "freq": "daily",
        "note": "周辺の油の除去",
        "owner": "包装"
      },
      {
        "id": "pa3",
        "name": "作業台の清掃",
        "freq": "daily",
        "note": "煤等除去、汚れ除去",
        "owner": "包装"
      },
      {
        "id": "pa4",
        "name": "金属探知機の点検",
        "freq": "daily",
        "owner": "包装"
      },
      {
        "id": "pa5",
        "name": "床等の清掃",
        "freq": "daily",
        "owner": "包装"
      },
      {
        "id": "pa6",
        "name": "エアコン清掃",
        "freq": "weekly",
        "note": "吸い込み・吹き出し口、フィルター清掃",
        "owner": "包装"
      },
      {
        "id": "pa7",
        "name": "頭上の点検",
        "freq": "monthly",
        "note": "雨漏、塗装の剥がれ、結露、照明の破損がないか",
        "owner": "包装"
      },
      {
        "id": "pa8",
        "name": "ゴミ箱とゴミ箱周辺の清掃",
        "freq": "daily",
        "owner": "包装"
      }
    ]
  },
  {
    "id": "clean-shipping",
    "title": "製造機械点検清掃計画（出荷区域・ごみ箱）",
    "kind": "clean",
    "area": "全体",
    "rule": "○は計画。実施したら●。",
    "items": [
      {
        "id": "sh1",
        "name": "床及び出入口の清掃",
        "freq": "daily",
        "note": "ほうき等での清掃",
        "owner": "営業"
      },
      {
        "id": "sh2",
        "name": "ラック上下の清掃",
        "freq": "daily",
        "note": "ほうき・ダスター等で清掃",
        "owner": "営業"
      },
      {
        "id": "sh3",
        "name": "作業台の清掃",
        "freq": "daily",
        "note": "ダスターにてアルコール消毒及び清掃",
        "owner": "営業"
      },
      {
        "id": "sh4",
        "name": "仕入れ商品の消費期限点検",
        "freq": "daily",
        "note": "点検時、消費期限1週間前の物は処分する",
        "owner": "営業"
      },
      {
        "id": "sh5",
        "name": "エアコン清掃",
        "freq": "weekly",
        "note": "吸い込み・吹き出し口、フィルター清掃",
        "owner": "営業"
      },
      {
        "id": "sh6",
        "name": "通箱の清掃",
        "freq": "daily",
        "owner": "営業"
      },
      {
        "id": "sh7",
        "name": "通箱の点検",
        "freq": "weekly",
        "owner": "営業"
      },
      {
        "id": "sh8",
        "name": "頭上の点検",
        "freq": "monthly",
        "note": "雨漏、塗装の剥がれ、結露、照明の破損がないか",
        "owner": "営業"
      },
      {
        "id": "sh9",
        "name": "ごみ集積場周辺の清掃",
        "freq": "weekly",
        "owner": "営業"
      }
    ]
  },
  {
    "id": "clean-fridge",
    "title": "製造機械点検清掃計画（冷蔵庫・冷凍庫）",
    "kind": "clean",
    "area": "全体",
    "rule": "○は計画。実施したら●。",
    "items": [
      {
        "id": "fr1",
        "name": "床の清掃",
        "freq": "monthly",
        "note": "パレット、スノコを移動して清掃",
        "owner": "資材",
        "group": "冷蔵庫・冷凍庫"
      },
      {
        "id": "fr2",
        "name": "ラックの清掃",
        "freq": "monthly",
        "note": "保管品を取り出して清掃",
        "owner": "資材",
        "group": "冷蔵庫・冷凍庫"
      },
      {
        "id": "fr3",
        "name": "不要原料の点検と廃棄",
        "freq": "monthly",
        "owner": "資材",
        "group": "冷蔵庫・冷凍庫"
      }
    ]
  },
  {
    "id": "clean-pizza",
    "title": "製造機械点検清掃計画（ピザ製造区域）",
    "kind": "clean",
    "area": "ピザ",
    "rule": "○は計画。実施したら●。",
    "items": [
      {
        "id": "pi1",
        "name": "天井の点検",
        "freq": "weekly",
        "note": "カビの生育、塗装の剥がれ、結露、照明の破損がないか",
        "owner": "ピザ"
      },
      {
        "id": "pi2",
        "name": "天井の清掃",
        "freq": "weekly",
        "note": "カビの生育があれば清掃する",
        "owner": "ピザ"
      },
      {
        "id": "pi3",
        "name": "焼成機清掃",
        "freq": "daily",
        "note": "内部及び外部清掃",
        "owner": "ピザ"
      },
      {
        "id": "pi4",
        "name": "生地寝かせ箱の清掃",
        "freq": "daily",
        "note": "残り生地、粉、生地カスの除去・清掃",
        "owner": "ピザ"
      },
      {
        "id": "pi5",
        "name": "生地寝かせ箱の点検",
        "freq": "weekly",
        "note": "内部・外部破損がないか",
        "owner": "ピザ"
      },
      {
        "id": "pi6",
        "name": "製造机の清掃",
        "freq": "daily",
        "note": "生地カス・粉溜まりの除去・清掃",
        "owner": "ピザ"
      },
      {
        "id": "pi7",
        "name": "鼠トラップの点検",
        "freq": "weekly",
        "owner": "ピザ"
      },
      {
        "id": "pi8",
        "name": "焼成機上部の点検",
        "freq": "weekly",
        "note": "埃換気扇回り清掃",
        "owner": "ピザ"
      }
    ]
  },
  {
    "id": "clean-pizza-oven",
    "title": "製造機械点検清掃計画（ピザ窯の区域）",
    "kind": "clean",
    "area": "ピザ",
    "rule": "○は計画。実施したら●。",
    "items": [
      {
        "id": "pi1",
        "name": "床の清掃",
        "freq": "weekly",
        "owner": "仕込",
        "group": "第一発酵室"
      },
      {
        "id": "pi2",
        "name": "天井の点検",
        "freq": "weekly",
        "note": "カビの生育、塗装の剥がれ、結露、照明の破損がないか",
        "owner": "仕込",
        "group": "第一発酵室"
      },
      {
        "id": "pi3",
        "name": "天井の清掃",
        "freq": "weekly",
        "note": "カビの生育があれば清掃する",
        "owner": "仕込",
        "group": "第一発酵室"
      },
      {
        "id": "pi4",
        "name": "天板の清掃",
        "freq": "daily",
        "note": "ダスターを使って清掃",
        "owner": "焼成"
      },
      {
        "id": "pi5",
        "name": "作業台の清掃",
        "freq": "daily",
        "note": "周辺の油の除去",
        "owner": "焼成"
      },
      {
        "id": "pi6",
        "name": "焼成窯入り口の清掃",
        "freq": "daily",
        "note": "煤等除去、汚れ除去",
        "owner": "焼成"
      },
      {
        "id": "pi7",
        "name": "換気扇の清掃",
        "freq": "weekly",
        "note": "埃、粉、油等の除去、フィルターの交換",
        "owner": "焼成"
      },
      {
        "id": "pi8",
        "name": "エアコン清掃",
        "freq": "twice",
        "note": "吸い込み・吹き出し口、フィルター清掃",
        "owner": "焼成"
      },
      {
        "id": "pi9",
        "name": "鼠トラップの点検",
        "freq": "weekly",
        "owner": "焼成"
      },
      {
        "id": "pi10",
        "name": "頭上の点検",
        "freq": "monthly",
        "note": "雨漏、塗装の剥がれ、結露、照明の破損がないか",
        "owner": "焼成"
      }
    ]
  }
];
