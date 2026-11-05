export const PL3_ORIGIN='https://pl3-staging-api.petitelueur-pl.workers.dev';
export function productionStorefront(source,{preview=false}={}){
 const entry='<script id="plStoreMainCode"',render='function renderEmbeddedStoreData(){';
 const gate='<script data-pl3-cutover="1">window.PL3_OPERATING_STOREFRONT=true;window.PL2_READONLY_RPC=window.plGithubRpc;window.plGithubRpc=()=>Promise.reject(Error("3.0連線暫時不可用，請稍後重試；尚未送出訂單。"));</script>\n<script src="'+PL3_ORIGIN+'/storefront-cutover.js"></script>\n';
 if(source.includes('data-pl3-cutover')){if(source.split('data-pl3-cutover="1"').length!==2||!source.includes(gate+entry)||!source.includes(render+'if(window.PL3_OPERATING_STOREFRONT)return false;'))throw Error('Storefront changed; review existing cutover');return preview?source.replace(/(src|href)=(["'])(assets\/[^"']+)/g,'$1=$2https://a-little-light-for-every-day.github.io/petite-lueur-pl/$3'):source;}
 if(source.split(entry).length!==2||source.split(render).length!==2)throw Error('Storefront changed; review the exact entry points before cutover');
 let html=source.replace(render,render+'if(window.PL3_OPERATING_STOREFRONT)return false;').replace(entry,gate+entry);
 if(preview)html=html.replace(/(src|href)=(["'])(assets\/[^"']+)/g,'$1=$2https://a-little-light-for-every-day.github.io/petite-lueur-pl/$3');
 return html.replace('</body>','<p style="text-align:center;padding:16px"><a href="https://a-little-light-for-every-day.github.io/petite-lueur-pl/privacy.html">資料使用與隱私說明</a></p>\n</body>');
}
export const productionAdminRedirect='<!doctype html><html lang="zh-Hant" data-pl3-admin-redirect="1"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="refresh" content="0;url='+PL3_ORIGIN+'/admin-operations"><title>Petite Lueur PL｜主購營運後台</title></head><body><p>正在開啟主購營運後台…</p><a href="'+PL3_ORIGIN+'/admin-operations">進入 PL 3.0 後台</a></body></html>';
