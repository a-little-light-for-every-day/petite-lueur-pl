/** Owner-run, isolated live QA. Never install in a customer-facing deployment. */
function operationsQaLiveTest(){
 const group='PL3-QA-STAR-20261105-01';
 const bookId='1V1OoNYnes0EpdV_dERAMcElveL-nC5kmQ66geXXKooo';
 const benefitSource='62e4bd23-b7dc-4d00-880d-987ec8af451a';
 if(bookId===OPS_BOOK_ID||benefitSource===PropertiesService.getScriptProperties().getProperty('PL3_STAR_TRACE_NOTION_DATA_SOURCE_ID'))throw Error('OPS_QA_NOT_ISOLATED');
 const p={...opsConfig_(),qa:true,bookId,benefitSource};
 const d={star_trace:{group_id:group,
  customers:[{customer_order_id:'PL3-QA-ORDER-001',eligible_krw:128000,preferences:['藝俊','諾亞','斑比','銀虎','河玟'],accept_duplicates:false,lines:[{product_id:'71386',quantity:1,eligible_krw:128000}]}],
  qualifications:[{customer_order_id:'PL3-QA-ORDER-001',eligible_krw:128000,slots:2}],
  official_orders:[{official_order_id:'PL3-QA-WEVERSE-001',eligible_krw:128000,gifts_expected:2,remaining_to_next_krw:22000}],
  received_cards:[{card_id:'PL3-QA-CARD-001',member:'藝俊'},{card_id:'PL3-QA-CARD-002',member:'諾亞'}],
  draw_order:['PL3-QA-ORDER-001:slot:1','PL3-QA-ORDER-001:slot:2'],
  draw_evidence:{reference:'PL3-QA-ONLY-NO-REAL-LOTTERY'},
  allocation:{allocated:[{slot_id:'PL3-QA-ORDER-001:slot:1',card_id:'PL3-QA-CARD-001',member:'藝俊'},{slot_id:'PL3-QA-ORDER-001:slot:2',card_id:'PL3-QA-CARD-002',member:'諾亞'}],unallocated:[],extra_cards:[],adjustment_history:[],packing_history:[]},
  audit_events:[{event_id:'PL3-QA-EVENT-001',action:'qa_fixture',actor:'qa',evidence:'isolated'}]}};
 const hash='PL3-QA-STAR-E2E-20261105';
 const make=(destination)=>({protocol:'pl3-operations-v1',event_id:'ops:benefit:'+hash,destination,record_id:'benefit:'+group,version:1,issued_at:new Date().toISOString(),projection:{kind:'benefit',record_id:'benefit:'+group,hash,document:d}});
 const sheets=make('sheets'),notion=make('notion');
 const passes=[];
 for(let i=0;i<2;i++){
  const a=opsSheets_(sheets,p),b=opsNotion_(notion,p);
  if(!a.ok||!b.ok)throw Error('OPS_QA_DELIVERY_FAILED_'+(a.error_code||b.error_code||'UNKNOWN'));
  passes.push({pass:i+1,sheets:a.ok,notion:b.ok,notion_page_id:b.remote_id});
 }
 const book=SpreadsheetApp.openById(bookId),rows=opsRows_(sheets),byKind={};
 for(const r of rows){const tab=book.getSheetByName('PL3 營運｜'+r.kind);if(!tab)throw Error('OPS_QA_SHEET_MISSING');const found=formalRows_(tab).filter(x=>String(x.values[0])===r.id);if(found.length!==1||found[0].values[6]!==r.json||!opsSheetUnchanged_(found[0].values))throw Error('OPS_QA_SHEET_MISMATCH');byKind[r.kind]=(byKind[r.kind]||0)+1;}
 const pages=formalNotionCall_(p,'post','/data_sources/'+benefitSource+'/query',{filter:{property:'活動識別碼',title:{equals:group}},page_size:3}).results||[];
 if(pages.length!==1||!opsPropsMatch_(pages[0],opsBenefitProperties_(d,notion.event_id)))throw Error('OPS_QA_NOTION_MISMATCH');
 const result={ok:true,group,write_attempts:2,sheet_entities:rows.length,sheet_types:byKind,notion_pages:pages.length,notion_page_id:pages[0].id,slots:2,official_expected:2,cards_received:2,allocated:2,unallocated:0};
 console.log(JSON.stringify(result));return result;
}
