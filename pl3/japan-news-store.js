const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const text=(v,max)=>String(v??'').trim().slice(0,max);
async function ensure(env){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS pl_japan_news (
 id TEXT PRIMARY KEY,
 date TEXT NOT NULL,
 title TEXT NOT NULL,
 summary TEXT NOT NULL,
 source_url TEXT NOT NULL,
 post_url TEXT NOT NULL DEFAULT '',
 cover_url TEXT NOT NULL DEFAULT '',
 published INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL DEFAULT ''
 )`).run();
}
function url(value,required=false){
 const s=text(value,1000);
 if(!s){if(required)fail('請填寫官方消息網址');return '';}
 let parsed;try{parsed=new URL(s)}catch{fail('網址格式無效');}
 if(parsed.protocol!=='https:')fail('消息網址必須使用 HTTPS');
 return parsed.href;
}
function publicItem(row){return{id:row.id,date:row.date,title:row.title,summary:row.summary,sourceUrl:row.source_url,postUrl:row.post_url||'',coverUrl:row.cover_url||''};}
export async function listJapanNews(env,{publicOnly=false}={}){
 await ensure(env);
 const sql='SELECT id,date,title,summary,source_url,post_url,cover_url,published,created_at,updated_at,updated_by FROM pl_japan_news '+(publicOnly?'WHERE published=1 ':'')+'ORDER BY date DESC,updated_at DESC LIMIT 300';
 const rows=await env.DB.prepare(sql).all();
 return(rows.results||[]).map(r=>({...publicItem(r),published:r.published===1,createdAt:r.created_at,updatedAt:r.updated_at,updatedBy:r.updated_by}));
}
export async function saveJapanNews(env,body,actor){
 await ensure(env);
 const id=text(body?.id,64)||crypto.randomUUID();
 if(!/^[0-9a-f-]{36}$/i.test(id))fail('情報識別碼無效');
 const date=text(body?.date,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z')))fail('請填寫正確的公告日期');
 const title=text(body?.title,180),summary=text(body?.summary,2000);
 if(!title)fail('請填寫情報標題');
 if(!summary)fail('請填寫情報摘要');
 const source=url(body?.sourceUrl,true),post=url(body?.postUrl),cover=url(body?.coverUrl);
 const published=body?.published===true?1:0,now=new Date().toISOString();
 await env.DB.prepare(`INSERT INTO pl_japan_news(id,date,title,summary,source_url,post_url,cover_url,published,created_at,updated_at,updated_by)
 VALUES(?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(id) DO UPDATE SET date=excluded.date,title=excluded.title,summary=excluded.summary,source_url=excluded.source_url,post_url=excluded.post_url,cover_url=excluded.cover_url,published=excluded.published,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
 .bind(id,date,title,summary,source,post,cover,published,now,now,text(actor,254)).run();
 const row=await env.DB.prepare('SELECT id,date,title,summary,source_url,post_url,cover_url,published,created_at,updated_at,updated_by FROM pl_japan_news WHERE id=?').bind(id).first();
 return{ok:true,item:{...publicItem(row),published:row.published===1,createdAt:row.created_at,updatedAt:row.updated_at,updatedBy:row.updated_by}};
}
