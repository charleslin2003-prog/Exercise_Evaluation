# 從零建置手冊：把整個演習評核平台架起來（含「測試版覆蓋正式版」）

> 對象：**開發者本人**，以及之後接手這套系統的人。
> 用途有兩個：
> 1. 在一個**全新的 Google 帳號＋全新的 Vercel 專案**上，把整個平台從零架起來（第 1–3 節）。
> 2. 把測試版（`dev`）**覆蓋到正式版**（`master`＋正式的兩支 Apps Script），也就是下一件真的要做的事（第 4 節）。
>
> 版本基準：`dev` @ `da22841`（2026-10-13）。本文所有 `檔案:行號` 都是這個 commit 的行號；
> 程式一改，行號就會漂，**以程式為準**。

---

## 0. 這份手冊是什麼、什麼時候用、跟其他文件的分工

### 0-1. 標記

| 標記 | 意思 |
|---|---|
| **〔未驗證〕** | 沒有人實際做過，預期是從程式碼推出來的 |
| **〔推論〕** | 程式碼沒有直接寫，是從程式行為推導的結論（例如 Apps Script 平台本身的行為） |
| **〔文件記載〕** | 來源是其他文件，程式碼無從佐證（例如 Vercel 後台的選單位置） |

### 0-2. 佔位符

本文**不寫任何真實的金鑰、試算表／文件／資料夾 ID、`/exec` 網址**——這份檔案在公開的
repo 裡（`docs/` 只被 `.vercelignore` 擋在網站外，GitHub 上照樣公開，見 `.vercelignore:9-14`）。
之後補充這份文件時也一樣。一律用下面的佔位符：

| 佔位符 | 是什麼 |
|---|---|
| `<設定試算表ID>`／`<紀錄試算表ID>`／`<註冊表ID>` | 試算表網址 `/d/` 與 `/edit` 之間那一段 |
| `<範本DocID>`／`<輸出資料夾ID>`／`<設定範本ID>`／`<精靈資料夾ID>` | Google 文件／資料夾 ID |
| `<RECORD_URL>` | ConfigWithSubmit 那支 Web App 的完整 `/exec` 網址 |
| `<CONFIG_URL>` | Config 那支 Web App 的完整 `/exec` 網址 |
| `<REPORT_URL>` | 報告 Web App 的完整 `/exec` 網址 |
| `<站台>` | Vercel 網址，例如 `https://xxxx.vercel.app`（結尾不加斜線） |
| `<ANALYSIS_KEY>` | fallback 租戶的分析金鑰（`ConfigWithSubmit.gs:86`＝`Analysis.html:286`） |
| `<分析金鑰>` | 註冊表某一列的 `分析金鑰` |
| `<ADMIN_KEY>` | 管理金鑰（`ConfigWithSubmit.gs:109`） |
| `<醫院代號>`／`<演習代號>` | 註冊表的代號（規則見附錄C） |

### 0-3. 跟其他文件的分工

| 想知道 | 看哪 | 備註 |
|---|---|---|
| 試算表每一欄填什麼（設定表、紀錄表） | `README.md` | 演習資訊 L41-59、項目與問題 L61-137、對應指標 L139-182、評核紀錄 L183-249。**README 沒寫**：`人員代號`、`評分標準`、`租戶註冊表`、`報告快照`、Setup 精靈——本文第 2 節補 |
| 註冊表的日常操作（結束演習、換金鑰、發連結、演習中不要改表） | `docs/owner-guide-多醫院多演習.md` | §1、§6、§10、§11、§12 大致可用，但要注意：§6 的「過去演習」清單現在是標頭的場次下拉（`Analysis.html:221`）；§10 的「產生報告」按鈕現在叫「列印檢視」（`Analysis.html:213`）；§11 引用的 `ConfigWithSubmit.gs:740-760`／`:945-1045` 行號已漂移（白名單在 `:805-818`，標籤對照在 `:1093-1140`）。其他過時處見 0-4 |
| 一步一步的測試程序 | `docs/operator-test-manual.md` | 本文的寫法也照它 |
| 只能人工做的測試 | `docs/manual-test-checklist.md` | |
| 線上試算表的實際狀態（欄數、潛能值字面、時間窗） | `docs/handover-筆電.md` §4 | 那是這類事實的唯一來源 |
| 系統為什麼這樣設計 | `CLAUDE.md` | Report.gs 的段落過時，見 0-4 |

### 0-4. 文件與程式不一致時：**程式贏**

以下文件（或其中的段落）已知與程式不符。**不要照抄**，本文已經改用程式的事實：

| 文件 | 過時的地方 | 程式的事實 |
|---|---|---|
| `CLAUDE.md` 的「File roles」與「Report generator (方案B)」 | 說 `Report.gs` 是容器綁定、「not a Web App and not deployed」、「Never executed」；屬性清單沒有 `REPORT_REGISTRY_ID`／`REPORT_CONFIG_SPREADSHEET_ID`，還把 `REPORT_ANALYSIS_KEY` 列為必填；提到 `verifyIcc_`、`#iccBadge`（程式裡都已不存在）；`CLAUDE.md:1158` 仍說精靈「mints a fresh key per row」 | 報告現在是獨立部署的 Web App（`Report.gs:8-14`、`:5450`），網頁模式不讀 `REPORT_ANALYSIS_KEY`（`Report.gs:739`）；一致性指標改成 r_wg（`Report.gs:1226-1230`）；精靈同院沿用金鑰（`Setup.gs:348-404`） |
| `CLAUDE.md` 的 Branch state 表 | 沒有 `REPORT_URL` 那一列 | `Analysis.html:325`，合併 master 時要改成 `''`（`Analysis.html:321-324`） |
| `apps-script/README.md` | Report.gs 列為容器綁定、不部署；屬性表只有選單模式；「精靈每建一列現生一把金鑰」；說 `Analysis.html` 有 `CONFIG_URL`；Report.gs 行號 | 見上；精靈同院沿用金鑰（`Setup.gs:348-404`）；`Analysis.html` 只有 `RECORD_URL`／`ANALYSIS_KEY`／`REPORT_URL` |
| `docs/setup-三支apps-script.md` | §3.4 整節（容器綁定、不部署）、§6.2／6.3；§3.2 說 Config 會忽略 `啟用觀察紀錄`；`Analysis.html` 第 163 行、Config.gs 163 行 | repo 版 `Config.gs:59-72` 已讀那兩列；`Analysis.html:283`；`Config.gs` 現在 185 行 |
| `docs/owner-guide-多醫院多演習.md` | §14 整章（試算表選單產報告、`{{SEC_*}}` 範本）；§9 L243-244「規則 1、2 只比對 啟用=Y」；§2 L65-68、§5 L119-121「每列／每場一把新金鑰」；§7 L169 換金鑰只改一列；§8 L209 註冊表壞了會退回；§4 L99-100 設定檔「檢視者就夠」；§2 L63 別名「擁有者」；§0 L17 `?t=` 完全沒作用 | 三條跨列規則比對全部列（`ConfigWithSubmit.gs:449`）；同院共用一把；帶 `?t=` 時是 `REGISTRY_BROKEN` 硬錯誤（`ConfigWithSubmit.gs:582-586`）；報告 Web 要設定檔編輯權（`Report.gs:1955-1956`）；格式錯的 `?t=` 一律 `BAD_CODE`（`ConfigWithSubmit.gs:554-561`）。⚠️ L54-55、L63、L74 有真實 ID 與 email，不要照抄 |
| `docs/handover-筆電.md` | §0.1 的貼上狀態表；§5 合併清單「8 行」與 `Analysis.html:230` | 2026-10-13 已重貼；清單漏了 `Analysis.html:325`，照它的算法（含不用改的 `ADMIN_KEY`）正確是 9 行、實際要改的是 8 行（4-4 步驟 1），`RECORD_URL` 在 `Analysis.html:283` |
| `docs/operator-test-manual.md` | 0-C 第 2–4 列（範本仍是骨架版、填入式還沒做、要設兩個專案的屬性、容器綁定專案） | 填入式已實作（`Report.gs:182-235`）且在用；沙箱已沒有容器綁定的 Report 專案 |
| `README.md` | L111-113「同一層名稱可以在不同分組下重複」 | 最底層名稱重複時，第二個的送出會被拒收（`ConfigWithSubmit.gs:811-818`） |
| 程式內註解 | `Report.gs:3-14`（同一份原始碼貼兩個專案）；`ConfigWithSubmit.gs:7-14`（Config.gs 沒有那兩個標籤）、`:106`（ADMIN_KEY 由容器腳本帶）、`:539-541`（(ii) 一律 fallback）；`Analysis.html:1156`、`:832`（叫人改用試算表選單）；`Setup.gs:138`（叫人跑 onOpen 授權） | 各見本文對應段落 |

---

## 1. 架構總覽

### 1-1. 元件一覽

| 代號 | 元件 | 形態 | 單場部署是否必要 | 誰讀／誰寫它 |
|---|---|---|---|---|
| S1 | **設定試算表** | Google 試算表，五個分頁 | **必要**（fallback 一份；註冊表模式下每場一份） | ConfigWithSubmit／Config 讀；報告 Web 寫入 `報告快照`／`_報告暫存`；精靈複製 |
| S2 | **紀錄試算表** | Google 試算表，每場一張紀錄分頁 | **必要** | ConfigWithSubmit 的 `doPost` 寫、`action=analysis` 讀；精靈新增分頁 |
| S3 | 租戶註冊表 | Google 試算表，分頁 `租戶註冊表` | 選用（多院多場才要） | ConfigWithSubmit 讀（快取 120 秒）、報告 Web 讀（另一份 120 秒快取）、Setup 精靈寫 |
| D1 | 報告範本 | Google 文件（不能是 Word） | 選用 | 報告 Web 每次複製一份 |
| F1 | 報告輸出資料夾 | 雲端硬碟資料夾 | 選用（但用報告就實際必填） | 報告 Web 寫 Doc＋PDF |
| P1 | **ConfigWithSubmit** | 獨立 Apps Script，Web App → `RECORD_URL` | **必要** | |
| P2 | **Config** | 獨立 Apps Script，Web App → `CONFIG_URL` | **必要**（可退役，見 2-6） | |
| P3 | 演習評核報告 Web | 獨立 Apps Script，只放 `Report.gs`，Web App → `REPORT_URL` | 選用，**而且需要 S3**（見 1-3） | |
| P4 | Setup | 容器綁定在 S3，`Setup.gs`＋`SetupDialog`＋`QrLib`，不部署 | 選用，需要 S3 | |
| W1 | **`Start.dc.html`** | Vercel 靜態頁（評核單） | **必要** | |
| W2 | **`Analysis.html`** | Vercel 靜態頁（分析平台） | **必要** | |
| W3 | **`support.js`、`vendor/`、`assets/`** | Vercel 靜態檔 | **必要**（`.vercelignore:7`） | |

不建議再建：容器綁定在 S1 的「Report 選單專案」（`Report.gs`＋`ReportDialog.html`）。程式還支援它
（`Report.gs:281-296`），但沙箱已經不用它，唯一的報告路徑是儀表板的「產生 Google 文件」→ P3。

### 1-2. 誰呼叫誰

```
  評核官手機：Start.dc.html                              品管中心：Analysis.html
   │                                                       │
   │ 不帶參數        GET  CONFIG_URL ─────► [P2 Config] ──讀──► S1（fallback 那份）
   │ 帶 ?t= 或 ?ex=  GET  RECORD_URL?t=&ex=  ─┐             │ GET RECORD_URL?action=analysis&key=
   │ 只帶 ?t=        GET  RECORD_URL?action=sessions&t= ─┤   │ GET RECORD_URL?action=exercises&t=&key=
   │ 送出分數        POST RECORD_URL ─────────┤             │
   │                                          ▼             ▼
   │                               [P1 ConfigWithSubmit] ◄──┘
   │                                 ├─ 讀 S3 註冊表（快取 reg:v2，120 秒）
   │                                 ├─ 讀 S1（解析出來那一列的設定試算表ID）
   │                                 └─ 寫／讀 S2（解析出來那一列的紀錄分頁）
   │
   │                                         Analysis.html ── GET REPORT_URL?action=report*&t=&ex=&key=
   │                                                             ▼
   │                                               [P3 報告 Web]
   │                                                 ├─ 讀 S3（快取 rptreg:v1，120 秒）
   │                                                 ├─ UrlFetch RECORD_URL?action=analysis → P1
   │                                                 ├─ 寫 S1 的 報告快照／_報告暫存
   │                                                 └─ 複製 D1 → 新 Doc＋PDF 放進 F1
   │
   [P4 Setup 精靈]（綁在 S3 裡，從不呼叫任何 Web App）
       複製 S1 範本 → 在 S2 加紀錄分頁 → 在 S3 加一列 → 產出三條網址＋QR
```

證據：`Start.dc.html:307-320`（連結形狀與打哪支）、`Analysis.html:1492-1497`（`action=exercises`）、
`Analysis.html:1167-1180`（打報告端點）、`Report.gs:1046`（UrlFetch）、`Setup.gs:3-8`（容器綁定、不碰後端）。

### 1-3. 兩種部署形態能做什麼

`REGISTRY_SPREADSHEET_ID`（`ConfigWithSubmit.gs:97`）是空字串＝註冊表關閉，所有請求一律走寫死的
fallback 租戶（`ConfigWithSubmit.gs:283`、`:564`）。

| 功能 | 註冊表關閉（單場） | 註冊表開啟（多院多場） |
|---|---|---|
| 不帶參數的評核單 | ✅ fallback | ✅ fallback |
| 只帶 `?t=` 的場次清單 | 靜默退回單場（`REGISTRY_OFF`，`ConfigWithSubmit.gs:1733-1742`；`Start.dc.html:501-515`） | ✅ |
| `?t=&ex=` 指定場次 | 參數只回聲，仍走 fallback | ✅ |
| 儀表板 | ✅ | ✅ |
| 儀表板場次下拉 | ✗（`meta.tenant` 是空的，`ConfigWithSubmit.gs:1278`；`Analysis.html:587`） | ✅ |
| 「產生 Google 文件」 | ✗ 永遠停用（`Analysis.html:1156`） | ✅（要有 P3，**而且**儀表板網址要帶 `?t=`；不帶 `?t=` 的 fallback 租戶——包括 2-4 建議的示範資料——即使註冊表開啟也永遠停用，`Analysis.html:1156`、`ConfigWithSubmit.gs:1278-1279`） |
| 「列印檢視」 | ✅ | ✅ |
| Setup 精靈 | ✗（沒有註冊表可寫） | ✅ |

所以：**要正式報告（Google 文件＋PDF），就一定要建註冊表。** `Report.gs` 雖然有「註冊表關閉的單一演習
網頁模式」（`Report.gs:5614-5636`），但儀表板在 `meta.tenant` 為空時就把按鈕擋掉了，從畫面上走不到。

---

## 2. 從零建置

### 2-0. 為什麼是這個順序

每一步都要用到前一步產生的 ID 或網址：

| 步驟 | 需要 | 產出 |
|---|---|---|
| 2-1 帳號與資料夾 | — | 「部署帳號」、資料夾 |
| 2-2 設定試算表 | 2-1 | `<設定試算表ID>` |
| 2-3 紀錄試算表 | 2-1 | `<紀錄試算表ID>` |
| 2-4 （選用）租戶註冊表 | 2-2、2-3 的 ID | `<註冊表ID>` |
| 2-5 ConfigWithSubmit | 2-2、2-3、（2-4）的 ID＋新產生的 `<ANALYSIS_KEY>` | `<RECORD_URL>` |
| 2-6 Config | 2-2 的 ID | `<CONFIG_URL>` |
| 2-7 前端常數＋Vercel | `<RECORD_URL>`、`<CONFIG_URL>`、`<ANALYSIS_KEY>` | `<站台>` |
| 2-8 （選用）報告 Web | `<RECORD_URL>`、`<註冊表ID>`、範本、資料夾 | `<REPORT_URL>` → 回填 `Analysis.html:325` |
| 2-9 （選用）Setup 精靈 | `<註冊表ID>`（綁在它裡面）、`<站台>`、設定範本 | 三條網址＋QR |
| 2-10 全面驗證 | 全部 | — |

> 💡 2-8 可以挪到 2-7 前面做，這樣前端只要推一次；否則 2-7 先把 `REPORT_URL` 留 `''`，2-8 做完再推一次。

---

### 2-1. Google 帳號與資料夾

**要做**

1. 決定**一個**「部署帳號」，讓它擁有所有試算表、部署全部 Web App、也由它執行精靈。
   理由：三支 Web App 都是「執行身分＝我」，各自以部署者身分 `openById`
   （`ConfigWithSubmit.gs:655-679`、`Report.gs:612-621`），精靈則以**執行精靈的人**的身分複製設定檔，
   新檔的擁有者就是那個人（`Setup.gs:427-441`）。帳號不一致時，新設定檔要另外分享給部署帳號，
   否則演習當天回「無法開啟設定試算表，請確認檔案權限。」〔推論〕
2. 在這個帳號的雲端硬碟建資料夾，例如：`平台／設定檔`、`平台／紀錄檔`、`平台／報告輸出`、`平台／範本`。
3. ⚠️ 用醫院網域（Google Workspace）帳號時，管理員政策可能不允許 Web App 開放給「任何人」，
   那樣手機與報告的 UrlFetch 都會拿到登入頁 HTML（`Report.gs:1064-1071`）。先確認。〔推論〕

**驗證**：用這個帳號打開 `https://script.google.com`，能建立新專案。

**常見錯誤**：用個人帳號部署、試算表卻在公司帳號底下 → 程式裡的 ID 對部署帳號不可見，重新部署也修不好
（`Start.dc.html:279-282` 記錄過一次）。

---

### 2-2. 設定試算表（S1）

**要做**

建一份 Google 試算表（例如命名「演習評核_設定」），檔案 → 設定 → 時區選台北。五個分頁，名稱**逐字**相同
（`ConfigWithSubmit.gs:1542`、`Setup.gs:79`）：

| 分頁 | 怎麼填 | 證據 |
|---|---|---|
| `演習資訊` | **沒有表頭**。A 欄標籤、B 欄值。認得 8 個標籤，全部選填：見 `README.md` L41-59。⚠️ 標籤用 `===` 比對、**不 trim**，尾端多一個空白就讀不到。日期格會格式化成 `yyyy/MM/dd` | `ConfigWithSubmit.gs:1938-1962`、`:1929-1931` |
| `人員代號` | 第 1 列一欄叫 **`代號`**（不是「人員代號」）。這份名冊也是送出的白名單 | `ConfigWithSubmit.gs:1989-1998`、`:806-809` |
| `評分標準` | 第 1 列 `分數`／`標籤`／`說明` 三欄都要有。手機的評分按鈕寫死 1–5，這張表只提供說明文字；1 分的語意是「劇本未走到」（另算未觸發率），說明要照這個意思寫 | `ConfigWithSubmit.gs:2001-2018`；`Start.dc.html:829`；`ConfigWithSubmit.gs:1191-1203` |
| `項目與問題` | 欄名看 `GROUP_HEADER_ALIASES_`／`ID_HEADER_ALIASES_`／`TEXT_HEADER_ALIASES_`／`GOAL_HEADER_ALIASES_`；填法見 `README.md` L61-137。手機選單只支援兩層 | `ConfigWithSubmit.gs:2028-2035`、`:2071-2116` |
| `對應指標` | 五欄都要有，否則 `action=analysis` 回 `ANALYSIS_FAILED`。欄名看 `INDICATOR_*_ALIASES_`，填法與易錯清單見 `README.md` L139-182 | `ConfigWithSubmit.gs:71-76`、`:959-973` |

再加五條 README 沒寫清楚、但會直接出事的規則：

1. **最底層名稱（葉節點）整張表唯一**，不是「同一分組內唯一」。送出時用第一個同名葉節點的題號當白名單，
   第二個同名場景整頁會被「未知的問題ID」拒收（`ConfigWithSubmit.gs:811-818`、`:2119-2129`）。
2. **問題ID 整張表唯一**，而且兩張表（`項目與問題`、`對應指標`）的題號要逐字相同；對不上的那題
   `potential` 是空字串，從所有圖表消失，沒有警告（`ConfigWithSubmit.gs:1096`、`:1142-1147`）。
3. **題號欄先設成純文字再填值**（格式 → 數值 → 純文字）。`1-1`、`10-2` 會被自動轉成日期；
   後端只替**紀錄表新寫入的格子**設純文字（`ConfigWithSubmit.gs:925-931`），設定表不處理。
4. `評核潛能` 的值只有這幾種會進圖表：恰好 `反應`／`監測`／`預期`（`回應` 會被折成 `反應`）、含「覆蓋率」、
   恰好 `學習`；其他值（空白、錯字、「反應潛能」）三組都不收、沒有警告（`ConfigWithSubmit.gs:2053-2056`、
   `:1142-1147`）。新寫的東西一律用 `反應`。
5. 4S 值建議用 `Space (空間)`／`Staff (人員)`／`Stuff (物資)`／`System (系統)` 這四個字串（含半形空格與括號）：
   排序（`Analysis.html:351`、`Report.gs:248`）與「綜合能力」說明（`Analysis.html:888`、`Report.gs:4519`）都以
   原字串為鍵，寫法不同就排序亂、說明欄整欄空白，不報錯。

> 💡 最快的做法：有現成設定試算表可以存取時，「建立副本」再改內容。⚠️ 副本裡若有 `報告快照`、`_報告暫存`
> 兩個分頁，**刪掉**（理由見 2-9 與第 5 節）。

**驗證**：此時還沒有後端，先目視。真正的驗證在 2-5：驗證 1（裸 `<RECORD_URL>`）只會讀 `演習資訊`／`人員代號`／
`評分標準`／`項目與問題` 四張（`ConfigWithSubmit.gs:729-745`）；`對應指標` 要到驗證 3（`?action=analysis&key=`）
才會被讀（`:1009`），五欄缺一回 `ANALYSIS_FAILED`。

**常見錯誤**：`人員代號` 表頭寫成「人員代號」→ `人員代號 缺少欄位：代號`；`對應指標` 的 4S 欄寫成
`4S元素`（沒空格）→ 分析與報告一起掛（`ConfigWithSubmit.gs:76` 對照紀錄表那邊 `:55` 才接受無空格）；
`對應指標` 的題目欄取名「問題內容」→ 前綴比對會抓到第一個以「問題」開頭的欄（可能是題號欄），
題目文字靜默錯位（`ConfigWithSubmit.gs:73`、`:2058-2069`）。

---

### 2-3. 紀錄試算表（S2）

**要做**

1. 建一份 Google 試算表（例如「演習評核_紀錄」），時區設台北。
2. 第一張分頁命名 **`評核紀錄`**（fallback 租戶寫這一張：`ConfigWithSubmit.gs:25`）。後端**不會自動建分頁**，
   找不到只回一句通用錯誤（`ConfigWithSubmit.gs:676-679`）。
3. 第 1 列打表頭。比對看欄名、不看位置：
   - 必要四欄：`問題ID`、`分數`、`人員代號`、`送出時間`（別名見 `RECORD_ID_ALIASES_` 等，`ConfigWithSubmit.gs:33-36`）。
     缺一欄，**每一次送出都失敗**（`ConfigWithSubmit.gs:846-853`）。
   - 建議加：`場景階段`、`演練單元`、`觀察紀錄`。註冊表模式再加 `醫院代號`、`演習代號`（D1 的第二道防線，
     `ConfigWithSubmit.gs:1045-1060`）。
   - 其他選填欄與「標籤快照」的意義：見 `README.md` L183-249 與 `RECORD_*_ALIASES_`（`ConfigWithSubmit.gs:33-59`）。
4. **這個檔案裡只放紀錄分頁。** 精靈建新分頁時，表頭是抄「依分頁順序第一個 A1 非空」的分頁（`Setup.gs:769-775`），
   最前面放彙整或樞紐分頁，新場次就會拿到錯的表頭。
5. 不要手動加列、不要在資料下方放加總列：送出是接在 `getLastRow()` 後面（`ConfigWithSubmit.gs:917`），
   空白分數會被當成 0 分算進統計（`Number('')` 是 0，`ConfigWithSubmit.gs:1043-1044`）。

⚠️ 兩個要先想清楚的欄：

- **不要留第二個「同義欄」**。`RECORD_COMMENT_ALIASES_` 含 `備註`（`ConfigWithSubmit.gs:47`），而
  `findHeaderCol_` 取的是**最左邊**符合的欄（`ConfigWithSubmit.gs:2058-2069`）——左邊有一欄「備註」，
  評核官的留言就寫進那欄。
- **快照欄（`評核潛能`／`4S 元素`／`評核題目`）或 `指標代號` 一加上，每次送出都要先成功讀 `對應指標`**
  （`ConfigWithSubmit.gs:869-873`）。對應指標一壞，所有評核官都送不出去，不再只是分析頁壞。
  對應指標穩定之前先不要加。

**驗證**：此時還沒有後端；2-7 驗證 6 會實際送一筆。

**常見錯誤**：分頁名打成「評核紀錄 」（尾端空白）或「紀錄」→ 送出回「紀錄試算表裡找不到指定的工作表」。

---

### 2-4. （選用）租戶註冊表（S3）

**什麼時候要**：要讓多家醫院、多場演習共用同一套後端；要用 Setup 精靈；要用「產生 Google 文件」。
只辦一場、只要列印檢視的話可以跳過，`REGISTRY_SPREADSHEET_ID` 留 `''`。

**要做**

1. 新建一份 Google 試算表（例如「租戶註冊表」），時區設台北。分頁名**逐字**為 `租戶註冊表`
   （`ConfigWithSubmit.gs:98`、`Setup.gs:40`、`Report.gs:255`，三處寫死）。
2. 第 1 列**一次打齊 13 欄表頭**（別名見 `REGISTRY_*_ALIASES_`，`ConfigWithSubmit.gs:113-125`）：
   `醫院代號`、`演習代號`、`顯示名稱`、`設定試算表ID`、`紀錄試算表ID`、`紀錄分頁名稱`、`分析金鑰`、`啟用`、
   `開放送出起`、`開放送出迄`、`預設演習`、`scenePrefix`、`檔案擁有者`。
   - 五個必要欄（醫院代號／演習代號／設定試算表ID／紀錄試算表ID／分析金鑰）任一**欄**不見，整張表判為不可用
     （`ConfigWithSubmit.gs:348-357`）。
   - 精靈只檢查這五欄（`Setup.gs:686-691`），其他欄不存在時它寫的值會被**靜默丟掉**（`Setup.gs:721-724`）：
     缺 `紀錄分頁名稱` → 精靈建了 `評核紀錄_<演習代號>`，後端卻寫進 `評核紀錄`；缺 `開放送出起／迄` → 永遠開放；
     缺 `預設演習` → 同院沒有任何預設場次：評核官的 `?t=` QR 仍會出現場次清單（`action=sessions` 不看預設，
     `ConfigWithSubmit.gs:1745`），但只帶 `?t=`、不帶 `&ex=` 的分析平台連結，以及場次清單拿不到時評核單的退回
     路徑，會回 `NO_DEFAULT`（`ConfigWithSubmit.gs:604-609`）；清單上「開放中」也不會把本場排第一。
   - ⚠️ `scenePrefix` 欄**不要**改名成「場景前綴」：別名只有 `scenePrefix`／`情境前綴`（`ConfigWithSubmit.gs:124`、
     `Setup.gs:73`），改了會靜默退回 `SCENE`。
3. 把整張表設成純文字格式（格式 → 數值 → 純文字），避免 `2026-01` 這類代號被吃成日期而整列無效
   （`ConfigWithSubmit.gs:225-241`）。
4. 決定 **fallback 租戶**是誰（`ConfigWithSubmit.gs:173-196` 的四個常數永遠存在，見 2-5）：
   - **建議（從零建置）：fallback ＝一套「示範／測試」用的設定表＋紀錄表，不寫進註冊表。**
     這樣 `Analysis.html` 內嵌的那把公開金鑰（`Analysis.html:286`）只保護示範資料，每家真實醫院都有自己的
     `分析金鑰`、連結一律帶 `?t=`。〔建議，非程式規定〕
   - 或者：fallback ＝第一家醫院的第一場。那就要加一列「遷移列」，其 `設定試算表ID`／`紀錄試算表ID`／
     `紀錄分頁名稱` 要與 fallback 常數**指向同一份**（`ConfigWithSubmit.gs:545-547`），`分析金鑰` 填
     `<ANALYSIS_KEY>`。⚠️ 同一場同時發出不帶參數與 `?t=` 兩種連結時，若紀錄表有 `醫院代號`／`演習代號` 欄，
     同一題會被拆成兩列統計（去重鍵含這兩欄，`ConfigWithSubmit.gs:1060`）〔推論〕——**同一場只發一種連結**。
5. 資料列可以先空著，第一列交給精靈（第 3 節）。手打的話：
   - `啟用`、`預設演習` **一律明確填 `Y` 或 `N`**。後端把空白的 `啟用` 當「啟用」、精靈當「未啟用」；
     後端接受 `預設`、精靈不接受（`ConfigWithSubmit.gs:204-216` 對照 `Setup.gs:869-872`）——差一個字就可能
     同院兩列預設（精靈的 `clearOtherDefaults_` 清不掉它看不懂的那一列，`Setup.gs:744-754`）。後果：只帶 `?t=`、
     不帶 `&ex=` 的請求（例如 `Analysis.html?t=…&key=`，或場次清單拿不到時評核單的退回路徑）回
     `AMBIGUOUS_DEFAULT`（`ConfigWithSubmit.gs:604-611`）；評核官掃的 `?t=` QR 本身仍會列出場次清單
     （`Start.dc.html:301`、`:481`）。
   - `開放送出起`／`開放送出迄` 寫成 `2026/10/06 08:00`；看不懂的值會讓整列無效，不會當成「不限」
     （`ConfigWithSubmit.gs:259-270`）。空白＝永遠開放。
   - 試算表 ID 只貼 `/d/` 與 `/edit` 之間那一段；貼整條網址會讓整列無效（`ConfigWithSubmit.gs:145-148`）。
6. 三條跨列規則（同代號、同紀錄分頁、跨院同金鑰）**比對全部列，不分啟用與否**（`ConfigWithSubmit.gs:448-508`）。
   無效列對路由完全不可見，只回 `ROW_INVALID` 一句通用話；具體原因只有 `action=selftest` 看得到。

**驗證**：等 2-5 部署好、而且至少有一列之後：開 `<RECORD_URL>?action=sessions&t=<醫院代號>`，應該回
`{"tenant":"<醫院代號>","sessions":[…]}`。

**常見錯誤**：一列都沒有時，帶 `?t=` 的請求會回 `REGISTRY_BROKEN`（「系統設定目前有問題…」，
`ConfigWithSubmit.gs:582-586`）——還沒發出任何 `?t=` 連結之前這是預期的。

---

### 2-5. ConfigWithSubmit Web App（P1）→ `<RECORD_URL>`

**要做**

1. 用部署帳號到 `https://script.google.com` → 新專案，命名「ConfigWithSubmit」。**這個專案只放這一個 `.gs`**
   ——同一個專案裡的所有 `.gs` 共用全域範圍。`Report.gs` 和這支撞名的有 `doGet`、`jsonOut_`、`rwgExpectedVar_`
   （`ConfigWithSubmit.gs:687`、`:784`、`:1394` 對照 `Report.gs:5450`、`:5374`、`:1227`；`doGet` 一被蓋掉，`RECORD_URL`
   就變成報告產生器）；`Setup.gs` 和這支撞名的有 `findHeaderCol_`、`normSlug_`、`isSpreadsheetId_`、`isYes_`、
   `isBlankRow_`（`Setup.gs:843-876`；其中 `isYes_` 兩邊判讀不同，見 2-4 第 5 步）。後載入的檔案勝出，而且不會報錯。
2. 把預設的 `Code.gs` 內容清空，貼上 `apps-script/ConfigWithSubmit.gs` **全文**。
3. 改常數（附錄A 有完整清單）：
   - `:21` `CONFIG_SPREADSHEET_ID` ＝ fallback 的 `<設定試算表ID>`
   - `:24` `RECORD_SPREADSHEET_ID` ＝ fallback 的 `<紀錄試算表ID>`
   - `:25` `RECORD_SHEET_NAME` 保持 `'評核紀錄'`（要與 2-3 的分頁名一致）
   - `:86` `ANALYSIS_KEY` ＝新產生的 `<ANALYSIS_KEY>`（附錄C）。**不要沿用現有沙箱／正式那把**——兩者目前同值
     （CLAUDE.md「Branch state」），再共用一次就是第三個環境綁在一起。
   - `:97` `REGISTRY_SPREADSHEET_ID` ＝ `<註冊表ID>`，或 `''`（不用註冊表）
   - `:109` `ADMIN_KEY` 保持 `''`（要用時見 2-10）
4. 專案設定 → 時區設成台北。文字形式的時間窗是用 `new Date('2026/10/06 08:00')` 解析的
   （`ConfigWithSubmit.gs:263`），結果取決於專案時區；repo 裡沒有 `appsscript.json`，時區不受版本控制。
   〔推論〕找不到時區選項時，勾「在編輯器中顯示 appsscript.json」，把 `"timeZone"` 改成 `"Asia/Taipei"`。〔未驗證〕
5. 部署 → **新增部署作業** → 類型「網頁應用程式」→ 執行身分「**我**」、誰可以存取「**任何人**」→ 部署 →
   授權（個人帳號會看到「Google 尚未驗證這個應用程式」→ 進階 → 前往，這是自己寫的腳本的正常畫面〔推論〕）。
6. 複製「網頁應用程式網址」（結尾 `/exec`）＝ `<RECORD_URL>`。

> ⚠️ **「新增部署作業」只在第一次做。** 之後改程式一律：部署 → 管理部署作業 → 鉛筆（編輯）→ 版本選「新版本」
> → 部署。選錯會產生新的 `/exec`，前端與 `REPORT_API_URL` 還指著舊網址、跑舊版本（`Report.gs:16-19`）。
> `.gs` 常數改了也一樣要部署新版本才生效。

**驗證**（全部是瀏覽器網址列打 GET）

1. `<RECORD_URL>` → JSON，裡面有 `"tenantSource":"fallback"`、你的 `orgName`、`codes`、`items`
   （`ConfigWithSubmit.gs:736-755`）。回 `CONFIG_READ_FAILED` 時，`error` 那句中文會講是哪個分頁或哪一欄。
2. `<RECORD_URL>?action=analysis` → `{"error":"unauthorized","errorCode":"UNAUTHORIZED"}`（`:708-709`）。
3. `<RECORD_URL>?action=analysis&key=<ANALYSIS_KEY>` → 有 `meta` 與 `stats`；`stats` 裡有 `rwg` 鍵
   （`:1153-1163`）。紀錄表還是空的，數字多半是 `null` 或 0。
4. 有註冊表時：`<RECORD_URL>?action=sessions&t=nobody` → `NO_TENANT`（表裡有列時）或 `REGISTRY_OFF`；
   `<RECORD_URL>?action=sessions` → `NO_TENANT_CODE`（`:1722-1724`）。
5. 沒有註冊表時：`<RECORD_URL>?action=sessions&t=abc` → `REGISTRY_OFF`。

**常見錯誤**

| 看到 | 原因 |
|---|---|
| 一大頁 HTML／Google 登入頁 | 存取權不是「任何人」 |
| `無法開啟設定試算表，請確認檔案權限。` | 部署帳號看不到那份檔、或 ID 貼錯（`:655-660`） |
| `找不到工作表：人員代號` 之類 | 分頁名不符（`nullSafeSheet_`，`:1970-1973`） |
| `人員代號 缺少欄位：代號` | 見 2-2 |

---

### 2-6. Config Web App（P2）→ `<CONFIG_URL>`（可省略）

`Start.dc.html` 只有在網址**完全沒有** `?t=`／`?ex=` 時才打 `CONFIG_URL`（`Start.dc.html:307-308`）。`Config.gs`
沒有任何註冊表程式、`doGet` 不看參數也不看 `action`（`Config.gs:9-30`），所以帶參數的請求絕不能打它。

**選項 A：照現行架構建它**

1. 新專案「Config」，只放 `apps-script/Config.gs` 全文（從 repo 貼；線上沙箱那份是手改混合體，不要拿它當來源）。
2. `Config.gs:7` `CONFIG_SPREADSHEET_ID` ＝ **與 `ConfigWithSubmit.gs:21` 同一份**。不同的話，不帶參數的評核單
   讀一份名冊、送出時卻用另一份當白名單，整批被拒。
3. 時區、部署方式同 2-5（執行身分我、任何人）。網址＝`<CONFIG_URL>`。

**選項 B：不建，退役它**

把 `Start.dc.html:276` 的字串填成與 `:284` **相同**的 `<RECORD_URL>`。ConfigWithSubmit 對不帶參數的請求本來就回
fallback 的設定，而且欄位是 Config 的超集。⚠️ `configRequestUrl` 裡的 `if` 分支（`Start.dc.html:307-314`）**不要刪**，
只換字串。代價：一支部署出錯時，載入、送出、儀表板同時斷；好處：少一支會漂移的副本（`Config.gs` 相對
ConfigWithSubmit 沒有 try/catch、沒有欄名防護，分頁改名時回原始 HTML 錯誤頁）。

**驗證**（選項 A）：`<CONFIG_URL>` → JSON 有 `orgName`、`codes`、`commentEnabled`，**沒有** `tenantSource`
（這就是分辨兩支的方法：有 `tenantSource` 的是 ConfigWithSubmit）。

**常見錯誤**：把 `<CONFIG_URL>` 填進報告的 `REPORT_API_URL`——網址格式檢查會過（`Report.gs:747-752`），但 Config 只回
設定 JSON（`Config.gs:9-30`）。按「先檢查設定」時，「取得分析資料」那一列就會變紅，訊息是「後端回傳的資料缺少 meta 或
stats」（`Report.gs:2600-2603`、`:1101-1103`）；直接產報告也會在同一處失敗。

---

### 2-7. 前端常數＋Vercel → `<站台>`

**要做**

1. 準備一個 GitHub repo（fork 或推一份這個 repo）。⚠️ 它是公開的：commit 進去的任何字串都公開，git 歷史清不掉
   （`.gitignore:1-4`）。`ADMIN_KEY` 的真值**永遠不要** commit。
2. 改五個常數（附錄A）：
   - `Start.dc.html:276` `CONFIG_URL` ＝ `<CONFIG_URL>`（選項 B 時＝`<RECORD_URL>`）
   - `Start.dc.html:284` `RECORD_URL` ＝ `<RECORD_URL>`
   - `Analysis.html:283` `RECORD_URL` ＝ `<RECORD_URL>`（與上一行同值）
   - `Analysis.html:286` `ANALYSIS_KEY` ＝ `<ANALYSIS_KEY>`（與 `ConfigWithSubmit.gs:86` **逐字相同**）
   - `Analysis.html:325` `REPORT_URL` ＝ `''`（2-8 做完再填）
   這幾行上方的「⚠️ 測試分支（dev）…」註解描述的是沙箱，順手改寫，避免下一個人誤會。
3. `support.js`、`vendor/`、`assets/` 不要動（`support.js` 是生成檔；少了 `vendor/` 會靜默改從 jsDelivr 載 React，
   `support.js:48`）。
4. commit、push 到 Vercel 要追蹤的分支。
5. Vercel → 新增專案 → 匯入這個 repo。Framework 選「Other」、不填 build 指令與輸出目錄（repo 沒有
   `vercel.json`／`package.json`，是純靜態）〔未驗證：介面字樣〕。部署。
6. 確認 Production Branch：Settings → Environments → Production → Branch Tracking〔文件記載：CLAUDE.md
   「Branch policy」〕。
7. `.vercelignore` 已在 repo 裡，會把 `apps-script/`、`docs/`、`*.md`、`scripts/` 等擋在網站外
   （`.vercelignore:20-33`）。新增任何後端、文件、暫存檔都要記得加進去。

**驗證**

1. `<站台>/` → 404。**正常**，站上沒有首頁，網址一定要帶檔名。
2. `<站台>/Start.dc.html` → 三行標頭顯示你的機構／演習／日期，人員代號下拉有你的名冊。
3. `<站台>/Analysis.html` → 儀表板載入（資料是空的也會載入），沒有場次下拉，「產生 Google 文件」是灰的、
   滑鼠移上去說「此部署尚未啟用報告產生器」（`Analysis.html:1149`）。
4. `<站台>/apps-script/ConfigWithSubmit.gs`、`<站台>/CLAUDE.md`、`<站台>/scripts/smoke.sh` → 都要 404。
5. 確認站上跑的是剛推的版本（Vercel 建置要幾分鐘，`docs/handover-筆電.md` §6）：
   ```bash
   git show HEAD:Analysis.html | sha256sum
   curl -s <站台>/Analysis.html | sha256sum      # 兩個值要相同
   ```
6. 用不帶參數的評核單、以一個測試代號送一筆 → `評核紀錄` 分頁多出列 → 儀表板重新整理看得到。
   （這是你自己的新環境，測試列可以事後刪；正式環境不要這樣做，見第 4 節。）

**常見錯誤**：`ANALYSIS_KEY` 兩邊不一致 → 儀表板「讀取失敗：unauthorized」；`RECORD_URL` 兩檔不一致 →
評核單與儀表板看的是不同後端。

---

### 2-8. （選用）報告 Web App（P3）＋範本＋輸出資料夾 → `<REPORT_URL>`

**前提**：2-4 已建註冊表，`ConfigWithSubmit.gs:97` 已填它（理由見 1-3）。步驟 1–8 可以先做，**驗證 2–4 要等三件事都成立**：
(a) 註冊表裡已經有這一場的有效列（第 3 節用精靈建，或手打一列）；(b) 這一場已經用 `?t=&ex=` 的連結送過至少一筆分數
（2-7 驗證 6 那一筆寫進的是 fallback 租戶，不算）；(c) `<站台>` 已經上線（2-7）。註冊表一列都沒有時，報告端回
`REGISTRY_OFF`（`Report.gs:5652-5662`），儀表板帶 `?t=` 則回 `REGISTRY_BROKEN`（`ConfigWithSubmit.gs:582-586`）；
這一場還沒有分數時，「先檢查設定」的「資料非空」是紅的，「下載」也會被拒（`Report.gs:2646`、`:2932`）。
照 2-0 的 💡 把 2-8 挪到 2-7 前面的話，只能先做步驟 1–8，驗證 2–4 延到第 3 節之後。

**要做**

1. **範本 Google 文件（D1）**。必須是 Google 文件，不能是 Word／PDF（`Report.gs:1328-1332`）。兩種模式擇一，
   由 `scanTemplate_` 依文件裡的標記判定、**混用或都沒有就拒絕**（`Report.gs:1681-1719`、`:198-200`）：
   - **填入式（目前業主在用）**：每張圖放在本文表格的一個儲存格裡，格內只放一個 `{{圖_*}}`（有圖說會被拒）；
     每張資料表留一列樣板列，最左格打 `{{列_*}}`，表格欄數不少於契約。標記清單與欄數契約的**權威來源**是
     `FILL_IMAGE_TOKENS_`（`Report.gs:210-218`）與 `FILL_ROW_TOKENS_`（`Report.gs:227-235`）。
   - 錨點式：每章一個 `{{SEC_*}}` 獨占一個本文最上層段落，6 個必要（`SECTIONS_`，`Report.gs:149-175`）。
   - 兩種都可以放封面 token（`COVER_TOKENS_`，`Report.gs:119-128`），內文、頁首、頁尾、表格內都會替換；
     `{{報告版次}}`／`{{文件編號}}`／`{{製表}}`／`{{審核}}`／`{{核定}}` 刻意不填，留給人簽（`Report.gs:143`）。
   - 頁碼、字型、頁首 logo、簽核欄都做在範本裡，程式不處理。
2. **輸出資料夾（F1）**：建一個資料夾，**分享給會看報告的人**。程式不做任何分享（`Report.gs` 沒有
   `setSharing`／`addViewer`），檔案擁有者永遠是部署帳號；不設這個屬性時會落在該場設定試算表的上層資料夾、
   再不行就是根目錄（`Report.gs:2328-2352`）。
3. 新專案，命名「演習評核報告 Web」，**只貼 `apps-script/Report.gs`**。不需要 `ReportDialog.html`（只有選單模式
   載入它，`Report.gs:312`）。**不要貼進 ConfigWithSubmit 的專案**——兩個 `doGet`，`RECORD_URL` 會變成「這個網址是
   報告產生器」（`Report.gs:5450-5466`）。
4. 專案設定 → 指令碼屬性（附錄B 有完整表）：
   - `REPORT_API_URL` ＝ `<RECORD_URL>`（必須 `https://script.google.com/` 開頭、`/exec` 結尾，`Report.gs:747-752`）
   - `REPORT_TEMPLATE_DOC_ID` ＝ `<範本DocID>`
   - `REPORT_REGISTRY_ID` ＝ `<註冊表ID>`（**與 `ConfigWithSubmit.gs:97` 同一份**，`Report.gs:390`）
   - `REPORT_OUTPUT_FOLDER_ID` ＝ `<輸出資料夾ID>`（名義選填，網頁模式實際必填，`Report.gs:387`）
5. 時區設台北（報告編號、產生時間取自專案時區，`Report.gs:570-576`）。
6. 部署成網頁應用程式：執行身分「我」、存取「任何人」（`Report.gs:8-10`）。授權時會要求雲端硬碟、文件、試算表、
   外部連線等權限。網址＝`<REPORT_URL>`。
7. 部署帳號要有的權限（`Report.gs:1337-1341`、`:1955-1956`、`:2588-2590`）：
   註冊表「讀」、**每一場設定試算表「編輯」**（要寫 `報告快照`、`_報告暫存`）、範本「**編輯者**」（只有檢視時
   `DocumentApp.openById` 常常失敗；範本本體永遠不會被寫）、輸出資料夾「編輯」。
8. 把 `<REPORT_URL>` 填進 `Analysis.html:325`，commit、push。

**驗證**

1. `<REPORT_URL>` → `BAD_ACTION`，訊息說「這個網址是報告產生器…」（`Report.gs:5463-5466`）。
2. `<REPORT_URL>?action=reportCheck&t=<醫院代號>&ex=<演習代號>&key=錯的` → 逐字 `unauthorized`。
   註冊表模式下 `t`、`ex` **兩個都必填**（`Report.gs:5639-5646`），不會自己猜預設演習。
3. 開 `<站台>/Analysis.html?t=<醫院代號>&ex=<演習代號>&key=<分析金鑰>` → 「產生 Google 文件」可按 →
   **「先檢查設定」**：第一列「程式版本」要等於 `Report.gs:52` 的 `REPORT_BUILD_`；每一項都綠；填入式會列出每個
   `{{列_*}}` 所在表格「目前 N 欄／需要 M 欄」與**缺席的標記**（`Report.gs:2718-2800`）。
   ⚠️ 這個檢查不是零寫入：它會在輸出資料夾建一個 0 位元組檔再丟垃圾桶，並在該場設定試算表寫入／清空隱藏分頁
   `_報告暫存`（`Report.gs:2468-2472`）。
4. 按「下載」（開始產生的按鈕，`Analysis.html:1217`）→ 輸出資料夾出現 Doc 與 PDF，檔名不帶「（部分完成）」。

**常見錯誤**

| 看到 | 原因 |
|---|---|
| 「後端不接受這把分析金鑰」 | 報告 Web 與後端讀的不是同一份註冊表（`Report.gs:1088-1093`） |
| 「後端回傳的是一頁 HTML」 | ConfigWithSubmit 的存取權不是「任何人」 |
| 「缺少 meta 或 stats」 | `REPORT_API_URL` 貼成 `<CONFIG_URL>` |
| 「報告快照 工作表缺少欄位：場景編號、測試場景與目標」 | 那份設定檔有舊版建的快照分頁。改 J1／K1 的欄名（程式以欄名比對），**不要刪分頁**（`Report.gs:110-114`、`:1968-1981`） |
| 報告少一張圖，產生紀錄卻寫「無」 | 填入式的缺席標記不算錯（`Report.gs:1778-1801`、`:5314-5317`）。每換一次範本先跑「先檢查設定」 |
| 「目前無法取得演習註冊資料」(`REGISTRY_OFF`) | `REPORT_REGISTRY_ID` 指錯、部署帳號沒權限、註冊表裡沒有「租戶註冊表」分頁、表頭少了五個必要欄之一，**或註冊表還沒有任何資料列**（從零建置、列還留給精靈時就是這個狀態；錯誤訊息裡給管理者的提示沒提到這一項）（`Report.gs:5652-5662`）。讀取失敗的結果也會在報告端快取 120 秒（`rptreg:v1`，`Report.gs:267-268`、`:5787-5789`），修好之後要等滿兩分鐘再試 |

> 每改一次 `Report.gs`，**同時改 `REPORT_BUILD_`**（`Report.gs:50-52`）。這是從外部分辨線上跑哪一版的唯一依據；
> ConfigWithSubmit 與 Config 沒有對應的指紋，只能看 payload 特徵（例如有沒有 `tenantSource`、`stats.rwg`）。
> 現況：沙箱線上那份在 2026-10-13 重貼時是 `'2026-10-13 rwg'`；repo 隨後在 `da22841` 改成 `'2026-10-13 notes v2'`
> （只換了 12 句綜合能力說明）。線上是否已再重貼〔未驗證〕——按一次「先檢查設定」看第一列就知道。

---

### 2-9. （選用）Setup 精靈（P4）

**前提**：2-4 已建註冊表；2-7 已有 `<站台>`。

**要做**

1. **開註冊表那份試算表** → 擴充功能 → Apps Script（容器綁定；從 Apps Script 首頁新建的是獨立專案，永遠不會有選單，
   `Setup.gs:99-112`）。
2. 三個檔，名稱**逐字**：`Setup.gs`（貼 `apps-script/Setup.gs`）、HTML 檔 `SetupDialog`、HTML 檔 `QrLib`
   （`Setup.gs:123`、`:151-153`）。這個專案**不要**放 `Report.gs`（`onOpen`、`MENU_TITLE_` 撞名，`Setup.gs:39`、`:89`
   對照 `Report.gs:48`、`:281`）。
3. 指令碼屬性（附錄B）：
   - `SETUP_SITE_BASE` ＝ `<站台>`，結尾不加斜線。三條網址都由它組（`Setup.gs:505-514`）；沒設就整個拒絕（`:261-265`）。
   - `SETUP_CONFIG_TEMPLATE` ＝ `<設定範本ID>`。名義選填，但對話框預設就是「複製一份新的設定檔」，沒設這個模式會拒絕
     （`Setup.gs:311-316`）。⚠️ 範本要**乾淨**：精靈用 `makeCopy` 整份複製（`Setup.gs:427-439`），範本裡若有
     `報告快照`／`_報告暫存`，新場次會繼承別場的快照列。範本的 `演習資訊` 先填好 `機構名稱`、`演習主題`、`演習類別`、
     `啟用觀察紀錄`、`低分需說明門檻`——精靈只寫 `演習名稱`、`演習日期`、`說明`（`Setup.gs:785-815`）。
   - `SETUP_TARGET_FOLDER` ＝ `<精靈資料夾ID>`（選填；指定失敗會退回預設位置並寫進 notes）。
4. 時區設台北（`parseWhen_` 也是 `new Date(...)`，`Setup.gs:887-899`）〔推論〕。
5. 存檔，回試算表按 F5 → 出現「演習場次管理」選單（新增一場演習…／檢查註冊表／設定說明，`Setup.gs:113-118`）。
6. 授權：第一次點選單項目時，通常會跳出授權視窗 → 允許。若出現 `script.container.ui` 權限錯誤：
   **不要**照 `Setup.gs:138` 的提示去跑 `onOpen`——報告那支 2026-10-09 實測過那樣不會觸發授權
   （`Report.gs:330-334`）；改在編輯器執行 `showSetupDialog` 觸發授權，仍不行就在 `appsscript.json` 明確宣告
   `oauthScopes`（至少 spreadsheets、drive、script.container.ui）〔推論，比照 `Report.gs:335-343`〕。

**驗證**：選單 → 設定說明：三個屬性都有值。選單 → 檢查註冊表：全部綠色（空表也應該沒有紅字）。

**常見錯誤**：精靈的「檢查註冊表」不檢查時間窗格式（`Setup.gs:553-561`），後端卻會因此判整列無效——精靈全綠、
評核單卻回 `ROW_INVALID`，就先看那一列的時間格。

---

### 2-10. 全面驗證

**A. 自動回歸：`scripts/smoke.sh`**（需要 bash、curl、node；**註冊表裡要已經有資料列**：`EVAL_HOSPITAL` 那家至少要有
一場有效列，而且恰好一個 `預設演習`（`scripts/smoke.sh:101-102`、`:122`、`:159`）。照本文順序，要等第 3 節建好第一場
之後才跑。只建了空的註冊表就跑的話，A 段第一項會因 `REGISTRY_OFF` 失敗（`ConfigWithSubmit.gs:1734-1741`）。下面 B 段的
selftest 帶 `t`／`ex` 時也一樣，沒有那一列就回 `REGISTRY_BROKEN`（`ConfigWithSubmit.gs:582-586`）。）

```bash
EVAL_RECORD_URL='<RECORD_URL>' \
EVAL_HOSPITAL='<醫院代號>' \
EVAL_CLINIC='<第二家醫院代號（對照組）>' \
EVAL_KEY_MAIN='<該院分析金鑰>' \
EVAL_KEY_CLINIC='<對照組分析金鑰>' \
bash scripts/smoke.sh            # 唯讀；加 --with-write 才會真的寫一筆
```

退出碼 0＝全過（`scripts/smoke.sh:8-11`）。在新環境要知道的四件事：

1. 它的預設值指向開發者沙箱（`scripts/smoke.sh:24-27`），**一定要用環境變數覆寫**。
2. `guard_production` 只認得兩個**舊的**正式 `/exec` 前綴（`scripts/smoke.sh:42-47`）。為新的正式環境建部署之後，
   要把新前綴加進去，否則它不會擋。
3. 「跨醫院隔離」是拿字串「萬芳」判斷的（`scripts/smoke.sh:150`）——在別家醫院的環境它永遠會過，等於沒驗。
4. `--with-write`（E 段，`scripts/smoke.sh:229`）寫死了 `TEST-USER`、`SCENE A1`、題號 `1-1`／`1-2`，並把分數送到
   `EVAL_CLINIC` 的演習代號 `2026a`。新環境的對照組沒有一場叫 `2026a`、正在開放、而且名冊與題庫裡有這些值的場次，
   這一段就會失敗；要嘛照樣建一套測試資料，要嘛改腳本。C 段（`:175`）的送出在名單驗證之前就會被 `DISABLED`／
   `OUT_OF_WINDOW` 擋下（`ConfigWithSubmit.gs:765-772` 先於 `:805-818`），不受這些資料影響。

它**不測**：`CONFIG_URL`、報告 Web、`selftest`／`flush`／`exercises`，也不斷言任何統計數字。

**B. `action=selftest`（要先設 `ADMIN_KEY`）**

`ADMIN_KEY` 是 `.gs` 常數、不是指令碼屬性，而 repo 是公開的。做法〔建議〕：只在**線上那份**貼上的副本裡填一把
（附錄C；不可等於 `<ANALYSIS_KEY>`，`ConfigWithSubmit.gs:105-108`）→ 部署新版本 → 跑完 → 改回 `''` 再部署新版本。
repo 裡永遠是 `''`。

```
<RECORD_URL>?action=selftest&t=<醫院代號>&ex=<演習代號>&adminKey=<ADMIN_KEY>
```

應該看到：`registry.invalidRows` 是空陣列、`record.writable` 是 `true`、`record.missingRequired` 是空的、
`messages` 沒有 ⚠️。寫入探測是 `addDeveloperMetadata` 再移除，不寫任何儲存格（`ConfigWithSubmit.gs:1611-1627`）。
這是**唯一**看得到無效列具體原因的地方。

**C. 人工**：手機實際走一次（`docs/manual-test-checklist.md`；流程寫法可參考 `docs/operator-test-manual.md`）。

---

## 3. 開第一家醫院／第一場演習

用精靈（2-9）。日常操作（結束演習、換金鑰、發連結、演習中不要改設定表）看 `docs/owner-guide-多醫院多演習.md`
§6、§7、§10、§11，但注意 0-4 列的過時處。

1. **新醫院的紀錄試算表檔案要自己先建**（含一張有表頭的分頁，見 2-3）。精靈只會在既有檔案裡加分頁，
   從不建立檔案（`Setup.gs:300-305`、`:324-326`）。同一家醫院的後續場次會自動沿用這個檔案。
2. 選單 → 新增一場演習…：
   - 醫事機構代碼 → 精靈產生 `<醫事機構代碼>-<6 hex>` 當醫院代號（`Setup.gs:248-253`）。**不要**直接用公開的醫事機構代碼，
     `?t=` 是陌生人與題庫、名冊、送出分數之間唯一的屏障（`Setup.gs:236-246`）。
   - 演習代號：例如 `2026a`。精靈寫入前會把整列設成純文字（`Setup.gs:731-736`），所以 `2026-01` 經精靈寫入不會變成
     日期；但之後若有人在非純文字的格子裡手動重打，就會被吃成日期而整列無效，所以仍建議避開「數字-數字」的寫法。
   - 顯示名稱（評核官在場次清單上看到的字）、開放送出起／迄（精靈裡**必填**，`Setup.gs:278-284`、`:887-891`）。
   - 設定檔：「複製一份新的設定檔」。紀錄分頁預設 `評核紀錄_<演習代號>`（`Setup.gs:271`）。
   - 只帶 `?t=` 的 QR 一律先顯示場次清單，由評核官自己挑，不會自動進預設那一場（`Start.dc.html:452`、`:481`）。
     勾「設為預設」的作用是：這場在「開放中」排第一（`ConfigWithSubmit.gs:1833`）；舊 `?t=` 連結留下的「已完成」
     標記會搬到這一場（`Start.dc.html:555-558`）；只帶 `?t=` 的分析平台連結會解析到這一場（`ConfigWithSubmit.gs:604-606`）。
     精靈會清掉同院其他啟用列的預設（`Setup.gs:744-754`）。
3. 精靈在寫入前只檢查：欄位格式、時間窗、同代號、同紀錄分頁、同院金鑰，以及（沿用／自填模式下）設定檔的五個分頁
   （`Setup.gs:267-414`）。寫入順序是 複製設定檔 → 建紀錄分頁 → 清其他預設 → 最後才加註冊表那一列（`Setup.gs:416-497`）。
   在預設的「複製一份新的設定檔」模式下，複本的分頁檢查與紀錄試算表能否開啟，都是在複製**之後**才做
   （`Setup.gs:443-451`、`:759-763`）。紀錄試算表 ID 貼錯或沒分享時，會留下一份孤兒複本，錯誤畫面也不會告訴你檔名
   （`Setup.gs:526-528`）：請到 `SETUP_TARGET_FOLDER`（或雲端硬碟）找「<顯示名稱>｜設定」（`Setup.gs:317`）刪掉再重試。
4. 分析金鑰：新醫院現生一把；同院已有一把就沿用；同院已有兩把以上就**拒絕**，要求先統一（`Setup.gs:348-404`）。
   原因：`Analysis.html` 只內嵌得了一把金鑰（`Analysis.html:301`），每場一把會讓場次下拉切過去回 `unauthorized`。
5. 完成畫面給三條網址：醫院通用 `?t=`、單場 `?t=&ex=` 兩條附 QR；分析平台 `Analysis.html?t=&ex=&key=` 只給文字、
   刻意不出 QR（`SetupDialog.html:303-318`、`Setup.gs:505-514`）。**分析平台那條本身就是憑證**，不要外流。
6. 等 2 分鐘（註冊表快取 120 秒，`ConfigWithSubmit.gs:103-104`；報告端另有一份，`Report.gs:267-268`）。
7. 打開複製出來的設定檔，依這場演習改：`演習資訊` 的 `機構名稱`／`演習主題`／`演習類別`（精靈只寫 `演習名稱`／
   `演習日期`／`說明`，`Setup.gs:789-798`；這三列沿用範本的值，而每個 Setup 專案只有一份範本，`Setup.gs:57`、`:427`——
   範本若是為別家醫院填的，評核單標頭就會顯示別家的機構名稱，`ConfigWithSubmit.gs:1947`、`:737`），以及
   `人員代號`、`項目與問題`、`對應指標`。**演習開始後到報告歸檔前不要再改**
   （owner-guide §11）。
8. 驗證：醫院通用網址 → 場次清單出現這一場；分析平台網址 → 載得出來、標頭有場次下拉；
   用了報告的話，「產生 Google 文件」→「先檢查設定」全綠（這一場要先有人送過一筆分數，否則「資料非空」是紅的，
   `Report.gs:2646`；2-8 的驗證 2–4 也在這時候補做）。

> 換某家醫院的分析金鑰時，**該院每一列一起改**。只改一列＝同院兩把金鑰：精靈拒絕在該院新增場次，
> 場次下拉切到另一場回 `unauthorized`（`Setup.gs:384-399`、`:616-645`）。

---

## 4. 測試版覆蓋正式版（升級既有正式站）

### 4-0. 現況與這次會動到什麼

- 正式站＝Vercel 追蹤 `master` 的專案（`exercise-evaluation.vercel.app`）＋正式的兩支 Apps Script（Config、
  ConfigWithSubmit）＋正式試算表。正式環境**沒有**註冊表、報告 Web、Setup。
- `origin/master`（`a7d1871`）是 `dev` 的祖先，可以**快轉**（`git merge-base --is-ancestor origin/master dev` 成立）。
- 本機 `master`（`bb5cfcb`）比 `origin/master` 多三個**只改文件**的 commit（`f04a756`、`bce64cc`、`bb5cfcb`）。
  在本機 `git merge dev` 會在 `CLAUDE.md`／`README.md` 衝突。下面的步驟**不用本機 master**，直接把發行分支推到
  `origin/master`。
- 這次要貼的後端只有兩支：`ConfigWithSubmit.gs`、`Config.gs`。`Report.gs`／`Setup.gs` 不部署到正式（沒有註冊表就沒有用）。
- 正式的兩支 Apps Script 屬於業主的公司帳號，**重貼要由對那兩個專案有編輯權的帳號來做**（`Start.dc.html:279-282`
  記錄過帳號不匹配的後果）。
- `smoke.sh` 拒絕對正式環境執行（`scripts/smoke.sh:42-47`），正式只能手動 GET 驗證，**不可以 POST 測試分數**
  （會寫進正式紀錄表）。

### 4-1. 合併前要先做的決定

| # | 決定 | 建議 | 依據 |
|---|---|---|---|
| 1 | 上線順序 | **後端先、前端後**（見 4-2；和原本「前端先」的計畫不同） | 見 4-2 |
| 2 | 正式的 Config 專案 | 照舊更新；或退役（`Start.dc.html:276` 填成與 `:284` 同值，以後只要貼一支） | 2-6 |
| 3 | `REGISTRY_SPREADSHEET_ID` | `''` | `ConfigWithSubmit.gs:95-96`。後果：沒有場次下拉、沒有「產生 Google 文件」，報告只剩「列印檢視」 |
| 4 | `REPORT_URL` | `''` | `Analysis.html:321-324`。漏改的話，日後按鈕會把正式分析金鑰送到開發者個人的部署（`docEndpoint` 帶 `&key=`，`Analysis.html:1169-1177`） |
| 5 | `ANALYSIS_KEY` | **這次不動**（dev 與 master 已同值）。要輪替就另外一次，而且 `Analysis.html:286` 與正式 `ConfigWithSubmit.gs:86` 同時換，先換的一邊會讓儀表板 `unauthorized` | `ConfigWithSubmit.gs:708`；CLAUDE.md「Branch state」的警告 |
| 6 | 正式紀錄表加不加 `觀察紀錄` 欄 | 要保留評核官留言就要加；沒有這欄，新後端也會丟掉留言（`ConfigWithSubmit.gs:911`）。加在最右邊，舊後端不受影響 | 舊版別名裡沒有任何一個是「觀察紀錄」的開頭（`master:apps-script/ConfigWithSubmit.gs:19-27`） |
| 7 | 要不要先關留言框 | 不想收留言就在正式 `演習資訊` 加一列 `啟用觀察紀錄`＝`N`（只有新後端認得：沒退役 Config 的話要在 Config 更新後才有效；退役的話步驟 3 之後就有效。兩條路都要在步驟 5 之前加，見步驟 4） | `Config.gs:63-67`、`ConfigWithSubmit.gs:1953-1957` |
| 8 | `action=sessions` 的無金鑰曝光 | 這次合併**不會**產生曝光：註冊表是 `''` 時它只回 `REGISTRY_OFF`（`ConfigWithSubmit.gs:1733-1742`）。這個姿態問題要在**建立正式註冊表那天**重新回答 | CLAUDE.md「The action=sessions exposure」 |

### 4-2. 順序：建議「後端先、前端後」

**和原本「先覆蓋、再更新後端」的計畫相反，理由如下。** 兩種中間狀態裡，只有一種會丟資料：

| 中間狀態 | 評核官看到的 | 分析者看到的 | 損害 |
|---|---|---|---|
| **新前端＋舊後端**（前端先） | 多出觀察紀錄框（舊後端沒回 `commentEnabled`，`Start.dc.html:825` 判成顯示），**填了不會存**（舊後端不寫留言，`master:apps-script/ConfigWithSubmit.gs:166-178`）；送出鈕不會因時間窗變灰 | 儀表板正常（`normalisePotentials` 與本機 r_wg 撐住，`Analysis.html:520-531`、`:756-760`）；未觸發率等顯示「—」 | **評核官打的文字靜默遺失，不可逆** |
| **舊前端＋新後端**（後端先） | 完全正常（舊前端不送 `tenant`，冪等鍵與舊版一字不差，`ConfigWithSubmit.gs:828-830`） | 「反應」雷達空白、iso-3D 少一欄、排序表少一組（舊頁寫死「回應」，`master:Analysis.html:88`） | 純顯示、只有持金鑰的人看得到 |

後端先還有一個好處：在使用者畫面還沒變之前，先用正式試算表驗證新後端（新後端讀表比較嚴，缺欄時會丟中文錯誤，
而舊版是靜默讀成空，`ConfigWithSubmit.gs:1983-1991` 對照 `master:apps-script/ConfigWithSubmit.gs:503`）；
驗證失敗就把後端退回舊版，使用者完全不受影響。

如果仍要前端先：前提是**間隔期間沒有任何演習在填答**，而且間隔要短。

兩個前提，任一順序都適用：在**非演習時段**做；期間**不要**改正式試算表的潛能字面（`回應`→`反應`）或表頭（`情境`→`場景`）
——舊後端只認舊字（`master:apps-script/ConfigWithSubmit.gs:308`、`:25`），在確定不回滾之前改了，資料會靜默消失。
正式 `對應指標` 留著 `回應` 完全沒問題，新後端會折成 `反應`（`ConfigWithSubmit.gs:2053-2056`）。

### 4-3. 合併前檢查清單（唯讀，先做）

1. 沙箱基線：在 `dev` 跑一次 `bash scripts/smoke.sh`（帶沙箱金鑰的環境變數），確認全綠。
2. 盤點正式環境（用業主帳號）：
   - 打開兩支正式 Apps Script，**另存目前線上的原始碼**（存在 repo 以外的地方——裡面有正式 ID），並記下
     「管理部署作業」裡目前的**版本號**。線上程式不一定等於 `master` 的檔案（沙箱的 Config 就是混合體），
     回滾時要找得到「原本是什麼」。
   - 正式紀錄表的表頭：有沒有 `觀察紀錄`？再逐欄對照 `ConfigWithSubmit.gs:47-59` 的新別名（完全相等或「以它開頭」都算
     命中，`:2063-2066`）：
     - 以「觀察紀錄／觀察意見／質性觀察／備註」開頭的欄會被當成觀察紀錄欄讀寫。
     - 以「評核潛能／潛能／4S 元素／4S元素／單一 4S 元素／評核題目／具體評核題目／問題內容」開頭的欄會變成快照欄，
       之後**每一次送出**都要先完整讀 `對應指標`，五欄缺一就整筆送出失敗（`:872-873`、`:969`）。
     - 以「測試場景／測試情境」開頭的欄會開始被寫入場景目標快照（取自 `項目與問題`，不依賴 `對應指標`，`:874-875`）。
     - 以「醫院代號／機構代號／演習代號／場次代號」開頭的欄會改變分析的去重鍵（`:1060`）。
     〔未驗證：正式紀錄表的實際表頭無法從 git 確認〕
   - 正式 `對應指標` 的 4S 值是不是 `Space (空間)` 那一組字串；不是的話「綜合能力」說明欄會整欄空白
     （`Analysis.html:884-888`）。〔未驗證〕
3. 指紋（確認現在線上是舊版）：裸 `<正式 RECORD_URL>` 回應裡**沒有** `tenantSource`；裸 `<正式 CONFIG_URL>`
   回應裡**沒有** `commentEnabled`。
4. 替現行正式 commit 打 tag：
   ```bash
   git tag prod-before-<日期> origin/master
   git push origin prod-before-<日期>
   ```

### 4-4. 實際步驟

**步驟 1：在發行分支上切常數（還不要推）**

```bash
git switch -c release-<日期> dev
```

改下面 8 行（表中標「—」的兩列不動）。正式值都寫在相鄰註解裡（除了要改成 `''` 的兩行）：

| # | 位置 | 改成 | 正式值在哪 |
|---|---|---|---|
| 1 | `Start.dc.html:276` `CONFIG_URL` | 正式 Config 的 `/exec`（選擇退役時＝第 2 列的值） | `Start.dc.html:269` 註解 |
| 2 | `Start.dc.html:284` `RECORD_URL` | 正式 ConfigWithSubmit 的 `/exec` | `Start.dc.html:270` 註解 |
| 3 | `Analysis.html:283` `RECORD_URL` | 同第 2 列 | `Analysis.html:282` 註解 |
| 4 | `Analysis.html:325` `REPORT_URL` | `''` | `Analysis.html:321-324` |
| 5 | `apps-script/ConfigWithSubmit.gs:21` | 正式設定試算表 ID | `:18` 註解 |
| 6 | `apps-script/ConfigWithSubmit.gs:24` | 正式紀錄試算表 ID | `:19` 註解 |
| 7 | `apps-script/ConfigWithSubmit.gs:97` `REGISTRY_SPREADSHEET_ID` | `''` | `:95-96` |
| 8 | `apps-script/Config.gs:7` | 正式設定試算表 ID（＝第 5 列） | `Config.gs:5-6` 註解 |
| — | `Analysis.html:286`、`ConfigWithSubmit.gs:86` `ANALYSIS_KEY` | **不動**（兩邊與正式同值） | — |
| — | `ConfigWithSubmit.gs:109` `ADMIN_KEY` | 保持 `''` | — |

同一個 commit 裡把描述沙箱的註解改寫掉（`Start.dc.html:267-275`、`:277-283`（**不要動** `:265` 的 `</x-dc>` 與 `:266` 的
`<script … data-dc-script>` 標籤）、`Analysis.html:273-282`、`:319-324`、
`ConfigWithSubmit.gs:16-24`、`:95-96`、`Config.gs:5-6`）：它們會隨 HTML 一起被正式站送出去，而且切完常數之後
內容就是錯的。

**步驟 2：機械檢查（不印出任何值）**

```bash
same() { [ "$(git show dev:"$1" | grep -E "$2")" = "$(grep -E "$2" "$1")" ]; }
for pair in \
  'Start.dc.html|^const CONFIG_URL =' \
  'Start.dc.html|^const RECORD_URL =' \
  'Analysis.html|^const RECORD_URL =' \
  'Analysis.html|^const REPORT_URL =' \
  'apps-script/ConfigWithSubmit.gs|^var CONFIG_SPREADSHEET_ID =' \
  'apps-script/ConfigWithSubmit.gs|^var RECORD_SPREADSHEET_ID =' \
  'apps-script/ConfigWithSubmit.gs|^var REGISTRY_SPREADSHEET_ID =' \
  'apps-script/Config.gs|^var CONFIG_SPREADSHEET_ID ='; do
  f=${pair%%|*}; re=${pair#*|}
  same "$f" "$re" && echo "⚠️ 仍是 dev 值：$f $re" || echo "已換：$f $re"
done
grep -qE "^const REPORT_URL = '';" Analysis.html && echo "REPORT_URL 為空 OK"
grep -qE "^var REGISTRY_SPREADSHEET_ID = '';" apps-script/ConfigWithSubmit.gs && echo "REGISTRY 為空 OK"
grep -qE "^var ADMIN_KEY = '';" apps-script/ConfigWithSubmit.gs && echo "ADMIN_KEY 為空 OK"
[ "$(grep -E '^const RECORD_URL =' Start.dc.html)" = "$(grep -E '^const RECORD_URL =' Analysis.html)" ] && echo "兩頁 RECORD_URL 一致"
a=$(grep -E "^const ANALYSIS_KEY =" Analysis.html | cut -d"'" -f2)
b=$(grep -E "^var ANALYSIS_KEY =" apps-script/ConfigWithSubmit.gs | cut -d"'" -f2)
[ "$a" = "$b" ] && echo "ANALYSIS_KEY 兩邊一致" || echo "⚠️ ANALYSIS_KEY 不一致"
git diff dev --stat     # 只該出現這四個檔
```

每一行都要是「已換」或「OK」。再用 `git diff dev` 目視一次，確認新值與相鄰註解裡的正式值一致。然後 commit
（**還不要推**）。

> ⚠️ 只要推出一個「已合併、常數卻還是 dev 值」的 master commit，Vercel 會立刻部署：正式站的評核官會讀開發者沙箱的
> 設定、分數也寫進沙箱。切常數一定和這個 commit 綁在一起，推之前一定跑步驟 2。

**步驟 3：更新正式 ConfigWithSubmit（後端先）**

1. 用業主帳號打開正式 ConfigWithSubmit 專案，確認已另存舊程式碼與版本號（4-3）。
2. 全選刪除，貼上**發行分支上的** `apps-script/ConfigWithSubmit.gs` 全文（已是正式常數）。
3. 部署 → 管理部署作業 → 鉛筆（**編輯現有部署**）→ 版本「新版本」→ 部署。**不要**按「新增部署作業」：那會產生新的
   `/exec`，而前端（`Start.dc.html:284`、`Analysis.html:283`）還在打舊網址，等於新程式沒有任何人用到。（冪等去重用的
   `CacheService.getScriptCache()` 是整個專案共用，跟哪一個部署無關，`ConfigWithSubmit.gs:821`、`:832`。）
4. 立刻驗證（只用 GET）：
   - `<正式 RECORD_URL>` → 有 `"tenantSource":"fallback"`，`orgName` 與 `codes` 是業主的（不是沙箱的
     A01–A07＋TEST-USER）。回 `CONFIG_READ_FAILED` → **立刻回滾後端**（4-6），那代表每一次送出也會失敗。
   - `<正式 RECORD_URL>?action=sessions&t=abc` → `REGISTRY_OFF`。
   - `<正式 RECORD_URL>?action=analysis&key=<ANALYSIS_KEY>` → `stats` 裡有 `rwg`，`stats.potentials` 的鍵是 `反應`
     而不是 `回應`（`ConfigWithSubmit.gs:1162`、`:1165`）。

**步驟 4：更新正式 Config（選擇退役就跳過；但「關留言框」這一步兩條路都要做）**

要關留言框的話，**不論是否退役**，都在步驟 5 之前去正式 `演習資訊` 加 `啟用觀察紀錄`＝`N`：退役的話新前端不帶參數時
打的是 `<正式 RECORD_URL>`（`Start.dc.html:308`），用它（不帶參數）確認回應裡有 `"commentEnabled":false`
（`ConfigWithSubmit.gs:1953-1957`、`:750`）；沒退役的話照下面更新 Config 之後用 `<正式 CONFIG_URL>` 確認。

沒退役時：同步驟 3，貼發行分支的 `apps-script/Config.gs`、編輯現有部署、新版本。驗證：`<正式 CONFIG_URL>` 回應裡有
`commentEnabled`（`Config.gs:22`），`orgName` 是業主的；加了 `啟用觀察紀錄`＝`N` 的話應該看到 `"commentEnabled":false`。

**步驟 5：推前端（快轉 `origin/master`）**

```bash
git push origin release-<日期>:master     # 一般 push，是快轉；不要 --force
```

⚠️ 這次之後 `origin/master` 會多一個 `dev` 沒有的「切常數」commit（而且**不要**把它合回 `dev`，那會把正式 ID 帶進沙箱）。
所以 4-0 的「可以快轉」只對第一次發行成立，下一次升級不能再快轉：要從 `origin/master` 開發行分支、`git merge dev`，
衝突處的常數一律保留正式值，再跑步驟 2 的檢查。

這會一併帶上 `.vercelignore` 與 `.gitignore`（`origin/master` 目前兩者都沒有，所以正式站**現在**會送出
`/apps-script/*.gs` 與 `/CLAUDE.md`）。

本機 master 的三個文件 commit 之後再處理：先 `git tag local-master-backup master` 留底，再用
`git diff prod-before-<日期> master --stat` 確認只有 `CLAUDE.md`／`README.md`（push 之後 `origin/master` 已經是發行分支，
拿它來比會列出二十幾個檔），再決定要不要把本機 master 對齊 `origin/master`（那是破壞性操作，做之前先問自己）。

### 4-5. 上線後檢查

1. 等 Vercel 建置完成，比對：
   ```bash
   git show origin/master:Analysis.html | sha256sum
   curl -s https://exercise-evaluation.vercel.app/Analysis.html | sha256sum
   ```
   （`Start.dc.html` 同法。）
2. `https://exercise-evaluation.vercel.app/apps-script/ConfigWithSubmit.gs`、`/CLAUDE.md`、`/scripts/smoke.sh` → 都 404。
   `/.vercelignore`、`/.gitignore` 會不會被送出〔未驗證〕；內容只有註解，風險低。
3. `https://exercise-evaluation.vercel.app/Start.dc.html`（不帶參數）→ 業主的機構／演習／日期與名冊；**不要送出**。
4. `https://exercise-evaluation.vercel.app/Analysis.html` → 反應雷達有資料、「統計方法」分頁第 4 點的 r_wg 後面印出數值
   （不是「資料不足」，`Analysis.html:776`；一致性徽章 `#agreeBadge` 在沒有分頁按鈕的 `#detail` 裡，畫面上看不到）、沒有場次下拉、
   「產生 Google 文件」灰色且說「此部署尚未啟用報告產生器」——**這是預期行為，不是功能沒上**（`Analysis.html:1149`）。
   「列印檢視」的說明卡裡仍有一句叫人改走「設定試算表選單」的舊文字（`Analysis.html:832`），那條路正式環境沒有。
5. 若一定要驗證「送出」：和業主約好，在 `人員代號` 加一個臨時代號、送一筆、確認後由業主刪掉那幾列與臨時代號。
   不約就不做——第一位真實評核官的送出就是驗證。
6. 進行中的評核官不會掉「已完成」標記：不帶參數的 localStorage 鍵與 master 逐字相同（`Start.dc.html:390-392`）。

### 4-6. 回滾

**前端**（Vercel 追蹤 `master`）：

- Vercel 後台 Instant Rollback 把前一個 Production 部署重新推上 production（平台功能，不改 git）。⚠️ 回滾之後 Vercel 會
  **關閉正式網域的自動指派**：之後再推 `master` 只會建置、不會上線，直到在 Production 部署卡片按「Undo Rollback」
  （或 `vercel promote`）為止。修好要重新上線時，先 Undo Rollback 再推，否則 4-5 的 sha256 比對會一直對不上
  〔文件記載：Vercel 文件 `/docs/instant-rollback`〕；或
- 在一個從 `origin/master` 開出的分支上用新 commit 還原（**不要用本機 master**，它與 `origin/master` 已分岔，見 4-0）：
  ```bash
  git fetch origin
  git switch -c rollback-<日期> origin/master
  git checkout prod-before-<日期> -- Start.dc.html Analysis.html
  git commit -m "Roll back frontend to prod-before-<日期>"
  git push origin rollback-<日期>:master   # 快轉，不要 --force
  ```

**後端**（每一支各自）：管理部署作業 → 鉛筆 → 版本選**舊的版本號** → 部署。`/exec` 不變，快取與屬性跨版本保留。
新後端期間寫進去的列對舊後端無害（舊版分析只讀題號／代號／分數／項目欄，`master:apps-script/ConfigWithSubmit.gs:262-285`）。

**兩邊都要退時的順序：與上線相反——先退前端、再退後端。** 這樣中間狀態就是上線時已經接受過的「舊前端＋新後端」
（只有儀表板反應桶空白）。反過來先退後端，會出現「新前端＋舊後端」＝留言靜默遺失。
例外：新後端本身讓送出失敗（步驟 3 驗證抓到 `CONFIG_READ_FAILED` 之類）時，**立刻先退後端**——分數比留言重要。

回滾期間一樣不要改正式試算表的潛能字面或表頭。

---

## 5. 會讓你卡住的坑

| 症狀 | 真正原因 | 怎麼辦 |
|---|---|---|
| 手機或報告拿到一整頁 HTML／Google 登入頁 | Web App 存取權不是「任何人」（`Report.gs:1064-1071`）；Workspace 網域可能禁止開放〔推論〕 | 編輯現有部署，改「任何人」，執行身分維持「我」 |
| 改了程式、重新部署了，前端行為沒變 | 按了「新增部署作業」，產生新 `/exec` | 回到原部署「編輯 → 新版本」；或把新網址補進所有常數與 `REPORT_API_URL` |
| `人員代號 缺少欄位：代號` | 表頭寫成「人員代號」（`ConfigWithSubmit.gs:1989-1998`） | 改成「代號」 |
| 題號變成一長串英文日期 | Sheets 自動轉日期；設定表不會被程式設成純文字（`ConfigWithSubmit.gs:925-931` 只處理紀錄表） | 題號欄先設純文字再填 |
| 某個場景整頁送出被拒「未知的問題ID」 | 最底層名稱整表重複（`ConfigWithSubmit.gs:811-818`、`:2119-2129`） | 葉節點名稱全表唯一 |
| 手機上有、圖表上沒有，沒有警告 | `對應指標` 缺該題號，或潛能值不在可接受集合（`ConfigWithSubmit.gs:1142-1147`） | 對照兩張表的題號；潛能值逐字 |
| 分析頁 `ANALYSIS_FAILED`、報告也掛 | `對應指標` 五欄缺一（常見：`4S元素` 沒空格，`ConfigWithSubmit.gs:76`） | 依 `README.md` L139-182 修表頭 |
| 加了快照欄之後所有人送出失敗 | 每次送出都要先讀 `對應指標`（`ConfigWithSubmit.gs:869-873`） | 先修好 `對應指標`，或先拿掉快照欄 |
| 留言寫進「備註」欄 | 別名含「備註」，取最左邊符合的欄（`ConfigWithSubmit.gs:47`、`:2058-2069`） | 紀錄表不要留同義欄 |
| `紀錄表缺少欄位：…` | 紀錄分頁表頭不完整；或精靈抄錯分頁的表頭（`Setup.gs:769-775`） | 紀錄試算表只放紀錄分頁 |
| `紀錄試算表裡找不到指定的工作表` | 分頁名不符；後端不會自動建（`ConfigWithSubmit.gs:676-679`） | `selftest` 看 `record.sheetName`；補分頁 |
| 儀表板只帶 `?t=`（沒帶 `&ex=`）時回「尚未指定預設演習」或「有多列被標為預設演習」 | 預設演習 0 列或 ≥2 列（`ConfigWithSubmit.gs:604-610`）；精靈與後端對 `啟用`／`預設演習` 判讀不同（`Setup.gs:869-872` 對照 `ConfigWithSubmit.gs:204-216`）。評核單的醫院通用 QR **不受影響**：它走場次清單（`Start.dc.html:301`、`ConfigWithSubmit.gs:1745-1766`），不需要預設演習；`Setup.gs:611` 的提示文字是舊的 | 兩欄一律明確填 `Y`／`N`；每家醫院恰好一列預設 |
| `ROW_INVALID`，精靈「檢查註冊表」卻全綠 | 精靈不檢查時間窗（`Setup.gs:553-561`）；後端看不懂時間就判整列無效（`ConfigWithSubmit.gs:259-270`） | 時間寫 `2026/10/06 08:00`；用 `selftest` 看原因 |
| 帶 `?t=` 全部「系統設定目前有問題…」 | `REGISTRY_BROKEN`：註冊表表頭被改、分頁改名、或全部列無效（`ConfigWithSubmit.gs:565-590`） | 修表頭，等 120 秒 |
| 改了註冊表沒反應 | 兩份獨立的 120 秒快取（`reg:v2`、`rptreg:v1`）；`flush` 要 `ADMIN_KEY` 且清不到報告端 | 等滿兩分鐘再測 |
| 自訂的場景前綴沒效 | 表頭寫成「場景前綴」，別名只有 `scenePrefix`／`情境前綴`（`ConfigWithSubmit.gs:124`） | 表頭用 `scenePrefix` |
| 開放送出時間整段偏移幾小時 | 專案或試算表時區不是台北；文字時間用 `new Date` 解析（`ConfigWithSubmit.gs:263`、`Setup.gs:893`）〔推論〕 | 三個專案＋註冊表都設台北 |
| 場次下拉切過去 `unauthorized` | 同院多把金鑰，儀表板只有一把（`Analysis.html:301`） | 同院每列統一一把 |
| 儀表板 `unauthorized` | 連結沒帶 `&key=`，用了內嵌的 `ANALYSIS_KEY` | 用精靈產的分析網址 |
| 「產生 Google 文件」灰色 | `REPORT_URL` 空，或這場不是由註冊表路由（`Analysis.html:1147-1157`） | 連結帶 `?t=&ex=&key=`。提示文字說的「設定試算表選單」已不存在 |
| 報告「後端不接受這把分析金鑰」 | 報告 Web 與後端指向不同的註冊表（`Report.gs:1088-1093`） | `REPORT_REGISTRY_ID`＝`REGISTRY_SPREADSHEET_ID` |
| 報告「缺少 meta 或 stats」 | `REPORT_API_URL` 貼成 Config 的 `/exec` | 改成 `<RECORD_URL>` |
| 報告開頭就「報告快照 工作表缺少欄位：場景編號、測試場景與目標」 | 2026-10-12 之前建的快照表頭（`Report.gs:110-114`、`:1968-1981`） | 改 J1／K1 欄名，不要刪分頁 |
| 報告產好了，按按鈕的人打不開 | 檔案在部署帳號的硬碟，程式不分享（`Report.gs:2588-2590`） | `REPORT_OUTPUT_FOLDER_ID` 指向已分享的資料夾 |
| 「可以看到範本檔案，但無法用程式開啟它」 | 部署帳號對範本只有檢視權（`Report.gs:1337-1341`） | 給「編輯者」 |
| 填入式報告少一張圖，產生紀錄寫「無」 | 缺席的標記不算錯（`Report.gs:1778-1801`） | 換範本後先跑「先檢查設定」 |
| `RECORD_URL` 回「這個網址是報告產生器」 | `Report.gs` 被貼進 ConfigWithSubmit 專案，`doGet` 撞名 | 一個專案只放一組檔案 |
| 選單只剩一個或不見 | `Setup.gs` 與 `Report.gs` 同專案，`onOpen` 撞名 | 分開放 |
| 新場次的報告快照裡有別場的列 | `SETUP_CONFIG_TEMPLATE` 指向產過報告的設定檔，被整份複製（`Setup.gs:427-439`） | 範本保持乾淨 |
| 精靈建的新設定檔，後端「無法開啟設定試算表」 | 精靈執行者與部署帳號不同（`Setup.gs:427-441`）〔推論〕 | 同一帳號；或 `SETUP_TARGET_FOLDER` 指向已分享的資料夾 |
| 平均分莫名變低 | 手動加的列分數空白，`Number('')` 是 0（`ConfigWithSubmit.gs:1043-1044`） | 不要手動加列或加總列 |
| `演習資訊` 某個標籤讀不到，精靈卻改得到 | 後端 `===` 不 trim（`ConfigWithSubmit.gs:1946-1953`），精靈 trim 後比對（`Setup.gs:804`） | 刪掉標籤尾端空白 |
| 同一題在分析表出現兩列 | 同一場同時收到不帶參數與 `?t=` 的送出，而紀錄表有 `醫院代號` 欄（去重鍵不同，`ConfigWithSubmit.gs:1060`）〔推論〕 | 同一場只發一種連結 |
| smoke.sh 在新環境 E 段（`--with-write`）失敗，或跨院檢查永遠過 | 寫死 `TEST-USER`／`SCENE A1`／`1-1`／`2026a`／「萬芳」（`scripts/smoke.sh:150`、`:229`） | 建同樣的測試資料或改腳本 |
| smoke.sh 對新的正式環境沒被擋 | `guard_production` 只認舊正式前綴（`scripts/smoke.sh:44-46`） | 加入新前綴 |
| 正式站觀察紀錄框出現、留言卻沒存 | 新前端＋舊後端；或紀錄表沒有 `觀察紀錄` 欄（`ConfigWithSubmit.gs:911`） | 後端先上；加欄 |
| 正式站儀表板反應雷達空白 | 舊 `Analysis.html`＋新後端（`master:Analysis.html:88`） | 推前端 |
| 從儀表板產的報告停在半成品、重試後出現重複列 | 填入式複製樣板列後、填值前被 6 分鐘上限砍掉（`Report.gs:5055-5083`；`docs/handover-筆電.md` §0.3） | 已知未修。重新產一份新的（每次都是新文件，不會蓋掉舊的） |

---

## 附錄A　每個環境要填的常數

| 位置 | 常數 | 意義 | 佔位符／值 |
|---|---|---|---|
| `Start.dc.html:276` | `CONFIG_URL` | 不帶參數時讀設定的 Web App | `<CONFIG_URL>`（退役時＝`<RECORD_URL>`） |
| `Start.dc.html:284` | `RECORD_URL` | 帶參數的設定、場次清單、送出 | `<RECORD_URL>` |
| `Analysis.html:283` | `RECORD_URL` | 分析與場次下拉 | `<RECORD_URL>`（與上一列同值） |
| `Analysis.html:286` | `ANALYSIS_KEY` | 沒帶 `?key=` 時用的金鑰（`Analysis.html:301`） | `<ANALYSIS_KEY>`（＝`ConfigWithSubmit.gs:86`） |
| `Analysis.html:325` | `REPORT_URL` | 報告 Web App；`''`＝按鈕永久停用 | `<REPORT_URL>` 或 `''` |
| `apps-script/ConfigWithSubmit.gs:21` | `CONFIG_SPREADSHEET_ID` | fallback 租戶的設定試算表 | `<設定試算表ID>` |
| `apps-script/ConfigWithSubmit.gs:24` | `RECORD_SPREADSHEET_ID` | fallback 租戶的紀錄試算表 | `<紀錄試算表ID>` |
| `apps-script/ConfigWithSubmit.gs:25` | `RECORD_SHEET_NAME` | fallback 的紀錄分頁名 | `'評核紀錄'`（固定，分頁要同名） |
| `apps-script/ConfigWithSubmit.gs:86` | `ANALYSIS_KEY` | fallback 租戶的分析金鑰 | `<ANALYSIS_KEY>` |
| `apps-script/ConfigWithSubmit.gs:97` | `REGISTRY_SPREADSHEET_ID` | 租戶註冊表；`''`＝關閉 | `<註冊表ID>` 或 `''` |
| `apps-script/ConfigWithSubmit.gs:98` | `REGISTRY_SHEET_NAME` | 註冊表分頁名 | `'租戶註冊表'`（固定） |
| `apps-script/ConfigWithSubmit.gs:99` | `DEFAULT_RECORD_SHEET_NAME` | 註冊列 `紀錄分頁名稱` 空白時用 | `'評核紀錄'`（固定） |
| `apps-script/ConfigWithSubmit.gs:109` | `ADMIN_KEY` | `selftest`／`flush` 用；`''`＝停用 | repo 永遠 `''`；只在線上副本暫時填 `<ADMIN_KEY>` |
| `apps-script/Config.gs:7` | `CONFIG_SPREADSHEET_ID` | 不帶參數時讀的設定表 | 與 `ConfigWithSubmit.gs:21` 同值 |
| `scripts/smoke.sh:24`／`:26-27` | `BASE`／`HOSPITAL`／`CLINIC` | 預設值是沙箱 | 用 `EVAL_RECORD_URL`／`EVAL_HOSPITAL`／`EVAL_CLINIC` 覆寫 |
| `scripts/smoke.sh:44-46` | `guard_production` 前綴 | 拒絕對正式環境執行 | 新正式部署要自己加 |
| `apps-script/Report.gs:52` | `REPORT_BUILD_` | 版本指紋，**不是**環境值 | 改 `Report.gs` 時一起改 |

正式值目前寫在相鄰註解：`Start.dc.html:269-270`、`Analysis.html:282`、`ConfigWithSubmit.gs:18-19`、`Config.gs:5-6`。
`Report.gs` 與 `Setup.gs` 沒有任何依環境而異的常數，全部走指令碼屬性（附錄B）。

## 附錄B　指令碼屬性一覽（各專案各一份，不互通）

**ConfigWithSubmit、Config**：沒有。兩者都不用 `PropertiesService`，一切走 `.gs` 常數（改了要部署新版本）。

**演習評核報告 Web**（`Report.gs:55-65`、說明表 `:383-393`、檢查 `:722-769`、`:5614-5646`）

| 屬性 | 必要性 | 值 |
|---|---|---|
| `REPORT_API_URL` | 必填 | `<RECORD_URL>`（不是 Config 的；`/dev` 或編輯器網址會被擋） |
| `REPORT_TEMPLATE_DOC_ID` | 必填 | `<範本DocID>`，必須是 Google 文件 |
| `REPORT_REGISTRY_ID` | 註冊表模式必填 | `<註冊表ID>`，與 `ConfigWithSubmit.gs:97` 同一份 |
| `REPORT_CONFIG_SPREADSHEET_ID` | 只在 `REPORT_REGISTRY_ID` 空白時必填 | 要寫 `報告快照` 的設定試算表 |
| `REPORT_ANALYSIS_KEY` | 只在 `REPORT_REGISTRY_ID` 空白時必填（網頁＋註冊表模式**不讀**，`Report.gs:739`） | 網址 `key` 必須逐字等於它 |
| `REPORT_OUTPUT_FOLDER_ID` | 名義選填、網頁模式實際必填 | `<輸出資料夾ID>` |
| `REPORT_TIME_BUDGET_MS` | 選填 | 30000–330000，預設 240000（`Report.gs:90`、`:754-757`） |
| `REPORT_TENANT`／`REPORT_EXERCISE` | 網頁模式不讀 | 只給選單模式 |
| `REPORT_RUN_<報告編號>`、`REPORT_ACTIVE_<醫院>/<演習>` | 程式維護 | 每輪一個／每場次一個標記（15 分鐘過期）；墓碑 7 天後在下一次開始產生時清掉（`Report.gs:67-77`、`:6084-6129`）。整個專案約 500KB 上限 |

註冊表關閉時，網頁模式從儀表板走不到（1-3），所以實務上只有註冊表模式。

**（不建議）Report 選單專案**：`REPORT_ANALYSIS_KEY`／`REPORT_API_URL`／`REPORT_TEMPLATE_DOC_ID` 必填，
`REPORT_TENANT`／`REPORT_EXERCISE`／`REPORT_OUTPUT_FOLDER_ID`／`REPORT_TIME_BUDGET_MS` 選填，`REPORT_RUN_STATE`
程式維護（`Report.gs:383-393`、`:739-741`）。報告對象被屬性釘死，執行時選不了場次。

**Setup**（`Setup.gs:48-58`、說明表 `:155-182`）

| 屬性 | 必要性 | 值 |
|---|---|---|
| `SETUP_SITE_BASE` | 必填 | `<站台>`，結尾不加斜線；正式環境要指正式站 |
| `SETUP_CONFIG_TEMPLATE` | 選填（但「複製設定檔」模式需要） | `<設定範本ID>`，乾淨的範本 |
| `SETUP_TARGET_FOLDER` | 選填 | `<精靈資料夾ID>` |

精靈不讀、不產生、不顯示 `ADMIN_KEY`（`Setup.gs:27`）；分析金鑰寫進註冊表，不放屬性。

## 附錄C　金鑰與代號的產生規則

| 東西 | 規則 | 怎麼產生 |
|---|---|---|
| `ANALYSIS_KEY`（fallback） | 寫在 `ConfigWithSubmit.gs:86` 與 `Analysis.html:286`，兩處逐字相同；因為 `Analysis.html` 公開，它**本質上是公開的**（存取控制＝未公開網址＋金鑰）。不要和任何其他環境共用 | 本機產生 32 字英數，例如 `openssl rand -hex 16`（Git Bash 內建）。長度至少 8，報告端才會在錯誤訊息裡遮蔽它（`Report.gs:526`）；建議 32 |
| 註冊列的 `分析金鑰` | 必填（空白＝規則 4 無效）。**同一家醫院所有列同一把**；不同醫院不可共用（規則 3，`ConfigWithSubmit.gs:480-506`）。除了刻意的遷移列，任何註冊列都不要用 `ANALYSIS_KEY` 的值——規則 3 只比對註冊表內的列，抓不到這種重複 | 精靈的 `randomKey_(32)`（`Setup.gs:903-912`，以 `Utilities.getUuid()` 為亂數來源）；手打的列用上面的指令 |
| `ADMIN_KEY` | 不可等於 `ANALYSIS_KEY`、不可出現在任何 HTML（`ConfigWithSubmit.gs:105-108`）。repo 公開，**真值永遠不 commit** | 同上指令另產一把 |
| `醫院代號` | `normSlug_`：trim、轉小寫後須符合 `^[a-z0-9][a-z0-9_-]{0,31}$`；`Date` 直接拒絕（`ConfigWithSubmit.gs:135-141`）。代號永遠不會被拿去 `openById` | `<醫事機構代碼>-<6 位隨機十六進位>`（`Setup.gs:248-253`），10 碼代碼得 17 字。不要直接用公開的醫事機構代碼 |
| `演習代號` | 同 `normSlug_` | 例如 `2026a`；不要 `2026-01`（會被吃成日期，整列無效） |
| 試算表 ID（註冊表格子） | `^[A-Za-z0-9_-]{20,}$`（`ConfigWithSubmit.gs:145-148`） | 只貼網址 `/d/` 與 `/edit` 之間那一段 |
| `submissionId`、`runToken` | 程式自己產生（評核單送出時／報告開始時） | 不用管 |

換金鑰：改註冊表儲存格即可，不用重新部署（`ConfigWithSubmit.gs:705-710`），但同院每一列要一起改、等 120 秒；
fallback 的 `ANALYSIS_KEY` 則要同時改 `Analysis.html:286`（推前端）與 `ConfigWithSubmit.gs:86`（部署新版本）。
