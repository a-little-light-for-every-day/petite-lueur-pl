const enc=new TextEncoder();const base64=s=>btoa(String.fromCharCode(...enc.encode(s)));const url64=s=>base64(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const mailError=(code,definite)=>Object.assign(new Error(code),{code,definite});
// Stable RFC Message-ID: an operator can search Gmail Sent manually even if
// the send API acknowledgement was lost. This does not require Gmail read scope.
export async function operationsMailMessageId(key){
 const digest=await crypto.subtle.digest('SHA-256',enc.encode(key));
 const hex=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
 return `plops.${hex}@petitelueur-pl.workers.dev`;
}
export async function gmailAccess(env,fetcher=fetch){
 if(!env.GMAIL_CLIENT_ID||!env.GMAIL_CLIENT_SECRET||!env.GMAIL_REFRESH_TOKEN)throw mailError('GMAIL_CONFIGURATION_MISSING',true);
 let r;try{r=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GMAIL_CLIENT_ID,client_secret:env.GMAIL_CLIENT_SECRET,refresh_token:env.GMAIL_REFRESH_TOKEN,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});}catch{throw mailError('GMAIL_AUTH_UNAVAILABLE',true);}
 if(!r.ok)throw mailError('GMAIL_AUTH_RECONNECT_REQUIRED',true);const token=await r.json();if(!token.access_token)throw mailError('GMAIL_AUTH_RECONNECT_REQUIRED',true);return token.access_token;
}
export async function sendOperationsMail(env,n,key,fetcher=fetch){
 if(env.GMAIL_SENDER!=='petitelueur.pl@gmail.com')throw mailError('OFFICIAL_SENDER_REQUIRED',true);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n.to)||/[\r\n]/.test(n.to+n.subject))throw mailError('INVALID_RECIPIENT',true);
 const files=[];for(const f of n.attachments||[]){const stored=await env.DB.prepare('SELECT name,mime_type,base64_data,sha256 FROM pl_ops_attachments WHERE id=?').bind(f.id).first();if(!stored||stored.sha256!==f.sha256)throw mailError('ATTACHMENT_CHANGED',true);files.push(stored);}
 const token=await gmailAccess(env,fetcher);
 const msgid=await operationsMailMessageId(key);
 const headers=['From: Petite Lueur PL <'+env.GMAIL_SENDER+'>','To: '+n.to,'Message-ID: <'+msgid+'>','Subject: =?UTF-8?B?'+base64(n.subject)+'?=','MIME-Version: 1.0'];
 const textPart=['Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',base64(n.body).match(/.{1,76}/g).join('\r\n')].join('\r\n');
 const boundary='plops_'+msgid.slice('plops.'.length,msgid.indexOf('@'));
 const parts=[textPart,...files.map(f=>['Content-Type: '+f.mime_type,'Content-Transfer-Encoding: base64',"Content-Disposition: attachment; filename*=UTF-8''"+encodeURIComponent(f.name),'',f.base64_data.match(/.{1,76}/g).join('\r\n')].join('\r\n'))];
 const raw=files.length?headers.concat(['Content-Type: multipart/mixed; boundary="'+boundary+'"','','--'+boundary,parts.join('\r\n--'+boundary+'\r\n'),'--'+boundary+'--']).join('\r\n'):headers.concat([textPart]).join('\r\n');
 let r;try{r=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({raw:url64(raw)}),signal:AbortSignal.timeout(25000)});}catch(e){console.error('PL3 Gmail send acknowledgement missing',e?.name==='TimeoutError'||e?.name==='AbortError'?'timeout_or_abort':'transport_exception');throw mailError('GMAIL_ACKNOWLEDGEMENT_UNKNOWN',false);}
 if(!r.ok)throw mailError(r.status===403?'GMAIL_PERMISSION_DENIED':'GMAIL_SEND_REJECTED',r.status>=400&&r.status<500);
 let sent;try{sent=await r.json();}catch{console.error('PL3 Gmail send acknowledgement malformed_json',r.status);throw mailError('GMAIL_ACKNOWLEDGEMENT_UNKNOWN',false);}
 if(!sent?.id){console.error('PL3 Gmail send acknowledgement missing_message_id',r.status);throw mailError('GMAIL_ACKNOWLEDGEMENT_UNKNOWN',false);}return sent;
}
