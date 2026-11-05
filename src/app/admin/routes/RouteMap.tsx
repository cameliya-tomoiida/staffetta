"use client";
// 配送コースの地図（⑦）。Leaflet（unpkg から読む）＋ 国土地理院の地図（淡色）。
// 番号つきの丸 = 回る順。赤い丸 = 時間の希望に遅れる先。四角 = 工場。線 = 道順（取れなければ直線の点線）。
// leaflet の型の部品（@types/leaflet）は入れていないので、ここだけ any で扱う
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";

type L = any;
declare global {
  interface Window {
    L?: L;
  }
}

const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet";
let loading: Promise<L> | null = null;
function loadLeaflet(): Promise<L> {
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${LEAFLET}.css`;
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = `${LEAFLET}.js`;
    s.onload = () => (window.L ? resolve(window.L) : reject(new Error("地図の部品が読めませんでした")));
    s.onerror = () => {
      loading = null;
      reject(new Error("地図の部品が読めませんでした（インターネットにつながっているか確かめてください）"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export interface MapPin {
  id: string;
  no: number;
  lat: number;
  lng: number;
  name: string;
  /** ふきだしに出す行 */
  lines: string[];
  late: boolean;
  /** 色（見直し案でコースごとに色を分けるとき） */
  color?: string;
}

/** 線（見直し案のように、コースが何本もあるとき） */
export interface MapLine {
  color: string;
  /** 道順の線（[緯度, 経度]）。無ければ points を点線で結ぶ */
  road?: [number, number][];
  points: [number, number][];
}

export function RouteMap({
  depot, pins, line, lines, selected, onSelect,
}: {
  depot: { lat: number; lng: number; name: string };
  pins: MapPin[];
  /** 道順の線（[緯度, 経度]）。無ければ工場→各先→工場を点線で結ぶ */
  line?: [number, number][];
  /** コースが何本もあるとき（これがあれば line は使わない） */
  lines?: MapLine[];
  selected?: string;
  onSelect?: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const [lib, setLib] = useState<L | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    loadLeaflet()
      .then((L) => {
        if (!alive || !box.current || map.current) return;
        const m = L.map(box.current, { scrollWheelZoom: false });
        L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>',
        }).addTo(m);
        layer.current = L.layerGroup().addTo(m);
        map.current = m;
        setLib(L);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  // 印と線を描き直す
  const pinKey = JSON.stringify(pins.map((p) => [p.id, p.no, p.lat, p.lng, p.late, p.lines]));
  const lineKey = JSON.stringify([line ?? null, lines ?? null]);
  useEffect(() => {
    const L = lib;
    const m = map.current;
    const g = layer.current;
    if (!L || !m || !g) return;
    g.clearLayers();
    const pts: [number, number][] = [[depot.lat, depot.lng], ...pins.map((p) => [p.lat, p.lng] as [number, number]), [depot.lat, depot.lng]];
    if (lines) {
      for (const l of lines) {
        if (l.road?.length) L.polyline(l.road, { color: l.color, weight: 5, opacity: 0.8 }).addTo(g);
        else L.polyline(l.points, { color: l.color, weight: 4, opacity: 0.7, dashArray: "8 8" }).addTo(g);
      }
    } else if (line?.length) L.polyline(line, { color: "#8f1d1d", weight: 5, opacity: 0.75 }).addTo(g);
    else if (pins.length) L.polyline(pts, { color: "#8f1d1d", weight: 4, opacity: 0.6, dashArray: "8 8" }).addTo(g);
    L.marker([depot.lat, depot.lng], {
      icon: L.divIcon({
        className: "",
        html: `<div style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:6px;background:#2b2420;color:#fff;font:700 15px/1 'BIZ UDPGothic',sans-serif;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">工場</div>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
      title: depot.name,
    })
      .bindPopup(`<b style="font-size:18px">${esc(depot.name)}</b><br>出発・帰社`)
      .addTo(g);
    for (const p of pins) {
      const on = p.id === selected;
      const bg = p.late ? "#7a2a1c" : (p.color ?? "#8f1d1d");
      const mk = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="display:flex;align-items:center;justify-content:center;width:${on ? 46 : 38}px;height:${on ? 46 : 38}px;border-radius:50%;background:${bg};color:#fff;font:700 ${on ? 22 : 19}px/1 'BIZ UDPGothic',sans-serif;border:3px solid ${on ? "#f5c400" : "#fff"};box-shadow:0 1px 4px rgba(0,0,0,.45)">${p.no}</div>`,
          iconSize: [on ? 46 : 38, on ? 46 : 38],
          iconAnchor: [on ? 23 : 19, on ? 23 : 19],
        }),
        title: `${p.no}. ${p.name}`,
        zIndexOffset: on ? 1000 : 0,
      })
        .bindPopup(`<div style="font-size:17px;line-height:1.6"><b style="font-size:19px">${p.no}. ${esc(p.name)}</b>${p.lines.map((l) => `<br>${esc(l)}`).join("")}</div>`, { maxWidth: 320 })
        .on("click", () => onSelect?.(p.id))
        .addTo(g);
      if (on) mk.openPopup();
    }
    if (pins.length) m.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 15 });
    else m.setView([depot.lat, depot.lng], 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pinKey・lineKey で中身の変化を見る
  }, [lib, pinKey, lineKey, selected, depot.lat, depot.lng, depot.name]);

  return (
    <div className="relative">
      <div ref={box} className="h-[520px] w-full rounded-lg border border-rule-strong bg-cream" role="application" aria-label="配送コースの地図" />
      {error && <p className="absolute inset-x-4 top-4 rounded-md border border-alert-line bg-alert-bg p-3 text-base text-alert-ink">{error}</p>}
    </div>
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
