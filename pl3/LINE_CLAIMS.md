# PL LINE 圖片引用自動認領｜開發候選版

**目前狀態：已完成程式及 11 項本機測試；尚未部署，也尚未連接正式 LINE Worker。**

這個模組只建立待確認認領紀錄，不建立正式訂單、不鎖庫存、不發送付款通知、不更動既有付款／核帳表。

## 設計

- LINE 官方帳號一對一聊天：客人輸入「PL認領 商品ID +2」，建立待確認紀錄。
- **一般 LINE 群組**：將官方帳號加入群組、開放 Bot join group 並設定群組白名單。主購先貼官方商品原圖，再引用該圖片回覆「PL綁定 商品ID」。客人引用同一張圖回覆「+2」，系統透過 quotedMessageId 對照資料庫，不猜圖片內容。
- LINE OpenChat 記事本社群不是 Messaging API 一般群組；無法以這個方法直接監聽 OpenChat。
- 圖片只留 LINE 訊息 ID，不儲存、下載、改作商品原圖。

## 整合與發布條件

1. **先取得並核對目前 Cloudflare 線上 pl-line-webhook 的完整程式**，不可用 10 月版快照覆蓋。PL3 Worker 與 LINE Worker 為不同服務。
2. 在驗證 X-Line-Signature 之後，讓既有 webhook 訊息處理流程呼叫本模組 createLineClaimHandler。回傳 null 時維持原有 PL 開團／價格試算／查單／付款等流程；回傳字串時用當次 replyToken 回覆一次。不要讓舊訊息處理器再次使用同一個 replyToken。
3. 確認 LINE Worker 具有同一份 PL3 D1 的 DB binding；**先做資料庫備份**，再審核／手動套用 migrations/0007_line_claims.sql。
4. 環境變數：PL_LINE_CLAIMS_ENABLED=true；PL_LINE_CLAIM_GROUP_IDS 設定允許群組的 ID（逗號分隔）。Secrets：PL_LINE_CLAIM_HASH_SECRET（至少 24 字元）；管理員 LINE ID 沿用 PL_TEST_USER_ID。這些值不得提交 GitHub。
5. 介面呼叫如下：

```js
const handler = createLineClaimHandler({
  db: env.DB,
  ownerId: env.PL_TEST_USER_ID,
  allowedGroupIds: (env.PL_LINE_CLAIM_GROUP_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
  hashSecret: env.PL_LINE_CLAIM_HASH_SECRET,
  enabled: env.PL_LINE_CLAIMS_ENABLED === 'true'
});
const responseText = await handler(lineWebhookEvent);
// null => continue existing handler; string => send through existing LINE reply API exactly once
```

6. 在隔離環境驗證：非允許群組、非主購綁定、圖片未綁定、草稿、已截止／售完、超數量、超 NT$22,000、重送 webhook、LINE API 回覆失敗、未設密鑰、不同用戶等情形，均不得寫入正式訂單。
7. 上線前確定 PL3 的 groups/products 資料與目前正式網站公開商品一致。現有 PL3 尚有另外一套營運資料狀態，因此 **不可在未核對資料來源前開啟客戶認領**。
8. 完成認領後仍須由客人到 PL 正式網站申請並通過主購審核；目前的認領編號尚未自動綁定網站 Email OTP 身分，因此不屬於正式訂單。

## 資料及隱私

- D1 只保留 HMAC-SHA256 的 LINE userId 雜湊與認領紀錄，不能從中取得客人的 LINE 身分、姓名、付款或配送資訊。
- 待確認登記不可自動扣庫存、通知付款或建立採購。
- 未來上線需由主購後台以受保護方式檢視認領紀錄並設定保存及刪除政策；目前沒有對外顯示這些個資的 API。

正式網站：https://a-little-light-for-every-day.petitelueur-pl.workers.dev/
