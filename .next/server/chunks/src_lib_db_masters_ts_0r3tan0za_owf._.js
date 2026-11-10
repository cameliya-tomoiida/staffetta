module.exports=[15754,e=>{"use strict";var a=e.i(23266);let r=`
CREATE TABLE IF NOT EXISTS masters (
  name TEXT NOT NULL,
  id TEXT NOT NULL,
  json TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (name, id)
);
CREATE TABLE IF NOT EXISTS master_history (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  id TEXT NOT NULL,
  action TEXT NOT NULL,            -- insert | update | disable | restore
  before_json TEXT,
  after_json TEXT,
  at TEXT NOT NULL,
  who TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS master_history_by_row ON master_history (name, id, seq);
`,s=()=>(0,a.E)("masters",r),t=()=>new Date().toISOString();async function d(e,r={}){return s(),(0,a.$)().prepare(`SELECT json, disabled FROM masters WHERE name = ? ${r.includeDisabled?"":"AND disabled = 0"} ORDER BY id`).all(e).map(e=>({...JSON.parse(e.json),...e.disabled?{disabled:!0}:{}}))}async function n(e,r){s();let t=(0,a.$)().prepare("SELECT json, disabled FROM masters WHERE name = ? AND id = ?").get(e,r);return t?{...JSON.parse(t.json),...t.disabled?{disabled:!0}:{}}:void 0}async function E(e,r,d){if(s(),!d)throw Error("誰が変えたか（who）が必要です");for(let a of r)if(!a?.id)throw Error(`${e}: id の無い行があります`);let n=(0,a.$)(),E=n.prepare("SELECT json, disabled FROM masters WHERE name = ? AND id = ?"),i=n.prepare(`INSERT INTO masters (name, id, json, disabled, updated_at, updated_by) VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(name, id) DO UPDATE SET json = excluded.json, disabled = 0, updated_at = excluded.updated_at, updated_by = excluded.updated_by`),o=n.prepare("INSERT INTO master_history (name, id, action, before_json, after_json, at, who) VALUES (?, ?, ?, ?, ?, ?, ?)"),T=t();(0,a.O)(()=>{for(let a of r){let{disabled:r,...s}=a,t=JSON.stringify(s),n=E.get(e,a.id);(!n||n.json!==t||n.disabled)&&(i.run(e,a.id,t,T,d),o.run(e,a.id,n?n.disabled?"restore":"update":"insert",n?.json??null,t,T,d))}})}async function i(e,r,d){s();let n=(0,a.$)();(0,a.O)(()=>{let a=n.prepare("SELECT json, disabled FROM masters WHERE name = ? AND id = ?").get(e,r);if(!a||a.disabled)return;let s=t();n.prepare("UPDATE masters SET disabled = 1, updated_at = ?, updated_by = ? WHERE name = ? AND id = ?").run(s,d,e,r),n.prepare("INSERT INTO master_history (name, id, action, before_json, after_json, at, who) VALUES (?, ?, 'disable', ?, NULL, ?, ?)").run(e,r,a.json,s,d)})}async function o(e,r,d){s();let n=(0,a.$)();(0,a.O)(()=>{let a=n.prepare("SELECT json, disabled FROM masters WHERE name = ? AND id = ?").get(e,r);if(!a||!a.disabled)return;let s=t();n.prepare("UPDATE masters SET disabled = 0, updated_at = ?, updated_by = ? WHERE name = ? AND id = ?").run(s,d,e,r),n.prepare("INSERT INTO master_history (name, id, action, before_json, after_json, at, who) VALUES (?, ?, 'restore', NULL, ?, ?, ?)").run(e,r,a.json,s,d)})}async function T(e,r){return s(),(r?(0,a.$)().prepare("SELECT * FROM master_history WHERE name = ? AND id = ? ORDER BY seq DESC").all(e,r):(0,a.$)().prepare("SELECT * FROM master_history WHERE name = ? ORDER BY seq DESC LIMIT 500").all(e)).map(e=>({seq:e.seq,name:e.name,id:e.id,action:e.action,at:e.at,who:e.who,before:e.before_json?JSON.parse(e.before_json):null,after:e.after_json?JSON.parse(e.after_json):null}))}async function N(e,r){return s(),!((0,a.$)().prepare("SELECT COUNT(*) AS n FROM masters WHERE name = ?").get(e).n>0)&&(await E(e,r,"サンプル（初期値）"),!0)}e.s(["H",0,i,"y",0,n,"W",0,T,"M",0,s,"h",0,d,"i",0,o,"l",0,N,"b",0,E])}];

//# sourceMappingURL=src_lib_db_masters_ts_0r3tan0za_owf._.js.map