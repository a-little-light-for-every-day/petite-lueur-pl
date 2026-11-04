// Parse owner-pasted product drafts without ever granting publication approval.
const filled=value=>String(value??'').trim();
const https=value=>{try{return new URL(value).protocol==='https:';}catch{return false;}};

export function parseDraftCatalogJSON(raw,groupId){
 let rows;
 try{rows=JSON.parse(raw);}catch{throw Error('JSON 格式錯誤，請貼上完整商品陣列');}
 if(!Array.isArray(rows)||rows.length<1||rows.length>500)throw Error('一次須匯入 1～500 款商品');
 if(!filled(groupId))throw Error('請先指定已建立的團次');
 const ids=new Set();
 const products=rows.map((row,index)=>{
  const number=index+1;
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error(`第 ${number} 款格式不正確`);
  if(row.published===true)throw Error(`第 ${number} 款要求公開上架；批次匯入僅接受草稿`);
  const id=filled(row.id),name=filled(row.name),variant=filled(row.variant);
  if(!id||id.length>160||!name||name.length>300)throw Error(`第 ${number} 款缺少有效商品編號或名稱`);
  if(ids.has(id))throw Error(`來源商品編號重複：${id}`);
  ids.add(id);
  if(row.group_id&&filled(row.group_id)!==groupId)throw Error(`第 ${number} 款的團次 ID 與所選團次不同`);
  if(!Number.isSafeInteger(row.price_twd)||row.price_twd<=0)throw Error(`第 ${number} 款台幣售價須為正整數`);
  const source_url=filled(row.source_url),image_url=filled(row.image_url);
  if(!https(source_url)||/animate/i.test(source_url))throw Error(`第 ${number} 款須填有效的官方 HTTPS 商品來源（不使用 Animate 商業代購）`);
  if(image_url&&!https(image_url))throw Error(`第 ${number} 款圖片網址須使用 HTTPS`);
  const units=row.shipping_units;
  if(units!==undefined&&units!==null&&units!==''&&(!Number.isSafeInteger(units)||units<=0))throw Error(`第 ${number} 款國際運費份數無效`);
  return {id,name,variant,price_twd:row.price_twd,source_url,image_url,
   official_sku:filled(row.official_sku),shipping_units:Number.isSafeInteger(units)?units:null,
   status:row.status==='sold_out'?'sold_out':'available',
   source_description:filled(row.source_description).slice(0,5000),
   notion_page_id:filled(row.notion_page_id).slice(0,160)};
 });
 return {products,missingShipping:products.filter(x=>!x.shipping_units).length,
  missingImage:products.filter(x=>!x.image_url).length};
}
