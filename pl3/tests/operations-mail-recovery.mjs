import test from 'node:test';
import assert from 'node:assert/strict';
import {operationsMailMessageId,sendOperationsMail} from '../operations-mail.js';

const key='mail-claim:stable-key-001';
const env={GMAIL_SENDER:'petitelueur.pl@gmail.com',GMAIL_CLIENT_ID:'test',GMAIL_CLIENT_SECRET:'test',GMAIL_REFRESH_TOKEN:'test',DB:{prepare(){throw Error('No attachments expected')}}};
const notice={to:'customer@example.com',subject:'付款通知',body:'測試',attachments:[]};
const mock=(send)=>async(url,options)=>url.includes('oauth2.googleapis.com')?new Response(JSON.stringify({access_token:'test-token'}),{status:200}):send(url,options);

test('stable RFC Message-ID is deterministic and included in outbound MIME',async()=>{
 const id=await operationsMailMessageId(key);
 assert.match(id,/^plops\.[0-9a-f]{64}@petitelueur-pl\.workers\.dev$/);
 assert.equal(id,await operationsMailMessageId(key));
 const sent=await sendOperationsMail(env,notice,key,mock(async(_url,options)=>{
  const base=options.body&&JSON.parse(options.body).raw;
  const raw=atob(base.replace(/-/g,'+').replace(/_/g,'/'));
  assert.ok(raw.includes('Message-ID: <'+id+'>'));
  return new Response(JSON.stringify({id:'gmail-id',threadId:'thread-id'}),{status:200});
 }));
 assert.equal(sent.id,'gmail-id');
});

test('unknown acknowledgement preserves diagnostic reasons and never claims a definite failure',async()=>{
 const cases=[
  ['GMAIL_ACK_TRANSPORT_EXCEPTION',async()=>{throw Error('network')}],
  ['GMAIL_ACK_TIMEOUT_OR_ABORT',async()=>{throw Object.assign(Error('timeout'),{name:'TimeoutError'})}],
  ['GMAIL_ACK_MISSING_MESSAGE_ID',async()=>new Response('{}',{status:200})],
  ['GMAIL_ACK_MALFORMED_JSON',async()=>new Response('not JSON',{status:200})],
  ['GMAIL_PROVIDER_HTTP_5XX_UNCERTAIN',async()=>new Response('{}',{status:503})]
 ];
 for(const [code,send] of cases){
  await assert.rejects(sendOperationsMail(env,notice,key,mock(send)),e=>e.code===code&&e.definite===false,code);
 }
});

test('pre-send OAuth errors and definite Gmail rejections remain distinct',async()=>{
 await assert.rejects(sendOperationsMail(env,notice,key,async()=>new Response('{}',{status:401})),e=>e.code==='GMAIL_AUTH_RECONNECT_REQUIRED'&&e.definite===true);
 await assert.rejects(sendOperationsMail(env,notice,key,mock(async()=>new Response('{}',{status:403}))),e=>e.code==='GMAIL_PERMISSION_DENIED'&&e.definite===true);
});

test('notice formatting preserves URLs and approved text in both MIME alternatives with attachments', async()=>{
 const {noticePlainText}=await import('../notice-format.js');
 const text=noticePlainText('## 商品明細\r\n- **PL-261113-01** ×2 · NT$170\r\n\r\n[查單](https://example.com/a?sku=A_B#part)\r\n<確認>');
 assert.equal(text,'商品明細\n・PL-261113-01 ×2 · NT$170\n\n查單：https://example.com/a?sku=A_B#part\n<確認>');
 let mime;
 const file={name:'下單證明.txt',mime_type:'text/plain',base64_data:'dGVzdA==',sha256:'proof'};
 const db={prepare:()=>({bind:()=>({first:async()=>file})})};
 await sendOperationsMail({...env,DB:db},{...notice,body:text,attachments:[{id:'a',sha256:'proof'}]},'format',mock(async(_url,options)=>{
  mime=Buffer.from(JSON.parse(options.body).raw,'base64url').toString();
  return new Response(JSON.stringify({id:'test-message'}));
 }));
 assert.match(mime,/multipart\/mixed/);
 assert.match(mime,/multipart\/alternative/);
 const decoded=Array.from(mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]+?)\r\n--/g),m=>Buffer.from(m[1],'base64').toString());
 assert.equal(decoded[0],text);
 assert.match(decoded[1],/&lt;確認&gt;/);
 assert.match(mime,/Content-Disposition: attachment/);
 assert.match(mime,/dGVzdA==/);
});
