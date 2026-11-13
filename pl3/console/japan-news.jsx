import React,{useEffect,useState}from'react';
const blank={id:'',date:new Date().toISOString().slice(0,10),title:'',summary:'',sourceUrl:'',postUrl:'',coverUrl:'',published:false};
export function JapanNewsDesk({api}){
 const[rows,R]=useState([]),[form,F]=useState(blank),[loading,L]=useState(true),[busy,B]=useState(false),[uploading,U]=useState(false),[error,E]=useState(''),[notice,N]=useState('');
 async function load(){L(true);E('');try{const d=await api('/api/admin/japan-news');R(d.items||[]);}catch(e){E(e.message||'情報載入失敗');}finally{L(false);}}
 useEffect(()=>{load()},[]);
 function change(k,v){F(x=>({...x,[k]:v}));}
 async function uploadImage(e){const file=e.target.files?.[0];e.target.value='';if(!file)return;E('');N('');if(!['image/png','image/jpeg'].includes(file.type)){E('請選擇 PNG 或 JPEG 圖片。');return;}if(file.size>1000000){E('圖片不可超過 1 MB。');return;}U(true);try{const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('圖片讀取失敗'));reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.readAsDataURL(file);});const uploaded=await api('/api/admin/ops/attachment',{name:file.name,mime_type:file.type,base64_data:base64});if(!uploaded.file?.id)throw new Error('附件上傳未回傳識別碼');const coverUrl=new URL('/api/public/japan-news-image?id='+encodeURIComponent(uploaded.file.id),window.location.origin).href;change('coverUrl',coverUrl);N('圖片已上傳；儲存情報後會依公開狀態顯示。');}catch(e){E(e.message||'圖片上傳失敗');}finally{U(false);}}
 async function save(e){e.preventDefault();if(busy)return;B(true);E('');N('');try{await api('/api/admin/japan-news',{...form,published:!!form.published});F(blank);N(form.published?'情報已儲存並公開到正式商店的「日本新品情報」。':'情報已儲存為草稿，尚未公開。');await load();}catch(e){E(e.message||'儲存失敗');}finally{B(false);}}
 function edit(row){F({...row,published:!!row.published});N('');E('');window.scrollTo({top:0,behavior:'smooth'});}
 return <><section className="panel"><h2>{form.id?'編輯日本新品情報':'新增日本新品情報'}</h2><p className="note">此頁會同步至正式商店「日本新品情報」。只有勾選「公開」的內容會顯示給訪客；商品尚未公開時，請清楚標示「待官方續報」，不可當作已開團商品。</p><form onSubmit={save}>
 <label className="field"><span>公告日期</span><input required type="date" value={form.date} onChange={e=>change('date',e.target.value)}/></label>
 <label className="field"><span>標題</span><input required maxLength="180" value={form.title} onChange={e=>change('title',e.target.value)}/></label>
 <label className="field"><span>情報摘要</span><textarea required rows="5" maxLength="2000" value={form.summary} onChange={e=>change('summary',e.target.value)}/></label>
 <label className="field"><span>官方消息網址（必填）</span><input required type="url" placeholder="https://" value={form.sourceUrl} onChange={e=>change('sourceUrl',e.target.value)}/></label>
 <label className="field"><span>官方貼文網址（選填）</span><input type="url" placeholder="https://" value={form.postUrl} onChange={e=>change('postUrl',e.target.value)}/></label>
 <label className="field"><span>官方圖片網址（選填）</span><input type="url" placeholder="https://" value={form.coverUrl} onChange={e=>change('coverUrl',e.target.value)}/></label>
 <label className="field"><span>或直接上傳圖片</span><input type="file" accept="image/png,image/jpeg" disabled={uploading||busy} onChange={uploadImage}/><small className="note">支援 PNG、JPEG，單檔上限 1 MB。上傳後請儲存情報；僅公開的情報圖片會提供給訪客。</small></label>
 <label><input type="checkbox" checked={!!form.published} onChange={e=>change('published',e.target.checked)}/> 公開到正式商店「日本新品情報」</label>
 <div className="actions"><button disabled={busy}>{busy?'儲存中…':'儲存情報'}</button>{form.id&&<button type="button" className="secondary" onClick={()=>{F(blank);E('');N('');}}>新增另一則</button>}</div>
 </form>{error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}</section>
 <section className="panel"><div className="sectionhead"><h2>已管理的日本新品情報</h2><button type="button" className="secondary" onClick={load}>重新整理</button></div>{loading?<p>載入中…</p>:rows.length?rows.map(row=><article className="record" key={row.id}><div className="sectionhead"><div><h3>{row.title}</h3><p className="note">{row.date} · {row.published?'已公開':'草稿'} · 更新於 {new Date(row.updatedAt).toLocaleString('zh-TW')}</p></div><button type="button" className="secondary" onClick={()=>edit(row)}>編輯</button></div><p>{row.summary}</p><a href={row.sourceUrl} target="_blank" rel="noreferrer">官方消息 ↗</a>{row.coverUrl&&<p><img src={row.coverUrl} alt="" loading="lazy" style={{maxWidth:'min(100%,420px)',borderRadius:12}}/></p>}</article>):<p className="empty">目前尚無管理中的日本新品情報。</p>}</section></>;
}
