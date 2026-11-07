// pdf.js のワーカーの入口。新しい JS の機能を足してから（pdf-polyfills.mjs）、本物のワーカーを読み込む。
// import は書いた順に実行されるので、ワーカーより先に足される。
import "./pdf-polyfills.mjs";
import "./pdf.worker.min.mjs";
