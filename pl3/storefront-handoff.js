// Only catalog item identifiers and quantities enter the URL fragment. No customer fields.
export function cartFromFragment(fragment,catalog){
 let raw;try{raw=JSON.parse(decodeURIComponent(String(fragment||'').replace(/^#cart=/,'')))}catch{return{cart:{},errors:[]}}
 if(!Array.isArray(raw)||raw.length>50)return{cart:{},errors:['購物袋格式無效，請重新選擇商品。']};
 const cart={},errors=[];for(const x of raw){const p=catalog.products.find(p=>p.id===x.product_id);if(!p||!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>Math.min(p.quantity_limit||99,99)||cart[x.product_id]){errors.push('部分商品已截止、數量超限或不再開放，請重新核對。');continue;}cart[p.id]=x.quantity;}return{cart,errors:[...new Set(errors)]};
}
export function serviceFromFragment(fragment){
 const empty={kind:'proxy',product_url:'',description:'',quantity:1,note:''};let r;try{r=JSON.parse(decodeURIComponent(String(fragment||'').replace(/^#request=/,'')))}catch{return empty}
 if(!r||!['proxy','ordering','payment','korea','forwarding'].includes(r.kind))return empty;
 let url='';try{const u=new URL(r.product_url);if(u.protocol==='https:')url=u.href}catch{}
 return{...empty,kind:r.kind,product_url:url,description:String(r.description||'').slice(0,2000),quantity:Number.isInteger(r.quantity)&&r.quantity>0&&r.quantity<=99?r.quantity:1};
}
export function legacyOperationsCatalog(s){
 const now=Date.now(),groups=s.groups.filter(g=>g.status==='open'&&g.deadline&&Date.parse(g.deadline)>now);
 const products=s.products.filter(p=>p.published&&(!p.image_url||p.image_official)&&p.status==='available'&&groups.some(g=>g.id===p.group_id)).map(p=>{const g=groups.find(g=>g.id===p.group_id);return{id:p.id,code:p.sku||p.id,title:p.name,price:p.price_twd,variantText:'',note:p.variant||'',published:true,displayMode:'formal',image:p.image_url||'',images:p.image_url?[p.image_url]:[],imagePublicApproved:!!p.image_official,campaignCode:g.id,campaignName:g.title,preorderDeadline:g.deadline,sourceUrl:p.source_url||'',maxPurchase:p.quantity_limit||null,soldOut:false,status:'可訂購',kind:'日本代購'};});
 return{ok:true,products,campaigns:groups.filter(g=>products.some(p=>p.campaignCode===g.id)).map(g=>({id:g.id,code:g.id,title:g.title,name:g.title,status:'收單中',deadline:g.deadline})),orderMaxTwd:22000,siteSettings:{privateBankDetails:true},sourceMode:'PL3-operating-catalog'};
}
