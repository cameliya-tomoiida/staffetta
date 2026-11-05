import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { getCompany } from "@/lib/company";
import { CompanyClient } from "./CompanyClient";

export const metadata = { title: "自社の情報｜設定" };

// 自社の情報（作者 11/5 夜 (12)）: 発注書・返事の FAX・メール・PDF の差出人と、画面の左上の工場名。
export default async function CompanyPage() {
  await connection();
  return (
    <div className="space-y-5">
      <PageHeader title="自社の情報" lead="発注書・受付の返事（FAX・メール）・PDF の差出人と、画面の左上に出る工場名です。変えると、次に作る書類から新しい値になります。" />
      <CompanyClient initial={getCompany()} />
    </div>
  );
}
