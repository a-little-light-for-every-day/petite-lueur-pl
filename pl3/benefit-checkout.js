import{STAR_TRACE_PRODUCTS,STAR_TRACE_MEMBERS}from './plave-star-trace.js';
export const BENEFIT_GROUP='WEVERSE-PLAVE-STARTRACE-261106';
export const BENEFIT_MEMBERS=STAR_TRACE_MEMBERS;
export function benefitEstimate(lines){
 let amount=0,hoodies=0;
 for(const p of lines){const id=String(p.source_url||p.sku||'').match(/(?:sales\/|WV-PLAVE-)(\d{5})/)?.[1],ref=STAR_TRACE_PRODUCTS.find(x=>x.id===id);if(!ref)continue;const q=Number(p.quantity||0);if(!Number.isSafeInteger(q)||q<0)throw Error('商品數量無效');amount+=ref.untaxed_krw*q;if(id==='71386')hoodies+=q;}
 return{amount_krw:amount,qualifications:Math.floor(amount/50000),next_krw:50000-amount%50000,hoodie_qty:hoodies};
}
export function normalizeBenefitPreference(value){
 if(!value||!Array.isArray(value.members)||value.members.length!==5||new Set(value.members).size!==5||!value.members.every(m=>BENEFIT_MEMBERS.includes(m)))throw Object.assign(Error('請填寫五位不重複的成員志願順序'),{status:400});
 if(value.confirmed!==true)throw Object.assign(Error('請確認滿額特典與排卡規則'),{status:400});
 return{members:[...value.members],allow_repeat:value.allow_repeat===true,accept_other:false,confirmed:true};
}
