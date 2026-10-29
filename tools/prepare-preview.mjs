import fs from 'node:fs';
fs.mkdirSync('dist',{recursive:true});
let html=fs.readFileSync('index.html','utf8');
const oldStore='https://script.google.com/macros/s/AKfycbx4PHYxXV1YMsA4h9PCduQ0pAStXFq8TdQV2bEPt3lxr2x-ciq6zNJmFF-Gx1ByTgtYhQ/exec';
const owner = String(process.env.GITHUB_REPOSITORY_OWNER || 'saoririri').toLowerCase();
const pagesOrigin = 'https://' + owner + '.github.io';
const sourceOrigin = 'https://saoririri.github.io';
html = html.replaceAll(sourceOrigin, pagesOrigin);
const payloadPattern = /(<div\b[^>]*\bid="plInitialStoreData"[^>]*\bdata-payload=")([^"]+)(")/;
const payloadMatch = html.match(payloadPattern);
if (!payloadMatch) throw new Error('Published product snapshot missing');
const data = JSON.parse(Buffer.from(payloadMatch[2], 'base64url').toString('utf8'));
if (!Array.isArray(data.products) || data.products.some(p => p.published === false)) throw new Error('Unexpected unpublished products in public snapshot');
if(data.siteSettings) data.siteSettings.canonicalUrl=pagesOrigin+'/petite-lueur-pl/';
const adapted = Buffer.from(JSON.stringify(data),'utf8').toString('base64url');
html = html.replace(payloadPattern, (_, a, b, c) => a + adapted + c);

html=html.replace('<meta name="robots" content="index,follow,max-image-preview:large">','<meta name="robots" content="noindex,nofollow">');
const guard=`<style>
#plGithubPreviewBar{position:sticky;top:0;z-index:9999;background:#6d4345;color:#fff;padding:12px 18px;text-align:center;font:600 14px/1.6 system-ui,sans-serif}
#plGithubPreviewBar a{color:#fff;text-decoration:underline}
</style>
<div id="plGithubPreviewBar" role="status">GitHub 新站測試版｜已搬入公開商品，但尚未開放訂購、詢問與查單。
<a href="${oldStore}" target="_blank" rel="noopener noreferrer">交易請使用原正式網站</a></div>
<script>
// Temporary DOM-only diagnostics for cross-origin bridge validation.
document.documentElement.dataset.plBridgeSignal='waiting';
window.addEventListener('message',function(event){
  const data=event.data;
  if(!data||typeof data!=='object')return;
  if(data.type==='PL_GAS_READY'){
    document.documentElement.dataset.plBridgeSignal='ready';
    document.documentElement.dataset.plBridgeOrigin=event.origin;
  }
  if(data.type==='PL_GAS_REPLY'){
    document.documentElement.dataset.plBridgeReply=String(data.ok);
  }
});
window.PL_STATIC_PREVIEW_ONLY=true;
// Allow public read methods through the real GAS bridge during verification.
window.addEventListener('DOMContentLoaded',function(){
  const rpc=window.plGithubRpc;
  if(typeof rpc!=='function')return;
  const reads=new Set(['plStoreBootstrap','plStoreLoadEnhancements','plStoreListPublicSplitGroups','plGetShoppingGuide']);
  window.plGithubRpc=function(name,args){
    if(!reads.has(name))return Promise.reject(new Error('新網站尚在驗收，請使用原正式商店進行交易'));
    return rpc(name,args);
  };
},{once:true});
document.addEventListener('click',function(e){
 const target=e.target.closest && e.target.closest('button');
 if(!target)return;
 const dangerous=/submit|otp|payment|verify|sendOtp|wish|inquiry/i.test((target.getAttribute('onclick')||'')+' '+(target.id||''));
 if(dangerous){e.preventDefault();e.stopImmediatePropagation();alert('新網站尚在驗收，請使用原正式網站進行訂購與查單。')}
},true);
</script>`;
html=html.replace('<body>','<body>'+guard);
fs.writeFileSync('dist/index.html',html);
