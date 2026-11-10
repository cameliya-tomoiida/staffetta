# 多言語の辞書の抜けと、直す案（②デザイン・2026-11-05）

対象は現場向けの画面（`/plan` 製造計画・工程表）。のちに計量表や注文書にも使う。
この文書は案だけを書いている。`src/i18n/dict.ts` を直すのは、Codex の UX 改善がマージされたあと。

## 今のしくみ（おさらい）

- `src/i18n/dict.ts`：画面の決まった言葉の辞書（日本語＋9言語）。日本語以外は Claude が作った下書きで、`reviewed: false`。画面には「機械翻訳」と出る。
- `src/i18n/machine.json`：辞書に無い言葉（商品名・生地名）を Claude API（`claude-sonnet-5-5`）で訳して保存したもの。次からはこれを使う。1語ずつ「機械翻訳」と出る。
- 訳せなかったとき（API キーが無いなど）は、日本語のまま出す。画面は止めない。

## 1. machine.json に落ちている言葉（17語 × 9言語。全部うまっている）

商品名と生地名だけ。工程名・単位・見出しは dict.ts にある。

| 日本語 | ja-easy | vi | id | zh | ko | fil | my | ne | en |
|---|---|---|---|---|---|---|---|---|---|
| バターロール | バターロール | Bánh mì cuộn bơ | Roti gulung mentega | 黄油小餐包 | 버터롤 | Butter Roll | ဘတ်တာရိုးလ် | बटर रोल | Butter rolls |
| ピザクラスト 23cm | ピザクラスト 23cm | Đế bánh pizza 23cm | Kulit pizza 23cm | 披萨饼底 23cm | 피자 크러스트 23cm | Pizza Crust 23cm | ပီဇာ ခရပ်စ် ၂၃ စင်တီမီတာ | पिज्जा क्रस्ट २३ सेमी | Pizza crust 23cm |
| ピザクラスト 27cm | ピザクラスト 27cm | Đế bánh pizza 27cm | Kulit Pizza 27cm | 披萨饼底 27cm | 피자 크러스트 27cm | Pizza crust 27cm | ပီဇာ ခရပ်စ်တ် ၂၇ စင်တီမီတာ | पिज्जा क्रस्ट २७ से.मी. | Pizza Crust 27cm |
| ピザ生地 | ピザの きじ | Bột bánh pizza | Adonan pizza | 披萨面团 | 피자 도우 | Masa ng Pizza | ပီဇာ ခေါက်ဆွဲ | पिज्जा को पिठो (डो) | Pizza dough |
| ピザ生地玉 180g | ピザのきじ だま 180g | Viên bột pizza 180g | Bola Adonan Pizza 180g | 披萨面团球 180g | 피자 도우볼 180g | Bola ng pizza dough 180g | ပီဇာ မုန့်ညက်လုံး ၁၈၀ဂရမ် | पिज्जा डो बल १८० ग्राम | Pizza Dough Ball 180g |
| マルゲリータ 21cm | マルゲリータ 21cm | Pizza Margherita 21cm | Pizza Margherita 21cm | 玛格丽特披萨 21cm | 마르게리타 21cm | Margherita 21cm | မာဂရီတာ ပီဇာ ၂၁ စင်တီမီတာ | मार्गारिटा २१ से.मी. | Margherita Pizza 21cm |
| ミニロール（黒糖） | ミニロール（くろざとう） | Bánh mì cuộn mini (đường nâu) | Roti gulung mini (gula merah) | 迷你小餐包（红糖） | 미니롤(흑설탕) | Mini Roll (Brown Sugar) | မီနီရိုးလ် (သကြားညို) | मिनी रोल (ब्राउन सुगर) | Mini rolls (brown sugar) |
| ミニロール（白） | ミニロール（しろ） | Bánh mì cuộn mini (trắng) | Roti gulung mini (putih) | 迷你小餐包（原味） | 미니롤(흰색) | Mini Roll (Puti) | မီနီရိုးလ် (အဖြူ) | मिनी रोल (सेतो) | Mini rolls (white) |
| ロール生地 | ロールの きじ | Bột bánh cuộn | Adonan roti gulung | 小餐包面团 | 롤 반죽 | Masa ng Roll | ရိုးလ်ပေါင်မုန့် ခေါက်ဆွဲ | रोल को पिठो (डो) | Roll dough |
| 高加水ピザ 白（OEM） | みずがおおい ピザ しろ（OEM） | Pizza độ ẩm cao sốt trắng (OEM) | Pizza Hidrasi Tinggi Putih (OEM) | 高含水披萨 白披萨（OEM） | 고수분 피자 화이트(OEM) | Pizza na mataas ang hydration, puti (OEM) | ရေပါဝင်မှုမြင့်သော ပီဇာ အဖြူ (OEM) | हाइ हाइड्रेसन पिज्जा सेतो (OEM) | High-Hydration Pizza, White (OEM) |
| 高加水ピザ生地 | みずがおおい ピザのきじ | Bột pizza độ ẩm cao | Adonan Pizza Hidrasi Tinggi | 高含水披萨面团 | 고수분 피자 도우 | Pizza dough na mataas ang hydration | ရေပါဝင်မှုမြင့်သော ပီဇာ မုန့်ညက် | हाइ हाइड्रेसन पिज्जा डो | High-Hydration Pizza Dough |
| 黒糖ロール | くろざとうロール | Bánh mì cuộn đường nâu | Roti gulung gula merah | 红糖小餐包 | 흑설탕 롤 | Brown Sugar Roll | ပန်းနုရောင်သကြားညို ရိုးလ် | ब्राउन सुगर रोल | Brown sugar rolls |
| 黒糖ロール生地 | くろざとうロールの きじ | Bột bánh cuộn đường nâu | Adonan roti gulung gula merah | 红糖小餐包面团 | 흑설탕 롤 반죽 | Masa ng Brown Sugar Roll | ပန်းနုရောင်သကြားညို ရိုးလ်ပေါင်မုန့် ခေါက်ဆွဲ | ब्राउन सुगर रोल को पिठो (डो) | Brown sugar roll dough |
| 食パン 6枚切 | しょくぱん 6まいぎり | Bánh mì sandwich cắt 6 lát | Roti tawar 6 lembar | 吐司 6片装 | 식빵 6장 슬라이스 | Tinapay (Loaf Bread) 6 hiwa | ပေါင်မုန့် ၆ ချပ်ဖြတ် | स्लाइस पाउरोटी ६ स्लाइस | Sandwich bread, 6 slices |
| 食パン 8枚切 | しょくぱん 8まいぎり | Bánh mì sandwich cắt 8 lát | Roti tawar 8 lembar | 吐司 8片装 | 식빵 8장 슬라이스 | Tinapay (Loaf Bread) 8 hiwa | ပေါင်မုန့် ၈ ချပ်ဖြတ် | स्लाइस पाउरोटी ८ स्लाइस | Sandwich bread, 8 slices |
| 食パン生地 | しょくぱんの きじ | Bột bánh mì sandwich | Adonan roti tawar | 吐司面团 | 식빵 반죽 | Masa ng Tinapay (Loaf Bread) | ဆန်ပေါင်မုန့် ခေါက်ဆွဲ | स्लाइस पाउरोटी को पिठो (डो) | Sandwich bread dough |
| 超じゅくロール 6個入 | ちょうじゅくロール 6こいり | Bánh cuộn siêu mềm (Choju Roll) 6 cái | Roti Gulung Super Lembut (Chō Juku Roll) isi 6 | 超软小餐包 6个装 | 초숙성 롤빵 6개입 | Chō-Juku Roll (Super Soft Roll) 6 piraso | ချောင်းဆွဲ ပေါင်မုန့်လိပ် (စူပါ့ဂျူကု ရိုးလ်) ၆ လုံးပါ | सुपर जुकु रोल ६ वटा प्याकेट | Super Soft Rolls, 6-pack |

### 案
1. **商品名・生地名は dict.ts に移さない**。マスターに増えていく言葉なので、machine.json（＝自動で増える辞書）のままにする。
   - そのかわり、各国のスタッフが確かめた訳は「確認済み」にできるようにする。
   - 例：`machine.json` を `{ "vi": { "バターロール": { "text": "...", "reviewed": true, "by": "グエン" } } }` の形にする。確認済みなら「機械翻訳」の印を出さない。
2. 確認のしかた：工程表の印刷を各国のスタッフに見せて、直したい訳に赤ペンを入れてもらう。事務がそれを machine.json に入れて `reviewed: true` にする（画面からの入力は、あとで作る）。
3. **まちがいが分かっている訳（先に直す）**
   - ミャンマー語：「生地」が「ခေါက်ဆွဲ」（麺）になっている語がある（ピザ生地・ロール生地・黒糖ロール生地）。辞書（dict.ts）では「မုန့်ညက်」を使っているので、そちらにそろえる。
   - ミャンマー語：「黒糖ロール生地」に「ပန်းနုရောင်」（ピンク色）が入っている。訳し直す。
   - ミャンマー語・ネパール語：「23cm」「180g」の数字が、その国の数字（၂၃・२३）に変わっている。**数字は 0〜9 のまま残す**（重さ・サイズを読みまちがえないように）。
   - **直し方の案**：translate.ts で Claude に頼むとき、dict.ts の用語（生地・粉・個 など）を「用語集」として一緒に渡し、「数字と単位（cm・g・kg）は変えない」と書く。そのうえで、この3語を machine.json から消して訳し直す。
4. 気になる訳（スタッフに先に見てほしいもの）
   - 「超じゅくロール 6個入」：商品名の固有の部分（超じゅく）を訳してしまっている言語がある。**カタカナ読みのローマ字（Chōjuku）を残す**ように、translate.ts のプロンプトに「商品名の固有の部分は音で残す」を足す。
   - 「高加水ピザ 白（OEM）」：OEM は訳さず残す。
   - やさしい日本語：「ピザクラスト」などのカタカナは、そのままでよい（現場で通じる言葉なので）。

## 2. dict.ts にまだ無い言葉（画面に日本語のまま出ているもの）

| どこ | 言葉 | 案 |
|---|---|---|
| 単位 | 本・袋・P・c/s・kg・L | `unit_本` `unit_袋` を足す。P・c/s は「袋」「ケース」に言いかえた `unit_P` `unit_c/s` を足す。kg・L は世界共通なのでそのまま。 |
| 時刻 | 「翌1:00」の「翌」、「前日23:52」の「前日」（③の fmtTime が付ける） | 時刻の表では「翌」だけ「+1 」に置きかえている。帯グラフの時刻の目盛りと、前日の文字はまだ日本語のまま出る。辞書に `next_day` `prev_day_time` を足して、各言語で出す（例 vi: "hôm sau 1:00" / "hôm trước 23:52"）。③に「分 → 日のずれと時刻」を別々に返す関数を作ってもらうと、画面で組み立てやすい。 |
| 注意 | 計算の注意（ピザの上限超えなど）・工程表の行ごとの注意 | 今は日本語のまま（管理者向けとして）。現場で見せたいのは「上限超え」「間に合わない」の2つだけなので、③の warnings に `code`（`over_cap` / `late_start`）と数字を持たせてもらい、画面で辞書から文を組み立てる。→ ③への相談が要る。 |
| 工程 | 工程のメモ（「捏ね上げ 26℃」など）| 今は画面に出していない。出すなら machine.json と同じく Claude で訳して保存する。 |
| 見出し | 「この日のお金」 | 管理者向けなので訳さない（現場の印刷には出さない）。 |

## 3. 辞書（dict.ts）の訳で、先にスタッフに見てほしいもの

- ミャンマー語・ネパール語：字の形（フォント）が端末によって出ないことがある。現場のタブレットで、工程表を開いて字が出るかを確かめる。出なければ `Noto Sans Myanmar` / `Noto Sans Devanagari` を同梱する。
- 「ホイロ（proof）」「ベンチタイム（bench）」：専門用語。各国の言葉より、日本語の音のまま（例 vi: "Hoiro (ủ lần 2)"）の方が現場で通じるかもしれない。スタッフに聞いてから決める。
- 「金属検出（CCP）」：CCP は残す。全部の言語で「CCP」が入っていることは確認済み。

## 4. 直す順番（Codex のマージのあと）

0. translate.ts に用語集と「数字を変えない」を足し、machine.json のまちがいが分かっている訳（ミャンマー語・ネパール語）を消して訳し直す。
1. `unit_本` `unit_袋` `unit_P` `unit_c/s` と `next_day` を dict.ts に足す（10言語）。
2. machine.json を `{ text, reviewed }` の形にして、確認済みは「機械翻訳」の印を消す。
3. translate.ts のプロンプトに「商品名の固有の部分は音で残す」を足して、「超じゅくロール」を訳し直す。
4. ③と相談して、warnings にコードを持たせて現場向けの注意を訳す。
