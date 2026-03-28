---
name: ppbears-deploy
description: PPBears SaaS 完整部署流程。每次部署到生產環境時必須透過此 SKILL，確保 Render 後端與 Vercel 管理後台都正確更新。
---

# PPBears SaaS 部署 SKILL

## ⚠️ 鐵則（每次部署必讀）

1. **絕對不可修改任何功能程式碼**，只執行版號更新、CHANGELOG、提交與部署驗證。
2. **每次部署必須完成以下全部步驟**，不可跳過任何一步。
3. **vercel.json 只能包含 `{"version": 2}`**，絕對不可加入 `rootDirectory`、`buildCommand`、`outputDirectory` 等屬性（Vercel dashboard 設定即可，加入會導致 schema 驗證失敗）。
4. Vercel **不依賴 Build Cache**，必要時強制 Redeploy without cache（見步驟 4）。

---

## 部署架構

| 服務 | 平台 | 觸發方式 |
|------|------|----------|
| 後端 API (`packages/backend`) | Render.com | git push 自動觸發 |
| 管理後台 (`packages/admin`) | Vercel.com | git push 自動觸發，**失敗時需手動強制** |

---

## Step 1：更新版號

修改以下兩個檔案中的 `version` 欄位（admin 與 backend 版號必須一致）：
- `packages/admin/package.json`
- `packages/backend/package.json`

例如：`"version": "0.4.3"` → `"version": "0.4.4"`

---

## Step 2：撰寫 CHANGELOG

在根目錄 `CHANGELOG.md` 最頂部新增本次版本的條目，格式如下：

```markdown
## [vX.X.X] - YYYY-MM-DD
### ✨ 功能 / 🐛 修正
- 說明本次更動內容
```

---

## Step 3：推送至 GitHub

```powershell
cd c:\Users\till2\Documents\trae_projects\ppbears-LINE
git add .
git commit -m "feat: [功能說明] vX.X.X - $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git push origin main
```

> GitHub push 成功後，Render 與 Vercel 的 CI/CD 會自動啟動（需等待 2~5 分鐘）。

---

## Step 4：Vercel 部署強制驗證（必做）

**等待 3 分鐘後**，使用瀏覽器執行以下驗證：

### 4a. 確認自動部署正常
前往 `https://vercel.com` → 進入 `ppbears-admin` 專案 → 點選 **Deployments**。

確認最新部署：
- 狀態為 ✅ **Ready**（非 ❌ Error / ⏳ Building）
- Commit 訊息與你剛推送的一致

### 4b. 若部署失敗或卡住（觸發頻率上限/Build Cache 問題）

> **這是昨天出錯的根本原因。每次部署後都要確認此步驟。**

在 Vercel **Deployments** 頁面：
1. 找到最新的部署條目，點右側 `...` 選單
2. 選擇 **Redeploy**
3. 在彈出視窗中：
   - ☑️ **取消勾選** "Use existing Build Cache"（避免舊快取覆蓋新代碼）
   - 點選 **Redeploy** 確認
4. 等待新部署完成（狀態變為 ✅ Ready）

### 4c. 若遇到 Deployment Rate Limit（部署頻率上限）

> 當一天內部署次數過多，自動部署會被 Vercel 暫停，需改用手動建立：

1. 在 Vercel 專案頁面，點右上角 `...` 選單
2. 選擇 **Create Deployment**
3. 在 Ref 欄位輸入最新 commit hash（從 `git log --oneline -1` 取得）
4. 點 **Create Deployment** 確認，等待完成

---

## Step 5：功能驗證

部署完成後，驗證以下端點正常：

```
🟢 Render 後端：https://ppbears-line-saas.onrender.com/health
🟢 Vercel 管理後台：https://ppbears-admin.vercel.app
```

並實際進入管理後台，確認本次更新的新功能/修復已正確呈現在 UI 上。

---

## 常見錯誤與解法

| 錯誤現象 | 根本原因 | 解法 |
|----------|----------|------|
| Vercel 顯示 Error（schema 驗證失敗） | `vercel.json` 含有非法屬性 | 確保 `vercel.json` 只有 `{"version": 2}` |
| Vercel 部署成功但網站仍顯示舊版 | Build Cache 命中，未真正重新編譯 | Step 4b：Redeploy without cache |
| GitHub push 後 Vercel 無反應 | Deployment Rate Limit 觸發 | Step 4c：Create Deployment 手動指定 commit |
| Render 健康檢查失敗 | 後端 build 錯誤或環境變數遺漏 | 查看 Render Dashboard 的 Logs |
