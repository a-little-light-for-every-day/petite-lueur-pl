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
