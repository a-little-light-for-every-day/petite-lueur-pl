import{productionStorefront}from '../production-storefront.js';
import{build}from'esbuild';import{readFileSync,writeFileSync}from'node:fs';
const r=await build({entryPoints:['app.jsx'],bundle:true,minify:true,format:'iife',target:['es2022'],define:{'process.env.NODE_ENV':'"production"'},write:false,outdir:'dist',legalComments:'eof'});const js=r.outputFiles.find(f=>f.path.endsWith('.js')).text,css=r.outputFiles.find(f=>f.path.endsWith('.css')).text;
const html='<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>Petite Lueur PL｜營運工作台</title><style>'+css+'</style></head><body><div id="root"></div><script src="/operations-app.js" defer></script></body></html>';
writeFileSync('../operations-bundle.js','// Generated from console/app.jsx. React / Refine CORE license notices retained.\nexport default '+JSON.stringify(js)+';\n');writeFileSync('../operations-html.js','// Generated operations shell.\nexport default '+JSON.stringify(html)+';\n');console.log('Console built:',js.length,'JS bytes,',css.length,'CSS bytes');

// PL3's own public homepage and privacy notice. Keep both on the Worker origin
// so the previous GitHub Pages deployment can eventually be retired safely.
const logo='data:image/jpeg;base64,'+readFileSync('../../assets/pl-logo.jpg').toString('base64');
const homepage=readFileSync('homepage.html','utf8').replace('__PL_OFFICIAL_LOGO__',logo);
const accountHeader=`<header class="account-site-header"><div>
  <a href="/" class="account-site-brand"><img src="${logo}" width="44" height="44" alt="">Petite Lueur PL</a>
  <nav aria-label="官網導覽"><a href="/">官網首頁</a><a href="/#shop">開團商品</a><a href="/account" aria-current="page">訂單查詢</a></nav>
</div></header>`;
const accountCss=readFileSync('account-site.css','utf8');
const accountHtml=html.replace('</style>',accountCss+'</style>').replace('<body>','<body class="account-site">'+accountHeader);
writeFileSync('../operations-account-html.js','// Generated customer account shell.\nexport default '+JSON.stringify(accountHtml)+';\n');
writeFileSync('../homepage-html.js','// Generated PL3 public homepage.\nexport default '+JSON.stringify(homepage)+';\n');
writeFileSync('../privacy-html.js','// Generated PL3 privacy notice.\nexport default '+JSON.stringify(readFileSync('privacy.html','utf8'))+';\n');
writeFileSync('../admin-html.js','// Generated from admin-test.html.\nexport default '+JSON.stringify(readFileSync('../admin-test.html','utf8'))+';\n');

writeFileSync('../operations-receiver-source.js','// Generated owner-only receiver source. No credentials included.\nexport default '+JSON.stringify(readFileSync('../formal-sync-adapter.gs','utf8')+'\n'+readFileSync('../operations-receiver.gs','utf8'))+';\n');

const storefront=productionStorefront(readFileSync('../../index.html','utf8'),{preview:true});
writeFileSync('../storefront-preview-html.js','// Generated preview of the current branded storefront.\nexport default '+JSON.stringify(storefront)+';\n');
writeFileSync('../storefront-cutover-source.js','// Generated public entry-point adapter.\nexport default '+JSON.stringify(readFileSync('../storefront-cutover.js','utf8'))+';\n');
