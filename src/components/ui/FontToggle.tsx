"use client";
// 字体の切りかえ（⑧ 試し）: 画面の名前と大きな数字を 明朝 ⇔ ゴシック。この端末に覚える（hub_font）。開いたときは layout のスクリプトで、ちらつかない
import { useSyncExternalStore } from "react";
import { FONT_KEY } from "@/lib/theme";

const read = () => (document.documentElement.getAttribute("data-font") === "mincho" ? "mincho" : "gothic");
function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-font"] });
  return () => mo.disconnect();
}

export function FontToggle() {
  const font = useSyncExternalStore(subscribe, read, () => "gothic");
  const toggle = () => {
    const next = font === "mincho" ? "gothic" : "mincho";
    if (next === "mincho") document.documentElement.setAttribute("data-font", "mincho");
    else document.documentElement.removeAttribute("data-font");
    try {
      localStorage.setItem(FONT_KEY, next);
    } catch {
      /* 覚えられなくても、この画面では切りかわる */
    }
  };
  return (
    <button type="button" onClick={toggle} className="min-h-11 rounded-full border border-rule-strong px-4 text-[15px] font-bold">
      字体: {font === "mincho" ? "明朝" : "ゴシック"}
    </button>
  );
}
