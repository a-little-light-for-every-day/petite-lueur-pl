import React from 'react';
import {taskDashboardModel} from './task-dashboard-model.js';
import './task-dashboard.css';

const destinations={service:'services',group:'groups',star_trace:'benefits',notice:'notices',invoice:'payments',order:'orders',purchase:'purchases',warehouse:'warehouse',shipment:'shipments',credit:'payments',report:'payments'};
const sections=[
 ['action','需要主購處理','付款核帳、資料異常、採購確認、待審通知等'],
 ['waiting','等待外部進度','海外倉入庫、顧客付款、平台撥款等；不計入立即待辦'],
 ['historical','待核對歷史資料','保留舊帳及核對證據，不與新訂單提醒混算'],
];

export function TaskDashboard({state,tasks,onNavigate,onOrder}){
 const model=taskDashboardModel(state,tasks);
 const go=task=>{onNavigate(destinations[task.type]||'orders');if(task.type==='order')onOrder(task.object_id)};
 return <>
  <section className="task-overview" aria-label="待辦分類統計">
   {sections.map(([key,label])=><div key={key} className={'task-overview-card '+key}><span>{label}</span><strong>{model[key].taskCount} <small>筆提醒</small></strong><small>{model[key].orderCount} 筆關聯客單</small></div>)}
  </section>
  <p className="task-explainer">共 {model.rawCount} 筆原始提醒，依處理責任分流；同一客單的多筆提醒保留各自紀錄，客單數不重複計算。</p>
  {sections.map(([key,label,description])=>{
   const data=model[key];
   return <section className={'panel task-category '+key} key={key}>
    <details open={key==='action'?true:undefined}>
     <summary className="task-category-heading"><span><b>{label}</b><small>{description}</small></span><strong>{data.taskCount} 項 · {data.orderCount} 筆客單</strong></summary>
     {data.groups.length?data.groups.map(group=><details key={group.key} className="task-order">
      <summary><b>{group.title}</b><span>{group.tasks.length} 筆提醒{group.orderId?' · 同一客單':' · 獨立事項'}</span></summary>
      {group.tasks.map(task=><button key={task.id} type="button" className="task" onClick={()=>go(task)}><i className={'priority p'+task.priority}/><span><b>{task.title}</b><small>{task.detail}</small></span><span>前往 →</span></button>)}
     </details>):<p className="empty">這個分類目前沒有提醒。</p>}
    </details>
   </section>;
  })}
 </>;
}
