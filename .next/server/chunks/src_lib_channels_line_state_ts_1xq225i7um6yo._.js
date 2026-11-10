module.exports=[30520,e=>{"use strict";var t=e.i(24212),r=e.i(2157),i=e.i(50227),o=e.i(61200);e.i(11975);var n=e.i(211),a=e.i(60814);let s="line_users",u=`
CREATE TABLE IF NOT EXISTS line_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  to_user TEXT NOT NULL,
  via TEXT NOT NULL,
  text TEXT NOT NULL,
  mode TEXT NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  order_id TEXT
);
CREATE INDEX IF NOT EXISTS line_outbox_by_order ON line_outbox (order_id);
CREATE TABLE IF NOT EXISTS line_link_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  who TEXT NOT NULL
);
`;async function T(){(0,a.E)("line",u),await d()}let l=!1;async function d(){if(l)return;l=!0;let e=i.default.join(t.f,"line.json");if(!(0,r.existsSync)(e))return;let o=JSON.parse(await r.promises.readFile(e,"utf8")),a=Object.values(o.users??{});a.length&&await (0,n.b)(s,a.map(e=>({...e,id:e.userId})),"line.json から移行"),E(o.outbox??[],o.linkLog??[]),await r.promises.rename(e,`${e}.migrated`)}function E(e,t){if(!e.length&&!t.length)return;let r=(0,a.$)(),i=r.prepare("INSERT INTO line_outbox (at, to_user, via, text, mode, ok, error, order_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),o=r.prepare("INSERT INTO line_link_log (at, user_id, action, customer_id, who) VALUES (?, ?, ?, ?, ?)");(0,a.O)(()=>{for(let t of e)i.run(t.at,t.to,t.via,t.text,t.mode,+!!t.ok,t.error??null,t.orderId??null);for(let e of t)o.run(e.at,e.userId,e.action,e.customerId,e.who)})}async function N(){await T();let e=Object.fromEntries((await (0,n.h)(s)).map(({id:e,...t})=>[t.userId,t])),t=(0,a.$)();return{users:e,outbox:t.prepare("SELECT * FROM (SELECT * FROM line_outbox ORDER BY id DESC LIMIT 300) ORDER BY id").all().map(e=>({at:e.at,to:e.to_user,via:e.via,text:e.text,mode:e.mode,ok:!!e.ok,...e.error?{error:e.error}:{},...e.order_id?{orderId:e.order_id}:{}})),linkLog:t.prepare("SELECT at, user_id, action, customer_id, who FROM line_link_log ORDER BY id").all().map(e=>({at:e.at,userId:e.user_id,action:e.action,customerId:e.customer_id,who:e.who}))}}let L=Promise.resolve();e.s(["customerIdForUser",0,function(e,t){let r=o.b.find(e=>e.lineUserId&&e.lineUserId===t);return r?r.id:e.users[t]?.customerId??""},"readLineState",0,N,"updateLineState",0,function(e,t="LINE（自動）"){let r=L.then(async()=>{let r=await N(),i=new Map(Object.values(r.users).map(e=>[e.userId,JSON.stringify(e)])),o=r.outbox.length,a=r.linkLog.length,u=await e(r),T=Object.values(r.users).filter(e=>i.get(e.userId)!==JSON.stringify(e));return T.length&&await (0,n.b)(s,T.map(e=>JSON.parse(JSON.stringify({...e,id:e.userId}))),t),E(r.outbox.slice(o),r.linkLog.slice(a)),u});return L=r.catch(()=>void 0),r}])}];

//# sourceMappingURL=src_lib_channels_line_state_ts_1xq225i7um6yo._.js.map