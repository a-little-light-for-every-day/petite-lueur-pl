import {balance} from './operations-domain.js';

// The account list is derived exclusively on an authenticated, email-owned
// customer route. Never include account settings in the public catalog.
export function paymentInstructionsFor(s,order,bill,now=Date.now()){
 if(!order||!bill||bill.order_id!==order.id)return [];
 if(['cancelled','excluded','completed','waitlisted','review_pending'].includes(order.status))return [];
 if(!bill.finalized||bill.notified!==true||bill.status==='void'||bill.channel==='cod')return [];
 if(!(balance(s,bill)>0))return [];
 if(bill.due_at){const deadline=Date.parse(bill.due_at);if(!Number.isFinite(deadline)||deadline<now)return [];}
 const accounts=s.config?.payment_accounts||{};
 const valid=x=>typeof x==='string'&&/^\d{10,16}$/.test(x);
 return [
  ...(valid(accounts.bank_transfer)?[{method:'銀行匯款',bank:'台新銀行',bank_code:'812',account:accounts.bank_transfer}]:[]),
  ...(valid(accounts.ctbc_cash)?[{method:'中國信託無卡存款',bank:'中國信託',bank_code:'822',account:accounts.ctbc_cash}]:[])
 ];
}
