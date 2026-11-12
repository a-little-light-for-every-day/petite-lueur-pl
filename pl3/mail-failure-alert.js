// A failed Gmail transport cannot be used as the alert channel.
// PL_LINE_ALERT is a Cloudflare service binding to the LINE webhook Worker.
// PL_MAIL_ALERT_SECRET is a shared secret, never sent to customers or logged.
export async function reportMailFailure(env,source,errorCode) {
  const code=String(errorCode||"MAIL_FAILURE").replace(/[^A-Z0-9_]/g,"_").slice(0,64);
  console.error("PL3 mail delivery failure",String(source||"mail"),code);
  if(!env.PL_LINE_ALERT||!env.PL_MAIL_ALERT_SECRET||!env.DB){
    console.error("PL3 mail alert channel not configured");
    return false;
  }
  const hour=new Date(Math.floor(Date.now()/3600000)*3600000).toISOString();
  const key="system:mail-delivery-alert";
  const purpose="mail_alert";
  let claimed=false;
  try {
    // One outbound alert per hour, even when many customers request codes.
    const row=await env.DB.prepare(
      "INSERT INTO email_rate_limits(email,purpose,window_start,count) VALUES(?,?,?,1) ON CONFLICT(email,purpose,window_start) DO UPDATE SET count=count+1 RETURNING count"
    ).bind(key,purpose,hour).first();
    claimed=Number(row?.count)===1;
    if(!claimed)return false;
    const resp=await env.PL_LINE_ALERT.fetch(new Request("https://pl-line-webhook/internal/mail-failure-alert",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+env.PL_MAIL_ALERT_SECRET},
      body:JSON.stringify({source:String(source||"mail").slice(0,40),code,at:new Date().toISOString()})
    }));
    if(!resp.ok)throw new Error("LINE_ALERT_HTTP_"+resp.status);
    return true;
  }catch(error){
    console.error("PL3 mail alert dispatch failed",String(error?.message||"unknown").slice(0,80));
    // Failed push should not suppress an alert during the next customer failure.
    if(claimed)try{
      await env.DB.prepare("DELETE FROM email_rate_limits WHERE email=? AND purpose=? AND window_start=? AND count=1").bind(key,purpose,hour).run();
    }catch{}
    return false;
  }
}
