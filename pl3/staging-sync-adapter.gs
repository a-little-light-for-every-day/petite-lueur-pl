/**
 * PL3 isolated QA sync receiver (standalone Apps Script, NOT PL2).
 *
 * Script Properties (never source code):
 * PL3_SYNC_WEBHOOK_SECRET   same random secret as Cloudflare Worker
 * PL3_QA_SPREADSHEET_ID     new, dedicated QA Google spreadsheet
 * PL3_QA_NOTION_PAGE_ID    new, dedicated QA parent Notion page
 * PL3_QA_NOTION_TOKEN      Notion integration token, granted ONLY QA parent
 *
 * Deploy as Web app: execute as owner, access Anyone. Requests are signed HMAC.
 * No get endpoint, no test customer messages, no PL2 mutation.
 */
const PL3_QA_PREFIX = 'PL3-QA-';
const PL3_QA_TAB = 'PL3 Sync QA Events';
const PL3_NOTION_API = 'https://api.notion.com/v1';

function doPost(e) {
  try {
    const raw = String((e && e.postData && e.postData.contents) || '');
    if (!raw || raw.length > 32000) throw new Error('Invalid request');
    const outer = JSON.parse(raw);
    const body = String(outer.body || '');
    const supplied = String(outer.signature || '');
    const props = PropertiesService.getScriptProperties();
    const secret = props.getProperty('PL3_SYNC_WEBHOOK_SECRET');
    if (!secret || !/^[a-f0-9]{64}$/.test(supplied)) throw new Error('Unauthorized');
    const expected = pl3HmacHex_(secret, body);
    if (!pl3SafeEqual_(supplied, expected)) throw new Error('Unauthorized');
    const event = JSON.parse(body);
    const safe = pl3Validate_(event);
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('Sync busy; retry later');
    try {
      const sheet = pl3QaSheet_(props.getProperty('PL3_QA_SPREADSHEET_ID'));
      const eventId = safe.event_id;
      // Every event uses the SAME event ID for both destinations.
      const isInSheet = pl3SheetHasEvent_(sheet, eventId);
      if (!isInSheet) {
        sheet.appendRow([eventId,safe.event_type,safe.entity_id,safe.group_id,
          safe.order_id,safe.change, new Date(), 'PL3 QA ONLY']);
        SpreadsheetApp.flush();
      }
      pl3EnsureNotionPage_(props, safe);
      return pl3Json_({ok:true,ack_event_id:eventId});
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    // Never echo secrets, private notes, or exception stack to clients.
    return pl3Json_({ok:false,error:'QA sync rejected or incomplete'});
  }
}
function doGet() {
  return pl3Json_({ok:false,error:'POST only'});
}
function pl3Json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
function pl3HmacHex_(secret, text) {
  const bytes=Utilities.computeHmacSha256Signature(text,secret,Utilities.Charset.UTF_8);
  return bytes.map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
}
function pl3SafeEqual_(a,b) {
  if (a.length!==b.length) return false;
  let difference=0;
  for(let i=0;i<a.length;i++) difference|=a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
function pl3Validate_(event) {
  if (!event || typeof event!=='object') throw new Error('Invalid event');
  const id=String(event.event_id||'');
  const entity=String(event.entity_id||'');
  const group=String(event.group_id||'');
  const kind=String(event.event_type||'');
  if (!/^[a-zA-Z0-9:_-]{1,200}$/.test(id) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(entity) ||
      !group.startsWith(PL3_QA_PREFIX) || group.length>128 ||
      !['order.created','payment.reviewed','fulfillment.advanced'].includes(kind)) {
    throw new Error('QA allowlist only');
  }
  const p=event.payload || {};
  const orderId=String(p.order_id||entity).slice(0,128);
  if (orderId!==entity) throw new Error('Order id mismatch');
  const change=kind==='payment.reviewed' ?
    String(p.decision||'').slice(0,40) :
    kind==='fulfillment.advanced' ? String(p.to||'').slice(0,40) : 'created';
  return {event_id:id,entity_id:entity,group_id:group,event_type:kind,
    order_id:orderId,change};
}
function pl3QaSheet_(id) {
  if (!id) throw new Error('QA spreadsheet missing');
  const spreadsheet=SpreadsheetApp.openById(id);
  const sheet=spreadsheet.getSheetByName(PL3_QA_TAB);
  // Create the tab yourself before first POST to prevent wrong destination.
  if (!sheet) throw new Error('QA tab missing');
  const headers=sheet.getRange(1,1,1,8).getValues()[0];
  if (headers[0]!=='event_id' || headers[1]!=='event_type') {
    throw new Error('QA spreadsheet header mismatch');
  }
  return sheet;
}
function pl3SheetHasEvent_(sheet,id) {
  const end=sheet.getLastRow();
  if(end<2) return false;
  const found=sheet.getRange(2,1,end-1,1)
    .createTextFinder(id).matchEntireCell(true).findNext();
  return !!found;
}
function pl3Notion_(token,path,method,body) {
  const response=UrlFetchApp.fetch(PL3_NOTION_API+path,{
    method:method,
    contentType:'application/json',
    headers:{Authorization:'Bearer '+token,'Notion-Version':'2022-06-28'},
    payload:body ? JSON.stringify(body) : undefined,
    muteHttpExceptions:true
  });
  const status=response.getResponseCode();
  if(status<200 || status>=300) throw new Error('Notion HTTP '+status);
  return JSON.parse(response.getContentText());
}
function pl3EnsureNotionPage_(props,event) {
  const token=props.getProperty('PL3_QA_NOTION_TOKEN');
  const parent=props.getProperty('PL3_QA_NOTION_PAGE_ID');
  if(!token || !/^[a-f0-9-]{32,36}$/i.test(String(parent||''))) {
    throw new Error('Notion QA destination missing');
  }
  const title='PL3 QA '+event.event_id;
  // Check the destination itself before creation, even if a previous run
  // wrote the page but timed out before sending its acknowledgement.
  let cursor=null, searched=0;
  do {
    const q='?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):'');
    const list=pl3Notion_(token,'/blocks/'+parent+'/children'+q,'get');
    for(const block of list.results||[]) {
      if(block.type==='child_page' && block.child_page &&
          block.child_page.title===title) return;
    }
    searched+=(list.results||[]).length;
    if(searched>=1000) throw new Error('QA page capacity reached');
    cursor=list.has_more?list.next_cursor:null;
  } while(cursor);
  const text=[event.event_type,event.order_id,event.group_id,event.change].join(' | ');
  pl3Notion_(token,'/pages','post',{
    parent:{type:'page_id',page_id:parent},
    properties:{title:{type:'title',title:[{type:'text',text:{content:title}}]}},
    children:[{object:'block',type:'paragraph',paragraph:{
      rich_text:[{type:'text',text:{content:text}}]
    }}]
  });
}
