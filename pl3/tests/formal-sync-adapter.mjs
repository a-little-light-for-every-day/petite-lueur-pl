import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac, createHash } from "node:crypto";
import vm from "node:vm";
const code=readFileSync(new URL("../formal-sync-adapter.gs",import.meta.url),"utf8");
function isolated(properties={}){
 const context=vm.createContext({
   PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties[k]||null})},
   Utilities:{
     Charset:{UTF_8:"utf8"},DigestAlgorithm:{SHA_256:"sha256"},
     computeHmacSha256Signature:(str,key)=>[...createHmac("sha256",key).update(str).digest()].map(x=>x>127?x-256:x),
     computeDigest:(_method,str)=>[...createHash("sha256").update(str).digest()].map(x=>x>127?x-256:x)
   }
 });
 vm.runInContext(code,context,{filename:"formal-sync-adapter.gs"});
 return context;
}
const group="PL3-FORMAL-LOCAL";
const settings={
 PL3_FORMAL_SYNC_SECRET:"test-secret",PL3_FORMAL_ALLOWED_GROUP_ID:group,
 PL3_FORMAL_WRITES_ENABLED:"true",PL3_FORMAL_SPREADSHEET_ID:"private-formal-test-workbook",
 PL3_FORMAL_NOTION_DATA_SOURCE_ID:"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
 PL3_FORMAL_NOTION_TOKEN:"test-not-real"
};
test("formal receiver is locked without explicit property and refuses PL2 destinations",()=>{
 assert.throws(()=>isolated({...settings,PL3_FORMAL_WRITES_ENABLED:"false"}).formalSettings_(),/disabled/);
 assert.throws(()=>isolated({...settings,PL3_FORMAL_SPREADSHEET_ID:"1Ts9N_UCnn5YITrT6M3CmliKswB78q6gtoxQR9zNkEPI"}).formalSettings_(),/PL2/);
 assert.throws(()=>isolated({...settings,PL3_FORMAL_NOTION_DATA_SOURCE_ID:"8c7c6206-6e5a-4850-aac6-712d261432a5"}).formalSettings_(),/PL2/);
});
test("unsigned or tampered envelopes never reach target code",()=>{
 const c=isolated(settings);
 const content=JSON.stringify({event_id:"e1",destination:"sheets",group_id:group,order_id:"o1",event_type:"order.created",
   projection:{event_id:"e1",group_id:group,order_id:"o1",event_type:"order.created"}});
 const signature=createHmac("sha256",settings.PL3_FORMAL_SYNC_SECRET).update(content).digest("hex");
 assert.equal(c.formalVerify_({body:content,signature},settings.PL3_FORMAL_SYNC_SECRET).event_id,"e1");
 assert.throws(()=>c.formalVerify_({body:content+" ",signature},settings.PL3_FORMAL_SYNC_SECRET),/Signature/);
 assert.throws(()=>c.formalVerify_({body:content,signature:"0".repeat(64)},settings.PL3_FORMAL_SYNC_SECRET),/Signature/);
});
test("formal receiver avoids spreadsheet formula injection and checks line sums",()=>{
 const c=isolated(settings);
 const base={order_id:"o1",group_id:group,event_id:"e1",source_revision:"r1",amount_twd:350,
 sheet:{order:{key:"o1",cells:{A:"o1",D:"訂購申請待確認",F:350,I:"商品 × 1"}},
  items:[{item_id:"i1",cells:{A:"商品",B:"SKU",C:1,D:350,E:"",F:"待處理",I:"o1"}}]}};
 const shape=c.formalSheetShape_(base);
 assert.equal(shape.items[0][5]*shape.items[0][6],350);
 assert.match(c.formalSheetRevision_(shape.order,shape.items),/^[0-9a-f]{64}$/);
 base.sheet.items[0].cells.A="=IMPORTXML(\"a\",\"b\")";
 assert.throws(()=>c.formalSheetShape_(base),/formula-like/);
});
function fakeWorkbook(){
 const sheets=new Map();
 const create=name=>{
  const sheet={rows:[],failNextAppend:false,
   getLastRow(){return this.rows.length;},
   getLastColumn(){return Math.max(1,...this.rows.map(row=>row.length));},
   getRange(row,col,height,width){return {
    getValues:()=>Array.from({length:height},(_,r)=>Array.from({length:width},(_,i)=>sheet.rows[row+r-1]?.[col+i-1]??"")),
    setValues:values=>{for(let r=0;r<values.length;r++){
     const target=sheet.rows[row+r-1]||[];
     for(let i=0;i<values[r].length;i++)target[col+i-1]=values[r][i];
     sheet.rows[row+r-1]=target;
    }}
   };},
   appendRow(values){if(this.failNextAppend){this.failNextAppend=false;throw Error("Simulated ledger outage");}this.rows.push([...values]);}
  };sheets.set(name,sheet);return sheet;
 };
 return {sheets,book:{getSheetByName:name=>sheets.get(name)||null,insertSheet:create}};
}
function sheetEnvelope(eventId="event-1",fulfillment="待處理"){
 return {event_id:eventId,destination:"sheets",order_id:"o1",group_id:group,
  expected_remote_id:null,expected_remote_revision:null,
  projection:{order_id:"o1",group_id:group,event_id:eventId,source_revision:"2026-11-01T00:00:00Z",amount_twd:350,
   sheet:{order:{key:"o1",cells:{A:"o1",D:"訂購申請待確認",F:350,I:"商品 × 1"}},
    items:[{item_id:"i1",cells:{A:"商品",B:"sku1",C:1,D:350,E:"",F:fulfillment,I:"o1"}}]}}
 };
}
test("receiver replays an acknowledged event without duplicating rows",()=>{
 const c=isolated(settings),fixture=fakeWorkbook();
 c.SpreadsheetApp={openById:()=>fixture.book,flush:()=>{}};
 const envelope=sheetEnvelope();
 const first=c.formalSheets_(envelope,settings);
 const second=c.formalSheets_(envelope,settings);
 assert.equal(first.remote_revision,second.remote_revision);
 assert.equal(fixture.sheets.get("PL3 Orders").rows.length,2);
 assert.equal(fixture.sheets.get("PL3 Items").rows.length,2);
 assert.equal(fixture.sheets.get("PL3 Sync Ledger").rows.length,2);
});
test("receiver recovers ledger append outage only if sheet cells match exactly",()=>{
 const c=isolated(settings),fixture=fakeWorkbook();
 c.SpreadsheetApp={openById:()=>fixture.book,flush:()=>{}};
 const envelope=sheetEnvelope();
 c.formalBook_(settings).ledger.failNextAppend=true;
 assert.throws(()=>c.formalSheets_(envelope,settings),/Simulated ledger outage/);
 assert.equal(fixture.sheets.get("PL3 Orders").rows.length,2);
 assert.equal(fixture.sheets.get("PL3 Items").rows.length,2);
 assert.equal(fixture.sheets.get("PL3 Sync Ledger").rows.length,1);
 const recovered=c.formalSheets_(envelope,settings);
 assert.equal(recovered.ok,true);
 assert.equal(fixture.sheets.get("PL3 Sync Ledger").rows.length,2);
 assert.equal(c.formalSheets_(envelope,settings).remote_revision,recovered.remote_revision);
 assert.equal(fixture.sheets.get("PL3 Orders").rows.length,2);
 assert.equal(fixture.sheets.get("PL3 Items").rows.length,2);
});
test("receiver quarantines an edited partial write instead of overwriting",()=>{
 const c=isolated(settings),fixture=fakeWorkbook();
 c.SpreadsheetApp={openById:()=>fixture.book,flush:()=>{}};
 const envelope=sheetEnvelope();
 c.formalBook_(settings).ledger.failNextAppend=true;
 assert.throws(()=>c.formalSheets_(envelope,settings),/Simulated ledger outage/);
 fixture.sheets.get("PL3 Orders").rows[1][3]=999;
 const result=c.formalSheets_(envelope,settings);
 assert.equal(result.conflict,true);
 assert.equal(fixture.sheets.get("PL3 Orders").rows[1][3],999);
 assert.equal(fixture.sheets.get("PL3 Sync Ledger").rows.length,1);
});
function fakeNotion(){
 const state={page:null,creates:0,patches:0,loseFirstAck:false};
 const response=data=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(data)});
 const client={fetch(url,opt){
  const payload=JSON.parse(opt.payload||"{}");
  if(url.includes("/data_sources/")&&url.endsWith("/query"))
   return response({results:state.page&&state.page.properties["網站訂單識別碼"].rich_text[0].text.content===payload.filter.rich_text.equals?[state.page]:[]});
  if(url.endsWith("/pages")&&opt.method==="post"){
   state.creates++;
   state.page={id:"notion-page-1",last_edited_time:"2026-11-01T01:00:00Z",properties:payload.properties};
   if(state.loseFirstAck){state.loseFirstAck=false;throw Error("Simulated Notion acknowledgement timeout");}
   return response(state.page);
  }
  if(url.includes("/pages/")&&opt.method==="patch"){
   state.patches++;state.page.properties=payload.properties;
   state.page.last_edited_time="2026-11-01T02:00:00Z";
   return response(state.page);
  }
  throw Error("Unexpected Notion request: "+url);
 }};
 return {state,client};
}
function notionEnvelope(eventId="event-1"){
 return {event_id:eventId,destination:"notion",order_id:"o1",group_id:group,
  expected_remote_id:null,expected_remote_revision:null,
  projection:{order_id:"o1",group_id:group,event_id:eventId,amount_twd:350,
   notion:{properties:{"訂單編號":"o1","網站訂單識別碼":"o1","商品款":350,"商品明細":"商品 × 1","狀態":"訂購申請待確認"}}}
 };
}
test("Notion receiver replay returns the same page without creating a duplicate",()=>{
 const c=isolated(settings),fixture=fakeNotion();c.UrlFetchApp=fixture.client;
 const envelope=notionEnvelope();
 const first=c.formalNotion_(envelope,settings);
 const replay=c.formalNotion_(envelope,settings);
 assert.equal(first.remote_id,replay.remote_id);
 assert.equal(fixture.state.creates,1);
 assert.equal(fixture.state.patches,0);
});
test("Notion receiver recovers a lost create acknowledgement without a duplicate",()=>{
 const c=isolated(settings),fixture=fakeNotion();c.UrlFetchApp=fixture.client;
 fixture.state.loseFirstAck=true;
 const envelope=notionEnvelope();
 assert.throws(()=>c.formalNotion_(envelope,settings),/acknowledgement timeout/);
 const retried=c.formalNotion_(envelope,settings);
 assert.equal(retried.remote_id,"notion-page-1");
 assert.equal(fixture.state.creates,1);
});
test("Notion receiver rejects replay when a page was edited after a lost acknowledgement",()=>{
 const c=isolated(settings),fixture=fakeNotion();c.UrlFetchApp=fixture.client;
 fixture.state.loseFirstAck=true;
 const envelope=notionEnvelope();
 assert.throws(()=>c.formalNotion_(envelope,settings),/acknowledgement timeout/);
 fixture.state.page.properties["商品款"].number=999;
 const retried=c.formalNotion_(envelope,settings);
 assert.equal(retried.conflict,true);
 assert.equal(fixture.state.creates,1);
 assert.equal(fixture.state.patches,0);
});
