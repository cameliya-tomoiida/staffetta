import "server-only";
// 配送コースの見直しの条件（⑦の(29)）の保存。kv "route_rules"。
import { kvGet, kvSet } from "@/lib/db/sqlite";
import type { RouteRule } from "./ai-rules";

export function listRouteRules(): RouteRule[] {
  return kvGet<RouteRule[]>("route_rules") ?? [];
}
export function saveRouteRules(rules: RouteRule[]) {
  kvSet("route_rules", rules);
}
