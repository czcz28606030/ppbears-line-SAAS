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

---

# 📚 PPBears-LINE 專案完整架構理解

> **本部分記錄整個項目的運作方式、功能與架構，供所有後續維護與開發人員參考。**
> 最後更新：2026-04-23 by Copilot

## 1. 專案目的和定位

**PPBears CS SaaS** 是一個**多渠道 AI 客服解決方案**，為 WooCommerce 電商平台提供：

- 🤖 **AI 對話引擎**：支援 OpenAI、Google Gemini、Claude 的多模型動態路由
- 👥 **真人接管系統**：客服可隨時接管客戶對話，支援營業時間檢查
- 📱 **多渠道整合**：LINE、Messenger、WhatsApp（架構易於擴展）
- 🏪 **電商訂單查詢**：與 WooCommerce 深度整合，顧客可即時查詢訂單
- 📚 **知識庫 RAG**：向量搜尋（pgvector）支援，精準檢索企業知識
- 📢 **行銷推播**：按客戶標籤分眾廣播，支援 LINE Multicast
- 🏢 **多租戶管理**：支援多個商家自主配置 LLM、渠道、模板

**當前版本**：v0.5.33（2026-04-15）

---

## 2. 技術棧和依賴

### Backend (Node.js + Fastify)
- **框架**：Fastify 5.0（高性能 HTTP 伺服器）
- **數據庫**：Supabase（PostgreSQL + pgvector 向量擴展）
- **認證**：JWT + bcrypt
- **LLM 整合**：
  - OpenAI API（GPT-4, GPT-3.5-turbo）
  - Google Generative AI（Gemini）
  - Anthropic Claude
- **日誌**：Pino（結構化日誌）
- **部署平台**：Render.com（主要）/ Hostinger Docker（備份）

### Admin Panel (Next.js)
- **框架**：Next.js 15 + React 19
- **UI 元件**：Lucide React（圖標庫）
- **資料獲取**：SWR（React hooks）
- **特殊功能**：`/api/woo-relay` 中繼層（繞過 Hostinger WAF）
- **部署平台**：Vercel

### Monorepo 管理
- **工具**：Turbo.js
- **包管理**：npm@10.0.0，Node.js ≥20.0.0

---

## 3. 專案資料夾結構和作用

### 根目錄重點文件
- `package.json` - Monorepo 根配置
- `turbo.json` - Turbo 構建配置（定義 build、test 等任務）
- `render.yaml` - Render 部署配置
- `ROADMAP.md` - 5 大功能規劃方向
- `CHANGELOG.md` - 版本日誌（每次部署必須更新）
- `tsconfig.base.json` - TypeScript 基礎配置

### `/packages/admin/` - 管理後台 (Next.js)

**功能**：為租戶提供可視化管理介面

| 路由 | 功能 | 用途 |
|------|------|------|
| `/login` | 管理員登入 | JWT 驗證入口 |
| `/dashboard` | 儀表板 | 展示當日統計（消息量、活躍使用者等） |
| `/conversations` | 對話管理 | 查看和搜尋所有顧客對話 |
| `/live-agent` | 客服接管面板 | 即時接管和管理活躍會話 |
| `/broadcast` | 行銷推播 | 建立分眾廣播活動，按標籤推送訊息 |
| `/knowledge` | 知識庫 | 上傳文件（PDF/Word）→自動向量化 |
| `/products` | 商品管理 | 與 WooCommerce 同步的商品展示 |
| `/models` | LLM 配置 | 設定各個 LLM provider 的 API key 和模型選擇 |
| `/channels` | 渠道設定 | 設定 LINE/Messenger/WhatsApp 的 Access Token |
| `/tenants` | 多租戶管理 | 建立/管理多個商家租戶 |
| `/settings` | 租戶設定 | 營業時間、自訂觸發詞、WooCommerce URL 等 |
| `/usage` | 使用量統計 | API 調用、消息數統計 |
| `/audit-logs` | 操作審計 | 追蹤所有管理員操作 |
| `/audiences` | 客戶分眾 | 按標籤管理和查看客戶群體 |
| `/chat-test` | 測試對話 | 測試 AI 回應效果 |

**關鍵組件**：
- `lib/api.ts` - 後端 API 客戶端（統一的 fetch 包裝層）
- `lib/auth-context.tsx` - JWT 認證上下文（localStorage 存儲 token）
- `/api/woo-relay` - WooCommerce 代理端點（解決 Hostinger WAF 問題）

### `/packages/backend/` - API 伺服器 (Fastify)

**核心架構**：

```
backend/
├── src/
│   ├── app.ts                   ← Fastify 應用入口，中間件+路由綁定
│   ├── config/index.ts          ← 環境變數載入和驗證
│   ├── types/index.ts           ← TypeScript 型別定義和 API 介面
│   │
│   ├── channels/                ← 多渠道適配器層
│   │   ├── channel.registry.ts  ← 註冊中心（動態選擇適配器）
│   │   ├── line.channel.ts      ← LINE Bot 適配器
│   │   ├── messenger.channel.ts ← Messenger 適配器
│   │   ├── whatsapp.channel.ts  ← WhatsApp 適配器
│   │   └── webhook.routes.ts    ← 統一 Webhook 路由分發
│   │
│   ├── core/                    ← 核心編排和認證服務
│   │   ├── orchestrator.ts      ← 消息流程編排中樞
│   │   ├── auth.service.ts      ← 區分 admin vs customer 角色
│   │   ├── identity.service.ts  ← 用戶跨渠道身份解析
│   │   └── message-gate.ts      ← 8 秒消息智能合併機制
│   │
│   ├── modules/                 ← 功能模塊
│   │   ├── broadcast/           ← 行銷推播（按標籤分眾推送）
│   │   ├── conversation/        ← 對話歷史管理
│   │   ├── knowledge/           ← 知識庫 RAG（向量搜尋）
│   │   ├── live-agent/          ← 真人接管會話管理
│   │   ├── llm/                 ← 多模型路由和 LLM API 調用
│   │   ├── orders/              ← WooCommerce 訂單查詢
│   │   ├── products/            ← 商品同步
│   │   ├── tagging/             ← 客戶標籤系統
│   │   └── tenant/              ← 多租戶管理和計費
│   │
│   ├── routes/                  ← HTTP 路由定義
│   │   ├── admin.routes.ts      ← 管理 API
│   │   └── tenant.routes.ts     ← 租戶 API
│   │
│   ├── middleware/              ← Fastify 中間件
│   │   ├── auth.middleware.ts   ← JWT 驗證
│   │   └── tenant.middleware.ts ← 租戶隔離
│   │
│   └── utils/                   ← 工具函式
│       ├── logger.ts            ← Pino 日誌工具
│       ├── supabase.ts          ← Supabase 初始化
│       ├── audit.ts             ← 審計日誌記錄
│       ├── keep-alive.ts        ← 定期 ping 保活
│       └── woo-request.ts       ← WooCommerce API 代理
```

---

## 4. 核心業務流程：消息處理管線

### 流程圖

```
外部消息（LINE/Messenger/WhatsApp）
    ↓
┌─────────────────────────────────┐
│ [Webhook] 接收消息               │
│ route: POST /webhooks/{channel}/ │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ [Orchestrator.handleMessage]    │
│ - 驗證簽名                      │
│ - 解析平台特定的消息格式         │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 1️⃣ 解析用戶身份                 │
│ - identityService.resolveUser   │
│ - 查詢 channel_identities 表    │
│ - 取得 ppbears 系統內 user_id   │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 2️⃣ 判斷角色                      │
│ - authService.identifyRole      │
│ - admin 角色 → 特殊處理（如測試）│
│ - customer 角色 → 進入主流程     │
└─────────────────────────────────┘
    ↓
   [IF CUSTOMER]
    ↓
┌─────────────────────────────────┐
│ 3️⃣ 檢查真人接管                  │
│ - liveAgentService.isActive     │
│ - 若活躍 → 靜默保存消息，結束    │
│ - 若非 → 繼續 AI 流程            │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 4️⃣ 檢測真人觸發詞                │
│ - 預設關鍵字：『真人』『客服』   │
│ - 可自訂 (tenant_settings)      │
│ - 檢查營業時間 (Asia/Taipei TZ) │
│   ├─ 在營業時間                 │
│   │  → liveAgentService.activate│
│   │  → 發送「已連接客服」提示    │
│   └─ 非營業時間                 │
│      → 發送「已記錄，營業時間回覆」│
│      → 結束                     │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 5️⃣ Message Gate（8 秒合併）     │
│ - 消息進入隊列                  │
│ - 等待 8 秒                     │
│ - 無新消息 → flush 全部消息      │
│ - 有新消息 → 重新計時            │
│ - 發送「打字中...」動畫          │
│ - 儲存 reply_context             │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 6️⃣ onBatchReady 批處理回調       │
│                                 │
│ a) 意圖檢測                      │
│    - 訂單查詢 vs 一般對話         │
│                                 │
│ b) 知識庫檢索 (RAG)              │
│    - 向量相似度搜尋              │
│    - 取 top-3 相關文檔            │
│                                 │
│ c) 標籤檢測                      │
│    - 自動貼標籤 (taggingService) │
│    - 用於後續分眾推播            │
│                                 │
│ d) LLM 推理 (llmRouter)          │
│    - 查詢租戶預設 LLM 配置        │
│    - 組合：系統提示 + 知識庫結果 + 對話歷史 │
│    - 呼叫 LLM API (with retry)  │
│                                 │
│ e) 訂單查詢（如果檢測到）        │
│    - 呼叫 WooCommerce API       │
│    - via Vercel relay endpoint  │
│    - 結果返回 LLM 格式化          │
│                                 │
│ f) 發送回覆 (adapter.sendReply)  │
│    - 優先使用 replyToken（快速） │
│    - 退而使用 Push API（緩慢）   │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 7️⃣ 存儲和審計                    │
│ - 保存至 messages 表             │
│ - 更新 conversations             │
│ - 記錄 audit_logs                │
└─────────────────────────────────┘
```

### 核心服務詳解

#### **A. Orchestrator（編排中樞）**
- **職責**：接收 webhook，協調各服務執行
- **主要方法**：
  - `handleMessage(channel, event)` - 入口點
  - `handleAdmin(message)` - 管理員特殊邏輯
  - `handleCustomer(message)` - 顧客消息主流程

#### **B. AuthService（認證）**
- **職責**：區分 admin 和 customer 角色
- **邏輯**：
  - 若 platform_user_id 在 tenant_admin_users 中 → admin 角色
  - 否則 → customer 角色

#### **C. IdentityService（身份解析）**
- **職責**：跨渠道身份映射
- **流程**：
  1. 查詢 channel_identities 表（platform_user_id → ppbears user_id）
  2. 若無記錄 → 自動建立
  3. 返回 ppbears 系統內的統一 user_id

#### **D. MessageGate（8 秒合併）**
- **目的**：防止消息風暴、優化 LLM 調用成本
- **邏輯**：
  1. 消息到達 → 加入隊列
  2. 設定 8 秒計時器
  3. 若無新消息 → flush（調用 onBatchReady）
  4. 若有新消息 → 重新計時
  5. **示例**：顧客快速發 3 條消息 → 合併成 1 次 LLM 呼叫

#### **E. LiveAgentService（真人接管）**
- **模式**：
  - **點對點接管**：單個會話 (live_agent_sessions)
  - **營業時間檢查**：Asia/Taipei 時區
  - **自動過期**：24 小時或手動釋放
- **API 端點**：
  - `POST /api/tenant/live-agent/takeover` - 激活接管
  - `POST /api/tenant/live-agent/release` - 釋放接管
  - `GET /api/tenant/live-agent/active-sessions` - 查看活躍會話
- **最近修復** (v0.5.32)：修正「永久接管後自動恢復」bug

#### **F. KnowledgeBaseService（知識庫 RAG）**
- **流程**：
  1. 管理員上傳文件（PDF/Word/TXT）
  2. 後端自動分塊 (chunk_size=500, overlap=50)
  3. 使用 OpenAI text-embedding-3-small 向量化
  4. 存儲至 pgvector (knowledge_chunks 表)
  5. 查詢時按餘弦相似度檢索 top-k
- **降級方案**：向量搜尋失敗 → 文本模糊搜尋
- **支援格式**：PDF（pdf-parse）、Word（mammoth）、TXT

#### **G. LLMRouter（多模型路由）**
- **支援模型**：
  - OpenAI: GPT-4, GPT-3.5-turbo
  - Google: Gemini
  - Anthropic: Claude
- **決策邏輯**：
  1. 查詢租戶預設 LLM（tenant_model_configs）
  2. 組合系統提示 + 知識庫 + 對話歷史
  3. 呼叫 LLM API
  4. 若故障 → 自動轉移至備選模型
- **系統提示**：由 `prompts/agent.config.json` 定義

#### **H. OrdersModule（訂單查詢）**
- **檢測邏輯**：NLP 意圖檢測
  - 觸發關鍵字：「我的訂單」「訂單號」「查詢」等
- **查詢流程**：
  1. 透過 Vercel `/api/woo-relay` 中繼層
  2. 呼叫 WooCommerce REST API
  3. 取得訂單列表 → 解析結果
  4. LLM 自然語言格式化 → 返回客戶
- **最新修復** (v0.5.31)：Render IP 被 Hostinger WAF 列黑 → 改用 Vercel 中繼

#### **I. BroadcastModule（行銷推播）**
- **功能**：按標籤分眾推送訊息
- **流程**：
  1. 建立廣播活動 (broadcast_campaigns)
  2. 按 tag_filter 查詢符合條件的用戶
  3. 透過 channel_identities 取得 LINE platform_user_id
  4. 批量呼叫 LINE Multicast API（500 人/批）
  5. 記錄發送統計

#### **J. TenantModule（多租戶）**
- **子模塊**：
  - **tenant-management.service** - 租戶 CRUD、計費方案
  - **usage-tracking.service** - 消息量、API 調用量統計
  - **feature-flags.service** - 按訂閱方案開啟/關閉功能
- **租戶隔離**：
  - 所有查詢必須經過 `tenant_middleware.ts`
  - 確保 tenant_id 正確傳遞

---

## 5. 數據庫架構（Supabase PostgreSQL）

### 核心表結構

```sql
-- 租戶管理
tenants                          -- 租戶信息
├─ id, name, slug, plan, status, settings_json

tenant_admin_users              -- 管理員帳號
├─ id, tenant_id, email, password_hash, role, created_at

-- 渠道配置
tenant_channel_configs          -- 渠道 API 密鑰（已加密）
├─ id, tenant_id, channel_type ('line'|'messenger'|'whatsapp')
├─ credentials_encrypted, is_active, created_at

-- LLM 配置
tenant_model_configs            -- LLM provider 設定
├─ id, tenant_id, provider ('openai'|'google'|'anthropic')
├─ model_name, api_key_encrypted, is_default, created_at

-- 提示詞配置
tenant_prompt_configs           -- 系統提示詞
├─ id, tenant_id, prompt_type ('system'|'greeting'|'fallback'|'scope_guard')
├─ content, version, updated_at

-- 租戶設定（鍵值對）
tenant_settings                 -- 動態配置
├─ id, tenant_id, setting_key, setting_value, updated_at
├─ 示例：live_agent_hours_start, live_agent_hours_end, takeover_keywords, woo_base_url

-- 用戶身份
channel_identities              -- 跨渠道身份映射
├─ id, tenant_id, user_id (ppbears 系統內)
├─ channel_type, platform_user_id (LINE/Messenger ID)
├─ created_at

-- 對話和消息
conversations                   -- 對話記錄
├─ id, tenant_id, user_id, channel_type, status ('active'|'closed')
├─ created_at, last_message_at

messages                        -- 消息歷史
├─ id, conversation_id, role ('user'|'assistant'|'system')
├─ content, metadata_json (token_usage, model 等), created_at

-- 真人接管
live_agent_sessions            -- 接管會話
├─ id, tenant_id, user_id, reason, started_at, expires_at
├─ released_at (null = 活躍), released_by_admin_id

-- 客戶標籤
user_tags                       -- 標籤系統
├─ id, tenant_id, user_id, tag, value, created_at

-- 推播活動
broadcast_campaigns            -- 廣播活動
├─ id, tenant_id, tag_filter, status ('draft'|'scheduled'|'sent'|'failed')
├─ total_recipients, sent_count, created_at, sent_at

-- 知識庫
knowledge_documents            -- 文件管理
├─ id, tenant_id, filename, file_type ('pdf'|'docx'|'txt')
├─ status ('pending'|'processing'|'ready'|'error')
├─ uploaded_by_admin_id, created_at

knowledge_chunks               -- 向量分塊（RAG）
├─ id, document_id, content (text chunk)
├─ embedding (pgvector 1536D), chunk_index, created_at

-- 審計
audit_logs                      -- 操作審計
├─ id, tenant_id, actor_type ('admin'|'system'|'customer')
├─ actor_id, action, resource_type, changes_json, created_at
```

---

## 6. 環境變數和配置

### 必須的環境變數

```bash
# ========== 服務器配置 ==========
PORT=8080                                # Fastify 監聽端口
HOST=0.0.0.0                            # 監聽地址（允許外部訪問）
NODE_ENV=production                     # 環境（production/development）

# ========== Supabase 數據庫 ==========
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx           # 有完整權限的 key（後端用）
SUPABASE_ANON_KEY=xxx                   # 前端 public key

# ========== JWT 認證 ==========
JWT_SECRET=<never-share>                # JWT 簽名密鑰（務必保密）
JWT_EXPIRES_IN=8h                       # Token 過期時間
ADMIN_SESSION_DURATION_MINUTES=10       # 管理面板 session 超時

# ========== LLM 服務 ==========
OPENAI_API_KEY=sk-xxx                   # OpenAI API key
GOOGLE_API_KEY=xxx                      # Google Generative AI (Gemini)
ANTHROPIC_API_KEY=xxx                   # Anthropic Claude

# ========== WooCommerce 整合 ==========
WOO_BASE_URL=https://www.ppbears.com    # WordPress 網站 URL
WOO_CONSUMER_KEY=xxx                    # WooCommerce API key
WOO_CONSUMER_SECRET=xxx                 # WooCommerce API secret
WOO_PROXY_URL=https://ppbears-admin.vercel.app/api/woo-relay  # Vercel 中繼 URL
WOO_PROXY_SECRET=ppbx_8f3a2c9d7b1e4f6a0e5d2c8b              # 中繼層認證密鑰

# ========== LINE 整合 ==========
LINE_CHANNEL_SECRET=xxx                 # LINE Channel Secret
LINE_CHANNEL_ACCESS_TOKEN=xxx           # LINE Channel Access Token

# ========== Vercel 中繼層 ==========
WOO_RELAY_SECRET=ppbx_8f3a2c9d7b1e4f6a0e5d2c8b  # 中繼層認證

# ========== 流量限制 ==========
RATE_LIMIT_MAX=100                      # 限制請求數
RATE_LIMIT_WINDOW_MS=60000              # 限制時間窗口（毫秒）

# ========== Message Gate ==========
MESSAGE_GATE_WINDOW_MS=8000             # 合併時間窗口（毫秒）

# ========== Live Agent 配置 ==========
LIVE_AGENT_DURATION_HOURS=24            # 接管會話有效期
```

---

## 7. 部署架構

### 三層架構

```
┌────────────────────────────────┐
│ Layer 1: Admin Panel (UI)      │
│ - Next.js 15 on Vercel         │
│ - Public: ppbears-admin.vercel.app
├────────────────────────────────┤
│ Layer 2: Backend API (Logic)   │
│ - Fastify on Render.com        │
│ - Public: ppbears-line-saas.onrender.com
│ - Private Mirror: Hostinger Docker
├────────────────────────────────┤
│ Layer 3: Data (Persistence)    │
│ - Supabase PostgreSQL + pgvector
│ - WooCommerce (Hostinger PHP)  │
└────────────────────────────────┘
```

### 自動部署流程

| 操作 | 觸發 | 服務 | 結果 |
|------|------|------|------|
| Git push 至 main | Webhook | Render + Vercel | 自動構建部署（2-5 分鐘） |
| 部署失敗 | 手動介入 | Vercel Dashboard | Redeploy without cache |
| Rate Limit 超出 | 頻繁部署 | Vercel | Create Deployment（指定 commit hash） |

---

## 8. 核心依賴版本

| 依賴 | 版本 | 用途 |
|------|------|------|
| fastify | ^5.0.0 | HTTP 框架 |
| @line/bot-sdk | ^9.0.0 | LINE Bot SDK |
| @supabase/supabase-js | ^2.45.0 | Supabase 客戶端 |
| openai | ^4.70.0 | OpenAI API |
| @google/generative-ai | ^0.21.0 | Google Gemini |
| jsonwebtoken | ^9.0.0 | JWT |
| bcryptjs | ^3.0.3 | 密碼加密 |
| pino | ^9.0.0 | 結構化日誌 |
| next | ^15.0.0 | React SSR 框架 |
| react | ^19.0.0 | UI 庫 |
| swr | ^2.2.5 | 資料獲取 |
| lucide-react | ^0.469.0 | 圖標 |
| pdf-parse | ^1.1.1 | PDF 解析 |
| mammoth | ^1.8.0 | Word 解析 |

---

## 9. 常見故障排查

| 問題 | 根本原因 | 解決方案 |
|------|----------|----------|
| 訂單查詢失敗 | Render IP 被 WAF 列黑 | 確認使用 Vercel 中繼 (`WOO_PROXY_URL`) |
| 知識庫搜尋無結果 | 向量化失敗或查詢嵌入不匹配 | 檢查 OpenAI API key，重新上傳文件 |
| LLM 回應遲緩 | API 配額用完或模型故障 | 切換備選模型（llmRouter 自動故障轉移） |
| 真人接管無法激活 | 營業時間檢查失敗或 session 已過期 | 檢查 `live_agent_hours_start/end` 設定 |
| 廣播推播失敗 | LINE Multicast API 限制（500 人/批） | 檢查 recipient_count，拆分多批 |
| Admin 無法登入 | JWT 過期或密碼錯誤 | 清除 localStorage，重新登入 |

---

## 10. 診斷工具和端點

### 健康檢查
```bash
GET https://ppbears-line-saas.onrender.com/health
# 返回：{ status: 'ok', version: '0.5.33' }
```

### 管理 API（需登入）
```bash
# 連線測試
GET /api/admin/woo/test-connection

# 訂單查詢測試
GET /api/admin/woo/test-order?id=123

# 儀表板統計
GET /api/admin/dashboard/stats

# 對話列表
GET /api/admin/conversations

# 活躍真人接管會話
GET /api/tenant/live-agent/active-sessions
```

### 調試腳本
在 `scripts/` 目錄：
- `debug_intent.ts` - 測試意圖檢測
- `debug_search.ts` - 測試知識庫搜尋
- `debug_woo.ts` - 測試 WooCommerce 連線

---

## 11. 更新記錄和版本歷史

### 最近更新（v0.5.33）
- 修正深色模式下拉選單不可見 bug
- 優化知識庫檢索速度
- 新增對話導出功能

### 上一版本（v0.5.31-32）
- **v0.5.32**：修正永久接管後自動恢復 bug
- **v0.5.31**：訂單查詢改用 Vercel 中繼（Render IP 被 WAF 列黑）

### 部署時注意
每次部署必須：
1. 更新 `packages/admin/package.json` 和 `packages/backend/package.json` 的版號
2. 更新 `CHANGELOG.md`
3. 推送至 GitHub，等待 Render 和 Vercel 自動部署
4. 若 Vercel 部署失敗，使用 Redeploy without cache

---

## 12. 下一步開發方向

參考 ROADMAP.md 的優先級：

1. **跨平台社群整合** - Instagram、Facebook Messenger（架構已支援）
2. **主動訂單追蹤** - Webhook 觸發自動推播
3. **高併發推播** - 付費 Queue 機制
4. **LINE LIFF App** - 內建小工具（設計預覽、抽獎轉盤）
5. **進階 CRM** - 購物車挽回、情緒偵測、數位會員卡

---

**此文檔由 Copilot AI 自動生成和維護。下次更新時，請在本部分最後添加時間戳記和變更摘要。**
