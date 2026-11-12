import React,{useState}from'react';

export function LegacySingleImportPanel({run}){
 const [payload,P]=useState(''),[confirmed,C]=useState(false),[busy,B]=useState(false),[error,E]=useState('');
 return <section className="panel"><h2>保留原單號的單筆安全匯入</h2>
 <p>僅供核對過的舊版訂單補入正式營運資料。須填原單號、原 Notion 頁面與修改時間、姓名、Email、正式團次及一項商品。禁止覆寫；不建立帳款、不寄付款通知。原 Notion 頁面及既有履約紀錄均保留。</p>
 <label>單筆核對資料（JSON）<textarea rows="8" value={payload} onChange={e=>{P(e.target.value);C(false);E('')}} placeholder='{"order_id":"PL-...","name":"...","email":"...","group_id":"...","source_url":"https://www.notion.so/p/...","source_revision":"...","source_status":"訂購申請待確認","source_payment_status":"尚未通知付款","expected_goods_twd":550,"items":[{"name":"...","sku":"...","quantity":1,"unit_price_twd":550,"shipping_units":2}]}'/></label>
 <label className="check"><input type="checkbox" checked={confirmed} onChange={e=>C(e.target.checked)}/>已核對正式來源，確認只補這筆、不寄付款通知</label>
 <button disabled={!confirmed||busy||!payload.trim()} onClick={async()=>{B(true);E('');try{const data=JSON.parse(payload);await run({type:'legacy_order_import_single',...data,confirmed:true});P('');C(false)}catch(e){E(e.message)}finally{B(false)}}}>{busy?'匯入中…':'確認單筆安全匯入'}</button>
 {error&&<p className="error">{error}</p>}</section>;
}
