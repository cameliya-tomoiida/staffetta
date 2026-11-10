module.exports=[211,e=>{"use strict";var a=e.i(60814);let d=`
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
`,s=()=>(0,a.E)("masters",d);async function t(e,d={}){return s(),(0,a.$)().prepare(`SELECT json, disabled FROM masters WHERE name = ? ${d.includeDisabled?"":"AND disabled = 0"} ORDER BY id`).all(e).map(e=>({...JSON.parse(e.json),...e.disabled?{disabled:!0}:{}}))}async function r(e,d){s();let t=(0,a.$)().prepare("SELECT json, disabled FROM masters WHERE name = ? AND id = ?").get(e,d);return t?{...JSON.parse(t.json),...t.disabled?{disabled:!0}:{}}:void 0}async function T(e,d,t){if(s(),!t)throw Error("誰が変えたか（who）が必要です");for(let a of d)if(!a?.id)throw Error(`${e}: id の無い行があります`);let r=(0,a.$)(),T=r.prepare("SELECT json, disabled FROM masters WHERE name = ? AND id = ?"),E=r.prepare(`INSERT INTO masters (name, id, json, disabled, updated_at, updated_by) VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(name, id) DO UPDATE SET json = excluded.json, disabled = 0, updated_at = excluded.updated_at, updated_by = excluded.updated_by`),n=r.prepare("INSERT INTO master_history (name, id, action, before_json, after_json, at, who) VALUES (?, ?, ?, ?, ?, ?, ?)"),i=new Date().toISOString();(0,a.O)(()=>{for(let a of d){let{disabled:d,...s}=a,r=JSON.stringify(s),o=T.get(e,a.id);(!o||o.json!==r||o.disabled)&&(E.run(e,a.id,r,i,t),n.run(e,a.id,o?o.disabled?"restore":"update":"insert",o?.json??null,r,i,t))}})}async function E(e,d){return s(),!((0,a.$)().prepare("SELECT COUNT(*) AS n FROM masters WHERE name = ?").get(e).n>0)&&(await T(e,d,"サンプル（初期値）"),!0)}e.s(["y",0,r,"M",0,s,"h",0,t,"l",0,E,"b",0,T])}];

//# sourceMappingURL=src_lib_db_masters_ts_0vvfn6dh8410s._.js.map