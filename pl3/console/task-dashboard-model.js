// A read-only projection of operationalTasks. Never change bookkeeping or the task source here.
const WAITING_TITLES=new Set(['等待海外倉入庫','轉運品等待海外倉入庫','等待付款','貨到付款待平台撥款']);
const HISTORICAL_TITLES=new Set(['歷史已核對款項待補入帳證據']);

export function taskCategory(state,task){
 if(HISTORICAL_TITLES.has(task.title))return 'historical';
 if(WAITING_TITLES.has(task.title))return 'waiting';
 if(task.type==='invoice'){
  const bill=(state.invoices||[]).find(x=>x.id===task.object_id);
  if(bill?.legacy_settlement&&task.title==='帳款金額待確認')return 'historical';
 }
 return 'action';
}

export function taskOrderId(state,task){
 if(task.type==='order')return task.object_id;
 if(['invoice','report','service'].includes(task.type)){
  const source={invoice:state.invoices,report:state.reports,service:state.service_requests}[task.type]||[];
  return source.find(x=>x.id===task.object_id)?.order_id||null;
 }
 if(['warehouse','shipment','purchase'].includes(task.type)){
  const owners=(state.orders||[]).filter(o=>(o.items||[]).some(l=>l.id===task.object_id));
  if(owners.length===1)return owners[0].id;
 }
 if(task.type==='notice'){
  const notice=(state.notices||[]).find(n=>n.id===task.object_id);
  if(notice?.order_ids?.length===1)return notice.order_ids[0];
 }
 return null;
}

function standaloneLabel(state,task){
 if(task.type==='purchase'){
  const p=(state.purchases||[]).find(x=>x.id===task.object_id);
  return p?task.title+' · '+[p.shop,p.official_order||p.id].filter(Boolean).join(' / '):task.title+' · '+task.object_id;
 }
 if(task.type==='credit'){
  const receipt=(state.receipts||[]).find(x=>x.id===task.object_id);
  return task.title+' · '+(receipt?.transaction_id||task.object_id);
 }
 if(task.type==='notice'){
  const notice=(state.notices||[]).find(x=>x.id===task.object_id);
  return task.title+' · '+(notice?.subject||task.object_id);
 }
 return task.title;
}

export function taskDashboardModel(state,tasks){
 const sections={action:[],waiting:[],historical:[]};
 const indexes={action:new Map(),waiting:new Map(),historical:new Map()};
 for(const task of tasks){
  const category=taskCategory(state,task),orderId=taskOrderId(state,task);
  // Global/official-purchase tasks must not be attributed to arbitrary customer orders.
  const key=orderId?'order:'+orderId:'standalone:'+task.id;
  let entry=indexes[category].get(key);
  if(!entry){
   const order=(state.orders||[]).find(o=>o.id===orderId);
   entry={key,orderId,title:orderId?orderId+(order?.name?' · '+order.name:''):standaloneLabel(state,task),tasks:[]};
   indexes[category].set(key,entry);
   sections[category].push(entry);
  }
  entry.tasks.push(task);
 }
 const result={rawCount:tasks.length};
 for(const [name,entries] of Object.entries(sections))result[name]={groups:entries,taskCount:entries.reduce((sum,g)=>sum+g.tasks.length,0),orderCount:new Set(entries.map(e=>e.orderId).filter(Boolean)).size};
 return result;
}
