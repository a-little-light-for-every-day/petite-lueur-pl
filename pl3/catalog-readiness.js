// Derived display state only. Never reopens a group or publishes a draft.
export function catalogReadiness(state, now=Date.now()) {
 const groups=(state.groups||[]).map(g=>{
  const products=(state.products||[]).filter(p=>p.group_id===g.id);
  const future=!!g.deadline&&Number.isFinite(Date.parse(g.deadline))&&Date.parse(g.deadline)>now;
  const eligible=g.status==='open'&&future;
  const published=products.filter(p=>p.published&&p.status==='available'&&(!p.image_url||p.image_official));
  const shipping=products.filter(p=>p.shipping_units_confirmed===false);
  let reason=g.status==='cancelled'?'已流團':g.status==='closed'?'已結單／來源歷史':g.status!=='open'?'草稿／未核准':!g.deadline?'未設定截止時間':!future?'截止時間已過':!products.length?'尚未建立商品':!published.length?'商品尚未完成上架':'可下單';
  return {id:g.id,title:g.title,total:products.length,public_count:eligible?published.length:0,drafts:products.filter(p=>!p.published).length,shipping_pending:shipping.length,reason,eligible};
 });
 return {groups,public_groups:groups.filter(g=>g.public_count>0).length,public_products:groups.reduce((n,g)=>n+g.public_count,0),open_blocked:groups.filter(g=>g.eligible&&!g.public_count),expired:groups.filter(g=>g.reason==='截止時間已過').length};
}
