// Owner-only, synthetic payment-phase rehearsal. This table is deliberately
// outside the production operations ledger and contains no customer identity.
const RUN='PL3-QA-PHASE-20261105';
const GROUP='PL3-QA-PAYMENTS';
const STEPS=[
  ['first_invoiced',890,0,890,0],
  ['first_partial',890,800,90,90],
  ['first_carry_applied',800,800,0,90],
  ['second_invoiced',228,0,228,90],
  ['second_settled',228,228,0,90]
];
const schema=`CREATE TABLE IF NOT EXISTS pl3_qa_payment_events(
  id TEXT PRIMARY KEY,stage TEXT NOT NULL,payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,ack_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`;
const sign=async(secret,body)=>{
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body)))].map(v=>v.toString(16).padStart(2,'0')).join('');
};
const configured=env=>{
  if(env.PL3_SYNC_ALLOW_QA!=='true'||!env.PL3_SYNC_WEBHOOK_SECRET||!env.PL3_SYNC_WEBHOOK_URL)
    throw Object.assign(Error('QA sync not configured'),{status:503});
  const url=new URL(env.PL3_SYNC_WEBHOOK_URL);
  if(url.protocol!=='https:'||url.hostname!=='script.google.com'||
    !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname))
    throw Object.assign(Error('QA receiver not allowlisted'),{status:503});
  return url.href;
};
export async function qaPaymentStart(env){
  configured(env);
  await env.DB.prepare(schema).run();
  const statements=STEPS.map(([stage,invoice_twd,received_twd,outstanding_twd,carry_twd],i)=>{
    const id='qa_payment_phase_'+RUN+'_'+String(i+1);
    const payload={event_id:id,event_type:'payment.phase.qa',entity_type:'order',
      entity_id:RUN,group_id:GROUP,payload:{order_id:RUN,stage,
        invoice_twd,received_twd,outstanding_twd,carry_twd}};
    return env.DB.prepare('INSERT OR IGNORE INTO pl3_qa_payment_events(id,stage,payload_json) VALUES(?,?,?)')
      .bind(id,stage,JSON.stringify(payload));
  });
  await env.DB.batch(statements);
  return qaPaymentStatus(env);
}
export async function qaPaymentStatus(env){
  await env.DB.prepare(schema).run();
  const rows=await env.DB.prepare('SELECT id,stage,payload_json,status,attempts,error_code,ack_at FROM pl3_qa_payment_events ORDER BY id').all();
  return {ok:true,run_id:RUN,group_id:GROUP,rows:(rows.results||[]).map(({payload_json,...r})=>({...r,amounts:JSON.parse(payload_json).payload}))};
}
export async function qaPaymentDrain(env){
  const url=configured(env);
  await env.DB.prepare(schema).run();
  const pending=await env.DB.prepare("SELECT id,payload_json FROM pl3_qa_payment_events WHERE status!='delivered' ORDER BY id LIMIT 5").all();
  const outcomes=[];
  for(const row of pending.results||[]){
    let status='retry',error='INVALID_ACK';
    try{
      const body=row.payload_json;
      const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({body,signature:await sign(env.PL3_SYNC_WEBHOOK_SECRET,body)}),
        signal:AbortSignal.timeout(30000)});
      const ack=await res.json();
      if(res.ok&&ack.ok===true&&ack.ack_event_id===row.id){status='delivered';error=null;}
    }catch{error='DELIVERY_UNCONFIRMED';}
    await env.DB.prepare("UPDATE pl3_qa_payment_events SET status=?,attempts=attempts+1,error_code=?,ack_at=CASE WHEN ?='delivered' THEN CURRENT_TIMESTAMP ELSE ack_at END WHERE id=? AND status!='delivered'")
      .bind(status,error,status,row.id).run();
    outcomes.push({event_id:row.id,status,error_code:error});
  }
  return {ok:true,outcomes,status:await qaPaymentStatus(env)};
}
