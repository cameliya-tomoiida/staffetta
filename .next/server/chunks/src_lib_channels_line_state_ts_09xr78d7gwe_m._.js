module.exports=[62136,e=>{"use strict";var t=e.i(77930),r=e.i(2157),i=e.i(50227),o=e.i(8242),a=e.i(62189),s=e.i(15754),n=e.i(23266);let l="line_users",d=`
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
`;async function u(){(0,n.E)("line",d),await T()}let E=!1;async function T(){if(E)return;E=!0;let e=i.default.join(t.f,"line.json");if(!(0,r.existsSync)(e))return;let o=JSON.parse(await r.promises.readFile(e,"utf8")),a=Object.values(o.users??{});a.length&&await (0,s.b)(l,a.map(e=>({...e,id:e.userId})),"line.json から移行"),N(o.outbox??[],o.linkLog??[]),await r.promises.rename(e,`${e}.migrated`)}function N(e,t){if(!e.length&&!t.length)return;let r=(0,n.$)(),i=r.prepare("INSERT INTO line_outbox (at, to_user, via, text, mode, ok, error, order_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),o=r.prepare("INSERT INTO line_link_log (at, user_id, action, customer_id, who) VALUES (?, ?, ?, ?, ?)");(0,n.O)(()=>{for(let t of e)i.run(t.at,t.to,t.via,t.text,t.mode,+!!t.ok,t.error??null,t.orderId??null);for(let e of t)o.run(e.at,e.userId,e.action,e.customerId,e.who)})}async function m(){await u();let e=Object.fromEntries((await (0,s.h)(l)).map(({id:e,...t})=>[t.userId,t])),t=(0,n.$)();return{users:e,outbox:t.prepare("SELECT * FROM (SELECT * FROM line_outbox ORDER BY id DESC LIMIT 300) ORDER BY id").all().map(e=>({at:e.at,to:e.to_user,via:e.via,text:e.text,mode:e.mode,ok:!!e.ok,...e.error?{error:e.error}:{},...e.order_id?{orderId:e.order_id}:{}})),linkLog:t.prepare("SELECT at, user_id, action, customer_id, who FROM line_link_log ORDER BY id").all().map(e=>({at:e.at,userId:e.user_id,action:e.action,customerId:e.customer_id,who:e.who}))}}let I=Promise.resolve();function c(e,t="LINE（自動）"){let r=I.then(async()=>{let r=await m(),i=new Map(Object.values(r.users).map(e=>[e.userId,JSON.stringify(e)])),o=r.outbox.length,a=r.linkLog.length,n=await e(r),d=Object.values(r.users).filter(e=>i.get(e.userId)!==JSON.stringify(e));return d.length&&await (0,s.b)(l,d.map(e=>JSON.parse(JSON.stringify({...e,id:e.userId}))),t),N(r.outbox.slice(o),r.linkLog.slice(a)),n});return I=r.catch(()=>void 0),r}function L(e,t){let r=o.b.find(e=>e.lineUserId&&e.lineUserId===t);return r?r.id:e.users[t]?.customerId??""}async function _(e,t={}){return c(r=>{let i=(0,a.w)(),o=r.users[e]??={userId:e,firstSeenAt:i,lastSeenAt:i};return o.lastSeenAt=i,t.displayName&&(o.displayName=t.displayName),t.claimedName&&(o.claimedName=t.claimedName),t.firstMessage&&!o.firstMessage&&(o.firstMessage=t.firstMessage.slice(0,200)),{user:{...o},customerId:L(r,e)}})}async function O(){await u(),await (0,s.h)(l);let t=(0,n.$)(),r=e=>/^U[-_]demo[-_]/i.test(e),i=e=>t.prepare(e).all().map(e=>e.id).filter(r),o=i(`SELECT id FROM masters WHERE name = '${l}'`),d=i("SELECT DISTINCT to_user AS id FROM line_outbox"),E=i("SELECT DISTINCT user_id AS id FROM line_link_log");(0,n.O)(()=>{for(let e of o)t.prepare("DELETE FROM masters WHERE name = ? AND id = ?").run(l,e);for(let e of d)t.prepare("DELETE FROM line_outbox WHERE to_user = ?").run(e);for(let e of E)t.prepare("DELETE FROM line_link_log WHERE user_id = ?").run(e)});let T=(0,a.w)();await (0,s.b)(l,f.map(e=>({id:e.userId,userId:e.userId,displayName:e.displayName,firstSeenAt:T,lastSeenAt:T,customerId:e.customerId,linkedAt:T,linkedBy:"デモの初期値"})),"デモを最初から");let{syncLineUserIds:N}=await e.A(34850);for(let e of f)await N(e.userId,e.customerId,"デモを最初から")}let f=[{userId:"U_demo_kotori",displayName:"ことり（デモ）",customerId:"C06"}];e.s(["customerIdForUser",0,L,"readLineState",0,m,"resetLineDemo",0,O,"touchUser",0,_,"updateLineState",0,c])}];

//# sourceMappingURL=src_lib_channels_line_state_ts_09xr78d7gwe_m._.js.map