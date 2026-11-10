// 画面の色（暗い・明るい）の決まり（作者 11/6）。サーバーの画面（layout）とクライアントの部品（ThemeToggle）の両方から使うので、普通のファイルに置く。
export type Theme = "dark" | "light";
export const THEME_KEY = "hub_theme";

/** 開いたとき、描く前に色を決めるスクリプト（layout の head に入れる。ちらつかないように） */
export const FONT_KEY = "hub_font";
export const THEME_BOOT = `try{if(localStorage.getItem("${THEME_KEY}")==="light")document.documentElement.setAttribute("data-theme","light");if(localStorage.getItem("${FONT_KEY}")==="mincho")document.documentElement.setAttribute("data-font","mincho")}catch(e){}`;
