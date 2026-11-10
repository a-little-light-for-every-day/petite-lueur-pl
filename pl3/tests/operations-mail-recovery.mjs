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

test('unknown acknowledgement stays ambiguous on transport error or missing Gmail ID',async()=>{
 for(const send of [async()=>{throw Error('network')},async()=>new Response('{}',{status:200})]){
  await assert.rejects(sendOperationsMail(env,notice,key,mock(send)),e=>e.code==='GMAIL_ACKNOWLEDGEMENT_UNKNOWN'&&e.definite===false);
 }
});
