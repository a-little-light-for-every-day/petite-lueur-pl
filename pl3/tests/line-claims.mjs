import test from 'node:test';
import assert from 'node:assert/strict';
import {createLineClaimHandler,lookupClaimProduct} from '../line-claims.js';

const OWNER='U'+'a'.repeat(32), CUSTOMER='U'+'b'.repeat(32), GROUP='C'+'c'.repeat(32);
const image=(id='12345678901234567')=>({type:'message',source:{type:'group',groupId:GROUP,userId:OWNER},message:{id,type:'image'}});
const text=(body,{userId=CUSTOMER,quote=null,id='ev-20261115-abcdefgh123456'}={})=>({type:'message',source:{type:'group',groupId:GROUP,userId},webhookEventId:id,message:{type:'text',text:body,...(quote?{quotedMessageId:quote}:{})}});
function database() {
 const images=new Set(), bindings=new Map(), intents=new Map();
 const product={id:'SKU-123',group_id:'GROUP-1',name:'官方商品',variant:'A款',price_twd:240,quantity_limit:3,product_status:'available',group_status:'open',published:1,order_deadline:'2099-11-16 22:00'};
 const db={prepare(sql){let args=[]; return {bind(...values){args=values;return this;},async first(){
  if(sql.includes('FROM products p JOIN groups g'))return args[0]==='SKU-123'?{...product}:null;
  if(sql.includes('FROM line_claim_images'))return images.has(args.join('|'))?{image_message_id:args[1]}:null;
  if(sql.includes('FROM line_claim_bindings'))return bindings.get(args.join('|'))?{product_id:bindings.get(args.join('|'))}:null;
  throw Error('unexpected SELECT '+sql);
 },async run(){
  if(sql.startsWith('INSERT OR IGNORE INTO line_claim_images')){images.add(args.join('|'));return {meta:{changes:1}};}
  if(sql.startsWith('INSERT INTO line_claim_bindings')){bindings.set(`${args[0]}|${args[1]}`,args[2]);return {meta:{changes:1}};}
  if(sql.startsWith('INSERT OR IGNORE INTO line_claim_intents')){if(intents.has(args[1]))return {meta:{changes:0}};intents.set(args[1],args);return {meta:{changes:1}};}
  throw Error('unexpected RUN '+sql);
 }};}};
 return {db,product,images,bindings,intents};
}
const create=(f,opts={})=>createLineClaimHandler({db:f.db,ownerId:OWNER,allowedGroupIds:[GROUP],hashSecret:'a private hashing secret 123456',enabled:true,now:()=>Date.parse('2026-11-15T05:00:00Z'),...opts});

 test('ignores all activity until explicitly enabled',async()=>{const f=database(),handle=create(f,{enabled:false});assert.equal(await handle(image()),null);assert.equal(f.images.size,0);});
 test('scope allowlist blocks other groups and unrelated chat commands',async()=>{const f=database(),handle=create(f);const e=image();e.source.groupId='C'+'d'.repeat(32);assert.equal(await handle(e),null);assert.equal(await handle(text('PL開團')),null);});
 test('non-owner cannot bind images',async()=>{const f=database(),handle=create(f);await handle(image());assert.equal(await handle(text('PL綁定 SKU-123',{quote:'12345678901234567'})),null);assert.equal(f.bindings.size,0);});
 test('binding requires previously observed owner photo in same chat',async()=>{const f=database(),handle=create(f);const message=text('PL綁定 SKU-123',{userId:OWNER,quote:'12345678901234567'});assert.match(await handle(message),/找不到/);await handle(image());assert.match(await handle(message),/已綁定/);assert.equal(f.bindings.size,1);});
 test('known image quote registers one pending non-order intent',async()=>{const f=database(),handle=create(f);await handle(image());await handle(text('PL綁定 SKU-123',{userId:OWNER,quote:'12345678901234567'}));const r=await handle(text('+2',{quote:'12345678901234567'}));assert.match(r,/官方商品/);assert.match(r,/NT\$480/);assert.match(r,/未成立訂單/);assert.equal(f.intents.size,1);const row=[...f.intents.values()][0];assert.equal(row[6],2);assert.equal(row[7],240);assert.notEqual(row[4],CUSTOMER);});
 test('webhook delivery redelivery is idempotent',async()=>{const f=database(),handle=create(f);await handle(image());await handle(text('PL綁定 SKU-123',{userId:OWNER,quote:'12345678901234567'}));const e=text('+2',{quote:'12345678901234567'});assert.match(await handle(e),/已暫存/);assert.match(await handle(e),/已登記過/);assert.equal(f.intents.size,1);});
 test('unknown quotes ignored and excessive quantities refused',async()=>{const f=database(),handle=create(f);assert.equal(await handle(text('+2',{quote:'12345678901234567'})),null);await handle(image());await handle(text('PL綁定 SKU-123',{userId:OWNER,quote:'12345678901234567'}));assert.equal(await handle(text('+21',{quote:'12345678901234567'})),null);assert.match(await handle(text('+4',{quote:'12345678901234567'})),/超過/);assert.equal(f.intents.size,0);});
 test('expired group and unpublished product fail closed',async()=>{const f=database();f.product.order_deadline='2026-11-14 22:00';const handle=create(f);assert.equal(await lookupClaimProduct(f.db,'SKU-123',Date.parse('2026-11-15T05:00:00Z')),null);f.product.order_deadline='2099-11-16 22:00';f.product.published=0;assert.equal(await lookupClaimProduct(f.db,'SKU-123',Date.parse('2026-11-15T05:00:00Z')),null);});
 test('direct chat command registers without image; missing user ID denied',async()=>{const f=database(),handle=create(f);const e=text('PL認領 SKU-123 +1');e.source={type:'user',userId:CUSTOMER};assert.match(await handle(e),/已暫存/);assert.equal(f.intents.size,1);});
 test('missing event id and secret cannot create a claim',async()=>{const f=database(),handle=create(f);let e=text('PL認領 SKU-123 +1');e.source={type:'user',userId:CUSTOMER};delete e.webhookEventId;assert.equal(await handle(e),null);assert.equal(f.intents.size,0);const bad=create(f,{hashSecret:''});e.webhookEventId='ev-20261115-abcdefgh123456';await assert.rejects(bad(e),/HASH_SECRET/);assert.equal(f.intents.size,0);});
 test('NT$22,000 cap enforced',async()=>{const f=database();f.product.price_twd=12000;f.product.quantity_limit=null;const handle=create(f);const e=text('PL認領 SKU-123 +2');e.source={type:'user',userId:CUSTOMER};assert.match(await handle(e),/超過 PL 單筆/);assert.equal(f.intents.size,0);});
