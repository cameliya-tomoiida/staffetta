module.exports=[83007,a=>{"use strict";var b=a.i(11654);let c=`
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
`,d=()=>(0,b.E)("masters",c),e=()=>new Date().toISOString();async function f(a,c={}){return d(),(0,b.$)().prepare(`SELECT json, disabled FROM masters WHERE name = ? ${c.includeDisabled?"":"AND disabled = 0"} ORDER BY id`).all(a).map(a=>({...JSON.parse(a.json),...a.disabled?{disabled:!0}:{}}))}async function g(a,c){d();let e=(0,b.$)().prepare("SELECT json, disabled FROM masters WHERE name = ? AND id = ?").get(a,c);return e?{...JSON.parse(e.json),...e.disabled?{disabled:!0}:{}}:void 0}async function h(a,c,f){if(d(),!f)throw Error("誰が変えたか（who）が必要です");for(let b of c)if(!b?.id)throw Error(`${a}: id の無い行があります`);let g=(0,b.$)(),h=g.prepare("SELECT json, disabled FROM masters WHERE name = ? AND id = ?"),i=g.prepare(`INSERT INTO masters (name, id, json, disabled, updated_at, updated_by) VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(name, id) DO UPDATE SET json = excluded.json, disabled = 0, updated_at = excluded.updated_at, updated_by = excluded.updated_by`),j=g.prepare("INSERT INTO master_history (name, id, action, before_json, after_json, at, who) VALUES (?, ?, ?, ?, ?, ?, ?)"),k=e();(0,b.O)(()=>{for(let b of c){let{disabled:c,...d}=b,e=JSON.stringify(d),g=h.get(a,b.id);(!g||g.json!==e||g.disabled)&&(i.run(a,b.id,e,k,f),j.run(a,b.id,g?g.disabled?"restore":"update":"insert",g?.json??null,e,k,f))}})}async function i(a,c,f){d();let g=(0,b.$)();(0,b.O)(()=>{let b=g.prepare("SELECT json, disabled FROM masters WHERE name = ? AND id = ?").get(a,c);if(!b||b.disabled)return;let d=e();g.prepare("UPDATE masters SET disabled = 1, updated_at = ?, updated_by = ? WHERE name = ? AND id = ?").run(d,f,a,c),g.prepare("INSERT INTO master_history (name, id, action, before_json, after_json, at, who) VALUES (?, ?, 'disable', ?, NULL, ?, ?)").run(a,c,b.json,d,f)})}async function j(a,c,f){d();let g=(0,b.$)();(0,b.O)(()=>{let b=g.prepare("SELECT json, disabled FROM masters WHERE name = ? AND id = ?").get(a,c);if(!b||!b.disabled)return;let d=e();g.prepare("UPDATE masters SET disabled = 0, updated_at = ?, updated_by = ? WHERE name = ? AND id = ?").run(d,f,a,c),g.prepare("INSERT INTO master_history (name, id, action, before_json, after_json, at, who) VALUES (?, ?, 'restore', NULL, ?, ?, ?)").run(a,c,b.json,d,f)})}async function k(a,c){return d(),(c?(0,b.$)().prepare("SELECT * FROM master_history WHERE name = ? AND id = ? ORDER BY seq DESC").all(a,c):(0,b.$)().prepare("SELECT * FROM master_history WHERE name = ? ORDER BY seq DESC LIMIT 500").all(a)).map(a=>({seq:a.seq,name:a.name,id:a.id,action:a.action,at:a.at,who:a.who,before:a.before_json?JSON.parse(a.before_json):null,after:a.after_json?JSON.parse(a.after_json):null}))}async function l(a,c){return d(),!((0,b.$)().prepare("SELECT COUNT(*) AS n FROM masters WHERE name = ?").get(a).n>0)&&(await h(a,c,"サンプル（初期値）"),!0)}a.s(["H",0,i,"y",0,g,"W",0,k,"M",0,d,"h",0,f,"i",0,j,"l",0,l,"b",0,h])}];

//# sourceMappingURL=src_lib_db_masters_ts_1e4nwvgjipy_u._.js.map