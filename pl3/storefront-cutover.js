/* PL3 operating entry-point adapter. Original mutation calls are never forwarded. */
(()=>{
 window.PL3_OPERATING_STOREFRONT=true;
 const base='https://pl3-staging-api.petitelueur-pl.workers.dev',old=window.PL2_READONLY_RPC||window.plGithubRpc;
 const go=(path,fragment)=>{location.assign(base+path+(fragment||''));return Promise.reject(Error('請在安全入口確認內容並驗證Email，尚未送出訂單。'));};
 window.plGithubRpc=async(name,args=[])=>{
  if(name==='plGetShoppingGuide')return{ok:true,html:"<p class=\"guideRuleLead\">請依商品頁的團次規則及當次付款通知辦理。訂購／委託人須年滿 18 歲。</p><details class=\"guideDetail\" open><summary><span>01</span> 訂購申請與一般預購</summary><div><p>在購物袋核對商品、規格與數量，填寫申請資料並完成 Email 驗證。一般預購由 PL 確認可承接後提供一補通知，核對入帳後依團次安排採購。</p></div></details><details class=\"guideDetail\" open><summary><span>02</span> 限量搶購與候補</summary><div><p>標示先搶後收的團次，申請時不用付款。正式名額額滿後列入候補。以官方實際買到的品項及數量通知第一階段付款，未購得的品項不收商品款。</p></div></details><details class=\"guideDetail\" open><summary><span>03</span> 付款與核帳</summary><div><p>依當次通知提供的收款資料付款。目前可使用銀行匯款、台灣 Pay（合庫 TWQR）或中信無卡存款，依通知所列方式辦理。付款後請回網站回報，PL 核對實際入帳後更新狀態。</p></div></details><details class=\"guideDetail\" open><summary><span>04</span> 運費與二補</summary><div><p>一補為已確認的商品款。海外境內運費按同筆官方訂單實際購入件數分攤，國際運費按商品份數分攤，包材、實際稅費及台灣配送依當次規則結算。二補以實際費用為準。賣貨便 NT$38，交貨便 NT$60（到付），其他配送依通知。</p></div></details><details class=\"guideDetail\"><summary><span>05</span> 代下單、代付與轉運</summary><div><p>日本網站代下單同站同次結帳 NT$100。銀行振込、超商代付、代收轉運及韓國代付，請先提供通路、金額或期限等必要資料，待 PL 確認可承接與報價後再辦理。</p></div></details><details class=\"guideDetail\"><summary><span>06</span> 限購、特典與出貨</summary><div><p>商品庫存、限購、特典與官方出貨依實際結果。海外入庫、國際運送與台灣配送會依訂單進度更新。若遇缺貨、砍單或規格變動，PL 會聯絡確認後續。</p></div></details><details class=\"guideDetail\"><summary><span>07</span> 查單與申請撤回</summary><div><p>使用下單 Email 驗證後，可在網站查看帳款、期限、付款回報與出貨進度。付款通知前可聯絡 PL 申請撤回，後續依團次通知和實際採購進度處理。</p></div></details>"};
  if(['plStoreBootstrap','plStoreLoadEnhancements'].includes(name)){const r=await fetch(base+'/api/operations/legacy-catalog',{cache:'no-store'});if(!r.ok)throw Error('目前無法核對商品，請稍後重試。');const d=await r.json();const initial=typeof INITIAL_STORE_DATA==='object'?INITIAL_STORE_DATA:{};return{...d,news:initial.news||[],siteSettings:{...(initial.siteSettings||{}),...d.siteSettings}};}
  if(name==='plStoreSubmitOrder')throw Error('請在本頁購物袋填寫申請資料並送出。');
  if(['plStoreSubmitWish','plStoreSubmitDirectOrderInquiry'].includes(name)){const d=args[0]||{},k={direct_order:'ordering',cvs_payment:'payment',forwarding:'forwarding'};return go('/services','#request='+encodeURIComponent(JSON.stringify({kind:k[d.serviceType]||'proxy',product_url:d.urls||d.url||'',description:d.variant||'',quantity:d.quantity||1})));}
  if(/Lookup|Otp|PaymentReport/.test(name))return go('/account');
  if(['plStorePreviewWish','plStoreListPublicSplitGroups'].includes(name)&&typeof old==='function')return old(name,args);
  throw Error('此操作已移至新的安全入口，請使用正式商店或Email查單。');
 };
 document.addEventListener('DOMContentLoaded',()=>{if(typeof retryStoreLoad==='function')retryStoreLoad();
  for(const a of document.querySelectorAll('a[href$="#lookup"]'))a.href=base+'/account';
  const checkout=document.getElementById('checkout');
  if(checkout){
   const el=id=>document.getElementById(id),value=id=>String(el(id)?.value||'').trim();
   let token='',verifiedEmail='',busy=false,requestedEmail='';
   const send=document.createElement('button');send.type='button';send.className='softbtn';send.textContent='寄送 Email 驗證碼';
   const auth=document.createElement('div');auth.className='field';auth.innerHTML='<label for="plInlineOtp">Email 六位數驗證碼</label><input id="plInlineOtp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="在本頁完成驗證，不需重新選商品"><small id="plInlineAuthStatus" class="meta" role="status"></small>';auth.append(send);
   el('customerEmail').closest('.field').after(auth);
   const note=document.createElement('p');note.textContent='填寫申請資料，在本頁完成 Email 驗證後直接送出；商品與排卡志願會一併保存。';checkout.prepend(note);
   const btn=el('submitOrderBtn');btn.textContent='驗證並送出訂購申請 →';
   const show=(text,kind='warn')=>{if(typeof msg==='function')msg('submitMsg',text,kind);};
   const request=async(path,body,bearer='')=>{const same=base===location.origin;const r=await fetch(base+path,{method:body===undefined?'GET':'POST',credentials:same?'same-origin':'omit',headers:{...(body===undefined?{}:{'Content-Type':'application/json',...(same?{'X-PL3-Admin-Action':'1'}:{})}),...(bearer?{Authorization:'Bearer '+bearer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok||d.ok===false){if(r.status===401&&bearer){token='';verifiedEmail='';}throw Error(d.error||d.message||'目前無法完成，請稍後重試。');}return d;};
   const email=()=>{const e=value('customerEmail').toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e))throw Error('請確認 Email 格式');return e;};
   el('customerEmail').addEventListener('input',()=>{document.getElementById('plDirectPayment')?.remove();token='';verifiedEmail='';requestedEmail='';el('plInlineOtp').value='';el('plInlineAuthStatus').textContent='';});
   send.onclick=async()=>{if(busy)return;try{const e=email();send.disabled=true;await request('/api/auth/request-code',{email:e});requestedEmail=e;el('plInlineAuthStatus').textContent='驗證碼已寄出，請在下方填寫申請資料，輸入驗證碼後送出。';send.textContent='重新寄送驗證碼';}catch(e){show(e.message);}finally{send.disabled=false;}};
   const attemptKey=async payload=>{const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))))).map(x=>x.toString(16).padStart(2,'0')).join('');let attempts=[];try{attempts=JSON.parse(sessionStorage.getItem('pl3-inline-attempts-v1')||'[]');}catch{}const found=attempts.find(x=>x.digest===digest);if(found)return found.key;const key=crypto.randomUUID();attempts.push({digest,key});try{sessionStorage.setItem('pl3-inline-attempts-v1',JSON.stringify(attempts.slice(-50)));}catch{}return key;};
   window.submitOrder=async()=>{
    if(busy)return;const completed=[];const receipts=[];
    try{
     if(typeof cart==='undefined'||!cart.length)throw Error('購物袋目前沒有商品');
     if(typeof plCatalogVerified!=='undefined'&&!plCatalogVerified)throw Error('商品仍在核對最新資料，請稍等後再送出。');
     const e=email(),name=value('customerName'),contact=value('customerContact'),delivery=value('deliveryMethod');
     if(!name)throw Error('請填寫訂購人本名');if(!contact)throw Error('請填寫社群帳號或手機');if(!delivery)throw Error('請選擇希望收貨方式');
     if(!el('ageConfirmed').checked||!el('termsAccepted').checked||!el('noAbandonConfirmed').checked)throw Error('請確認成年、購物須知與訂購約定');
     const preference=window.plStarBonusDraft?window.plStarBonusDraft():null;
     const groups=new Map();for(const line of cart){const p=typeof productById==='function'?productById(line.productId):null;if(!p?.campaignCode)throw Error('部分商品團次尚未核實，請重新整理後確認');if(!groups.has(p.campaignCode))groups.set(p.campaignCode,[]);groups.get(p.campaignCode).push({product_id:line.productId,quantity:line.quantity});}
     busy=true;btn.disabled=true;send.disabled=true;btn.textContent='正在驗證與送出…';show('');
     if(!token||verifiedEmail!==e){let restored=false;if(base===location.origin){try{const session=await request('/api/auth/session');restored=session.email?.toLowerCase()===e;}catch{}}
      if(!restored){if(requestedEmail!==e||!/^\d{6}$/.test(value('plInlineOtp')))throw Error('請先寄送並填寫這個 Email 的六位數驗證碼');const verified=await request('/api/auth/verify-code',{email:e,code:value('plInlineOtp')});token=verified.token;}verifiedEmail=e;
     }
     for(const[group_id,items]of groups){const payload={name,group_id,items,adult_confirmed:true,terms_confirmed:true,no_abandon_confirmed:true,contact,delivery_method:delivery,...(group_id==='WEVERSE-PLAVE-STARTRACE-261106'?{benefit_preference:preference}:{})};const key=await attemptKey({email:e,...payload});const r=await request('/api/operations/checkout',{key,...payload},token);completed.push(r.result.order_id);receipts.push({group_id,status:r.result.status,direct_payment:r.result.direct_payment===true,order_id:r.result.order_id});cart=cart.filter(line=>!(groups.get(group_id)||[]).some(x=>x.product_id===line.productId));if(typeof saveCart==='function')saveCart();try{const attempts=JSON.parse(sessionStorage.getItem('pl3-inline-attempts-v1')||'[]');sessionStorage.setItem('pl3-inline-attempts-v1',JSON.stringify(attempts.filter(x=>x.key!==key)));}catch{}}
     if(typeof renderCart==='function')renderCart();if(typeof renderProducts==='function')renderProducts();
     checkout.classList.remove('hidden');btn.hidden=true;
     const directReceipts=receipts.filter(r=>r.direct_payment&&r.status!=='waitlisted');
     const notices=['訂購申請已送出！編號：'+completed.join('、')+'。'];
     if(receipts.some(r=>r.status==='waitlisted'))notices.push('候補訂單尚未取得採購名額，請等候後續通知，暫無須付款。');
     if(receipts.some(r=>r.group_id==='WEVERSE-PLAVE-STARTRACE-261106'&&r.status!=='waitlisted'))notices.push('一販未買到的品項將保留至官方二販（如有）；成功購得後才通知第一階段付款，運費於二補結算。兩販未得或無二販則另公告處理時間。');
     if(receipts.some(r=>!r.direct_payment&&r.status!=='waitlisted'&&r.group_id!=='WEVERSE-PLAVE-STARTRACE-261106'))notices.push('一般預購將於結單後提供第一階段付款通知，運費另於二補核算。');
     show(notices.join(''),'ok');
     if(directReceipts.length){
      let shown=0;
      document.getElementById('plDirectPayment')?.remove();
      const payment=document.createElement('section');payment.id='plDirectPayment';checkout.append(payment);
      const paymentLink=document.createElement('a');paymentLink.href=base+'/account';paymentLink.className='legacyPrimary';paymentLink.textContent='前往我的訂單查看付款資料與回報 →';payment.append(paymentLink);
      try{
       const data=await request('/api/operations/my-orders',undefined,token);
       for(const receipt of directReceipts){
        const order=data.orders.find(o=>o.id===receipt.order_id);
        const bill=order?.invoices.find(b=>b.phase==='first'&&b.payment_options?.length);
        if(!bill)continue;
        const details=document.createElement('p');
        const deadline=new Date(bill.due_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
        const accounts=bill.payment_options.map(p=>p.method+' '+p.bank_code+' '+p.account).join(' ／ ');
        details.textContent=order.id+'｜一補 NT$'+bill.outstanding_twd+'｜付款及回報期限 '+deadline+'（台灣時間）｜'+accounts;
        payment.insertBefore(details,paymentLink);
        shown++;
       }
      }catch{ /* The saved order remains accessible from the secure account page. */ }
      if(shown)notices.push('一補金額、付款期限及匯款資料請見下方。匯款後請回報付款。');
      if(shown<directReceipts.length)notices.push(shown?'其餘可直接匯款的訂單，請到「我的訂單」查看付款資料。':'請到「我的訂單」查看一補金額、付款期限及匯款資料。');
      else paymentLink.textContent='前往我的訂單回報付款 →';
      show(notices.join(''),'ok');
     }
    }catch(e){if(completed.length){if(typeof renderCart==='function')renderCart();checkout.classList.remove('hidden');}show((completed.length?'已保存 '+completed.join('、')+'；其他商品尚未送出：':'')+e.message);}
    finally{busy=false;btn.disabled=false;send.disabled=false;btn.textContent='驗證並送出訂購申請 →';}
   };
   const originalRender=window.renderCart;if(typeof originalRender==='function')window.renderCart=function(){const r=originalRender.apply(this,arguments);if(typeof cart!=='undefined'&&cart.length)btn.hidden=false;return r;};
  }
  const lookup=document.getElementById('lookup');if(lookup){for(const el of lookup.children)if(!['H2'].includes(el.tagName)){el.hidden=true;el.style.setProperty('display','none','important');};const link=document.createElement('a');link.href=base+'/account';link.className='legacyPrimary';link.textContent='前往Email安全查單 →';lookup.append(link);}
  const oldOpen=window.plOpenQuickService;window.plOpenQuickService=type=>{if(type==='progress'||type==='anonymous')return oldOpen(type);const kind={proxy_purchase:'proxy',direct_order:'ordering',cvs_payment:'payment',forwarding:'forwarding'}[type];if(kind)location.assign(base+'/services#request='+encodeURIComponent(JSON.stringify({kind})));};const link=document.getElementById('plOwnerMobileShortcut');if(link)link.href=base+'/admin-operations';});
})();
