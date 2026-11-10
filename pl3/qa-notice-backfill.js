// Owner-only, isolated rehearsal: never touches pl_ops_state/pl_ops_mail or Gmail.
const TABLE=`CREATE TABLE IF NOT EXISTS pl3_qa_notice_backfill(
 id TEXT PRIMARY KEY, status TEXT NOT NULL, gmail_message_id TEXT,
 sent_at TEXT, evidence TEXT, updated_at TEXT NOT NULL)`;
const ID='PL3-QA-GMAIL-BACKFILL-43';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export async function qaNoticeBackfillStatus(env){
 await env.DB.prepare(TABLE).run();
 const row=await env.DB.prepare('SELECT * FROM pl3_qa_notice_backfill WHERE id=?').bind(ID).first();
 return {ok:true,isolated:true,notice:row||{id:ID,status:'draft'}};
}
export async function qaNoticeBackfillStart(env){
 await env.DB.prepare(TABLE).run();
 const existing=await env.DB.prepare('SELECT status FROM pl3_qa_notice_backfill WHERE id=?').bind(ID).first();
 if(existing?.status==='sent')return {ok:true,isolated:true,already_completed:true};
 await env.DB.prepare("INSERT OR IGNORE INTO pl3_qa_notice_backfill(id,status,updated_at) VALUES(?,'draft',?)").bind(ID,new Date().toISOString()).run();
 return qaNoticeBackfillStatus(env);
}
export async function qaNoticeBackfillSet(env,body){
 const {notice}=await qaNoticeBackfillStatus(env);
 if(notice.status!=='draft')fail('隔離通知已寄出，不能重複回填',409);
 const gmail=String(body?.gmail_message_id||'').trim(),evidence=String(body?.evidence||'').trim(),sentAt=String(body?.sent_at||'');
 if(!/^qa-gmail-43-[a-z0-9-]{4,80}$/.test(gmail))fail('只能使用隔離測試 Gmail ID');
 if(evidence.length<8||evidence.length>1000||!body?.confirmed)fail('缺少測試核對依據');
 if(!Number.isFinite(Date.parse(sentAt))||Date.parse(sentAt)>Date.now())fail('測試時間無效');
 const result=await env.DB.prepare("UPDATE pl3_qa_notice_backfill SET status='sent',gmail_message_id=?,sent_at=?,evidence=?,updated_at=? WHERE id=? AND status='draft'").bind(gmail,new Date(sentAt).toISOString(),evidence,new Date().toISOString(),ID).run();
 if(!result.meta?.changes)fail('隔離通知已變動',409);
 return qaNoticeBackfillStatus(env);
}
