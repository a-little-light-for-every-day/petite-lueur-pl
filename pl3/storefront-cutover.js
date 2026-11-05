/* PL3 operating entry-point adapter. Original mutation calls are never forwarded. */
(()=>{
 window.PL3_OPERATING_STOREFRONT=true;
 const base='https://pl3-staging-api.petitelueur-pl.workers.dev',old=window.PL2_READONLY_RPC||window.plGithubRpc;
 const go=(path,fragment)=>{location.assign(base+path+(fragment||''));return Promise.reject(Error('請在安全入口確認內容並驗證Email，尚未送出訂單。'));};
 window.plGithubRpc=async(name,args=[])=>{
  if(['plStoreBootstrap','plStoreLoadEnhancements'].includes(name)){const r=await fetch(base+'/api/operations/legacy-catalog',{cache:'no-store'});if(!r.ok)throw Error('目前無法核對商品，請稍後重試。');const d=await r.json();const initial=typeof INITIAL_STORE_DATA==='object'?INITIAL_STORE_DATA:{};return{...d,news:initial.news||[],siteSettings:{...(initial.siteSettings||{}),...d.siteSettings}};}
  if(name==='plStoreSubmitOrder'){const d=args[0]||{};return go('/shop','#cart='+encodeURIComponent(JSON.stringify(d.benefit_preference?{items:(d.items||[]).map(x=>({product_id:x.productId,quantity:x.quantity})),benefit_preference:d.benefit_preference}:(d.items||[]).map(x=>({product_id:x.productId,quantity:x.quantity})))));}
  if(['plStoreSubmitWish','plStoreSubmitDirectOrderInquiry'].includes(name)){const d=args[0]||{},k={direct_order:'ordering',cvs_payment:'payment',forwarding:'forwarding'};return go('/services','#request='+encodeURIComponent(JSON.stringify({kind:k[d.serviceType]||'proxy',product_url:d.urls||d.url||'',description:d.variant||'',quantity:d.quantity||1})));}
  if(/Lookup|Otp|PaymentReport/.test(name))return go('/account');
  if(['plStorePreviewWish','plStoreListPublicSplitGroups'].includes(name)&&typeof old==='function')return old(name,args);
  throw Error('此操作已移至新的安全入口，請使用正式商店或Email查單。');
 };
 document.addEventListener('DOMContentLoaded',()=>{if(typeof retryStoreLoad==='function')retryStoreLoad();
  for(const a of document.querySelectorAll('a[href$="#lookup"]'))a.href=base+'/account';
  const checkout=document.getElementById('checkout');if(checkout){for(const el of checkout.children)if(!['submitOrderBtn','submitMsg'].includes(el.id)){el.hidden=true;el.style.setProperty('display','none','important');};const note=document.createElement('p');note.textContent='核對商品後，前往安全結帳入口驗證Email並確認訂購資料。';checkout.prepend(note);const btn=document.getElementById('submitOrderBtn');if(btn)btn.textContent='前往安全結帳 →';window.submitOrder=()=>{if(typeof cart==='undefined'||!cart.length)return;try{const benefit_preference=window.plStarBonusDraft?window.plStarBonusDraft():null;window.plGithubRpc('plStoreSubmitOrder',[{items:cart.map(x=>({productId:x.productId,quantity:x.quantity})),...(benefit_preference?{benefit_preference}:{})}]).catch(e=>{if(typeof msg==='function')msg('submitMsg',e.message);});}catch(e){if(typeof msg==='function')msg('submitMsg',e.message);}};}
  const lookup=document.getElementById('lookup');if(lookup){for(const el of lookup.children)if(!['H2'].includes(el.tagName)){el.hidden=true;el.style.setProperty('display','none','important');};const link=document.createElement('a');link.href=base+'/account';link.className='legacyPrimary';link.textContent='前往Email安全查單 →';lookup.append(link);}
  const oldOpen=window.plOpenQuickService;window.plOpenQuickService=type=>{if(type==='progress'||type==='anonymous')return oldOpen(type);const kind={proxy_purchase:'proxy',direct_order:'ordering',cvs_payment:'payment',forwarding:'forwarding'}[type];if(kind)location.assign(base+'/services#request='+encodeURIComponent(JSON.stringify({kind})));};const link=document.getElementById('plOwnerMobileShortcut');if(link)link.href=base+'/admin-operations';});
})();
