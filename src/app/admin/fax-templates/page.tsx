import { PageHeader } from "@/components/ui";
import { allProducts } from "@/lib/catalog";
import { formatKindLabelsAction, listFormatDraftsAction, listFormatsAction } from "@/app/formats/actions";
import { FaxFormatsClient } from "./FaxFormatsClient";

export const metadata = { title: "FAXの様式｜マスタ管理" };

// 中身（保存・無効化・履歴）は①の src/app/formats/actions.ts。②は画面だけ
export default async function FaxTemplatesAdmin() {
  const [formats, drafts, kinds] = await Promise.all([listFormatsAction(), listFormatDraftsAction(), formatKindLabelsAction()]);
  const products = allProducts().map((p) => ({ id: p.id, name: p.name }));
  return (
    <div>
      <PageHeader
        title="FAXの様式"
        lead="取引先ごとの FAX の様式です。「書いてある品名 → 商品」の対応を覚えておくので、使うほど読み取りが正確になります。初めての様式の FAX は、承認するまで受注に入りません。"
      />
      <FaxFormatsClient formats={JSON.parse(JSON.stringify(formats))} drafts={JSON.parse(JSON.stringify(drafts))} kinds={kinds} products={products} />
    </div>
  );
}
