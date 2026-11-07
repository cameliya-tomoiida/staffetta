import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { homeOf } from "@/lib/auth/roles";

// 最初の画面（⑧・担当者「スマホで開くと FAX 受信箱になる。最初はその人の部署のホームに」）。
// FAX 受信箱は /fax に移した。ここは、その人の役割のホームへ送るだけ（ログインなしのときは /home）。
export default async function Start() {
  const user = await currentUser();
  redirect(user ? homeOf(user.role) : "/home");
}
