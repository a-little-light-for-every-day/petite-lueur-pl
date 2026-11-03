import {approvedPublicCatalog} from '../tools/refresh-public-catalog.mjs';
const SOURCE='https://script.google.com/macros/s/AKfycbx4PHYxXV1YMsA4h9PCduQ0pAStXFq8TdQV2bEPt3lxr2x-ciq6zNJmFF-Gx1ByTgtYhQ/exec';
export async function readApprovedLegacyCatalog(transport=fetch){
 const response=await transport(SOURCE,{redirect:'follow',headers:{Accept:'text/html'},signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Error('舊站商品來源暫時無法讀取');if(Number(response.headers.get('content-length')||0)>5000000)throw Error('商品來源過大');
 const html=await response.text();if(html.length>5000000)throw Error('商品來源過大');const marker=html.indexOf('plInitialStoreData');if(marker<0)throw Error('舊站未提供商品資料');const match=html.slice(marker,marker+1200000).match(/data-payload.{0,40}?(eyJ[A-Za-z0-9_-]{100,})/);if(!match)throw Error('商品來源格式無效');
 const raw=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(match[1].replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));
 return approvedPublicCatalog(raw).products;
}
export function planLegacyCatalogImport(products,groups){
 const matched=[],unmatched=[];for(const p of products){const gs=groups.filter(g=>g.title===p.campaignName||g.source_code&&g.source_code===p.campaignCode);if(gs.length!==1){unmatched.push({code:p.code,campaign:p.campaignName||p.campaignCode||'',reason:gs.length?'團次重複':'尚無精確團次對應'});continue;}
 if(!Number.isSafeInteger(p.price)||p.price<=0){unmatched.push({code:p.code,reason:'售價待核實'});continue;}
 matched.push({group_id:gs[0].id,id:p.code,name:p.title,official_sku:p.code,variant:p.variantText||'',price_twd:p.price,shipping_units:Number.isSafeInteger(p.shippingShares)&&p.shippingShares>0?p.shippingShares:undefined,quantity_limit:Number.isSafeInteger(p.maxPurchase)&&p.maxPurchase>0?p.maxPurchase:null,image_url:p.image||'',status:p.soldOut?'sold_out':'available',source_url:p.sourceUrl||'',source_snapshot:p});}
 return {matched,unmatched};
}
