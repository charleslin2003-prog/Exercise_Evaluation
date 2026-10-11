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

---

## ConfigWithSubmit.gs

**放置位置：** 獨立 Apps Script 專案，部署成 Web App，網址即 `RECORD_URL`。
**平常真正會被編輯、重新部署的就是這一支。**

**功能：** 整個後端的核心，一支檔案撐起六種行為：

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
業主自己的範本 Google 文件複本，章節共 16 章 + 附錄A–D，逐章對應範本裡的
`{{SEC_*}}` 錨點（刪錨點＝該章不產生，調錨點順序＝調報告順序）。報告裡的數字
一律原樣取自 `action=analysis` 的回傳，不在這支腳本裡另外重算（唯一例外是
ICC(2,k) 的本機驗算，用來在算出 `null` 時具名指出是哪幾題造成的）。圖表走
「原生圖表 → 直條圖改畫 → 純文字表格」三層降級，絕不因為畫不出圖而整個失敗。
因為 Apps Script 單次執行上限 6 分鐘，產生過程拆成多次
`google.script.run` 呼叫（`reportStart` → `reportContinue` 迴圈），每次只做
預算內能做的章節，中斷也會在封面、檔名、附錄三處清楚標示「部分完成」。

---

## ReportDialog.html

**放置位置：** 容器綁定，跟 `Report.gs` 同一個專案（演習評核_設定底下），是
`Report.gs` 用 `HtmlService` 開出來的對話框（560×680）。

**功能：** 報告產生器的操作介面。驅動 `reportStart`／`reportContinue` 的執行
迴圈，即時顯示目前跑到第幾章、經過時間、以及警告／降級紀錄；也是「檢查設定
（不產生報告）」這個健檢功能的入口。裡面是一般瀏覽器 JS（跑在 Chrome，不是
`.gs` 的 V8 執行環境），不受其他檔案的 ES5 寫法限制。
