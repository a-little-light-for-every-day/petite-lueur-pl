# Petite Lueur PL｜官方品牌網站

Petite Lueur PL 日本・韓國代購前台。儲存庫由 GitHub 品牌組織 `a-little-light-for-every-day` 管理。

- **品牌網站**：https://a-little-light-for-every-day.github.io/petite-lueur-pl/
- **公開商品**：前端包含經主購核准的 159 件商品快照；進站後會向正式後端請求公開資料更新。
- **正式後端**：沿用原有 Google Apps Script（v251 起提供 `?staticBridge=1` 專用安全橋接入口）。
- **訂購、付款回報、Email OTP 查單**：透過受限的公開橋接呼叫既有 Apps Script 函式；訂單資料仍由後端驗證與儲存。
- **Notion／試算表同步**：仍由原有後端任務處理；GitHub Pages 只顯示核准公開的結果，並非資料庫。
- **管理後台**：維持原有 Google Apps Script／Notion 流程；不在 GitHub Pages 暴露管理 API。
- **自動部署**：推送 `main` 時 GitHub Actions 產生並發布 `dist/index.html`。

## 安全與發布規範

- 嚴禁提交 Notion API 金鑰、Apps Script 私密設定、客戶訂單個資、付款帳戶資料、OTP 或管理登入資訊。
- 新商品與商品圖片必須先獲主購核准；官方商品原圖不得重繪或改動。
- GitHub Pages 僅是公開網站；後端公開橋接必須繼續實施來源限制與函式白名單。
- 不可直接將試算表中的客戶／財務資訊輸出到公開的靜態快照。

## 上線驗收

- [x] 品牌組織及 GitHub Pages 部署
- [x] `?staticBridge=1` 橋接載入及允許的公開 RPC 回覆
- [x] 公開商品列表、規格和訂購介面顯示
- [ ] 以經同意的測試訂單驗證實際寫入及防重複送出
- [ ] 使用測試 Email 完成 OTP 寄送／驗證／查單
- [ ] 測試付款回報寫入及後台顯示
- [ ] 驗證完整 Notion → 試算表 → 網站動態更新延遲與資料一致性
