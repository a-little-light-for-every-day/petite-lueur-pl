import React,{useState}from'react';
import{parseDraftCatalogJSON}from'../catalog-batch-draft.js';

export function DraftCatalogImport({s,run}){
 const[groupId,G]=useState(''),[raw,R]=useState(''),[confirm,C]=useState(false),[busy,B]=useState(false),[message,M]=useState('');
 let preview=null,error='';
 if(raw.trim()&&groupId){try{preview=parseDraftCatalogJSON(raw,groupId);}catch(e){error=e.message;}}
 const target=s.groups.find(g=>g.id===groupId);
 async function submit(){
  if(!preview||!confirm||busy)return;
  B(true);M('');
  try{
   const {result}=await run({type:'catalog_batch_draft',group_id:groupId,confirmed:true,products:preview.products});
   M(`已匯入 ${result.imported} 款草稿，重複跳過 ${result.skipped} 款；全部維持不公開。`);
   C(false);
  }catch(e){M(`匯入未完成：${e.message}`);}finally{B(false);}
 }
 return <section className="panel"><h2>批次匯入商品草稿（保留來源編號）</h2>
  <p className="note">先在「團次與結單」建立原始團次 ID，再於此選擇團次並貼上商品 JSON 陣列。商品一律保留草稿，國際運費、官方原圖及公開狀態須逐項審核；不會自動寄信或改動既有訂單。</p>
  <label className="field"><span>匯入目標團次</span><select value={groupId} onChange={e=>{G(e.target.value);C(false);M('');}}>
   <option value="">請先選擇團次</option>{s.groups.map(g=><option key={g.id} value={g.id}>{g.title}｜{g.id}</option>)}
  </select></label>
  <label className="field"><span>商品 JSON 陣列（每款需 id、name、price_twd、source_url，可附 group_id、variant、image_url）</span>
   <textarea rows="8" spellCheck="false" value={raw} onChange={e=>{R(e.target.value);C(false);M('');}} placeholder={'[{"id":"NEOGDS-...","group_id":"原團次ID","name":"官方商品名稱","price_twd":240,"source_url":"https://www.neowing.co.jp/..."}]'}/>
  </label>
  {error&&<p className="error" role="alert">{error}</p>}
  {preview&&<div className="record"><p>預覽：<b>{preview.products.length} 款</b> · 待核實運費 {preview.missingShipping} 款 · 無官方圖片 {preview.missingImage} 款</p>
   <details><summary>展開檢查商品與原始 ID</summary>{preview.products.map(p=><p key={p.id}>{p.id}｜{p.name} {p.variant}｜NT${p.price_twd}</p>)}</details>
   <label className="check"><input type="checkbox" checked={confirm} onChange={e=>C(e.target.checked)}/>我已確認這 {preview.products.length} 款屬於「{target?.title}」，只匯入草稿、不公開上架。</label>
  </div>}
  <button disabled={!preview||!confirm||busy} onClick={submit}>{busy?'正在安全匯入…':'確認批次匯入草稿'}</button>
  {message&&<p role="status">{message}</p>}
 </section>;
}
