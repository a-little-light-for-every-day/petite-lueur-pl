// Preserve every source order, including archived / unresolved records. Never infer historical prices.
const pageId = x => String(x||'').replace(/-/g,'').match(/[a-f0-9]{32}/i)?.[0]?.toLowerCase();
export function enrichLegacySnapshot(rows, items) {
 const enhanced=[...items], findings=[];
 for(const row of rows){
  let parsed=null;
  try {const value=JSON.parse(row.raw_structured_items||'null');if(Array.isArray(value))parsed=value;}catch{}
  const own=pageId(row.source_url);
  const existing=items.filter(x=>pageId(x.order_source_url)===own);
  if(existing.length || !parsed)continue;
  for(let i=0;i<parsed.length;i++){
   const x=parsed[i], q=x.a===undefined?x.q:x.a;
   // a=0 explicitly means not secured. Requested quantities remain in raw_structured_items.
   if(q===0)continue;
   if(!x.c||!Number.isSafeInteger(q)||q<1){findings.push({source_id:row.source_id,reason:'STRUCTURED_LINE_INVALID'});continue;}
   enhanced.push({source_id:row.source_url+'#structured-'+i,order_source_url:row.source_url,sku:x.c,variant:x.v||'',quantity:q,
    unit_price_twd:Number.isSafeInteger(x.p)&&x.p>=0?x.p:null,fulfillment:x.r||'',official_batch:'',provenance:'notion_structured'});
  }
 }
 return {rows,items:enhanced,findings};
}
