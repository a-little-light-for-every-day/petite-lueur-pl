/* Prepared PL3 entry-point adapter. Loaded only in the isolated preview until formal cutover. */
(()=>{
 window.PL3_OPERATING_STOREFRONT=true;
 const base='https://pl3-staging-api.petitelueur-pl.workers.dev',old=window.plGithubRpc;
 const go=(path,fragment)=>{location.assign(base+path+(fragment||''));return Promise.reject(Error('請在安全入口確認內容並驗證Email，尚未送出訂單。'));};
 window.plGithubRpc=async(name,args=[])=>{
  if(['plStoreBootstrap','plStoreLoadEnhancements'].includes(name)){const r=await fetch(base+'/api/operations/legacy-catalog',{cache:'no-store'});if(!r.ok)throw Error('目前無法核對商品，請稍後重試。');const d=await r.json();const initial=typeof INITIAL_STORE_DATA==='object'?INITIAL_STORE_DATA:{};return{...d,news:initial.news||[],siteSettings:{...(initial.siteSettings||{}),...d.siteSettings}};}
  if(name==='plStoreSubmitOrder'){const d=args[0]||{};return go('/shop','#cart='+encodeURIComponent(JSON.stringify((d.items||[]).map(x=>({product_id:x.productId,quantity:x.quantity})))));}
  if(['plStoreSubmitWish','plStoreSubmitDirectOrderInquiry'].includes(name)){const d=args[0]||{},k={direct_order:'ordering',cvs_payment:'payment',forwarding:'forwarding'};return go('/services','#request='+encodeURIComponent(JSON.stringify({kind:k[d.serviceType]||'proxy',product_url:d.urls||d.url||'',description:d.variant||'',quantity:d.quantity||1})));}
  if(/Lookup|Otp|PaymentReport/.test(name))return go('/account');
  if(['plStorePreviewWish','plStoreListPublicSplitGroups'].includes(name)&&typeof old==='function')return old(name,args);
  throw Error('此操作已移至新的安全入口，請使用正式商店或Email查單。');
 };
 document.addEventListener('DOMContentLoaded',()=>{if(typeof retryStoreLoad==='function')retryStoreLoad();const oldOpen=window.plOpenQuickService;window.plOpenQuickService=type=>{if(type==='progress'||type==='anonymous')return oldOpen(type);const kind={proxy_purchase:'proxy',direct_order:'ordering',cvs_payment:'payment',forwarding:'forwarding'}[type];if(kind)location.assign(base+'/services#request='+encodeURIComponent(JSON.stringify({kind})));};const link=document.getElementById('plOwnerMobileShortcut');if(link)link.href=base+'/admin-operations';});
})();
