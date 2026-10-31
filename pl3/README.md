# Petite Lueur PL 3.0 — 隔離測試環境（尚未正式部署）

這個資料夾與[正式 PL 2.0 網站](https://a-little-light-for-every-day.github.io/petite-lueur-pl/)獨立。主分支、Apps Script、客人訂單及 Notion／試算表均未切換。

## 這一階段已建立

- src/index.ts：Cloudflare Workers 唯讀 API：GET /api/health、GET /api/catalog。沒有任何建立訂單、寄送 OTP、付款或後台寫入入口。
- migrations/0001_schema.sql：D1 商品／團次以及空白的未來訂單、OTP、付款回報、履約事件、同步佇列、衝突資料表。
- fixtures/demo.sql：純假資料，用來測試公開／隱藏／已結單／已過期／售完的商品過濾。
- public/index.html：顯示明確「STAGING／示範／禁止下單」的簡單測試網站。
- scripts/smoke.mjs：測試假資料只公開一筆、關單不曝光、無客資、禁止寫入。

**目前沒有實際 Cloudflare D1 資料庫 ID、沒有上線測試網址、沒有測試效能數字。** 這些必須完成 Cloudflare 帳戶內的隔離環境建置後才能驗證。

## 在隔離的開發電腦測試

1. 進入 pl3/、執行 npm install。
2. 執行 npm run db:migrate:local 建立本地 D1。
3. 執行 npm run db:seed:local 寫入假商品。
4. 啟動 npm run dev，造訪 http://127.0.0.1:8787。
5. 在另一個終端執行 npm run test:smoke。

## 建立 Cloudflare 遠端測試環境（尚待執行）

1. 透過主購授權的 Cloudflare 帳戶建立名為 pl3-staging 的獨立 D1 資料庫，不使用正式環境資料庫。
2. 將 Cloudflare 回傳的 D1 UUID 填入 wrangler.toml，取代 00000000-0000-0000-0000-000000000000。
3. 先使用假資料執行 npx wrangler d1 migrations apply pl3-staging --remote，以及 npx wrangler d1 execute pl3-staging --remote --file=./fixtures/demo.sql。
4. 遠端部署 npx wrangler deploy，確認測試網址、API 回應、關單後不再顯示、延遲。
5. 遠端測試資料不得包含真實客人的 Email、個資、付款帳戶、訂單或 OTP。

## 尚未實作：不能誤認為遷移完成

- 將全部 90 筆《偶像學園！》及既有團次從 Notion／試算表可靠地同步至 D1，並做 ID、規格、尺寸與截止時間比對。
- 釐清 Apps Script、Notion 與試算表的資料主從、衝突規則和公開審核旗標。
- 含交易原子性、冪等鍵、刷卡上限 NT$22,000 的訂單 API；Email OTP、本人查單、付款回報與銀行核帳分離。
- 拆團配額、履約事件、主購安全登入、手機後台以及正式訂單完整遷移。
- 雙讀比對、備份、回復流程與主購再次明確核准正式切換。

## 安全原則

所有 API 必須以服務端欄位白名單公開資料；商品與團次均經主購核准，且團次狀態為 open/reopened、現在未過截止時間，才允許輸出。絕不將 Notion 金鑰、Cloudflare API Token、客資、OTP、付款資訊或實刷成本寫入 GitHub。

管理計畫：[Notion｜PL 3.0 遷移與驗收計畫](https://app.notion.com/p/40a52485b66081d8b600ce6cf5cbe2eb?pvs=204)。
