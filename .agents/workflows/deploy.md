---
description: 部署 PPBears SaaS 更新到 GitHub (自動觸發 Render 後端與 Vercel 管理後台部署)
---

# 部署技能：GitHub (Render + Vercel)

這個 skill 用於：將專案最新程式碼推送到 GitHub，這將自動觸發 Render.com (後端) 與 Vercel.com (管理後台) 的重新建置與部署。
**絕對不可修改任何功能程式碼，只執行程式碼提交與部署。**

---

## 執行流程

### 1. 更新版本並推送到 GitHub

這個步驟會將本機所有的修改存檔並推送到 GitHub 雲端備份。

// turbo
```powershell
cd c:\Users\till2\Documents\trae_projects\ppbears-LINE
git add .
git commit -m "chore: auto deploy and backup $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git push origin main
```

*(確認 GitHub 推送成功後，Render 與 Vercel 的 CI/CD 管線會自動捕捉到更新，並開始建置最新版本。此過程通常需要 1~3 分鐘。)*

### 2. 部署後驗證

請等待 2-3 分鐘後，驗證以下雲端服務狀態：

- 🟢 **確認 Render 後端健康狀態：** `https://ppbears-line-saas.onrender.com/health`
- 🟢 **確認 Vercel 管理後台狀態：** `https://ppbears-admin.vercel.app`
