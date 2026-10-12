# apps-script/ 檔案總覽

這個資料夾裡的檔案全部是 Google Apps Script 原始碼，但彼此**不是同一種專案**、
也**不綁在同一份試算表下**。改之前先確認放置位置，貼錯試算表或當成同一個
專案看待是最容易出錯的地方。

| 檔案 | 專案類型 | 綁定／部署對象 |
|---|---|---|
| `Config.gs` | 獨立 Web App | 部署成 `CONFIG_URL` |
| `ConfigWithSubmit.gs` | 獨立 Web App | 部署成 `RECORD_URL` |
| `Setup.gs` | 容器綁定 | 租戶註冊表 |
| `SetupDialog.html` | 容器綁定（對話框） | 租戶註冊表（`Setup.gs` 用） |
| `QrLib.html` | 容器綁定（函式庫） | 租戶註冊表（`SetupDialog.html` 用） |
| `Report.gs` | 容器綁定 | 演習評核_設定 |
| `ReportDialog.html` | 容器綁定（對話框） | 演習評核_設定（`Report.gs` 用） |

### ⚠️ 線上狀態不等於 repo（2026-10-12 實測）

repo 是真實來源，**但沒有任何東西會自動同步到 Apps Script**。各支的最新 commit 不同
（`984d9f7` 只動了 `Config.gs`／`ConfigWithSubmit.gs`／`Report.gs`，**沒有**動 `Setup.gs`）：

| 專案 | repo 最新 commit | 線上狀態 | 怎麼確認的 |
|---|---|---|---|
| `ConfigWithSubmit.gs` | `984d9f7` | 線上含 `984d9f7` 的改動 | `action=analysis` 的 `stats.potentials` 鍵回「反應」。那三個鍵是程式裡寫死的字面值，改試算表改不動 |
| `Config.gs` | `984d9f7` | ⚠️ **不等於 repo 任何一個 commit** | 見下方 `Config.gs` 一節 |
| `Setup.gs` | **`92dca7f`** | 先前記錄為已貼 | **無法從外部確認**——容器綁定沒有端點 |
| `Report.gs` | `984d9f7` | **已貼，但早於 `984d9f7`** | 「報告快照」分頁有 6 筆「完成」的報告紀錄（它確實跑過），而該分頁表頭仍是舊名 `情境編號`／`測試情境與目標`（所以線上那份必然早於 `984d9f7`）。⛔ **重貼前先看下方 `Report.gs` 一節** |

兩個精確度上的提醒，因為這張表很容易被過度解讀：

- **一個字串指紋只證明「線上那段程式 ≥ 某個 commit」，不證明整支檔案相同。**
  正下方 `Config.gs` 那一列就是同一個 repo 裡「手改混合體」的實例，正好說明這類指紋
  推不出檔案層級的等同。線上那份有沒有含 `02d5ed1` 的 `REGISTRY_BROKEN` 硬擋等後續
  修正，目前**無法驗證**（`action=selftest` 因 `ADMIN_KEY=''` 停用）。
- **「`git diff 984d9f7 HEAD -- apps-script/` 是空的」只證明 `984d9f7` 之後沒再改**，
  推不出「每一支的最新 commit 都是 `984d9f7`」。要知道某一支的最新 commit，
  跑 `git log -1 -- apps-script/<檔名>`。

### 正式環境還需要指令碼屬性（不是 repo 常數）

兩支容器綁定腳本的設定不在程式裡，合併到正式環境時**要另外設一次**，否則第一次
執行才會炸：

| 專案 | 必填 | 選填 |
|---|---|---|
| `Setup.gs` | `SETUP_SITE_BASE`（目前範例指向測試站） | `SETUP_CONFIG_TEMPLATE`、`SETUP_TARGET_FOLDER`（複製出來的設定檔要放哪個資料夾；沒設就留在範本旁邊） |
| `Report.gs` | `REPORT_ANALYSIS_KEY`、`REPORT_API_URL`、`REPORT_TEMPLATE_DOC_ID` | `REPORT_OUTPUT_FOLDER_ID`、`REPORT_TENANT`、`REPORT_EXERCISE`、`REPORT_TIME_BUDGET_MS` |

---

容器綁定的五個檔案（`Setup.gs`／`SetupDialog.html`／`QrLib.html`／`Report.gs`／
`ReportDialog.html`）**不需要部署**：把內容貼進該試算表「擴充功能 → Apps
Script」底下同名檔案、存檔、重新整理試算表，選單就會出現。只有
`Config.gs`、`ConfigWithSubmit.gs` 這兩個是真正的 Web App，改完要在 Apps
Script 編輯器走「部署 → 管理部署作業 → 編輯現有部署 → 新版本」，而且**一定要
編輯現有部署、不能選「新增部署」**——選錯會換掉 `/exec` 網址，靜靜打壞評核單
與分析頁。

---

## Config.gs

**放置位置：** 獨立 Apps Script 專案，部署成 Web App，網址即 `Start.dc.html`／
`Analysis.html` 裡的 `CONFIG_URL` 常數。

**功能：** 只有 `doGet`、沒有 `doPost` 的唯讀設定端點。讀「演習資訊／人員代號／
評分標準／項目與問題」四個分頁，組成評核單開場要的 JSON。`Start.dc.html` 只
在網址**完全沒有** `?t=`／`?ex=` 參數時打這支——也就是最早期、沒有多租戶概念
的舊連結行為。沒有租戶註冊表邏輯、也沒有 `nullSafeSheet_`／`safeHeaderCol_`
防呆，跟 `ConfigWithSubmit.gs` 已經出現落差（有些函式不再逐字相同），但因為
它只服務無參數連結，這個落差目前可以容忍。

> ⚠️ **線上那份不等於 repo 任何一個版本——它是手改出來的混合體。** 2026-10-12 實測：
>
> ```
> CONFIG_URL  →  "exerciseDate":"Sat Oct 03 2026 15:00:00 GMT+0800 (台北標準時間)"
> RECORD_URL  →  "exerciseDate":"2026/10/03"        ← 同一張表、同一格
> ```
>
> 兩邊的 `items`／`codes`／`criteria`／說明逐位元相同，所以讀的是同一格；差的是
> `Config.gs:40` 的 `formatCellValue_` 沒生效。但線上那份**有** 2026-10-08 補的
> `commentEnabled`（commit `e08b54c`）——而 `formatCellValue_` 由 `13d34da` 引入、
> **比 `e08b54c` 早**，任何含後者的版本必然也含前者。所以「有 `commentEnabled`、
> 沒有日期格式化」不可能是任何一個 commit 的檔案內容。
>
> **處理方式：把 `Config.gs` 全文重貼、部署新版本。** 不急——`Start.dc.html` 的
> `formatExerciseDate()` 看到字串含 `GMT`／`UTC` 會自己 parse 回 `yyyy/MM/dd`，所以
> 評核官看不到。但一支「不等於 repo 任何版本」的線上程式，會把下一個除錯的人騙很久。
>
> ⚠️ 另外：`984d9f7` 對這支的改動（`場景階段`／`測試場景與目標` 別名）**無法驗證**
> 是否已部署。新別名陣列仍包含舊名，而試算表用的就是舊名，所以新舊版輸出完全相同。

---

## ConfigWithSubmit.gs

**放置位置：** 獨立 Apps Script 專案，部署成 Web App，網址即 `RECORD_URL`。
**平常真正會被編輯、重新部署的就是這一支。**

**功能：** 整個後端的核心，一支檔案撐起**七**種行為（這份文件原本寫「六種」，但下面
一直都列著七條——從它誕生那天起就數錯了）：

- `doGet`（無 `action`）：帶 `?t=`／`?ex=` 的評核單設定端點，含租戶路由
  （`resolveTenant_`）、送出時間窗判斷、觀察紀錄開關等。
- `doGet?action=analysis`：分析儀表板／報告產生器在讀的統計端點，金鑰保護。
- `doGet?action=selftest`：健檢，回報註冊表、設定試算表、紀錄試算表狀態，
  `adminKey` 保護，預設關閉。
- `doGet?action=exercises`：某醫院底下所有演習場次列表（含已結束的），
  `key` 保護。
- `doGet?action=sessions`：**無金鑰**，評核官手機在場次選擇畫面會打的端點，
  只回傳同一醫院代號底下的場次清單文字，不開任何試算表。
- `doGet?action=flush`：清掉註冊表快取（120 秒 TTL），`adminKey` 保護。
- `doPost`：評核官送出分數的寫入端點，含 idempotency（`submissionId` 去重）、
  時間窗檢查、欄位 sanitize。

---

## Setup.gs

**放置位置：** 容器綁定腳本，貼在**租戶註冊表**試算表底下（擴充功能 →
Apps Script）。不是獨立專案，不部署——存檔、重新整理試算表，「演習場次管理」
選單就出現。

**功能：**「新增一場演習」精靈的後端邏輯。原本手動開一場演習要五個容易出錯的
步驟（複製設定試算表、加紀錄分頁、自己編金鑰、填 13 欄註冊表、手兜兩條網址），
這支腳本把五步包成一個對話框：寫入前先跑五條健全性檢查（重複代號、重複紀錄
位置、金鑰跨醫院重複、必填欄位、格式解析），檢查過才依「複製設定檔 → 建紀錄
分頁 → 最後才寫註冊表列」的順序寫入——這個順序刻意把註冊表列放最後，確保任何
一步失敗都不會留下一列指向不存在檔案的殘列。完成後直接給評核官連結＋QR code。

---

## SetupDialog.html

**放置位置：** 容器綁定，跟 `Setup.gs` 同一個專案（租戶註冊表底下），是
`Setup.gs` 用 `HtmlService` 開出來的對話框畫面。

**功能：** 新增演習精靈的使用者介面——表單輸入、五條檢查結果的呈現、完成後
顯示評核官網址與 QR code。透過 `<?!= include('QrLib') ?>` 把 `QrLib.html`
整個內嵌進來，所以 QR code 是在瀏覽器裡現場產生，不會把任何網址丟給第三方圖片
服務。

---

## QrLib.html

**放置位置：** 容器綁定，跟 `Setup.gs`／`SetupDialog.html` 同一個專案（租戶
註冊表底下），本身不是獨立對話框，純粹被 `SetupDialog.html` include 進去用。

**功能：** 原封不動 vendored 自 `kazuhikoarase/qrcode-generator`
（`js/dist/qrcode.js`，MIT 授權），提供 `qrcode()` / `addData()` / `make()` /
`createSvgTag()` 這組 API，讓 `SetupDialog.html` 能在瀏覽器端把評核官網址轉成
SVG 格式的 QR code。放在 `apps-script/` 而不是 `vendor/`，是因為只有這個精靈
對話框用得到，且 `apps-script/` 整個目錄被 `.vercelignore` 排除，不會把這
56 KB 送進正式站。

---

## Report.gs

**放置位置：** 容器綁定腳本，貼在**演習評核_設定**試算表底下（擴充功能 →
Apps Script）。不是獨立專案，也不是 Web App，不部署——存檔、重新整理試算表，
「演習評核報告」選單就出現。

**功能：** 演習評核報告產生器（方案B，委員會正式歸檔用，對比 `Analysis.html`
自己的列印視圖「方案A」）。只透過 `UrlFetchApp` 打一次 `ConfigWithSubmit.gs`
的 `action=analysis`，從不改動評核單或分析端。把回傳的統計數字排版進一份
業主自己的範本 Google 文件複本。錨點表共 **21** 個 `{{SEC_*}}`：目錄 1 + 第一～十六章
16 + 附錄A–D 4。（所以對話框的進度是 N/21，而「16 章」漏算了目錄，「21 章 + 附錄A–D」
則是把附錄算了兩次。）逐章對應範本裡的
`{{SEC_*}}` 錨點（刪錨點＝該章不產生，調錨點順序＝調報告順序）。報告裡的數字
一律原樣取自 `action=analysis` 的回傳，不在這支腳本裡另外重算（唯一例外是
ICC(2,k) 的本機驗算，用來在算出 `null` 時具名指出是哪幾題造成的）。圖表是一次原生
嘗試之後再接**四段**降級（這份文件原本只寫三段，漏掉第 ② 段）：
原生嵌入圖表 → ① 改用 **`COLUMN`** 重畫同一組數字 → ② **`legacyChartBlob_`，舊版 Charts
服務** → ③ 原生 Docs 表格 → ④ 一段指名失敗原因的文字。絕不因為畫不出圖而整個失敗。

兩點精確度：**① 只存在於 `RADAR` 與 `BAR` 型的圖**——本身型別就是 `COLUMN` 的圖沒有這
一段（見 `Report.gs:1654-1661` 組 `order` 的地方）；而且改畫目標永遠是 `COLUMN`，`BAR`
只會是某張圖的原生型別，不會被當成退路。
**沒有任何一次實跑已知走到這四段**，但這個說法比它聽起來弱：`chartCapability_` 全綠只
排除得掉 ①，②③④ 是逐張圖在 `tryChartBlob_` 拿不到 blob（含「PNG ≤ 1000 位元組」那種
空白圖）或插入文件失敗時才走，與 capability 無關。真正能證明的是那幾次的
`warnings[]`／附錄C 是空的。
因為 Apps Script 單次執行上限 6 分鐘，產生過程拆成多次
`google.script.run` 呼叫（`reportStart` → `reportContinue` 迴圈），每次只做
預算內能做的章節，中斷也會在封面、檔名、附錄三處清楚標示「部分完成」。

> ## ⛔ 重貼這支之前，先改「報告快照」的表頭，否則第一次產報告就會中止
>
> `984d9f7` 把 `SNAPSHOT_COLUMNS_`（`Report.gs:69-73`）裡的 `情境編號`／`測試情境與目標`
> 改成 `場景編號`／`測試場景與目標`。而設定試算表上那張既有的「報告快照」分頁，表頭
> **仍然是舊名**（2026-10-12 直讀確認）。
>
> `ensureSnapshotSheet_` 以欄名比對、缺欄就 throw，而且 `Report.gs:2112` **刻意**把它排在
> `makeCopy` 之前（註解寫「欄位不符要在建立任何檔案之前就擋下來」）。所以重貼後：
>
> - 按「產生評核報告」→ 立刻丟「『報告快照』工作表缺少欄位：場景編號、測試場景與目標」，
>   連第一章都到不了，更不可能看到第六章。
> - 「檢查設定」的「報告快照工作表」那一項會從 ✅ 變 ❌（M3 記的 14 項全綠不再成立）。
>
> **處理方式：把那張分頁的 J1 改成 `場景編號`、K1 改成 `測試場景與目標`。**
> ⚠️ **不要刪掉整個分頁**——它是 D3 標籤快照的歷史，刪了就沒了。
>
> 這個錯誤訊息指向試算表，不會指向改名那個 commit，所以沒人會自己聯想到。
>
> ---
>
> ⚠️ **這支腳本產哪一場演習的報告，是被指令碼屬性釘死的，執行時選不了。**
> `ReportDialog.html` 裡完全沒有租戶／場次選擇欄位（grep 零命中），報告對象只能來自
> `REPORT_TENANT`／`REPORT_EXERCISE`，而且後端回的 `meta` 與屬性不符時會直接中止。
>
> 後果是一個真實的產品缺口，不是 bug：**`Setup.gs` 精靈新建的場次完全沒辦法產生
> 報告**，除非有人手動去改那兩個屬性——而且還得同時改 `REPORT_ANALYSIS_KEY`，因為
> 精靈每建一列都用 `randomKey_(32)` 現生一把新金鑰，舊金鑰讀不到新場次。
> 任何人測這支腳本，測的是機制，不是他剛剛建的那一場。
>
> `Analysis.html` 那一側（方案A）已經沒有這個問題：`enterReport()` 讀記憶體裡的
> `DATA`，而 `DATA` 跟著標頭的場次下拉走。這也是業主「把產生評核報告搬到分析平台」
> 那項需求真正的價值所在——它會順便消掉這個釘死問題。

---

## ReportDialog.html

**放置位置：** 容器綁定，跟 `Report.gs` 同一個專案（演習評核_設定底下），是
`Report.gs` 用 `HtmlService` 開出來的對話框（560×680）。

**功能：** 報告產生器的操作介面。驅動 `reportStart`／`reportContinue` 的執行
迴圈，即時顯示目前跑到第幾章、經過時間、以及警告／降級紀錄；也是「檢查設定
（不產生報告）」這個健檢功能的入口。裡面是一般瀏覽器 JS（跑在 Chrome，不是
`.gs` 的 V8 執行環境），不受其他檔案的 ES5 寫法限制。
