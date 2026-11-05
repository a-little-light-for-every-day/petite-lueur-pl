/**
 * PL3 formal receiver — deploy as a SEPARATE Apps Script web app from PL2 and QA.
 * Script Properties (all required): PL3_FORMAL_SYNC_SECRET,
 * PL3_FORMAL_ALLOWED_GROUP_ID, PL3_FORMAL_WRITES_ENABLED ("true"),
 * PL3_FORMAL_SPREADSHEET_ID, PL3_FORMAL_NOTION_DATA_SOURCE_ID, PL3_FORMAL_NOTION_TOKEN.
 * Independent PL3-only Sheet and Notion source are mandatory.
 * Apps Script ContentService returns HTTP 200 for business conflicts; Worker reads
 * {conflict:true} from body and quarantines them instead of retrying/overwriting.
 */
const FORMAL_OLD_SHEET = "1Ts9N_UCnn5YITrT6M3CmliKswB78q6gtoxQR9zNkEPI";
const FORMAL_OLD_NOTION = "8c7c6206-6e5a-4850-aac6-712d261432a5";
const FORMAL_ORDER_HEADERS = ["order_id","group_id","status","amount_twd","item_summary","source_revision","last_event_id","remote_revision"];
const FORMAL_ITEM_HEADERS = ["order_id","item_id","product_id","product_name","variant","quantity","unit_price_twd","fulfillment_status","last_event_id"];
const FORMAL_LEDGER_HEADERS = ["event_id","destination","order_id","remote_id","remote_revision","recorded_at"];
function formalHex_(bytes) {
  return bytes.map(x=>("0"+(x<0?x+256:x).toString(16)).slice(-2)).join("");
}
function formalHash_(str) { return formalHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,str,Utilities.Charset.UTF_8)); }
function formalReply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function formalReject_(message,conflict) {
  return formalReply_({ok:false,conflict:!!conflict,error:String(message).slice(0,120)});
}
function formalSettings_() {
  const v=PropertiesService.getScriptProperties();
  const keys=["PL3_FORMAL_SYNC_SECRET","PL3_FORMAL_ALLOWED_GROUP_ID","PL3_FORMAL_WRITES_ENABLED",
    "PL3_FORMAL_SPREADSHEET_ID","PL3_FORMAL_NOTION_DATA_SOURCE_ID","PL3_FORMAL_NOTION_TOKEN"];
  const p={};
  keys.forEach(k=>p[k]=v.getProperty(k));
  if(keys.some(k=>!p[k])||p.PL3_FORMAL_WRITES_ENABLED!=="true")throw Error("Receiver disabled or missing settings");
  if(!/^PL3-FORMAL-[A-Za-z0-9_-]+$/.test(p.PL3_FORMAL_ALLOWED_GROUP_ID))throw Error("Formal group allowlist invalid");
  if(p.PL3_FORMAL_SPREADSHEET_ID===FORMAL_OLD_SHEET||
     p.PL3_FORMAL_NOTION_DATA_SOURCE_ID.replace(/-/g,"")===FORMAL_OLD_NOTION.replace(/-/g,""))
    throw Error("PL2 destination refused");
  return p;
}
function formalVerify_(raw,secret) {
  if(typeof raw.body!=="string"||typeof raw.signature!=="string"||!/^[0-9a-f]{64}$/.test(raw.signature))
    throw Error("Invalid signed envelope");
  const expected=formalHex_(Utilities.computeHmacSha256Signature(raw.body,secret,Utilities.Charset.UTF_8));
  if(expected.length!==raw.signature.length)throw Error("Signature invalid");
  let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^raw.signature.charCodeAt(i);
  if(diff!==0)throw Error("Signature invalid");
  if(raw.body.length>30000)throw Error("Message too large");
  const v=JSON.parse(raw.body);
  if(!v||!["sheets","notion"].includes(v.destination)||!v.event_id||!v.order_id||
    !v.projection||v.projection.order_id!==v.order_id||v.projection.event_id!==v.event_id||
    v.projection.group_id!==v.group_id||v.event_type!==v.projection.event_type)
    throw Error("Message identity invalid");
  return v;
}
function formalRows_(s) {
  if(s.getLastRow()<=1)return [];
  if(s.getLastRow()>5001)throw Error("Manual review: sheet row limit");
  return s.getRange(2,1,s.getLastRow()-1,s.getLastColumn()).getValues().map((values,i)=>({row:i+2,values}));
}
function formalTab_(book,name,header) {
  let sheet=book.getSheetByName(name);
  if(!sheet)sheet=book.insertSheet(name);
  if(sheet.getLastRow()===0)sheet.getRange(1,1,1,header.length).setValues([header]);
  const current=sheet.getRange(1,1,1,header.length).getValues()[0];
  if(JSON.stringify(current)!==JSON.stringify(header))throw Error("Sheet header changed: "+name);
  return sheet;
}
function formalBook_(p) {
  const book=SpreadsheetApp.openById(p.PL3_FORMAL_SPREADSHEET_ID);
  return {
    book,orders:formalTab_(book,"PL3 Orders",FORMAL_ORDER_HEADERS),
    items:formalTab_(book,"PL3 Items",FORMAL_ITEM_HEADERS),
    ledger:formalTab_(book,"PL3 Sync Ledger",FORMAL_LEDGER_HEADERS)
  };
}
function formalLedger_(sheet,eventId,destination) {
  const matches=formalRows_(sheet).filter(r=>r.values[0]===eventId&&r.values[1]===destination);
  if(matches.length>1)throw Error("Duplicate event ledger");
  return matches[0]||null;
}
function formalSafeText_(x) {
  const s=String(x??"");
  if(/^[=+\-@\t\r]/.test(s))throw Error("Spreadsheet formula-like text rejected");
  return s;
}
function formalSheetShape_(p) {
  const s=p.sheet;if(!s||!s.order||!Array.isArray(s.items)||s.items.length<1||s.items.length>50)throw Error("Invalid sheet projection");
  const o=s.order.cells;
  if(s.order.key!==p.order_id||o.A!==p.order_id||o.F!==p.amount_twd)throw Error("Sheet order identity mismatch");
  const order=[p.order_id,p.group_id,formalSafeText_(o.D),p.amount_twd,formalSafeText_(o.I),formalSafeText_(p.source_revision),p.event_id,""];
  const items=s.items.map(i=>{
    const c=i.cells;if(!i.item_id||c.I!==p.order_id||!Number.isInteger(c.C)||!Number.isInteger(c.D))throw Error("Invalid sheet item");
    return [p.order_id,i.item_id,formalSafeText_(c.B),formalSafeText_(c.A),formalSafeText_(c.E),c.C,c.D,formalSafeText_(c.F),p.event_id];
  }).sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
  if(new Set(items.map(x=>x[1])).size!==items.length)throw Error("Duplicate item id");
  if(items.reduce((sum,x)=>sum+x[5]*x[6],0)!==p.amount_twd)throw Error("Amount mismatch");
  return {order,items};
}
function formalSheetRevision_(order,items) {
  return formalHash_(JSON.stringify({order:order.slice(0,6),items:items.map(x=>x.slice(0,8)).sort((a,b)=>String(a[1]).localeCompare(String(b[1])))}));
}
function formalSheets_(v,p) {
  const tabs=formalBook_(p),shape=formalSheetShape_(v.projection);
  const previous=formalLedger_(tabs.ledger,v.event_id,"sheets");
  const allOrders=formalRows_(tabs.orders);
  const matched=allOrders.filter(x=>x.values[0]===v.order_id);
  if(matched.length>1)throw Error("Duplicate order rows");
  const current=matched[0]||null;
  const currentItems=formalRows_(tabs.items).filter(x=>x.values[0]===v.order_id);
  const actualRevision=current?formalSheetRevision_(current.values,currentItems.map(x=>x.values)):null;
  const revision=formalSheetRevision_(shape.order,shape.items);
  const expected=v.expected_remote_revision||null;
  if(previous) {
    if(previous.values[2]!==v.order_id||!current||previous.values[4]!==actualRevision||current.values[6]!==v.event_id)
      return {ok:false,conflict:true,error:"Ledger or sheet changed after acknowledgement"};
    return {ok:true,ack_event_id:v.event_id,destination:"sheets",remote_id:v.order_id,remote_revision:actualRevision};
  }
  // If Sheets committed both records but appending the event ledger failed,
  // recover only when every managed cell and event marker matches exactly.
  // A partially written or manually edited record must still be quarantined.
  if(current&&current.values[6]===v.event_id) {
    const sameItems=currentItems.length===shape.items.length&&currentItems.every(row=>
      row.values[8]===v.event_id&&shape.items.some(item=>item[1]===row.values[1]));
    if(actualRevision!==revision||current.values[7]!==revision||!sameItems)
      return {ok:false,conflict:true,error:"Incomplete or edited event write"};
    tabs.ledger.appendRow([v.event_id,"sheets",v.order_id,v.order_id,revision,new Date().toISOString()]);
    SpreadsheetApp.flush();
    return {ok:true,ack_event_id:v.event_id,destination:"sheets",remote_id:v.order_id,remote_revision:revision};
  }
  if(current) {
    if(v.expected_remote_id!==v.order_id||!expected||actualRevision!==expected)
      return {ok:false,conflict:true,error:"Spreadsheet revision mismatch"};
    const existingIds=currentItems.map(x=>x.values[1]);
    if(existingIds.length!==shape.items.length||existingIds.some(id=>!shape.items.some(x=>x[1]===id)))
      return {ok:false,conflict:true,error:"Item identities changed"};
  }else if(v.expected_remote_id||expected||currentItems.length) {
    return {ok:false,conflict:true,error:"Missing spreadsheet order or orphaned items"};
  }
  shape.order[7]=revision;
  if(current)tabs.orders.getRange(current.row,1,1,shape.order.length).setValues([shape.order]);
  else tabs.orders.appendRow(shape.order);
  for(const item of shape.items) {
    const old=currentItems.find(x=>x.values[1]===item[1]);
    if(old)tabs.items.getRange(old.row,1,1,item.length).setValues([item]);
    else tabs.items.appendRow(item);
  }
  SpreadsheetApp.flush();
  tabs.ledger.appendRow([v.event_id,"sheets",v.order_id,v.order_id,revision,new Date().toISOString()]);
  SpreadsheetApp.flush();
  return {ok:true,ack_event_id:v.event_id,destination:"sheets",remote_id:v.order_id,remote_revision:revision};
}
function formalNotionCall_(p,method,path,payload) {
  const response=UrlFetchApp.fetch("https://api.notion.com/v1"+path,{
    method,contentType:"application/json",
    headers:{Authorization:"Bearer "+p.PL3_FORMAL_NOTION_TOKEN,"Notion-Version":"2025-09-03"},
    payload:payload===undefined?undefined:JSON.stringify(payload),muteHttpExceptions:true
  });
  const status=response.getResponseCode();
  let parsed={};try{parsed=JSON.parse(response.getContentText());}catch(_){}
  if(status===409||status===412)return {conflict:true};
  if(status<200||status>=300)throw Error("Notion API HTTP "+status);
  return parsed;
}
function formalRich_(text) {return {rich_text:[{type:"text",text:{content:String(text).slice(0,1800)}}]};}
function formalNotionProperties_(projection,eventId) {
  const values=projection.notion.properties;
  if(!values||values["訂單編號"]!==projection.order_id||values["網站訂單識別碼"]!==projection.order_id)
    throw Error("Notion identity mismatch");
  return {
    "訂單編號":{title:[{type:"text",text:{content:projection.order_id}}]},
    "網站訂單識別碼":formalRich_(projection.order_id),
    "商品款":{number:projection.amount_twd},
    "商品明細":formalRich_(values["商品明細"]),
    "狀態":{select:{name:String(values["狀態"])}},
    "PL3 同步事件":formalRich_(eventId)
  };
}
function formalNotionEvent_(page) {
  const rich=page.properties&&page.properties["PL3 同步事件"]&&page.properties["PL3 同步事件"].rich_text;
  return (rich||[]).map(x=>x.plain_text||x.text&&x.text.content||"").join("");
}
function formalNotionMatches_(page,projection) {
  const p=page.properties||{};
  const plain=(xs)=>(xs||[]).map(x=>x.plain_text||x.text&&x.text.content||"").join("");
  return plain(p["訂單編號"]&&p["訂單編號"].title)===projection.order_id &&
    plain(p["網站訂單識別碼"]&&p["網站訂單識別碼"].rich_text)===projection.order_id &&
    Number(p["商品款"]&&p["商品款"].number)===projection.amount_twd &&
    plain(p["商品明細"]&&p["商品明細"].rich_text)===String(projection.notion.properties["商品明細"]) &&
    p["狀態"]&&p["狀態"].select&&p["狀態"].select.name===projection.notion.properties["狀態"];
}
function formalNotion_(v,p) {
  const ds=p.PL3_FORMAL_NOTION_DATA_SOURCE_ID;
  const query=formalNotionCall_(p,"post","/data_sources/"+encodeURIComponent(ds)+"/query",{
    filter:{property:"網站訂單識別碼",rich_text:{equals:v.order_id}},page_size:2
  });
  if(query.conflict)return {ok:false,conflict:true,error:"Notion query conflict"};
  if(!Array.isArray(query.results)||query.results.length>1)throw Error("Notion duplicate or query invalid");
  const current=query.results[0]||null;
  if(current&&formalNotionEvent_(current)===v.event_id) {
    if((v.expected_remote_id&&v.expected_remote_id!==current.id)||!formalNotionMatches_(current,v.projection))
      return {ok:false,conflict:true,error:"Notion content changed after event"};
    return {ok:true,ack_event_id:v.event_id,destination:"notion",remote_id:current.id,remote_revision:current.last_edited_time};
  }
  if(current) {
    if(current.id!==v.expected_remote_id||current.last_edited_time!==v.expected_remote_revision)
      return {ok:false,conflict:true,error:"Notion page changed; owner review required"};
  }else if(v.expected_remote_id||v.expected_remote_revision)
    return {ok:false,conflict:true,error:"Notion page missing"};
  const properties=formalNotionProperties_(v.projection,v.event_id);
  const res=current?
    formalNotionCall_(p,"patch","/pages/"+encodeURIComponent(current.id),{properties}):
    formalNotionCall_(p,"post","/pages",{parent:{type:"data_source_id",data_source_id:ds},properties});
  if(res.conflict)return {ok:false,conflict:true,error:"Notion concurrent edit"};
  if(!res.id||!res.last_edited_time)throw Error("Notion acknowledgement invalid");
  return {ok:true,ack_event_id:v.event_id,destination:"notion",remote_id:res.id,remote_revision:res.last_edited_time};
}
function doPost(e) {
  try {
    if(e&&e.postData&&e.postData.contents.length<=240000){const envelope=JSON.parse(e.postData.contents);if(typeof envelope.body==='string'&&JSON.parse(envelope.body).protocol==='pl3-operations-v1')return operationsDoPost_(envelope);}

    const p=formalSettings_();
    if(!e||!e.postData||e.postData.contents.length>40000)throw Error("Malformed POST");
    const v=formalVerify_(JSON.parse(e.postData.contents),p.PL3_FORMAL_SYNC_SECRET);
    if(v.group_id!==p.PL3_FORMAL_ALLOWED_GROUP_ID||v.projection.schema_version!==1)
      return formalReject_("Cohort or schema not allowed",true);
    const lock=LockService.getScriptLock();
    if(!lock.tryLock(20000))throw Error("Receiver busy");
    try {
      return formalReply_(v.destination==="sheets"?formalSheets_(v,p):formalNotion_(v,p));
    }finally {lock.releaseLock();}
  }catch(err) {
    // Do not leak token, event payload or PII to callers.
    console.error("PL3 formal receiver failure",String(err&&err.message||"error").slice(0,100));
    const reply={ok:false,conflict:false,error:"Receiver temporarily unavailable",error_code:formalErrorCode_(err)};
    return formalReply_(reply);
  }
}

function formalErrorCode_(err) {
  const message=String(err&&err.message||"");
  if(/Signature invalid|Invalid signed envelope/.test(message))return "SIGNATURE_INVALID";
  if(/settings|disabled|allowlist/.test(message))return "CONFIGURATION_INVALID";
  if(/permission|access|權限/i.test(message))return "DESTINATION_ACCESS_DENIED";
  if(/Notion API HTTP (401|403|404)/.test(message))return "NOTION_ACCESS_DENIED";
  if(/Notion API HTTP 400/.test(message))return "NOTION_SCHEMA_INVALID";
  if(/Notion API HTTP 429|busy/.test(message))return "DESTINATION_BUSY";
  return "RECEIVER_UNAVAILABLE";
}

// Owner-run diagnostics only: never log credentials, customer rows, or payloads.
function formalSelfCheck() {
  const p=formalSettings_();
  const probe="PL3 sync public probe 測試";
  const expected="875dd17ff78c9903831072b25880f02d54997ffa534555117a5610ce6ffb3153";
  const result={settings:true,spreadsheet:false,notion:false,
    utf8_hmac:formalHex_(Utilities.computeHmacSha256Signature(probe,"pl3-public-test-key",Utilities.Charset.UTF_8))===expected,
    default_hmac:formalHex_(Utilities.computeHmacSha256Signature(probe,"pl3-public-test-key"))===expected};
  SpreadsheetApp.openById(p.PL3_FORMAL_SPREADSHEET_ID).getSheets();
  result.spreadsheet=true;
  const data=formalNotionCall_(p,"get","/data_sources/"+encodeURIComponent(p.PL3_FORMAL_NOTION_DATA_SOURCE_ID));
  result.notion=!!data.id;
  console.log(JSON.stringify(result));
  return result;
}
