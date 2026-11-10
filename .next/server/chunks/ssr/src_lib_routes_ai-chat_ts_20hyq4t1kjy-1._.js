module.exports=[83201,30062,8087,a=>{"use strict";var b=a.i(96117),c=a.i(26972),d=a.i(89963),e=a.i(11365),f=a.i(27221),g=a.i(63507),h=a.i(68123),i=a.i(49310);let j=c.z.object({kind:i.z.enum(["window","service","closed","backBy","together","info"]).describe("window=時間の希望 / service=納品にかかる分 / closed=回らない曜日 / backBy=〇時までに帰るコース / together=同じコースにする先 / info=条件にならないメモ"),customerIds:d.z.array(f.z.string()).describe("先の id（一覧の id をそのまま）。backBy は空"),from:f.z.string().nullable().describe("window の始まり HH:MM"),to:f.z.string().nullable().describe("window の終わり HH:MM"),minutes:e.z.number().nullable().describe("service の分"),weekdays:d.z.array(e.z.number()).nullable().describe("closed の曜日（0=日〜6=土）"),time:f.z.string().nullable().describe("backBy の時刻 HH:MM"),label:f.z.string().nullable().describe("backBy のだれか（例: 〇〇さん）"),text:f.z.string().nullable().describe("info の中身（短く）"),why:f.z.string().describe("なぜこの条件か（メモの言葉・人の話）。短く")}),k=/^(\d{1,2}):([0-5]\d)$/;function l(a){let b=a?.trim().replace("：",":").match(k);if(!(!b||Number(b[1])>23))return`${b[1].padStart(2,"0")}:${b[2]}`}let m=0,n=()=>`r${Date.now().toString(36)}${(m++).toString(36)}`;a.s(["s",0,j,"t",0,function(a,b,c,d=[]){let e=[],f=[];for(let g of a){let a,h=[...new Set(g.customerIds)].filter(a=>b.has(a)),i=g.customerIds.filter(a=>!b.has(a));i.length&&e.push(`知らない先を外しました: ${i.join("・")}`);let j={kind:g.kind,why:g.why.replace("（いまは使っていない）","").trim(),source:c,on:!0};switch(g.kind){case"window":{let b=l(g.from),c=l(g.to);h.length&&(b||c)&&!(b&&c&&b>=c)?a={...j,customerIds:h.slice(0,1),...b?{from:b}:{},...c?{to:c}:{}}:e.push(`時間の希望を読めませんでした（${g.why}）`);break}case"service":h.length&&null!=g.minutes&&g.minutes>0&&g.minutes<=180?a={...j,customerIds:h.slice(0,1),minutes:Math.round(g.minutes)}:e.push(`納品の時間を読めませんでした（${g.why}）`);break;case"closed":{let b=[...new Set(g.weekdays??[])].filter(a=>Number.isInteger(a)&&a>=0&&a<=6).sort();h.length&&b.length?a={...j,customerIds:h.slice(0,1),weekdays:b}:e.push(`回らない曜日を読めませんでした（${g.why}）`);break}case"backBy":{let b=l(g.time);b?a={...j,customerIds:[],time:b,...g.label?.trim()?{label:g.label.trim()}:{}}:e.push(`帰る時刻を読めませんでした（${g.why}）`);break}case"together":h.length>=2?a={...j,customerIds:h}:e.push(`同じコースにする先が2件そろいませんでした（${g.why}）`);break;case"info":h.length&&g.text?.trim()&&(a={...j,customerIds:h.slice(0,1),text:g.text.trim()})}if(!a)continue;let k=d.find(b=>(function(a,b){let c=a=>JSON.stringify([a.kind,[...a.customerIds].sort(),a.from,a.to,a.minutes,a.weekdays,a.time,a.label,a.text]);return c(a)===c(b)})(b,a));f.push(k?{...a,id:k.id,on:k.on,source:k.source}:{...a,id:n()})}return{rules:f,warnings:e}}],30062);let o="claude-opus-5-5",p=()=>!!(0,h.z)(),q="配送コースの AI",r=`あなたは食品工場（パン・ピザ）の配送コースの係です。毎朝、自社のトラックで取引先に納品します。
計算の条件の種類:
- window: その先に着く時間の希望（from〜to, HH:MM）。「10時まで」→ to=10:00、「9時以降」→ from=09:00
- service: その先の納品にかかる分（「搬入に時間がかかる」「階段で運ぶ」など。分がわからなければ作らない）
- closed: その先に行かない曜日（0=日〜6=土）。「月曜休み」→ [1]
- backBy: 〇時までに工場に帰るコースを1つ（label=だれのコースか）。2人なら2つ
- together: 同じコースにする先（2件以上）
- info: 計算には使わないが、配る人に大事なメモ（裏口・鍵・置き場所）。短く
決まり:
- 先は一覧の id をそのまま使う。一覧に無い先は作らない
- 書いていないこと・言っていないことを、勝手に決めない
- why には、メモの言葉か人の話を短く
- 返事はやさしい日本語で短く`,s=c.z.object({rules:d.z.array(j)});async function t(a){if(!p())throw Error("AI のキーがありません（設定 → AI）");let c=(0,g.f)(q,{timeout:18e4}),d=[];for(let e=0;e<a.length;e+=80){let f=a.slice(e,e+80),g=await c.beta.messages.parse({model:o,max_tokens:16e3,thinking:{type:"adaptive"},output_config:{effort:"medium",format:(0,b.f)(s)},system:`${r}

仕事: 各先の配送メモを読み、計算に効く条件（window・service・closed）と、配る人に大事なメモ（info）を出す。いまの時間の希望（window）と同じなら出さない。条件にならない先は何も出さない。`,messages:[{role:"user",content:`## 先とメモ
${JSON.stringify(f)}`}]});if("refusal"===g.stop_reason)throw Error("AI が答えられませんでした");if(!g.parsed_output)throw Error("AI の答えを読めませんでした。もう一度押してください");d.push(...g.parsed_output.rules)}return d}let u=c.z.object({courses:e.z.number().nullable().describe("コースの数。変えないなら null。自動にするなら 0"),earliestDepart:f.z.string().nullable().describe("いちばん早い出発 HH:MM。変えないなら null"),maxHours:e.z.number().nullable().describe("1コースの上限（時間）。変えないなら null"),breakMinutes:e.z.number().nullable().describe("休けい（分）。変えないなら null")}),v=c.z.object({reply:f.z.string().describe("人への返事。やさしい日本語で1〜3文。何を変えたか・確かめたいこと"),rules:d.z.array(j).describe("条件の全部（変えないものもそのまま返す。消すものは入れない）"),options:u});async function w(a,c){if(!p())throw Error("AI のキーがありません（設定 → AI）");let d=(0,g.f)(q,{timeout:12e4}),e=`## 曜日
${"日月火水木金土"[c.weekday]}曜
## 計算の決まり（空=自動）
${JSON.stringify(c.options)}
## いまの条件
${JSON.stringify(c.rules)}
## 先の一覧（id・名前・時間の希望・今の便）
${JSON.stringify(c.stops)}${c.lastResult?`
## さっきの結果
${c.lastResult}`:""}`,f=a.map((b,c)=>({role:b.role,content:c===a.length-1&&"user"===b.role?`${e}

## 人の話
${b.text}`:b.text})),h=await d.beta.messages.parse({model:o,max_tokens:8e3,thinking:{type:"adaptive"},output_config:{effort:"medium",format:(0,b.f)(v)},system:`${r}

仕事: 人の話を聞いて、条件の全部と、計算の決まりの変更を返す。言われた所だけ直し、ほかの条件はそのまま返す。人の名前が出ても、先の名前と取りちがえない（人のコースは backBy の label）。`,messages:f});if("refusal"===h.stop_reason)throw Error("AI が答えられませんでした。言い方を変えてもう一度");let i=h.parsed_output;if(!i)throw Error("AI の答えを読めませんでした。もう一度送ってください");return i}async function x(a){if(!p())throw Error("AI のキーがありません（設定 → AI）");let b=(0,g.f)(q,{timeout:12e4}),c=await b.messages.create({model:o,max_tokens:3e3,thinking:{type:"adaptive"},output_config:{effort:"low"},system:`${r}

仕事: コースの見直し案を、今のコースと比べて説明する。はじめに大事なこと（コースの数・遅れる先・いちばん早い出発・帰る時刻）を1〜2文。そのあと、何が変わったか・なぜそうなったか（条件のせい・遠い先・時間の希望）を短い箇条書きで3〜6行。入らなかった先や守れなかった決まりがあれば、どうすればよいかも。数字は結果のとおりに。むずかしいことばは使わない。マークダウンの見出しは使わない。`,messages:[{role:"user",content:a}]});if("refusal"===c.stop_reason)throw Error("AI が答えられませんでした");return c.content.flatMap(a=>"text"===a.type?[a.text]:[]).join("\n").trim()}a.s(["l",0,w,"Z",0,x,"S",0,p,"u",0,t],83201);var y=a.i(11654);a.s(["r",0,function(){return(0,y.Y)("route_rules")??[]},"q",0,function(a){(0,y.A)("route_rules",a)}],8087)}];

//# sourceMappingURL=src_lib_routes_ai-chat_ts_20hyq4t1kjy-1._.js.map