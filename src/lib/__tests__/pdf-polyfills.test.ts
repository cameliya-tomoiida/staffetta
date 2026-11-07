// iPhone の Safari に無い機能（pdf.js v6 が使う）を足す。足したものが正しく動くか・画面とワーカーの中身が同じか
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync("public/pdf-polyfills.mjs", "utf8");

/** 新しい機能が無いブラウザのつもりで、消してから足す */
function fresh() {
  const ctx = vm.createContext({ atob, btoa, URL });
  vm.runInContext(
    `delete Map.prototype.getOrInsert; delete Map.prototype.getOrInsertComputed; delete WeakMap.prototype.getOrInsertComputed;
     delete Math.sumPrecise; delete Promise.withResolvers; delete Set.prototype.intersection;
     delete Uint8Array.fromBase64; delete Uint8Array.prototype.toHex; delete Uint8Array.prototype.toBase64;`,
    ctx,
  );
  vm.runInContext(src.replace(/^export \{\};?$/m, ""), ctx);
  return ctx;
}

describe("pdf.js のための足し（iPhone で FAX が出なかった）", () => {
  it("Map・WeakMap の getOrInsertComputed・getOrInsert", () => {
    const c = fresh();
    expect(vm.runInContext(`const m=new Map();let n=0;m.getOrInsertComputed('a',()=>++n);m.getOrInsertComputed('a',()=>++n);[m.get('a'),n,m.getOrInsert('b',5),m.getOrInsert('b',6)].join()`, c)).toBe("1,1,5,5");
    expect(vm.runInContext(`const w=new WeakMap();const k={};w.getOrInsertComputed(k,()=>7)`, c)).toBe(7);
  });

  it("Math.sumPrecise・Promise.withResolvers・Set.intersection・URL.parse", () => {
    const c = fresh();
    expect(vm.runInContext(`Math.sumPrecise([1,2,3])`, c)).toBe(6);
    expect(vm.runInContext(`typeof Promise.withResolvers().resolve`, c)).toBe("function");
    expect(vm.runInContext(`[...new Set([1,2,3]).intersection(new Set([2,3,4]))].join()`, c)).toBe("2,3");
    expect(vm.runInContext(`URL.parse('not a url')`, c)).toBeNull();
  });

  it("Uint8Array の base64・hex", () => {
    const c = fresh();
    expect(vm.runInContext(`Array.from(Uint8Array.fromBase64('AQID')).join()`, c)).toBe("1,2,3");
    expect(vm.runInContext(`new Uint8Array([1,255]).toHex()`, c)).toBe("01ff");
    expect(vm.runInContext(`new Uint8Array([1,2,3]).toBase64()`, c)).toBe("AQID");
  });

  it("画面の側（src/lib/pdf-polyfills.ts）とワーカーの側（public）の中身が同じ。ワーカーは足してから読む", () => {
    const body = (s: string) => s.split(/\r?\n/).filter((l) => !/^\/\/|^\/\*|^export \{\};?$/.test(l.trim()) && l.trim()).join("\n");
    expect(body(readFileSync("src/lib/pdf-polyfills.ts", "utf8"))).toBe(body(src));
    const boot = readFileSync("public/pdf.worker.boot.mjs", "utf8");
    expect(boot.indexOf("pdf-polyfills.mjs")).toBeLessThan(boot.indexOf("pdf.worker.min.mjs"));
  });
});
