# 使った素材・データの出典

STAFFETTA のコードは [MIT License](LICENSE) です。アプリの中で使っている、ほかの人が作った素材・データは次のとおりです（どれも無料で、それぞれの決まりに従って使っています）。

## フォント

| 何 | どこで使う | 出典・ライセンス |
|---|---|---|
| Noto Sans JP | 発注書などの PDF の日本語（`src/lib/channels/pdf.ts`） | Google Fonts（npm `@expo-google-fonts/noto-sans-jp`）・SIL Open Font License 1.1 |
| BIZ UDPゴシック | 画面の文字（パソコンに入っているフォントを使う。リポジトリには入れていない） | 株式会社モリサワ・SIL Open Font License 1.1 |

## 地図・位置・道順・天気

| 何 | どこで使う | 出典・ライセンス |
|---|---|---|
| 地理院タイル（淡色地図） | 配送コースの地図（`src/app/admin/routes/RouteMap.tsx`）。地図の右下に出典を表示 | [国土地理院](https://maps.gsi.go.jp/development/ichiran.html)（出典の表示で利用可） |
| 住所検索 API | 取引先の住所から地図の位置を出す（`src/lib/routes/store.ts`） | 国土地理院 |
| Leaflet 1.9.4 | 地図の表示 | BSD 2-Clause License（unpkg から読み込む） |
| OSRM のデモのサーバー | 道の上の時間と線（取れなければ直線距離で見積もる） | [Project OSRM](https://project-osrm.org/)。道のデータは © OpenStreetMap contributors（ODbL） |
| Open-Meteo | 製品カードの天気・気温・湿度（`src/lib/cards/store.ts`） | [Open-Meteo](https://open-meteo.com/)・CC BY 4.0 |

## プログラムの部品

npm の部品（Next.js・React・Anthropic SDK・pdf.js・PDFKit・ExcelJS・zod など）は `package.json` のとおりで、それぞれのライセンス（MIT・Apache-2.0 など）に従います。

## 自分たちで作ったもの

- ロゴ（`public/brand/`）・アイコン・画面の絵は、このハッカソンのために作りました。
- 見本のデータ（取引先・仕入先・商品・単価・レシピ・FAX の見本）は、すべて架空です。実在の会社・人とは関係ありません。
- デモ動画の音声は合成音声、音楽は自作または CC0 の素材です（動画の側に出典を書きます。このリポジトリには入っていません）。
