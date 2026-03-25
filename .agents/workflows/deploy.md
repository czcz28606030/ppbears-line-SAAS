---
description: 部署 ppbears-LINE SaaS 專案到 GitHub（版本備份）並透過 FTP 上傳後端 build 到 Hostinger VPS
---

# 部署技能：ppbears-LINE SaaS (GitHub + FTP)

這個 skill 用於：將 ppbears-LINE 專案最新程式碼版本備份推送到 GitHub，同時透過 FTP 上傳建置結果到 Hostinger VPS。
**絕對不可修改任何功能程式碼，只執行打包與部署。**

---

## 部署主機資訊

| 欄位 | 值 |
|------|-----|
| FTP Host | `178.16.135.30` |
| 使用者名稱 | `u141631622.caca28606030` |
| 密碼 | `M@eXVDP+0\|l` |
| GitHub | `https://github.com/czcz28606030/ppbears-line-SAAS.git` |
| 專案根目錄 | `c:\Users\till2\Documents\trae_projects\ppbears-LINE` |

> **注意**：FTP 密碼已安全保存於此文件，之後部署可直接使用，不需再詢問使用者。

---

## ⚠️ 重要架構說明

本專案為 **Node.js 後端 (Fastify)** + **Next.js 管理後台**，不同於靜態 SPA 專案：

| 套件 | 部署方式 |
|------|---------|
| `packages/backend` | FTP 上傳 `dist/` + 由伺服器端 PM2/Node 執行 |
| `packages/admin` | FTP 上傳 next export `out/` (靜態) |

---

## 執行流程

### 步驟一：前置確認

// turbo
1. 確認沒有誤改功能程式碼。

```powershell
cd c:\Users\till2\Documents\trae_projects\ppbears-LINE
git status
git diff --stat
```

2. **詢問使用者**：「本次為 Bug 修復（Patch x.x.1）還是新功能（Minor x.1.0）？」
3. 根據回應更新 `package.json` 根目錄版號。
4. 根據最新任務幫使用者補上 `CHANGELOG.md` 新增內容。

---

### 步驟二：打包後端（Backend Build）

// turbo
```powershell
cd c:\Users\till2\Documents\trae_projects\ppbears-LINE
npm run build -w packages/backend
```

> 驗證打包結果：
```powershell
# 確認 dist 存在且有檔案
Get-ChildItem packages\backend\dist | Measure-Object | Select-Object Count
```

---

### 步驟三：打包管理後台（Admin Static Export）

// turbo
```powershell
cd c:\Users\till2\Documents\trae_projects\ppbears-LINE
npm run build -w packages/admin
```

> 驗證打包結果：
```powershell
Get-ChildItem packages\admin\.next | Measure-Object | Select-Object Count
```

---

### 步驟四：提交並推送到 GitHub

// turbo
```powershell
cd c:\Users\till2\Documents\trae_projects\ppbears-LINE
git add -A
git commit -m "chore: deploy update $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git branch -M main
git push -u origin main
```

---

### 步驟五：FTP 上傳後端 build

使用 WinSCP CLI 上傳後端建置結果（執行前確認 WinSCP 已安裝）：

```powershell
cd c:\Users\till2\Documents\trae_projects\ppbears-LINE
powershell -ExecutionPolicy Bypass -File scripts\deploy-ftp.ps1
```

若腳本不存在，手動執行 WinSCP：

```powershell
& "C:\Program Files (x86)\WinSCP\WinSCP.com" `
  /command `
  "open ftp://u141631622.caca28606030:M@eXVDP+0|l@178.16.135.30/" `
  "synchronize remote packages\backend\dist /ppbears-backend -delete" `
  "exit"
```

---

### 步驟六：部署後驗證

```powershell
# 確認後端服務（如 VPS 已設 PM2 自動重啟）
node -e "fetch('http://178.16.135.30:8080/health').then(r=>r.json()).then(console.log).catch(e=>console.log('Backend health check failed:', e.message))"
```

---

## 部署注意事項

1. **自動執行** — 使用者已授權，未來部署可直接使用此文件中的憑證，不需再詢問。
2. **不可修改功能程式碼** — 此 skill 只做版本標記與上傳。
3. **打包必須成功** — 若 `npm run build` 失敗，不可繼續 FTP 上傳。
4. **後端需 VPS 支援 Node.js** — FTP 上傳後需登入 VPS 以 `pm2 restart ppbears-backend` 重啟伺服器；若尚未設定 PM2，需另行配置。
5. **環境變數** — `.env` 不會上傳到 GitHub（在 `.gitignore`），需確認 VPS 上有正確的 `.env` 檔案。
