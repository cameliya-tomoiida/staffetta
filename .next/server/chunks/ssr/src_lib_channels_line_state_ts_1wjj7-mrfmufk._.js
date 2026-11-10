module.exports=[32295,a=>{"use strict";var b=a.i(37669),c=a.i(2157),d=a.i(50227),e=a.i(55842),f=a.i(93394),g=a.i(83007),h=a.i(11654);let i="line_users",j=`
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
`;async function k(){(0,h.E)("line",j),await m()}let l=!1;async function m(){if(l)return;l=!0;let a=d.default.join(b._,"line.json");if(!(0,c.existsSync)(a))return;let e=JSON.parse(await c.promises.readFile(a,"utf8")),f=Object.values(e.users??{});f.length&&await (0,g.b)(i,f.map(a=>({...a,id:a.userId})),"line.json から移行"),n(e.outbox??[],e.linkLog??[]),await c.promises.rename(a,`${a}.migrated`)}function n(a,b){if(!a.length&&!b.length)return;let c=(0,h.$)(),d=c.prepare("INSERT INTO line_outbox (at, to_user, via, text, mode, ok, error, order_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),e=c.prepare("INSERT INTO line_link_log (at, user_id, action, customer_id, who) VALUES (?, ?, ?, ?, ?)");(0,h.O)(()=>{for(let b of a)d.run(b.at,b.to,b.via,b.text,b.mode,+!!b.ok,b.error??null,b.orderId??null);for(let a of b)e.run(a.at,a.userId,a.action,a.customerId,a.who)})}async function o(){await k();let a=Object.fromEntries((await (0,g.h)(i)).map(({id:a,...b})=>[b.userId,b])),b=(0,h.$)();return{users:a,outbox:b.prepare("SELECT * FROM (SELECT * FROM line_outbox ORDER BY id DESC LIMIT 300) ORDER BY id").all().map(a=>({at:a.at,to:a.to_user,via:a.via,text:a.text,mode:a.mode,ok:!!a.ok,...a.error?{error:a.error}:{},...a.order_id?{orderId:a.order_id}:{}})),linkLog:b.prepare("SELECT at, user_id, action, customer_id, who FROM line_link_log ORDER BY id").all().map(a=>({at:a.at,userId:a.user_id,action:a.action,customerId:a.customer_id,who:a.who}))}}let p=Promise.resolve();function q(a,b="LINE（自動）"){let c=p.then(async()=>{let c=await o(),d=new Map(Object.values(c.users).map(a=>[a.userId,JSON.stringify(a)])),e=c.outbox.length,f=c.linkLog.length,h=await a(c),j=Object.values(c.users).filter(a=>d.get(a.userId)!==JSON.stringify(a));return j.length&&await (0,g.b)(i,j.map(a=>JSON.parse(JSON.stringify({...a,id:a.userId}))),b),n(c.outbox.slice(e),c.linkLog.slice(f)),h});return p=c.catch(()=>void 0),c}function r(a,b){let c=e.customers.find(a=>a.lineUserId&&a.lineUserId===b);return c?c.id:a.users[b]?.customerId??""}async function s(a,b={}){return q(c=>{let d=(0,f.nowIso)(),e=c.users[a]??={userId:a,firstSeenAt:d,lastSeenAt:d};return e.lastSeenAt=d,b.displayName&&(e.displayName=b.displayName),b.claimedName&&(e.claimedName=b.claimedName),b.firstMessage&&!e.firstMessage&&(e.firstMessage=b.firstMessage.slice(0,200)),{user:{...e},customerId:r(c,a)}})}async function t(){await k(),await (0,g.h)(i);let b=(0,h.$)(),c=a=>/^U[-_]demo[-_]/i.test(a),d=a=>b.prepare(a).all().map(a=>a.id).filter(c),e=d(`SELECT id FROM masters WHERE name = '${i}'`),j=d("SELECT DISTINCT to_user AS id FROM line_outbox"),l=d("SELECT DISTINCT user_id AS id FROM line_link_log");(0,h.O)(()=>{for(let a of e)b.prepare("DELETE FROM masters WHERE name = ? AND id = ?").run(i,a);for(let a of j)b.prepare("DELETE FROM line_outbox WHERE to_user = ?").run(a);for(let a of l)b.prepare("DELETE FROM line_link_log WHERE user_id = ?").run(a)});let m=(0,f.nowIso)();await (0,g.b)(i,u.map(a=>({id:a.userId,userId:a.userId,displayName:a.displayName,firstSeenAt:m,lastSeenAt:m,customerId:a.customerId,linkedAt:m,linkedBy:"デモの初期値"})),"デモを最初から");let{syncLineUserIds:n}=await a.A(3992);for(let a of u)await n(a.userId,a.customerId,"デモを最初から")}let u=[{userId:"U_demo_kotori",displayName:"ことり（デモ）",customerId:"C06"}];a.s(["DEMO_LINE_USERS",0,u,"customerIdForUser",0,r,"readLineState",0,o,"resetLineDemo",0,t,"touchUser",0,s,"updateLineState",0,q])}];

//# sourceMappingURL=src_lib_channels_line_state_ts_1wjj7-mrfmufk._.js.map