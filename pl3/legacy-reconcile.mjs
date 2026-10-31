// Offline, READ-ONLY PL2 -> PL3 comparison. This tool never imports or writes customer orders.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const integer = x => Number.isInteger(x) && x >= 0;
const key = row => String(row.source_system||"PL2")+":"+String(row.source_id||"");
function normalized(row, side) {
  if(!row||typeof row!=="object"||!row.source_id||!Array.isArray(row.items))
    throw Error(side+": missing source identity/items");
  const amount=Number(row.amount_twd);
  if(!integer(amount)||amount>22000)throw Error(side+": invalid amount for "+key(row));
  if(!row.items.length||row.items.length>50)throw Error(side+": invalid line count for "+key(row));
  const lineKeys=new Set();
  const lines=row.items.map(item=>{
    const sku=String(item.sku||"").trim(),variant=String(item.variant||"").trim();
    const qty=Number(item.quantity),price=Number(item.unit_price_twd);
    if(!sku||!integer(qty)||qty<1||!integer(price)||price<1)throw Error(side+": invalid line for "+key(row));
    const signature=JSON.stringify([sku,variant]);
    if(lineKeys.has(signature))throw Error(side+": duplicate SKU/variant for "+key(row));
    lineKeys.add(signature);
    return {sku,variant,quantity:qty,unit_price_twd:price};
  }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(lines.reduce((sum,x)=>sum+x.quantity*x.unit_price_twd,0)!==amount)
    throw Error(side+": amount/lines mismatch for "+key(row));
  return {key:key(row),source_revision:String(row.source_revision||""),
    amount_twd:amount,item_count:lines.length,quantity_total:lines.reduce((sum,x)=>sum+x.quantity,0),
    payment_phase:String(row.payment_phase||"unknown"),status:String(row.status||"unknown"),lines};
}
function indexed(rows,side) {
  if(!Array.isArray(rows))throw Error(side+": JSON array required");
  const result=new Map();
  for(const row of rows) {
    const r=normalized(row,side);
    if(result.has(r.key))throw Error(side+": duplicate source identity "+r.key);
    result.set(r.key,r);
  }
  return result;
}
export function reconcileLegacySnapshots(legacy,staged) {
  const a=indexed(legacy,"PL2 snapshot"),b=indexed(staged,"PL3 staged snapshot");
  const findings=[];
  let matched=0,amountMatched=0;
  for(const [id,old] of a) {
    const next=b.get(id);
    if(!next){findings.push({source_id:id,reason:"missing_staged"});continue;}
    const differences=[];
    for(const field of ["amount_twd","item_count","quantity_total","payment_phase","status"])
      if(old[field]!==next[field])differences.push(field);
    if(JSON.stringify(old.lines)!==JSON.stringify(next.lines))differences.push("items");
    if(differences.length)findings.push({source_id:id,reason:"mismatch",fields:differences});
    else {matched++;amountMatched+=old.amount_twd;}
  }
  for(const id of b.keys())if(!a.has(id))findings.push({source_id:id,reason:"unexpected_staged"});
  findings.sort((x,y)=>x.source_id.localeCompare(y.source_id));
  return {
    safe_to_import:false,mode:"dry_run_only",legacy_count:a.size,staged_count:b.size,
    legacy_total_twd:[...a.values()].reduce((sum,x)=>sum+x.amount_twd,0),
    staged_total_twd:[...b.values()].reduce((sum,x)=>sum+x.amount_twd,0),
    matched_count:matched,matched_total_twd:amountMatched,
    discrepancy_count:findings.length,findings
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==4){console.error("Usage: node pl3/legacy-reconcile.mjs <sanitized-pl2-snapshot.json> <sanitized-pl3-staged-snapshot.json>");process.exitCode=2;}
  else {
    try {
      const [a,b]=await Promise.all([readFile(process.argv[2],"utf8"),readFile(process.argv[3],"utf8")]);
      console.log(JSON.stringify(reconcileLegacySnapshots(JSON.parse(a),JSON.parse(b)),null,2));
      // Discrepancies are expected before cutover; CI operators may inspect the JSON.
    }catch(error){console.error("Legacy reconciliation could not be completed:",error.message);process.exitCode=1;}
  }
}
