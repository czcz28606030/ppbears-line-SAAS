---
description: 部署 PPBears SaaS 更新到 GitHub (自動觸發 Render 後端與 Vercel 管理後台部署)
---

# 部署流程：PPBears SaaS

> ⚠️ **每次部署必須完整執行此流程，絕不跳步。**  
> 詳細說明與常見錯誤解法請參閱：`skills/deploy/SKILL.md`

---

## 1. 更新版號

修改 `packages/admin/package.json` 與 `packages/backend/package.json` 的 `version` 欄位（兩者必須一致）。

---

## 2. 撰寫 CHANGELOG

在根目錄 `CHANGELOG.md` 頂部新增本次版本條目（格式參考文件內現有條目）。

---

## 3. 推送到 GitHub

// turbo
```powershell
cd c:\Users\till2\Documents\trae_projects\ppbears-LINE
git add .
git commit -m "feat: [功能說明] vX.X.X - $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git push origin main
```

---

## 4. 等待 3 分鐘，然後強制驗證 Vercel（必做）

> **這是最常出問題的步驟。** 使用瀏覽器進入 Vercel Dashboard 驗證。

**4a. 自動部署正常** → 確認最新 Deployment 狀態為 ✅ Ready，且 Commit 訊息正確。

**4b. 若部署失敗或網站仍為舊版** → 在 Deployments 頁面點 `...` → **Redeploy** → **取消勾選 Build Cache** → 確認。

**4c. 若遇到 Rate Limit（自動部署被封鎖）** → 在專案頁 `...` → **Create Deployment** → 輸入最新 commit hash(`git log --oneline -1`) → 確認。

---

## 5. 驗證上線

```
🟢 Render 後端：https://ppbears-line-saas.onrender.com/health
🟢 Vercel 管理後台：https://ppbears-admin.vercel.app
```

進入管理後台，確認本次新功能/修復已正確顯示在 UI。
