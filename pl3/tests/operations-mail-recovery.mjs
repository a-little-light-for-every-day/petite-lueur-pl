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
