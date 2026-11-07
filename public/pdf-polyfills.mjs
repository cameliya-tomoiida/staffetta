// pdf.js v6 が使う新しい JS の機能を、無いブラウザ（iPhone の Safari・LINE の中のブラウザ・古い Chrome）に足す。
// 画面（src/lib/pdfjs.ts）とワーカー（pdf.worker.boot.mjs）の両方で、pdf.js より先に読み込む。
// 担当者 11/7: iPhone の LINE で FAX を開くと「this._requestsByChunk.getOrInsertComputed is not a function」。
const def = (obj, name, fn) => {
  if (obj && typeof obj[name] !== "function") Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true });
};
for (const C of [globalThis.Map, globalThis.WeakMap]) {
  if (!C) continue;
  def(C.prototype, "getOrInsert", function (key, value) {
    if (!this.has(key)) this.set(key, value);
    return this.get(key);
  });
  def(C.prototype, "getOrInsertComputed", function (key, fn) {
    if (!this.has(key)) this.set(key, fn(key));
    return this.get(key);
  });
}
// 足し算（Math.sumPrecise）。pdf.js はバイト数などの整数の合計に使う
def(Math, "sumPrecise", function (items) {
  let s = 0;
  for (const x of items) s += x;
  return s;
});
def(Promise, "withResolvers", function () {
  let resolve, reject;
  const promise = new this((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
});
if (globalThis.URL)
  def(URL, "parse", function (url, base) {
    try {
      return base === undefined ? new URL(url) : new URL(url, base);
    } catch {
      return null;
    }
  });
if (globalThis.Set) {
  def(Set.prototype, "intersection", function (other) {
    const out = new Set();
    for (const x of this) if (other.has(x)) out.add(x);
    return out;
  });
  def(Set.prototype, "union", function (other) {
    const out = new Set(this);
    for (const x of other.keys()) out.add(x);
    return out;
  });
  def(Set.prototype, "difference", function (other) {
    const out = new Set();
    for (const x of this) if (!other.has(x)) out.add(x);
    return out;
  });
}
if (globalThis.Uint8Array) {
  def(Uint8Array, "fromBase64", function (s) {
    const bin = atob(String(s).replace(/[\s]/g, "").replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  });
  def(Uint8Array.prototype, "toBase64", function () {
    let bin = "";
    for (let i = 0; i < this.length; i += 0x8000) bin += String.fromCharCode.apply(null, this.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  def(Uint8Array.prototype, "toHex", function () {
    let s = "";
    for (let i = 0; i < this.length; i++) s += this[i].toString(16).padStart(2, "0");
    return s;
  });
  def(Uint8Array, "fromHex", function (h) {
    const out = new Uint8Array(h.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  });
}
export {};
