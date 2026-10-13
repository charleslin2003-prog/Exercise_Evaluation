// 演習評核報告產生器（docs/multi-tenant-and-report-plan.md §3.1 的「方案 B」）。
//
// ⚠️ 這一份原始碼要貼到**兩個**專案，兩份內容逐字相同：
//
//   (A) 容器綁定：貼在「演習評核_設定」那份試算表底下（擴充功能 → Apps
//       Script），**不部署**。存檔、重新載入試算表，「演習評核報告」選單就出現。
//       這條路已經產出過 6 份真實報告，它的行為一個位元都不能變。
//   (B) 獨立專案「演習評核報告 Web」：同一份原始碼，另外**部署成 Web App**
//       （執行身分「我」、存取權「任何人」），/exec 就是 Analysis.html 的
//       REPORT_URL。這條路沒有容器試算表，SpreadsheetApp.getActive() 會回
//       **null（不是丟例外）**，所以每一個用得到試算表的地方都改走
//       targetSpreadsheet_()，由註冊表解析出來的 設定試算表ID 開檔。
//       在 (B) 裡 onOpen 永遠不會觸發、SpreadsheetApp.getUi() 會丟進既有的
//       try/catch，所以選單那一段只是無害的死碼，不需要條件編譯。
//
// 容器綁定腳本**不需要部署**：存檔、重新載入試算表，選單就出現了。
// 這一點就是整個方案 B 的全部理由 —— 業主拉不動「重新部署 Web App」那根槓桿
// （選錯「新增部署」會換掉 /exec 網址、靜靜打壞評核單與分析頁，見 CLAUDE.md
// 「Backend / data architecture」那一節），所以報告功能一行都不能碰
// ConfigWithSubmit.gs。(B) 是**新增**一支 /exec，不是在 ConfigWithSubmit 上
// 加分支 —— 後端的「無金鑰分支只有兩條」那條不變式沒有被動到，而這一支新部署
// 的無金鑰行為是零：沒有金鑰的呼叫只拿得到字串 unauthorized。
//
// ⚠️ 兩份手貼的副本一定會漂移（Config.gs 線上那份就是同一個 repo 裡的實例：
// 它不等於任何一個 commit）。唯一從外部看得出來的防線是 REPORT_BUILD_ ——
// reportCheck 與附錄C 都會印它，兩邊對不上就是其中一份沒重貼。
//
// 它與後端的關係只有一條：用 UrlFetchApp 打 ConfigWithSubmit.gs 的
// `action=analysis`，然後把回傳的數字排版進一份 Google 文件。
// **報告裡的統計數字一律原樣取自該 payload，絕不另算**，否則儀表板與紙本報告
// 會互相打架，而業主沒有任何辦法判斷哪一個才對。唯一的例外是 r_wg 的
// 「本機驗算」（見 verifyRwg_）：stats.rwg.mean 是一個裸數字，看不出有幾題因為
// 只有一位評核官評過而被跳過、幾題因為 r_wg 為負而被截到 0 —— 兩者都會把平均
// 往上拉。報告必須能具名說出是哪幾題，以及一致性最低的是哪幾題。
// （「一題單人評就讓整個資料集變 null」是舊的 ICC(2,k) 的故障模式，r_wg 沒有；
//  r_wg 只有在每一題都只有一位評核官時才是 null。）
//
// 後端從不讀「報告快照」與「_報告暫存」這兩個分頁（它只按分頁名讀 演習資訊／
// 人員代號／評分標準／項目與問題／對應指標／租戶註冊表），所以這支腳本新增的
// 兩個分頁對評核單與分析端是零影響。
//
// ⚠️ 金鑰不寫在這個檔案裡，一律從指令碼屬性讀（見 requireConfig_）。
// 理由：.gs 原始碼會被複製、貼上、郵寄、存進版本控制，金鑰一旦進去就收不回來
// —— plan §6.6 已經在為 ANALYSIS_KEY 進了 git 付代價。這個 repo 目前完全沒有
// 用到 PropertiesService，所以這是淨新增的做法，業主第一次使用前必須先設三個
// 屬性（選單有一項「設定說明（指令碼屬性）」會把步驟列出來）。

var MENU_TITLE_ = '演習評核報告';

// 兩份手貼副本的指紋。**改這個檔案就要改這一行**，否則它會從「可查核的版本號」
// 退化成「兩邊都印同一個字串的裝飾」。reportCheck 與附錄C 都會印它。
var REPORT_BUILD_ = '2026-10-13 rwg';

// ===== 指令碼屬性鍵 =====
var PROP_ANALYSIS_KEY_ = 'REPORT_ANALYSIS_KEY';
var PROP_API_URL_ = 'REPORT_API_URL';
var PROP_TEMPLATE_ID_ = 'REPORT_TEMPLATE_DOC_ID';
var PROP_OUTPUT_FOLDER_ = 'REPORT_OUTPUT_FOLDER_ID';
var PROP_TENANT_ = 'REPORT_TENANT';
var PROP_EXERCISE_ = 'REPORT_EXERCISE';
var PROP_BUDGET_ = 'REPORT_TIME_BUDGET_MS';
var PROP_RUN_STATE_ = 'REPORT_RUN_STATE';
// 只有獨立部署 (B) 需要的兩個。註冊表模式填前者，單一演習模式填後者。
var PROP_REGISTRY_ID_ = 'REPORT_REGISTRY_ID';
var PROP_CONFIG_SS_ID_ = 'REPORT_CONFIG_SPREADSHEET_ID';

// 網頁模式的執行狀態：每一輪各自一個屬性，外加每場次一個「目前有誰在跑」標記。
// 容器選單模式**完全不碰這兩個前綴**，仍然只用單一的 REPORT_RUN_STATE。
// 為什麼不沿用單一槽位：兩家醫院同時產報告會互相覆寫，而 reportContinue 的
// runId 比對會把其中一輪判成「有另一輪插進來」直接中止。
var PROP_RUN_PREFIX_ = 'REPORT_RUN_';
var PROP_ACTIVE_PREFIX_ = 'REPORT_ACTIVE_';
// 終局（done/partial/failed）的執行狀態會被壓成小小的墓碑，只留 reportStatus
// 答得出問題所需的欄位。超過這個年紀的墓碑在下一次 reportStart 時清掉 ——
// 指令碼屬性整個專案約 500KB，一輪完整狀態約 8KB，不掃會慢慢撐爆。
var TOMBSTONE_TTL_MS_ = 604800000; // 7 天
// 單次 HTTP 呼叫的硬上限（Apps Script 的 6 分鐘）。網頁模式用它當「這一輪
// 目前有沒有別的呼叫在飛」的過期時間：被硬上限砍掉的執行不會跑 finally，
// 所以旗標只能靠時間自己過期，不能靠程式清。
var HTTP_CALL_CAP_MS_ = 360000;

// ===== 分頁名稱 =====
var SNAPSHOT_SHEET_NAME_ = '報告快照';
var TEMP_SHEET_NAME_ = '_報告暫存';

// 單次 google.script.run 呼叫的時間預算。Apps Script 單次執行的硬上限是
// 6 分鐘（360000ms），撞到硬上限時執行會被直接終止，連 finally 都不保證會跑，
// 所以這裡刻意留約兩分鐘餘裕，讓「寫不完就回去、由對話框再發一次」成為正常
// 路徑，而不是靠例外處理去搶救。
var DEFAULT_BUDGET_MS_ = 240000;
// 跨步驟的總預算。超過就不再寫新章節，直接進收尾並把報告標成「部分完成」
// —— 一份產不完的報告必須在封面、檔名、附錄三處都自己說出來，不能無聲停住。
var TOTAL_BUDGET_MS_ = 1500000;
// 執行狀態視為「卡住」的門檻：上一輪 status=running 且超過這個時間沒進展，
// 就不再把它當成「正在產生中」（通常是業主關掉了瀏覽器分頁）。
var RUN_STALE_MS_ = 900000;

// payload 跨步驟傳遞：CacheService 單值約 100KB 上限，所以切塊存。
// ⚠️ 那個上限是**位元組**，而 payload 幾乎全是中文（題目、場景目標、指標、
// 觀察紀錄），UTF-8 一個中文字 3 個位元組。用 80000 字元切塊會切出 240KB 的
// 塊、每一塊都 put 失敗，快取路線整條變成死碼，於是每個步驟都重新 fetch 一次
// —— 中間只要有評核官送出新分數，指紋就對不上、整輪中止。
// 30000 字元在最壞情況（全中文）約 90KB，仍在上限內。
var CACHE_CHUNK_ = 30000;
var CACHE_TTL_ = 21600;

// 報告快照 的欄位。全部以欄名比對、不靠位置，而且全部設成 '@' 文字格式
// —— 問題ID 的「10-2」和 演習代號 的「2026-01」正是 Sheets 自動轉日期的典型
// 受害者（與後端 textColIndexes 處理的是同一個危害，plan §7.2）。
var SNAPSHOT_COLUMNS_ = [
  '報告編號', '產生時間', '報告狀態', '機構代號', '演習代號', '分組', '問題ID',
  '階段', '項目名稱', '場景編號', '測試場景與目標', '指標', '評核潛能',
  '4S 元素', '評核題目', '評核人數', '平均', '標準差', '未觸發數', '標籤來源'
];

// 封面 token。範本裡原字打上（含兩層大括號）就會被替換；沒打的不會報錯，
// 只在驗證關卡回報「缺 token」當成警告。
// ⚠️ {{報告版次}} 刻意不在這張表裡：那一格是留給業主在複本裡自己填的。
var COVER_TOKENS_ = [
  '{{機構名稱}}', '{{演習名稱}}', '{{演習主題}}', '{{演習類別}}', '{{演習日期}}',
  '{{機構代號}}', '{{演習代號}}', '{{評核官人數}}', '{{資料列數}}',
  '{{報告產生時間}}', '{{報告編號}}', '{{匿名模式}}',
  // 2026-10-13 新增，給業主自己的報告手稿用（儀表板上那張「說明」KPI 卡的同一個值）。
  // 它走的是既有的 applyCoverTokens_ 三容器 replaceText，所以**打在表格儲存格裡
  // 也會被替換** —— replaceText 會走訪表格，這正是填入式範本不需要為它寫新程式的原因。
  '{{演習說明}}'
];

// 缺席時**不計入** scan.coverMissing 的封面 token。
// 為什麼要有這張表：{{演習說明}} 是後加的，而舊的 21 章骨架範本裡沒有它。
// 若讓它進 coverMissing，每一份用舊範本產出的報告都會在附錄C 多一則
// 「範本缺少封面 token：演習說明」—— 一則對那份範本而言完全正確、卻每次都響的
// 警告。這個檔案已經為同一個病付過一次代價（見 OWNER_FILLED_TOKENS_）。
var COVER_TOKENS_SILENT_ = ['{{演習說明}}'];

// **刻意不填**的 token：報告版次／文件編號／製表／審核／核定 是留給業主在產生出來
// 的文件裡自己簽的（附錄C 最後一段就是這樣寫的）。
// 它們必須被排除在收尾的殘留掃描之外，否則每一份報告都會固定跳出一則
// 「文件裡仍有未被替換的 {{…}}」—— 而那一則正是用來抓「範本 token 打錯字」的。
// 一個每次都響的警告等於沒有警告，而且會訓練操作者忽略它。
// 2026-10-09 第一次真的產生報告時就是這樣：整份文件唯一的殘留是 {{報告版次}}，
// 警告照響，真正的瑕疵（如果有）就會混在裡面看不出來。
var OWNER_FILLED_TOKENS_ = ['{{報告版次}}', '{{文件編號}}', '{{製表}}', '{{審核}}', '{{核定}}'];

// 章節錨點。**章節順序＝錨點在範本裡的先後順序**，刪掉錨點＝不產生那一章，
// 所以業主要加減章節或調順序時動的是文件、不是程式碼。
// required:true 的六個缺任一就整個拒絕產生（沒有摘要、基本資料、方法、品質、
// 總體結果、附錄C 的東西不是一份可歸檔的品質紀錄）。
var SECTIONS_ = [
  { id: 'TOC', token: '{{SEC_目錄}}', title: '目錄', required: false },
  { id: 'SUMMARY', token: '{{SEC_摘要}}', title: '一、報告摘要', required: true },
  { id: 'BASIC', token: '{{SEC_基本資料}}', title: '二、演習基本資料', required: true },
  { id: 'METHOD', token: '{{SEC_評核方法}}', title: '三、評核方法與評分尺度', required: true },
  { id: 'QUALITY', token: '{{SEC_資料品質}}', title: '四、資料品質與完整性', required: true },
  { id: 'OVERALL', token: '{{SEC_總體結果}}', title: '五、總體結果', required: true },
  { id: 'S4', token: '{{SEC_4S}}', title: '六、4S 整備分析', required: false },
  { id: 'POTENTIAL', token: '{{SEC_潛能}}', title: '七、三項潛能分項分析', required: false },
  { id: 'COVERAGE', token: '{{SEC_覆蓋率}}', title: '八、演習覆蓋率分析', required: false },
  // ⚠️ 錨點刻意維持 {{SEC_情境}} —— 2026-10-12 把顯示用語從「情境」改成「場景」時
  //    沒有一起改它，因為錨點要跟**業主範本文件裡實際打的字**逐字相符。改了這裡
  //    而沒改範本，scanAnchors_ 找不到它，第九章會整章消失、只在附錄D 留一行。
  //    真要改成 {{SEC_場景}}，必須同一天連範本一起改，兩邊不能分開。
  { id: 'SCENE', token: '{{SEC_情境}}', title: '九、場景逐項分析', required: false },
  { id: 'LEARNING', token: '{{SEC_學習}}', title: '十、學習潛能觀察', required: false },
  { id: 'RANKING', token: '{{SEC_排序}}', title: '十一、強弱項排序', required: false },
  { id: 'COMMENTS', token: '{{SEC_觀察紀錄}}', title: '十二、觀察紀錄彙整', required: false },
  { id: 'EVALUATOR', token: '{{SEC_評核官差異}}', title: '十三、評核官評分差異分析', required: false },
  { id: 'PREV', token: '{{SEC_前次比較}}', title: '十四、與前次演習比較', required: false },
  { id: 'ACTION', token: '{{SEC_改善行動}}', title: '十五、改善行動計畫', required: false },
  { id: 'CONCLUSION', token: '{{SEC_結論}}', title: '十六、結論與建議', required: false },
  { id: 'APPA', token: '{{SEC_附錄A}}', title: '附錄A　評核題目與指標對應表', required: false },
  { id: 'APPB', token: '{{SEC_附錄B}}', title: '附錄B　原始評分資料（逐題 × 逐評核官）', required: false },
  { id: 'APPC', token: '{{SEC_附錄C}}', title: '附錄C　資料來源與產出資訊', required: true },
  { id: 'APPD', token: '{{SEC_附錄D}}', title: '附錄D　本報告未涵蓋的項目', required: false }
];

// 附錄C／附錄D 的內容是「這一輪執行發生了什麼」的總結（降級了哪些圖、跳過了
// 哪些章節），所以**寫入順序**一律排到最後，即使它們的錨點在文件中間。
// 插入位置仍然是各自的錨點，所以文件上的章節順序完全由範本決定。
var LAST_WRITTEN_SECTIONS_ = ['APPC', 'APPD'];

// ===================================================================
// 填入式範本（第二種模式，2026-10-13）
// ===================================================================
//
// 為什麼需要第二種模式：{{SEC_*}} 錨點式假設「範本是一具骨架，程式把一整章
// 內容插進去」。業主交來的是一份**已經寫好、已經畫好 12 張表格**的報告手稿：
// 圖要放進 1×1 表格的儲存格裡、資料要一列一列長在他排好的表格中（框線已經
// 設成隱藏）。錨點式在這裡**物理上做不到** —— 錨點必須是本文最上層段落
// （見 topLevelParagraphOf_ 的註解）；放進儲存格時 body.getChildIndex 會算出
// 錯誤索引、把一整章插到不相干的位置，所以 scanAnchors_ 從第一天就直接拒絕它。
//
// 填入式不是「放寬那條規則」，而是換一種寫法 —— 兩種 token 都不走 body 插入：
//   • {{圖_*}}：清空標記所在的那一格，把圖**放進那一格**，寬度依該欄欄寬縮放。
//   • {{列_*}}：把標記所在的那一列當樣板**複製**，一筆資料一列，格式自動繼承。
// 兩者都只動儲存格，不需要 body 的索引，所以在表格裡完全成立。
//
// ⚠️ 兩種模式互斥，由 scanTemplate_ 一次判定並寫進執行狀態（st.mode）。
// 混用會產出半成品，所以是硬拒絕、不是「盡力而為」—— 理由與
// assertRequiredAnchors_ 完全相同：一份缺了東西的 PDF 看起來跟完整的一模一樣。

// 填入式的「最後才寫」清單，與 LAST_WRITTEN_SECTIONS_ 同一個理由：
// 產生紀錄必須在所有可能降級的東西都寫完之後才寫，否則它記不到自己後面發生的事。
var FILL_TAIL_IDS_ = ['FILLREC'];
var FILL_RECORD_ID_ = 'FILLREC';
var FILL_RECORD_TITLE_ = '附錄　報告產生紀錄（系統自動附加）';

// 七個圖片標記。title 同時是降級訊息與進度標籤用的名稱。
// 新增一個就是在這張表加一列，再到 fillImageSpec_ 加一個 case —— 沒有第三個地方。
var FILL_IMAGE_TOKENS_ = [
  { id: 'IMG_ABILITY',  token: '{{圖_綜合能力}}',  kind: 'image', title: '綜合能力（潛能 × 4S 交叉平均）' },
  { id: 'IMG_S4',       token: '{{圖_4S整備}}',    kind: 'image', title: '4S 整備平均' },
  { id: 'IMG_COVERAGE', token: '{{圖_覆蓋率}}',    kind: 'image', title: '演習覆蓋率各指標平均' },
  { id: 'IMG_RADAR_1',  token: '{{圖_雷達_反應}}', kind: 'image', title: '反應潛能各指標平均', potential: '反應' },
  { id: 'IMG_RADAR_2',  token: '{{圖_雷達_監測}}', kind: 'image', title: '監測潛能各指標平均', potential: '監測' },
  { id: 'IMG_RADAR_3',  token: '{{圖_雷達_預期}}', kind: 'image', title: '預期潛能各指標平均', potential: '預期' },
  { id: 'IMG_SCENE_S4', token: '{{圖_場景4S}}',    kind: 'image', title: '各場景在各 4S 類別的平均' }
];

// 七種資料列標記。
// ⚠️ columns 不是註解，是**契約本身**：它同時是欄數檢查、拒絕訊息的文字來源、
// 以及由左至右的寫入順序。想多填一欄就只改這一張表 —— 一個地方可讀、一個地方
// 可改，這也正是「欄位順序」這條約定查得動的原因
// （對照 ConfigWithSubmit.gs 的 sessionSortable_ 是唯一組裝回應物件的地方）。
// 範本的欄數可以**多**於 columns.length，多出來的欄系統一個字都不碰（留給業主
// 自己填備註）；**少**就是硬拒絕，絕不「有幾欄填幾欄」。
var FILL_ROW_TOKENS_ = [
  { id: 'ROW_TOP3',  token: '{{列_優勢前三}}',   kind: 'row', title: '優勢前三（綜合能力）',   columns: ['序號', '綜合能力', '分數', '說明'] },
  { id: 'ROW_BOT3',  token: '{{列_待改善前三}}', kind: 'row', title: '待改善前三（綜合能力）', columns: ['序號', '綜合能力', '分數', '說明'] },
  { id: 'ROW_COV',   token: '{{列_覆蓋率指標}}', kind: 'row', title: '覆蓋率指標明細',         columns: ['指標', '具體評核題目', '分數'] },
  { id: 'ROW_P1',    token: '{{列_反應指標}}',   kind: 'row', title: '反應潛能指標明細',       columns: ['場景編號', '指標', '具體評核題目', '分數'], potential: '反應' },
  { id: 'ROW_P2',    token: '{{列_監測指標}}',   kind: 'row', title: '監測潛能指標明細',       columns: ['場景編號', '指標', '具體評核題目', '分數'], potential: '監測' },
  { id: 'ROW_P3',    token: '{{列_預期指標}}',   kind: 'row', title: '預期潛能指標明細',       columns: ['場景編號', '指標', '具體評核題目', '分數'], potential: '預期' },
  { id: 'ROW_SCENE', token: '{{列_場景對照}}',   kind: 'row', title: '場景編號對照表',         columns: ['色塊', '場景編號', '測試場景'] }
];

var DRAFT_BANNER_ ='草稿 — 產生未完成（本份報告尚未完成，請勿分發）';
var WIP_SUFFIX_ = '（產生中）';
var PARTIAL_SUFFIX_ = '（部分完成）';

// A4 直式、上下左右 2.54cm 時的本文寬度約 451pt。圖片一律縮到這個寬度以內，
// 否則 Google 文件會自己把圖推到超出版面。
var IMAGE_WIDTH_PT_ = 440;
// 單一表格的列數上限。Docs 的表格每一列都是一次 API 動作，上千列會直接吃掉
// 整個時間預算；超過就截斷並在章節尾端說明（截斷必須說出來，不能無聲）。
var TABLE_ROW_CAP_ = 300;

var S4_PREFERRED_ORDER_ = ['Space (空間)', 'Staff (人員)', 'Stuff (物資)', 'System (系統)'];
var POTENTIALS_ = ['反應', '監測', '預期'];

// ===== 租戶註冊表（只有獨立部署 (B) 的網頁入口會讀） =====
// 欄名與別名逐字照抄 ConfigWithSubmit.gs，因為「哪一列有效」這件事兩邊必須
// 同意：這支腳本判有效、後端判無效的話，報告會先複製好文件才在 fetchAnalysis_
// 被 ROW_INVALID 擋下來，留下一份孤兒 Doc。
var REG_SHEET_NAME_ = '租戶註冊表';
var REG_HID_ALIASES_ = ['醫院代號', '機構代號'];
var REG_EXID_ALIASES_ = ['演習代號', '場次代號'];
var REG_NAME_ALIASES_ = ['顯示名稱', '名稱'];
var REG_CONFIGID_ALIASES_ = ['設定試算表ID', '設定檔ID'];
var REG_RECORDID_ALIASES_ = ['紀錄試算表ID', '紀錄檔ID'];
var REG_RECORDSHEET_ALIASES_ = ['紀錄分頁名稱', '紀錄分頁'];
var REG_KEY_ALIASES_ = ['分析金鑰', '金鑰'];
var REG_ENABLED_ALIASES_ = ['啟用', '啟用中'];
var REG_DEFAULT_RECORD_SHEET_ = '評核紀錄';
// 與後端同樣 120 秒。沒有快取的話，一個沒有金鑰的呼叫每次都會開一次註冊表 ——
// 這個端點的 DoS 上限就從「一次快取讀取」變成「一次 Drive 開檔」。
var REG_CACHE_KEY_ = 'rptreg:v1';
var REG_CACHE_TTL_ = 120;
// 組合鍵分隔字元（U+241F），理由同 ConfigWithSubmit.gs 的 KEY_SEP_。
var REG_KEY_SEP_ = '␟';

// ===================================================================
// 選單
// ===================================================================

// ⚠️ onOpen 是簡易觸發器，授權範圍受限：在這裡呼叫 PropertiesService／
// UrlFetchApp／DriveApp 可能直接丟錯，而 onOpen 丟錯會讓業主**每次打開試算表**
// 都看到一個錯誤框。所以這裡只做一件事：用靜態標籤建選單，整段包 try/catch。
// 所有真正的工作都在選單項目觸發的函式裡（那些是完整授權的執行）。
// 第一次點選單項目時 Google 會跳授權畫面，這要寫進業主文件。
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu(MENU_TITLE_)
      .addItem('產生評核報告…', 'showReportDialog')
      .addItem('檢查設定（不產生報告）', 'showReportCheckDialog')
      .addItem('開啟上一份報告', 'showLastReport')
      .addSeparator()
      .addItem('設定說明（指令碼屬性）', 'showPropertyHelp')
      .addItem('重設產生狀態', 'resetRunState')
      .addToUi();
  } catch (err) {
    // 刻意吞掉：選單建不起來最多是少一個選單，但讓例外逸出會變成
    // 「這張試算表每次開啟都跳錯」，而業主完全不知道那跟報告功能有關。
  }
}

// 模態（showModalDialog）而非無模式（showSidebar/showModelessDialog）是刻意的：
// 產生期間必須擋住業主同時編輯設定試算表。演習進行中改設定表會毀掉在飛行中的
// 送出（plan §1.1 的 D5），而報告讀的 項目與問題／對應指標 被改到一半，
// 報告的標籤就會自己前後矛盾（owner-guide §11 的鐵則是同一個風險）。
function showReportDialog() {
  openDialog_('generate', '產生評核報告');
}

function showReportCheckDialog() {
  openDialog_('check', '檢查設定');
}

function openDialog_(mode, title) {
  try {
    var t = HtmlService.createTemplateFromFile('ReportDialog');
    t.mode = mode;
    var html = t.evaluate().setWidth(560).setHeight(680);
    SpreadsheetApp.getUi().showModalDialog(html, title);
  } catch (err) {
    alertError_('無法開啟對話框：' + msg_(err) + '\n\n' + dialogFailureHint_(msg_(err)));
  }
}

// 兩種完全不同的失敗會被同一個 catch 接住，而**給錯提示比不給提示更糟**。
// 2026-10-08 第一次有人真的執行這支程式時就踩到了：真正的原因是容器綁定腳本
// 還沒被授權 script.container.ui，提示卻叫人去確認 ReportDialog 檔案在不在，
// 於是測試的人跑去檢查了一個本來就沒問題的東西，然後卡住。
function dialogFailureHint_(m) {
  var authSigns = ['script.container.ui', '權限', '授權', 'permission', 'Authorization', 'authoriz'];
  for (var i = 0; i < authSigns.length; i++) {
    if (m.indexOf(authSigns[i]) !== -1) {
      return '這是「授權」問題，不是檔案缺失 —— ReportDialog 檔案在不在都一樣會出現這個錯誤。\n\n'
        + '這個專案被授權時沒有拿到 script.container.ui。注意：**跑 onOpen 沒有用**'
        + '（2026-10-09 實測過）—— 加選單在受限模式下就能做，根本不需要這個範圍，'
        + '所以執行它不會觸發授權請求。必須執行一個真的會開對話框的函式。\n\n'
        + '做法一：在 Apps Script 編輯器上方的函式下拉選單選「showReportCheckDialog」，'
        + '按「執行」。這次應該會跳出 Google 授權視窗，按「允許」'
        + '（權限清單看起來會有點多，那是正常的）。\n\n'
        + '做法二（做法一還是沒跳授權視窗時）：專案設定 → 勾選「在編輯器中顯示 '
        + 'appsscript.json 資訊清單檔案」，把 oauthScopes 明確寫成以下五個，存檔後'
        + '再執行一次 showReportCheckDialog：\n'
        + '  https://www.googleapis.com/auth/spreadsheets\n'
        + '  https://www.googleapis.com/auth/documents\n'
        + '  https://www.googleapis.com/auth/drive\n'
        + '  https://www.googleapis.com/auth/script.container.ui\n'
        + '  https://www.googleapis.com/auth/script.external_request\n'
        + '明確宣告會強制重新授權，自動推斷則可能沿用舊的授權而永遠補不上這個範圍。';
    }
  }
  return '請確認這個 Apps Script 專案裡有一個名為「ReportDialog」的 HTML 檔案'
    + '（檔案 → 新增 → HTML，命名 ReportDialog，再把 apps-script/ReportDialog.html 的內容貼進去）。';
}

// 只讀、不寫。上一輪被瀏覽器關掉時，這是找回那份半成品文件的入口。
function showLastReport() {
  var st = readRunState_();
  var html = '';
  if (!st || !st.runId) {
    html = '<p style="font:14px/1.7 \'Noto Sans TC\',sans-serif">尚未產生過報告。</p>';
  } else {
    var rows = [
      ['報告編號', st.runId],
      ['狀態', statusText_(st.status)],
      ['開始產生時間', st.startedAtText || ''],
      ['匿名模式', st.identified ? '⚠ 含可識別評核官代號' : '已匿名（評核官 1…N）'],
      ['已完成章節', String(st.doneCount || 0) + ' / ' + String(st.totalCount || 0)]
    ];
    var body = '';
    for (var i = 0; i < rows.length; i++) {
      body += '<tr><th style="text-align:left;padding:4px 10px 4px 0;white-space:nowrap;color:#555">' +
        esc_(rows[i][0]) + '</th><td style="padding:4px 0">' + esc_(rows[i][1]) + '</td></tr>';
    }
    var links = '';
    if (st.docUrl) links += '<p><a href="' + esc_(st.docUrl) + '" target="_blank">開啟 Google 文件</a></p>';
    if (st.pdfUrl) links += '<p><a href="' + esc_(st.pdfUrl) + '" target="_blank">開啟 PDF</a></p>';
    if (!links) links = '<p style="color:#b00020">這一輪還沒有產生出任何檔案。</p>';
    html = '<div style="font:14px/1.7 \'Noto Sans TC\',sans-serif"><table>' + body + '</table>' + links +
      '<p style="color:#555;font-size:12.5px">「重設產生狀態」只會清掉這筆紀錄，' +
      '不會刪除上面任何一個檔案，也不會刪除 報告快照 的任何一列。</p></div>';
  }
  showInfoDialog_(html, '上一份報告');
}

function showPropertyHelp() {
  var p = props_();
  var defs = [
    [PROP_ANALYSIS_KEY_, '必填（選單模式）', '本場演習的「分析金鑰」。單一演習模式下＝後端 ConfigWithSubmit.gs 的 ANALYSIS_KEY 常數值；啟用租戶註冊表後＝該列的 分析金鑰。（啟用 ' + PROP_REGISTRY_ID_ + ' 之後，從分析平台產生報告時不會讀這個屬性——憑證是網址上帶來的那一把金鑰。）', true],
    [PROP_API_URL_, '必填', '後端 Web App 的 /exec 網址（RECORD_URL 那一支，只有它有 action=analysis）。兩種模式都必填。', false],
    [PROP_TEMPLATE_ID_, '必填', '報告範本 Google 文件的檔案 ID（網址 /d/ 與 /edit 之間那一段）。兩種模式都必填。', false],
    [PROP_OUTPUT_FOLDER_, '選填／網頁模式實際上必填', '報告 Doc 與 PDF 的輸出資料夾 ID。未設時用「該場演習設定試算表」所在的資料夾。從分析平台產生時，檔案會落在這個部署帳號的雲端硬碟，點按鈕的人不一定看得到——請指定一個已經分享給報告讀者的資料夾。', false],
    [PROP_TENANT_, '選填（僅容器選單模式使用）', '醫院代號。有設就帶上 &t=，並要求後端回的 meta.tenant 完全相符。單一演習模式請留空。從分析平台產生報告時由網址參數決定，這個屬性不會被讀取。', false],
    [PROP_EXERCISE_, '選填（僅容器選單模式使用）', '演習代號。規則同上，對應 &ex=。從分析平台產生報告時由網址參數決定，這個屬性不會被讀取。', false],
    [PROP_REGISTRY_ID_, '網頁模式必填', '租戶註冊表試算表的 ID（與後端 ConfigWithSubmit.gs 的 REGISTRY_SPREADSHEET_ID 同一份）。只有獨立部署的報告 Web App 會讀它，用來把網址上的 ?t=&ex= 解析成「該場演習的設定試算表ID 與 分析金鑰」。容器選單模式完全不讀。', false],
    [PROP_CONFIG_SS_ID_, '網頁模式且未啟用註冊表時必填', '設定試算表的 ID。只有在 ' + PROP_REGISTRY_ID_ + ' 留空（註冊表關閉）時，網頁入口才用它決定要寫 報告快照 的檔案；此時金鑰比對的對象是 ' + PROP_ANALYSIS_KEY_ + '。', false],
    [PROP_BUDGET_, '選填', '單次步驟的時間預算毫秒數，預設 ' + DEFAULT_BUDGET_MS_ + '（低於 6 分鐘硬上限約兩分鐘的安全邊際）。', false],
    [PROP_RUN_STATE_, '程式維護', '執行紀錄（僅容器選單模式），業主不要手動設。卡住時用選單的「重設產生狀態」清除。網頁模式另外用 ' + PROP_RUN_PREFIX_ + '<報告編號> 與 ' + PROP_ACTIVE_PREFIX_ + '<醫院>/<演習>，會自己清。', false]
  ];
  var body = '';
  for (var i = 0; i < defs.length; i++) {
    var key = defs[i][0];
    var raw = p.getProperty(key);
    var set = raw !== null && String(raw).trim() !== '';
    // 已設定的敏感值只說「已設定」，絕不回顯 —— 這個對話框會被截圖。
    var shown = set ? (defs[i][3] ? '已設定（已遮蔽）' : esc_(String(raw).length > 70 ? String(raw).substring(0, 70) + '…' : String(raw))) : '<span style="color:#b00020">尚未設定</span>';
    body += '<tr><td style="padding:6px 10px 6px 0;font-family:monospace;white-space:nowrap">' + esc_(key) +
      '</td><td style="padding:6px 10px 6px 0;white-space:nowrap">' + esc_(defs[i][1]) +
      '</td><td style="padding:6px 0">' + shown + '<div style="color:#555;font-size:12px">' + esc_(defs[i][2]) + '</div></td></tr>';
  }
  var html = '<div style="font:13.5px/1.6 \'Noto Sans TC\',sans-serif">' +
    '<p><b>設定位置：</b>擴充功能 → Apps Script → ⚙ 專案設定 → 指令碼屬性 → 新增指令碼屬性，' +
    '把下面的鍵與值一組一組加進去，最後按「儲存指令碼屬性」。</p>' +
    '<table style="border-collapse:collapse">' + body + '</table>' +
    '<p style="color:#555">刻意不設 ADMIN_KEY：這支腳本從不呼叫 action=selftest 或 action=flush，' +
    '所以不需要、也不應該持有管理金鑰。</p>' +
    '<p style="color:#555">⚠️ 這份原始碼會貼在兩個專案（這個容器綁定專案，以及獨立部署的報告 Web App），' +
    '而<b>指令碼屬性是各專案各一份</b>，不會互通。改了一邊要記得改另一邊。' +
    '本專案目前的程式版本：<code>' + esc_(REPORT_BUILD_) + '</code>。</p></div>';
  showInfoDialog_(html, '指令碼屬性設定說明');
}

// 需二次確認。只清執行狀態與暫存分頁，不碰任何已產生的檔案或快照列。
function resetRunState() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.alert('重設產生狀態',
    '這個動作會：\n' +
    '　• 清掉「上一份報告」的執行紀錄（報告編號／狀態／連結）\n' +
    '　• 清空隱藏分頁「' + TEMP_SHEET_NAME_ + '」裡的繪圖暫存資料\n\n' +
    '這個動作不會：\n' +
    '　• 刪除任何已產生的 Google 文件或 PDF\n' +
    '　• 刪除「' + SNAPSHOT_SHEET_NAME_ + '」的任何一列\n\n' +
    '執行中的鎖不需要手動釋放：鎖只在那一次執行期間存在，' +
    '瀏覽器被關掉時那次執行早就結束了，鎖也跟著消失。\n\n要繼續嗎？',
    ui.ButtonSet.YES_NO);
  if (ans !== ui.Button.YES) return;
  var notes = [];
  try {
    props_().deleteProperty(PROP_RUN_STATE_);
    notes.push('✅ 已清除執行紀錄');
  } catch (err) {
    notes.push('❌ 清除執行紀錄失敗：' + msg_(err));
  }
  try {
    // 這一項是選單專屬的。獨立部署那一份貼進去也必須**解析得過**，所以不直接
    // 呼叫 SpreadsheetApp.getActive()（在獨立專案裡它回 null，`null.getSheetByName`
    // 的英文 TypeError 會讓人去查一個根本不存在的分頁問題）。
    // HTTP 這一側的對應動作是 action=reportAbandon：它清每場次的執行標記、把
    // 那一輪的快照列標成「中斷」，但刻意不去碰任何它沒有解析過的試算表。
    var ss = activeSpreadsheetOrNull_();
    if (!ss) {
      notes.push('ℹ️ 這個專案沒有容器試算表（它是獨立部署的報告產生器），沒有 ' +
        TEMP_SHEET_NAME_ + ' 可以清');
    } else {
      var sh = ss.getSheetByName(TEMP_SHEET_NAME_);
      if (sh) {
        resetTempSheet_(sh);
        notes.push('✅ 已清空 ' + TEMP_SHEET_NAME_);
      } else {
        notes.push('ℹ️ 沒有 ' + TEMP_SHEET_NAME_ + ' 分頁，不需要清');
      }
    }
  } catch (err2) {
    notes.push('❌ 清空 ' + TEMP_SHEET_NAME_ + ' 失敗：' + msg_(err2));
  }
  ui.alert('重設產生狀態', notes.join('\n'), ui.ButtonSet.OK);
}

function showInfoDialog_(html, title) {
  try {
    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(html).setWidth(560).setHeight(520), title);
  } catch (err) {
    alertError_(msg_(err));
  }
}

function alertError_(message) {
  try {
    SpreadsheetApp.getUi().alert(MENU_TITLE_, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    // UI 不可用（例如從編輯器直接執行）時沒有別的地方可以說話，只能放棄。
  }
}

function statusText_(s) {
  if (s === 'running') return '產生中';
  if (s === 'done') return '完成';
  if (s === 'partial') return '部分完成';
  if (s === 'failed') return '失敗';
  return String(s || '未知');
}

// ===================================================================
// 小工具
// ===================================================================

// 本次執行讀到的分析金鑰，只存在於記憶體裡，唯一用途是讓 scrub_ 能把它從錯誤
// 訊息裡擦掉。**不是**拿來傳遞設定用的（設定一律走 requireConfig_ 的回傳值）。
var SECRET_KEY_ = '';

// 本次執行用到的試算表／文件／資料夾 ID，同樣只存在於記憶體裡，用途也只有
// 一個：讓 scrub_ 把它們從錯誤訊息裡擦掉。
//
// ⚠️ 為什麼需要：openById／getFileById／getFolderById 失敗時，Apps Script 的
// 例外訊息常常會把**那個 ID 原樣**寫進去，而網頁入口會把 msg_() 的結果當成
// JSON 的 error 欄位回給瀏覽器 —— 那正好違反「任何回應都不得含試算表 ID」
// 這條紅線。（2026-10-13 用樁測試打到的真實洩漏，不是假想。）
//
// ⚠️ **只在網頁模式填**。容器選單模式的訊息只進業主自己的對話框，而業主本來
// 就看得到自己的指令碼屬性；在那裡遮蔽等於無謂地改掉既有行為，而那一條路是
// 已經產出過 6 份真實報告的那一條。
var SECRET_IDS_ = [];

function rememberSecretId_(id) {
  var s = String(id == null ? '' : id).replace(/^\s+|\s+$/g, '');
  if (s.length < 20) return;            // 太短的字串遮起來會把正常文字打穿。
  if (SECRET_IDS_.indexOf(s) !== -1) return;
  SECRET_IDS_.push(s);
}

// 把任何可能外洩的金鑰從字串裡擦掉。
// 為什麼需要：金鑰是以查詢字串帶進 UrlFetchApp.fetch 的，而 Apps Script 的
// 連線類例外（Invalid argument / DNS error / Address unavailable）會把**整個
// 請求網址**塞進例外訊息裡，包含 &key=。那條訊息會一路走到對話框的紅字、
// 走進 warnings[]、再被寫進指令碼屬性並由「開啟上一份報告」重新顯示。
// showPropertyHelp 已經刻意遮蔽同一個值（因為「這個對話框會被截圖」），
// fetch 的失敗路徑不能把它又放回去。
function scrub_(s) {
  var t = String(s == null ? '' : s);
  if (SECRET_KEY_ && SECRET_KEY_.length >= 8) {
    t = t.split(SECRET_KEY_).join('…金鑰已遮蔽…');
    // 網址裡是編碼過的樣子，與原字串可能不同（金鑰含特殊字元時）。
    try {
      var enc = encodeURIComponent(SECRET_KEY_);
      if (enc !== SECRET_KEY_) t = t.split(enc).join('…金鑰已遮蔽…');
    } catch (err) {}
  }
  // 保險絲：就算 SECRET_KEY_ 還沒設定（例如 requireConfig_ 自己丟錯），
  // 任何 ?key=／&key= 後面的內容一律擦掉。
  t = t.replace(/([?&](?:key|adminKey)=)[^&\s"'<>]*/gi, '$1…金鑰已遮蔽…');
  for (var i = 0; i < SECRET_IDS_.length; i++) {
    t = t.split(SECRET_IDS_[i]).join('…檔案ID已遮蔽…');
  }
  return t;
}

// 所有錯誤訊息都經過這裡，所以遮蔽只要做在這一個點。
function msg_(err) {
  if (err == null) return '未知錯誤';
  if (err.message) return scrub_(String(err.message));
  return scrub_(String(err));
}

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function props_() {
  return PropertiesService.getScriptProperties();
}

function prop_(key) {
  try {
    var v = props_().getProperty(key);
    return v === null ? '' : String(v).trim();
  } catch (err) {
    throw new Error('無法讀取指令碼屬性（' + key + '）：' + msg_(err) +
      '　請確認是以有權限的 Google 帳號開啟這份試算表，並已完成首次授權。');
  }
}

function tz_() {
  try {
    return Session.getScriptTimeZone() || 'Asia/Taipei';
  } catch (err) {
    return 'Asia/Taipei';
  }
}

// ⚠️ 在獨立（非容器綁定）專案裡，SpreadsheetApp.getActive() **回 null，不丟例外**。
// 所以 try/catch 不是守衛：少了這個明確的 null 檢查，呼叫端會拿到一個英文的
// 「Cannot call method getSheetByName of null」，而那句話指不到真正的原因。
// 所有「這個專案有沒有容器」的判斷一律走這裡，不要在別處再寫一次 getActive()。
function activeSpreadsheetOrNull_() {
  try {
    return SpreadsheetApp.getActive() || null;
  } catch (err) {
    return null;
  }
}

// 這一輪要寫 報告快照／_報告暫存 的那份試算表。
//   選單模式：ssId 是容器試算表自己的 ID（或空字串）→ 回 getActive()，
//             與改這一版之前逐字同一個物件，不多繞一次 openById。
//   網頁模式：ssId 來自**註冊表那一列的 設定試算表ID**。
// ⚠️ 代號（醫院代號／演習代號）永遠不會被拿來 openById —— 試算表 ID 只能從
// 註冊表儲存格讀出來，而且要先過 isSpreadsheetIdR_。這條界線跟
// ConfigWithSubmit.gs 的是同一條：沒有它，這支部署就變成「任意 Drive 檔案
// 讀取代理」。
function targetSpreadsheet_(ssId) {
  var active = activeSpreadsheetOrNull_();
  if (active) {
    if (!ssId) return active;
    try {
      if (active.getId() === ssId) return active;
    } catch (errId) {}
  }
  if (!ssId) {
    throw new Error('這個專案沒有容器試算表（它是獨立部署的報告產生器），' +
      '而這一次呼叫也沒有解析出任何一場演習的設定試算表。\n' +
      '從分析平台產生報告時，網址必須同時帶 ?t=（醫院代號）與 &ex=（演習代號）；' +
      '若尚未啟用租戶註冊表，請改設指令碼屬性 ' + PROP_CONFIG_SS_ID_ + '。');
  }
  try {
    return SpreadsheetApp.openById(ssId);
  } catch (err) {
    // 刻意不把 ID 本身印出來：這個訊息會一路走到 HTTP 回應與對話框紅字，
    // 而 openById 的例外訊息**常常自己就含著那個 ID**。這裡在 SECRET_IDS_
    // 之外再擦一次，不依賴「誰記得先註冊」的順序。
    throw new Error('無法開啟這場演習的設定試算表（租戶註冊表「' +
      REG_CONFIGID_ALIASES_[0] + '」那一格指到的檔案）：' +
      String(msg_(err)).split(ssId).join('…檔案ID已遮蔽…') +
      '\n請確認執行報告的 Google 帳號對那份試算表有編輯權限，且檔案沒有被刪除或移到垃圾桶。');
  }
}

// 數值格式化。null 一律印「—」而不是 0 —— 「沒有資料」和「平均 0 分」在一份
// 品質紀錄上是完全不同的兩件事，印成 0 會被讀成「全部不及格」。
function num_(v, digits) {
  if (v === null || v === undefined || v === '') return '—';
  var n = Number(v);
  if (isNaN(n)) return String(v);
  return n.toFixed(digits === undefined ? 2 : digits);
}

function pct_(v) {
  if (v === null || v === undefined || isNaN(Number(v))) return '—';
  return (Number(v) * 100).toFixed(1) + '%';
}

function txt_(v) {
  var s = String(v == null ? '' : v).replace(/^\s+|\s+$/g, '');
  return s === '' ? '—' : s;
}

function escapeRegExp_(s) {
  return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 與 Analysis.html 的 shortScene() 同一條規則。兩套規則會讓同一場演習的螢幕
// 畫面與紙本報告對不起來（「場景 D2」在兩份文件上指到不同的東西）。
function shortScene_(name, prefix) {
  var p = prefix || 'SCENE';
  var raw = String(name == null ? '' : name);
  var s = raw.replace(new RegExp('^' + escapeRegExp_(p) + '\\s*', 'i'), '').replace(/^\s+|\s+$/g, '');
  return s === '' ? raw : s;
}

// 與 Analysis.html 的 cleanIndicator() 同一條規則：指標欄常寫成
// 「某某某（實際指標名）」，括號裡才是要印的那一段。
function cleanIndicator_(s) {
  var raw = String(s == null ? '' : s);
  var m = raw.match(/[(（]([^)）]*)[)）]/);
  return m ? m[1] : raw;
}

// 自然排序（A1 < A2 < B < … < D10），與 Analysis.html 的
// localeCompare(..., {numeric:true}) 效果一致。ES5 的 localeCompare 不吃
// options 參數，所以自己切成「文字段／數字段」比較。
function naturalCompare_(a, b) {
  var ra = String(a == null ? '' : a).match(/(\d+|\D+)/g) || [];
  var rb = String(b == null ? '' : b).match(/(\d+|\D+)/g) || [];
  var len = Math.min(ra.length, rb.length);
  for (var i = 0; i < len; i++) {
    var x = ra[i], y = rb[i];
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      var d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return ra.length - rb.length;
}

// 匿名映射：把人員代號換成「評核官 N」，N 是該代號在排序後 meta.evaluatorCodes
// 裡的索引 + 1。**刻意與 Analysis.html 的 anonCode() 完全一致。**
// code → 序號 的對照表本身絕不印在報告的任何地方（印了就等於沒有匿名）。
function buildAnonMap_(codes) {
  var sorted = (codes || []).slice().sort();
  var map = {};
  for (var i = 0; i < sorted.length; i++) map[sorted[i]] = '評核官 ' + (i + 1);
  return map;
}

function evaluatorLabel_(ctx, code) {
  if (ctx.identified) return String(code == null ? '' : code);
  return ctx.anonMap[code] || '評核官 ?';
}

function allRows_(payload) {
  return (payload.analysisRows || [])
    .concat(payload.coverageRows || [])
    .concat(payload.learningRows || []);
}

function chartRows_(payload) {
  return (payload.analysisRows || []).concat(payload.coverageRows || []);
}

// ===================================================================
// 設定與執行狀態
// ===================================================================

// 三個必填屬性缺任一就中止，而且訊息要逐字指名「缺哪一個鍵、它是什麼、去哪裡設」
// —— 「設定錯誤」這種訊息對業主等於沒有訊息。
//
// target === undefined/null  → 容器選單模式。與改這一版之前逐字相同：金鑰與
//   租戶代號全部來自指令碼屬性。
// target === {hid, exid, ssId, analysisKey, registryOff}  → 網頁模式。金鑰是
//   呼叫端在網址上帶來、而且**已經比對過註冊表那一列**的那一把；
//   REPORT_TENANT／REPORT_EXERCISE 在這個模式下連讀都不讀（讀了就等於把被這次
//   改動拆掉的「釘死」問題從後門放回來）。
function requireConfig_(target) {
  var webMode = !!target;
  var cfg = {
    analysisKey: webMode ? String(target.analysisKey || '') : prop_(PROP_ANALYSIS_KEY_),
    apiUrl: prop_(PROP_API_URL_),
    templateId: prop_(PROP_TEMPLATE_ID_),
    outputFolderId: prop_(PROP_OUTPUT_FOLDER_),
    // 註冊表關閉的網頁模式：代號對路由零影響，所以也**不送給後端、不做身分
    // 比對**，行為與今天的單一演習選單模式完全一樣。
    tenant: webMode ? (target.registryOff ? '' : String(target.hid || '')) : prop_(PROP_TENANT_),
    exercise: webMode ? (target.registryOff ? '' : String(target.exid || '')) : prop_(PROP_EXERCISE_),
    ssId: webMode ? String(target.ssId || '') : '',
    webMode: webMode,
    budgetMs: DEFAULT_BUDGET_MS_
  };
  var where = '（設定位置：擴充功能 → Apps Script → ⚙ 專案設定 → 指令碼屬性 → 新增指令碼屬性）';
  var missing = [];
  if (!cfg.analysisKey && !webMode) missing.push(PROP_ANALYSIS_KEY_ + '：本場演習的分析金鑰，與分析儀表板網址 ?key= 的那一串相同');
  if (!cfg.apiUrl) missing.push(PROP_API_URL_ + '：後端 Web App 的 /exec 網址（RECORD_URL 那一支，只有它有 action=analysis）');
  if (!cfg.templateId) missing.push(PROP_TEMPLATE_ID_ + '：報告範本 Google 文件的檔案 ID（網址 /d/ 與 /edit 之間那一段）');
  if (missing.length) {
    throw new Error('尚未設定指令碼屬性：\n　• ' + missing.join('\n　• ') + '\n' + where);
  }
  // 貼成 /dev 或貼成編輯器網址是這裡最常見的兩個錯誤，而兩者都不會回 JSON，
  // 等到 JSON.parse 丟錯時完全看不出原因，所以提前擋掉。
  if (cfg.apiUrl.indexOf('https://script.google.com/') !== 0 ||
      cfg.apiUrl.substring(cfg.apiUrl.length - 5) !== '/exec') {
    throw new Error(PROP_API_URL_ + ' 看起來不是已部署的 Web App 網址。\n' +
      '它必須以 https://script.google.com/ 開頭、以 /exec 結尾。\n' +
      '常見錯誤：貼成結尾 /dev 的測試網址，或貼成 Apps Script 編輯器的網址。\n' + where);
  }
  var budgetRaw = prop_(PROP_BUDGET_);
  if (budgetRaw) {
    var b = Number(budgetRaw);
    if (!isNaN(b) && b >= 30000 && b <= 330000) cfg.budgetMs = b;
  }
  // 讓 scrub_ 知道要遮蔽哪一串。設在這裡而不是取資料時，是因為 requireConfig_
  // 之後的每一條路徑（含完全無關的例外）都可能把網址帶出來。
  SECRET_KEY_ = cfg.analysisKey;
  // 網頁模式才遮 ID：這些訊息會變成 HTTP 回應的 error 欄位，而 DriveApp／
  // SpreadsheetApp 的例外常常把 ID 原樣寫進訊息裡。選單模式刻意不動。
  if (webMode) {
    rememberSecretId_(cfg.templateId);
    rememberSecretId_(cfg.outputFolderId);
    rememberSecretId_(cfg.ssId);
  }
  return cfg;
}

// st.propKey 決定這一輪的狀態寫到哪一個屬性：
//   選單模式不設它 → 一律 REPORT_RUN_STATE（與今天逐字相同）。
//   網頁模式設成 REPORT_RUN_<報告編號> → 每一輪一格，兩家醫院同時跑不會互相覆寫。
function runStateKeyOf_(st) {
  return (st && st.propKey) ? String(st.propKey) : PROP_RUN_STATE_;
}

function readRunStateAt_(key) {
  try {
    var raw = props_().getProperty(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    // 壞掉的 JSON 當成「沒有紀錄」，不要讓它把整個功能卡死。
    return null;
  }
}

function readRunState_() {
  return readRunStateAt_(PROP_RUN_STATE_);
}

// 指令碼屬性單值的上限約 9KB，而那是**位元組**，不是字元。
// 這裡的訊息幾乎全是中文，JSON.stringify 不會把 CJK 轉成 \u 逸出序列，所以
// 一個字就是 3 個位元組 —— 用字元數估算會低估三倍，是這個檔案最容易踩到的
// 「看起來有防護、其實沒有」的陷阱。一律用實際位元組長度判斷。
var RUN_STATE_MAX_BYTES_ = 8000;

function byteLen_(s) {
  try {
    return Utilities.newBlob(String(s == null ? '' : s)).getBytes().length;
  } catch (err) {
    return String(s == null ? '' : s).length * 3; // 取不到就保守高估。
  }
}

// 把執行狀態序列化成一定塞得進指令碼屬性的 JSON。
// 捨棄順序刻意由「最可犧牲」到「最不可犧牲」：warnings（附錄C 另有一份）→
// skipped（附錄D 另有一份）→ cap.detail → plannedIds。docId／queue／snap 座標
// 永遠保留，因為沒有它們就找不回那份文件、也接不下去。
function serializeRunState_(st) {
  var copy = {};
  for (var k in st) {
    if (Object.prototype.hasOwnProperty.call(st, k)) copy[k] = st[k];
  }
  copy.warnings = (st.warnings || []).slice();
  copy.skipped = (st.skipped || []).slice();
  var json = JSON.stringify(copy);
  if (byteLen_(json) <= RUN_STATE_MAX_BYTES_) return json;

  var kept = copy.warnings.slice();
  var droppedW = 0;
  while (kept.length) {
    kept.shift();
    droppedW++;
    copy.warnings = kept.concat(['（另有 ' + droppedW + ' 則較早的警告因狀態大小限制未保存，完整清單見報告附錄C）']);
    json = JSON.stringify(copy);
    if (byteLen_(json) <= RUN_STATE_MAX_BYTES_) return json;
  }

  copy.skipped = [];
  json = JSON.stringify(copy);
  if (byteLen_(json) <= RUN_STATE_MAX_BYTES_) return json;

  if (copy.cap) copy.cap = { column: !!copy.cap.column, radar: !!copy.cap.radar, detail: [] };
  json = JSON.stringify(copy);
  if (byteLen_(json) <= RUN_STATE_MAX_BYTES_) return json;

  copy.warnings = [];
  copy.plannedIds = [];
  copy.rwgNote = '';
  return JSON.stringify(copy);
}

// 絕不丟例外。
// 為什麼：這個函式在 reportContinue 的**最後一行**被呼叫，也就是 PDF 已經
// 建好、文件已經寫完之後。讓它丟錯會被外層 catch 接住，把一輪其實已經成功的
// 執行標成 failed、把快照改成「中斷」，而業主手上明明有一份完整的 PDF。
// 寫不進去最壞的後果只是「開啟上一份報告」少一筆紀錄，遠比假失敗輕。
function writeRunState_(st) {
  try {
    props_().setProperty(runStateKeyOf_(st), serializeRunState_(st));
    return true;
  } catch (err) {
    // 最後手段：只留「找得回那份文件」與「下一個步驟還接得下去」所需的欄位。
    // queue／unwritten／snap 座標／fingerprint 都很小但缺一不可 —— 少了 queue，
    // 下一次 reportContinue 會以為已經寫完而直接收尾，產出一份沒有內容的報告。
    try {
      props_().setProperty(runStateKeyOf_(st), JSON.stringify({
        // propKey／ssId／runToken／hid／exid 缺一不可：少了 propKey 下一次會
        // 寫錯格子；少了 ssId 網頁模式接不下去（它沒有容器試算表可以退回）；
        // 少了 runToken 原本那個分頁也續不下去。
        propKey: st.propKey || '',
        runToken: st.runToken || '',
        // ⚠️ mode 缺一不可：少了它，續跑時 st.mode 會是 undefined → 判成
        // 錨點式，於是程式開始往業主的手稿裡插 21 章內容。它只有幾個位元組，
        // 永遠不值得為了省空間而丟掉。
        mode: st.mode || 'anchor',
        fillInflight: st.fillInflight || '',
        webMode: st.webMode === true,
        hid: st.hid || '',
        exid: st.exid || '',
        ssId: st.ssId || '',
        busyUntil: st.busyUntil || 0,
        folderName: st.folderName || '',
        runId: st.runId || '',
        status: st.status || '',
        startedAt: st.startedAt || 0,
        startedAtText: st.startedAtText || '',
        generatedAtText: st.generatedAtText || '',
        fingerprint: st.fingerprint || '',
        identified: !!st.identified,
        includeComments: st.includeComments !== false,
        includeAppendixB: st.includeAppendixB === true,
        docId: st.docId || '',
        docUrl: st.docUrl || '',
        pdfId: st.pdfId || '',
        pdfUrl: st.pdfUrl || '',
        baseName: st.baseName || '',
        queue: (st.queue || []).slice(),
        unwritten: (st.unwritten || []).slice(),
        aborting: st.aborting === true,
        plannedIds: (st.plannedIds || []).slice(),
        doneCount: st.doneCount || 0,
        totalCount: st.totalCount || 0,
        chunkCount: st.chunkCount || 0,
        snapStartRow: st.snapStartRow || 0,
        snapCount: st.snapCount || 0,
        snapStatusCol: st.snapStatusCol || 0,
        warnings: ['（執行狀態無法完整寫入指令碼屬性，僅保留最小紀錄；本次的警告清單未能保存）']
      }));
    } catch (err2) {}
    return false;
  }
}

// 列出文件裡所有還沒被替換掉的 {{…}}。回傳 [{ text, count, where }]。
//
// 三件事是刻意的：
// 1. **三個容器都掃**（內文／頁首／頁尾），因為 applyCoverTokens_ 也是三個都替換。
//    只掃內文的話，頁首裡打錯字的 token 永遠不會被抓到，而範本的機構名稱常常就
//    放在頁首。
// 2. **回報「是哪幾個」而不是「有沒有」**：token 打錯字時 replaceText 完全靜默，
//    只說「有殘留」等於要操作者自己 Ctrl+F 去翻 35 頁。
// 3. **數出現次數並標出容器**。2026-10-09 的測試裡，同一個 {{機構名稱 }} 被列了
//    兩次而操作者在範本裡只搜到一個，當場無法判斷是掃描重複計算、還是真的有
//    第二個藏在別處。帶上次數與容器就能自己回答這個問題。
//
// [^{}] 讓比對不會跨過下一個 token；guard 擋住 findText 沒有前進時的無窮迴圈。
function leftoverTokens_(doc) {
  var pattern = '\\{\\{[^{}]*\\}\\}';
  var containers = [];
  try { containers.push({ el: doc.getBody(), name: '內文' }); } catch (e1) {}
  try { containers.push({ el: doc.getHeader(), name: '頁首' }); } catch (e2) {}
  try { containers.push({ el: doc.getFooter(), name: '頁尾' }); } catch (e3) {}

  var index = {}, order = [];
  for (var c = 0; c < containers.length; c++) {
    var box = containers[c];
    if (!box.el) continue;
    var guard = 0, r = null;
    try { r = box.el.findText(pattern); } catch (err) { continue; }
    while (r && guard++ < 300) {
      try {
        var t = r.getElement().asText();
        var s = r.getStartOffset(), e = r.getEndOffsetInclusive();
        if (s >= 0 && e >= s) {
          var txt = t.getText().substring(s, e + 1);
          if (txt) {
            if (!index[txt]) { index[txt] = { text: txt, count: 0, where: {} }; order.push(txt); }
            index[txt].count++;
            index[txt].where[box.name] = true;
          }
        }
      } catch (err2) {}
      try { r = box.el.findText(pattern, r); } catch (err3) { break; }
    }
  }

  var out = [];
  for (var i = 0; i < order.length; i++) {
    var rec = index[order[i]];
    var places = [];
    for (var w in rec.where) { if (rec.where.hasOwnProperty(w)) places.push(w); }
    out.push({ text: rec.text, count: rec.count, where: places.join('／') });
  }
  return out;
}

// 把一筆殘留描述成人看得懂的一行：{{機構名稱 }}（內文 ×2）
// 這裡**刻意保留**完整的 {{…}}：殘留警告的重點就是那個打錯的字元（通常是多一個
// 空格），去掉大括號就看不出來了。安全的理由是它只在收尾第 4b 步寫入，晚於第 4 步
// 的掃描，而且每次產生都是全新的文件複本 —— 不會自己觸發自己。
// 搬動這兩步的順序之前，先回頭看 plainToken_ 的註解。
function describeLeftover_(rec) {
  return rec.text + '（' + rec.where + (rec.count > 1 ? ' ×' + rec.count : '') + '）';
}

// 把 {{機構名稱}} 變成 機構名稱。給「會被寫進附錄C 的警告」用，理由見
// buildCover 那段的註解：警告文字裡的完整 token 會被殘留掃描誤判成範本沒替換掉。
function plainToken_(token) {
  return String(token == null ? '' : token).replace(/^\{\{/, '').replace(/\}\}$/, '');
}

function plainTokens_(list) {
  var out = [];
  for (var i = 0; i < (list || []).length; i++) out.push(plainToken_(list[i]));
  return out;
}

// plainToken_ 的「整段字串」版：把一句話裡**任何**完整的 {{…}} 拆掉大括號。
// 為什麼需要它而不是只在每個寫死的字串上呼叫 plainToken_：會被寫進文件的字串
// 不只有我們自己組的那幾句，還有 msg_(err) —— 例外訊息裡原樣帶著一個 token 的
// 情形真的會發生（填入式的欄數不足就是這樣丟的）。那句話一旦落進儲存格或
// 「報告產生紀錄」，收尾第 4 步的殘留掃描就會把它當成「範本沒替換掉的 token」
// 報出來，於是報告警告自己剛剛寫下去的字 —— 2026-10-09 已經踩過一次，
// 見 plainToken_ 上方與 OWNER_FILLED_TOKENS_ 的註解。
// 只拆大括號、不動裡面的字，讀者仍然看得出是哪一個標記。
function plainifyTokens_(s) {
  return String(s == null ? '' : s).replace(/\{\{([^{}]*)\}\}/g, '$1');
}

function addWarning_(st, text) {
  if (!st.warnings) st.warnings = [];
  // 160 個中文字約 480 位元組；真正的總量保護在 serializeRunState_ 的位元組
  // 計算，這裡只是避免單一則訊息就把額度吃光。
  var s = scrub_(text);
  if (s.length > 160) s = s.substring(0, 160) + '…';
  st.warnings.push(s);
}

function addSkipped_(st, title, reason) {
  if (!st.skipped) st.skipped = [];
  st.skipped.push({ title: String(title), reason: String(reason) });
}

// 鎖只擋「同一帳號的並行執行」，擋不住「業主關掉對話框再重開」。真正的防連點
// 是執行狀態檢查，以及「每一輪都複製出一份全新 Doc」這條不變式（見 startReport_）。
// getDocumentLock() 在容器綁定場景下比較貼切，但 getScriptLock() 一定存在。
function acquireLock_() {
  var lock = null;
  try {
    lock = LockService.getScriptLock();
  } catch (err) {
    return null; // 鎖服務不可用時不要因此中止，後面還有兩道防線。
  }
  var got = false;
  try {
    got = lock.tryLock(0);
  } catch (err2) {
    got = false;
  }
  if (!got) {
    throw new Error('報告正在產生中，請稍候再試。\n' +
      '如果確定沒有別人在產生（例如上一次被瀏覽器關掉了），請用選單的' +
      '「' + MENU_TITLE_ + ' → 重設產生狀態」。');
  }
  return lock;
}

function releaseLock_(lock) {
  if (!lock) return;
  try { lock.releaseLock(); } catch (err) {}
}

// ===================================================================
// 取資料（action=analysis）
// ===================================================================

function fetchAnalysis_(cfg) {
  var url = cfg.apiUrl + '?action=analysis&key=' + encodeURIComponent(cfg.analysisKey);
  if (cfg.tenant) url += '&t=' + encodeURIComponent(cfg.tenant);
  if (cfg.exercise) url += '&ex=' + encodeURIComponent(cfg.exercise);
  var res;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true
    });
  } catch (err) {
    throw new Error('無法連線後端分析服務：' + msg_(err) +
      '\n請確認 ' + PROP_API_URL_ + ' 是正確的 /exec 網址，且這個 Google 帳號可以連外。');
  }
  var code = -1;
  try { code = res.getResponseCode(); } catch (err2) {}
  var text = '';
  try { text = res.getContentText(); } catch (err3) { text = ''; }
  if (code !== 200) {
    throw new Error('後端分析服務反應 HTTP ' + code + '。\n' +
      '若是 401／403，請檢查 Web App 的「部署設定 → 誰可以存取」是否為「任何人」；' +
      '若是 404，請檢查 ' + PROP_API_URL_ + ' 是否指向仍然存在的部署。');
  }
  var head = text.replace(/^\s+/, '').charAt(0);
  if (head === '<') {
    // 回一整頁 HTML 幾乎一定是被導向 Google 登入頁。直接讓 JSON.parse 丟錯的話，
    // 訊息會是「Unexpected token <」，完全看不出真正原因。
    throw new Error('後端回傳的是一頁 HTML 而不是資料，這通常表示請求被導向 Google 登入頁。\n' +
      '請到 Apps Script 的「部署 → 管理部署作業 → 編輯現有部署」，' +
      '把「誰可以存取」改成「任何人」（執行身分維持「我」），再重新部署同一個部署。');
  }
  var data;
  try {
    data = JSON.parse(text);
  } catch (err4) {
    throw new Error('無法解析後端回傳的內容（不是合法的 JSON）。\n' +
      '請直接在瀏覽器開啟 ' + PROP_API_URL_ + '?action=analysis&key=… 看看回了什麼。');
  }
  if (!data || typeof data !== 'object') {
    throw new Error('後端回傳的內容不是預期的資料物件。');
  }
  if (data.error) {
    if (String(data.errorCode || '') === 'UNAUTHORIZED') {
      // 提示要指對地方：網頁模式下 REPORT_ANALYSIS_KEY 連讀都沒讀（憑證是網址上
      // 帶來、而且已經對過本部署註冊表那一列的那一把），叫人去改它等於把人送去
      // 檢查唯一不相干的東西。這條在網頁模式下真正的成因只有一個：這支報告部署的
      // 註冊表，與後端 ConfigWithSubmit.gs 的註冊表，對同一場的「分析金鑰」不一致。
      throw new Error(cfg.webMode
        ? '後端不接受這把分析金鑰（回「unauthorized」）。\n' +
          '這把金鑰是從分析平台的網址帶過來、並且已經與本報告部署的租戶註冊表那一列比對通過的，' +
          '所以問題出在兩邊的註冊表對同一場演習記的「分析金鑰」不同。\n' +
          '請確認本部署的指令碼屬性 ' + PROP_REGISTRY_ID_ + ' 與後端 ConfigWithSubmit.gs 的 ' +
          'REGISTRY_SPREADSHEET_ID 指向同一份註冊表（改完後兩邊各有 120 秒快取）。'
        : '分析金鑰不正確（後端回「unauthorized」）。\n' +
          '請確認指令碼屬性 ' + PROP_ANALYSIS_KEY_ + ' 的值，與分析儀表板網址上 ?key= 後面那一串完全相同；' +
          '若已啟用租戶註冊表，要用該場演習那一列的「分析金鑰」。');
    }
    throw new Error('後端回報錯誤：' + String(data.error) +
      (data.errorCode ? '（代碼 ' + data.errorCode + '）' : ''));
  }
  if (!data.meta || !data.stats) {
    throw new Error('後端回傳的資料缺少 meta 或 stats，無法產生報告。');
  }
  return data;
}

// payload 指紋：**刻意不含 meta.generatedAt**。generatedAt 每次呼叫都不一樣，
// 把它放進指紋，「快取掉了就重新 fetch 再比對」這條回退路線永遠會失敗。
// 這裡選的全部是「資料真的變了才會變」的欄位，所以產生期間有人送出新分數時
// 指紋就會不同 —— 那時必須中止，絕不讓同一份報告的不同章節來自不同次快照。
//
// ⚠️ 絕對不要把 meta.evaluatorCodes 原樣串進來。
// 匿名映射是「排序後的 evaluatorCodes 依索引換成 評核官 1…N」，所以一串排序過
// 的代號**就是**那張對照表；而指紋會被印進附錄C。印出去等於在一份封面寫著
// 「已匿名」的 PDF 裡附上解碼表，正好是 commit 54b33dd 刻意移除的那個表面。
// 代號的「集合有沒有變」用人數與總長度就夠偵測了（評核官增減、代號改名都會
// 讓其中一個變），而這兩個數字還原不出任何代號。
function fingerprint_(payload) {
  var m = payload.meta || {};
  var s = payload.stats || {};
  var ov = s.overall || {};
  var codes = m.evaluatorCodes || [];
  return [
    String(m.recordRowCount || 0),
    String((payload.analysisRows || []).length),
    String((payload.coverageRows || []).length),
    String((payload.learningRows || []).length),
    String(m.commentCount || 0),
    String(codes.length) + ':' + String(codes.join(',').length),
    String(ov.n || 0),
    num_(ov.mean, 6),
    num_(s.within1, 6)
  ].join('|');
}

// 附錄C 印的是指紋的雜湊，不是指紋本身。
// 指紋的用途是「同一輪的各章節是否來自同一次快照」，那只需要可比較；讀者需要
// 的也只是「兩份報告是不是同一批資料」，雜湊同樣做得到。印原字串只會讓未來
// 任何一個新加進指紋的欄位自動變成一次資料外洩。
function fingerprintDigest_(s) {
  try {
    var bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, String(s == null ? '' : s), Utilities.Charset.UTF_8);
    return Utilities.base64Encode(bytes).substring(0, 16);
  } catch (err) {
    // 雜湊算不出來時寧可不印，也不要退回去印原字串。
    return '（本環境無法計算雜湊）';
  }
}

function cacheKey_(runId, i) {
  return 'rpt:' + runId + ':' + i;
}

// 寫入後立刻讀回驗證：CacheService 的 put 失敗是靜默的，不驗證的話下一個步驟
// 會拿不到資料，而症狀看起來像是「第二章就開始出錯」。
function cachePayload_(runId, payload) {
  var json;
  try {
    json = JSON.stringify(payload);
  } catch (err) {
    return 0;
  }
  var chunks = [];
  for (var i = 0; i < json.length; i += CACHE_CHUNK_) chunks.push(json.substring(i, i + CACHE_CHUNK_));
  try {
    var cache = CacheService.getScriptCache();
    for (var j = 0; j < chunks.length; j++) cache.put(cacheKey_(runId, j), chunks[j], CACHE_TTL_);
    for (var k = 0; k < chunks.length; k++) {
      if (cache.get(cacheKey_(runId, k)) !== chunks[k]) return 0;
    }
    return chunks.length;
  } catch (err2) {
    return 0;
  }
}

function readCachedPayload_(runId, count) {
  if (!count) return null;
  try {
    var cache = CacheService.getScriptCache();
    var parts = [];
    for (var i = 0; i < count; i++) {
      var piece = cache.get(cacheKey_(runId, i));
      if (piece === null) return null;
      parts.push(piece);
    }
    return JSON.parse(parts.join(''));
  } catch (err) {
    return null;
  }
}

// 每個步驟都從這裡拿 payload：先試快取，失敗就重新 fetch 並以指紋比對。
function loadPayloadForStep_(st, cfg) {
  var cached = readCachedPayload_(st.runId, st.chunkCount || 0);
  if (cached && fingerprint_(cached) === st.fingerprint) return cached;
  var fresh = fetchAnalysis_(cfg);
  if (fingerprint_(fresh) !== st.fingerprint) {
    throw new Error('產生期間資料已經變動（可能有評核官剛送出新的分數，或設定試算表被編輯過）。\n' +
      '為了不讓同一份報告的不同章節來自不同次快照，已中止這一輪。\n' +
      '請用選單的「重設產生狀態」之後重新產生一份。');
  }
  st.chunkCount = cachePayload_(st.runId, fresh);
  return fresh;
}

// ===================================================================
// r_wg 本機驗算（規則「數字一律取自後端」的唯一例外）
// ===================================================================

// 2026-10-13：本節原本驗算 ICC(2,k)，改成驗算 r_wg。不是換個公式而已，
// 連「為什麼要重算」的理由都變了：
//   舊理由：ICC 要取「所有題目都有評分的評核官」交集，只要一題只有一人
//           評過，整個資料集就崩成 null，所以必須指出是哪幾題弄垄的。
//   新理由：r_wg 是逐題獨立計算再平均，沒有交集崩潰這種故障模式。
//           但它有另兩種：單人評的題被跳過、r_wg 為負被截到 0。
//           這兩者都會把平均往上拉，而且在一個裸數字裡完全看不出來。
// 所以這裡仍然重算一次，並且回報納入題數、跳過題數、截斷題數，以及
// 一致性最低的幾題（reasons）—— 後者取代了舊版「讓交集崩潰的題」清單，
// 因為讀者真正要的從來不是「哪題弄垄了統計量」，而是「哪題評核官意見最分歧」。
//
// 分母慣例必須跟 ConfigWithSubmit.gs 的 rwg_() 與 Analysis.html 的 rwgLocal()
// 逐字相同：樣本變異數（n-1）、σ_E²=(A²-1)/12、5 點量表。三份實作一旦漂移，
// 報告與儀表板就會各說各話，而業主沒有任何辦法判斷哪一個才對。
var RWG_SCALE_POINTS_ = 5;
function rwgExpectedVar_(points) {
  return (points * points - 1) / 12;
}
function verifyRwg_(payload) {
  var rows = chartRows_(payload);
  var remote = (payload.stats || {}).rwg;
  var out = {
    remote: (remote && typeof remote.mean === 'number') ? remote.mean : null,
    local: null,
    match: false,
    items: 0,
    skipped: 0,
    clamped: 0,
    questions: rows.length,
    reasons: [],
    note: ''
  };
  if (!rows.length) {
    out.note = '沒有可用的評分列，無法計算。';
    out.match = (out.remote === null);
    return out;
  }
  var sigmaE = rwgExpectedVar_(RWG_SCALE_POINTS_);
  var vals = [], low = [];
  for (var i = 0; i < rows.length; i++) {
    var sc = rows[i].scores || [];
    var xs = [];
    for (var j = 0; j < sc.length; j++) xs.push(Number(sc[j].score));
    if (xs.length < 2) {
      out.skipped++;
      out.reasons.push('題號 ' + txt_(rows[i].questionId) + '：只有 ' + xs.length +
        ' 位評核官評過，無群組內一致性可言，未納入');
      continue;
    }
    var m = avg_(xs), ss = 0;
    for (var k = 0; k < xs.length; k++) ss += (xs[k] - m) * (xs[k] - m);
    var sx2 = ss / (xs.length - 1);
    var v = 1 - sx2 / sigmaE;
    if (v < 0) {
      v = 0;
      out.clamped++;
      out.reasons.push('題號 ' + txt_(rows[i].questionId) + '：實際變異數 ' + num_(sx2, 2) +
        ' 大於無共識期望值 ' + num_(sigmaE, 2) + '，r_wg 為負、依慣例截為 0');
    }
    vals.push(v);
    low.push({ id: txt_(rows[i].questionId), v: v });
  }
  if (!vals.length) {
    out.note = '所有題目都只有一位評核官評過，依定義無法計算（後端也會回 null）。';
    out.match = (out.remote === null);
    return out;
  }
  out.items = vals.length;
  out.local = avg_(vals);
  if (out.local === null || out.remote === null) {
    out.match = (out.local === null && out.remote === null);
  } else {
    out.match = Math.abs(Number(out.local) - Number(out.remote)) <= 1e-6;
  }
  // 一致性最低的幾題：這是讀者看到一個偏低的平均值之後唯一會問的問題。
  low.sort(function (a, b) { return a.v - b.v; });
  for (var q = 0; q < Math.min(low.length, 5); q++) {
    if (low[q].v >= 0.7) break;
    out.reasons.push('題號 ' + low[q].id + '：r_wg = ' + num_(low[q].v, 2) + '（評核官意見分歧）');
  }
  var tail = '（納入 ' + out.items + ' 題';
  if (out.skipped) tail += '；' + out.skipped + ' 題只有一位評核官評分、未納入';
  if (out.clamped) tail += '；' + out.clamped + ' 題 r_wg 為負並依慣例截為 0';
  tail += '）。';
  out.note = out.match
    ? '已驗算一致' + tail
    : '⚠ 驗算不一致：後端 ' + num_(out.remote, 4) + '，本機 ' + num_(out.local, 4) + tail;
  return out;
}

function avg_(arr) {
  if (!arr || !arr.length) return null;
  var s = 0;
  for (var i = 0; i < arr.length; i++) s += Number(arr[i]);
  return s / arr.length;
}

// ===================================================================
// 範本與錨點
// ===================================================================

// body.replaceText / findText 吃的是 RE2 正規式，不是純文字：{ 與 } 是量詞
// 字元，直接把「{{機構名稱}}」丟進去會被當成量詞語法。所有 token 一律先跳脫。
function tokenPattern_(token) {
  return escapeRegExp_(token);
}

function openTemplateDoc_(templateId) {
  var file;
  try {
    file = DriveApp.getFileById(templateId);
  } catch (err) {
    throw new Error('找不到報告範本，或執行報告的帳號沒有這份文件的權限。\n' +
      '請確認指令碼屬性 ' + PROP_TEMPLATE_ID_ + ' 填的是範本 Google 文件網址中 /d/ 與 /edit 之間那一段，' +
      '而且這個 Google 帳號至少有「檢視」權限。\n原始訊息：' + msg_(err));
  }
  var mime = '';
  try { mime = file.getMimeType(); } catch (err2) {}
  if (mime && mime !== MimeType.GOOGLE_DOCS) {
    throw new Error('指令碼屬性 ' + PROP_TEMPLATE_ID_ + ' 指到的不是 Google 文件（目前是 ' + mime + '）。\n' +
      '報告範本必須是 Google 文件，不能是 Word 檔或 PDF。');
  }
  var doc;
  try {
    doc = DocumentApp.openById(templateId);
  } catch (err3) {
    throw new Error('可以看到範本檔案，但無法用程式開啟它：' + msg_(err3) + '\n' +
      '最常見的原因是這個 Google 帳號對範本只有「檢視」權限。' +
      '請把範本的權限提高到「編輯者」（程式只會讀它、永遠不會寫入範本本體，' +
      '每次產生報告都是先複製一份）。');
  }
  return { file: file, doc: doc };
}

// 從 findText 回傳的 Text 元素往上爬，找出它所屬的「本文最上層段落」。
// 為什麼要爬：findText 回的 Text，父層可能是 ListItem 或 TableCell，
// 對它呼叫 body.getChildIndex 會丟錯或算出錯誤索引，而錯誤索引會把一整章的
// 內容插到完全不相干的位置 —— 這種錯誤無聲、而且極難查。
function topLevelParagraphOf_(body, element) {
  var cur = element;
  var guard = 0;
  while (cur && guard < 20) {
    guard++;
    var parent;
    try { parent = cur.getParent(); } catch (err) { return null; }
    if (!parent) return null;
    var ptype;
    try { ptype = parent.getType(); } catch (err2) { return null; }
    if (ptype === DocumentApp.ElementType.BODY_SECTION) {
      var ctype;
      try { ctype = cur.getType(); } catch (err3) { return null; }
      // 必須是 PARAGRAPH。LIST_ITEM 與 TABLE 都不接受：錨點放在清單項目或
      // 表格裡，插入位置與樣式都會跑掉。
      if (ctype !== DocumentApp.ElementType.PARAGRAPH) return null;
      return cur;
    }
    cur = parent;
  }
  return null;
}

// 掃描一份文件裡的全部章節錨點，回傳 {found:{id:{index}}, problems:[...]}。
// 這個函式是「驗證關卡」與「產生流程」共用的同一段程式碼 —— 兩套掃描邏輯
// 會讓「檢查說沒問題、產生卻失敗」變成常態。
function scanAnchors_(doc) {
  var body = doc.getBody();
  var out = { found: {}, problems: [], coverMissing: [], leftovers: [] };
  for (var i = 0; i < SECTIONS_.length; i++) {
    var sec = SECTIONS_[i];
    var hit = null;
    try {
      hit = body.findText(tokenPattern_(sec.token));
    } catch (err) {
      out.problems.push(sec.token + '：掃描時發生錯誤（' + msg_(err) + '）');
      continue;
    }
    if (!hit) {
      // 本文找不到時，再看看是不是被放進頁首／頁尾了 —— 那是最常見的放錯位置，
      // 而「找不到」這三個字完全不會讓業主想到去頁首找。
      if (tokenInHeaderOrFooter_(doc, sec.token)) {
        out.problems.push(sec.token + '：被放在頁首或頁尾裡。章節錨點必須放在本文，' +
          '頁首／頁尾只能放版面元素（院徽、頁碼）。');
      }
      continue;
    }
    var para = topLevelParagraphOf_(body, hit.getElement());
    if (!para) {
      out.problems.push(sec.token + '：不是本文的最上層段落（可能被放在表格儲存格、' +
        '清單項目或其他容器裡）。請把它移到單獨一個空段落。');
      continue;
    }
    var text = '';
    try { text = String(para.getText() || '').replace(/^\s+|\s+$/g, ''); } catch (err2) {}
    if (text !== sec.token) {
      out.problems.push(sec.token + '：該段落裡還有別的文字（目前內容：「' +
        (text.length > 40 ? text.substring(0, 40) + '…' : text) + '」）。' +
        '章節錨點必須單獨占一個段落，段落裡不可以有任何其他字。');
      continue;
    }
    var idx = -1;
    try { idx = body.getChildIndex(para); } catch (err3) { idx = -1; }
    if (idx < 0) {
      out.problems.push(sec.token + '：無法定位它在文件裡的位置，請把它移到單獨一個空段落。');
      continue;
    }
    out.found[sec.id] = { index: idx, token: sec.token };
  }
  for (var c = 0; c < COVER_TOKENS_.length; c++) {
    if (!tokenExistsAnywhere_(doc, COVER_TOKENS_[c])) out.coverMissing.push(COVER_TOKENS_[c]);
  }
  return out;
}

function tokenInHeaderOrFooter_(doc, token) {
  var pattern = tokenPattern_(token);
  var parts = [];
  try { parts.push(doc.getHeader()); } catch (err) {}
  try { parts.push(doc.getFooter()); } catch (err2) {}
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    try {
      if (parts[i].findText(pattern)) return true;
    } catch (err3) {}
  }
  return false;
}

function tokenExistsAnywhere_(doc, token) {
  var pattern = tokenPattern_(token);
  try {
    if (doc.getBody() && doc.getBody().findText(pattern)) return true;
  } catch (err) {}
  return tokenInHeaderOrFooter_(doc, token);
}

// 必要錨點缺一就整個拒絕產生。這裡不「盡力而為」，因為一份缺了資料品質章節或
// 附錄C 的 PDF 看起來跟完整的一模一樣，而讀者無從察覺少了什麼。
function assertRequiredAnchors_(scan) {
  var missing = [];
  for (var i = 0; i < SECTIONS_.length; i++) {
    if (SECTIONS_[i].required && !scan.found[SECTIONS_[i].id]) {
      missing.push(SECTIONS_[i].token + '（' + SECTIONS_[i].title + '）');
    }
  }
  if (missing.length) {
    throw new Error('報告範本缺少必要的章節錨點：\n　• ' + missing.join('\n　• ') +
      '\n每一個錨點都必須單獨占一個段落（段落裡只有這一串字），而且是本文的最上層段落。');
  }
  if (scan.problems.length) {
    throw new Error('報告範本的章節錨點位置有問題：\n　• ' + scan.problems.join('\n　• '));
  }
}

// 依「錨點在文件裡的先後順序」排出章節計畫，再把附錄C／附錄D 移到寫入順序的
// 最後（它們的內容是這一輪執行的總結，必須等其他章節都寫完才算得出來；
// 插入位置仍然是各自的錨點，所以文件上的順序完全由範本決定）。
function planFromScan_(scan, opts) {
  var list = [];
  for (var i = 0; i < SECTIONS_.length; i++) {
    var sec = SECTIONS_[i];
    var f = scan.found[sec.id];
    if (!f) continue;
    list.push({ id: sec.id, index: f.index });
  }
  list.sort(function (a, b) { return a.index - b.index; });
  var head = [], tail = [];
  for (var j = 0; j < list.length; j++) {
    if (LAST_WRITTEN_SECTIONS_.indexOf(list[j].id) === -1) head.push(list[j].id);
    else tail.push(list[j].id);
  }
  // 附錄C 一定要在附錄D 之前寫（附錄D 要引用附錄C 已經記下的降級結果）。
  tail.sort(function (a, b) { return LAST_WRITTEN_SECTIONS_.indexOf(a) - LAST_WRITTEN_SECTIONS_.indexOf(b); });
  return head.concat(tail);
}

// ===================================================================
// 範本模式判定（錨點式／填入式）
// ===================================================================

function fillDefById_(id) {
  var i;
  for (i = 0; i < FILL_IMAGE_TOKENS_.length; i++) {
    if (FILL_IMAGE_TOKENS_[i].id === id) return FILL_IMAGE_TOKENS_[i];
  }
  for (i = 0; i < FILL_ROW_TOKENS_.length; i++) {
    if (FILL_ROW_TOKENS_[i].id === id) return FILL_ROW_TOKENS_[i];
  }
  if (id === FILL_RECORD_ID_) {
    // token 為空字串是刻意的：產生紀錄不是範本裡的標記，它是文件最後自動附加的
    // 一段。finalizeReport_ 第 1 步會檢查 token 是否為空，空的就只記進附錄、
    // 不去 replaceText（replaceText('') 會把整份文件掃爛）。
    return { id: FILL_RECORD_ID_, token: '', kind: 'record', title: FILL_RECORD_TITLE_ };
  }
  return null;
}

function fillDefByToken_(token) {
  var i;
  for (i = 0; i < FILL_IMAGE_TOKENS_.length; i++) {
    if (FILL_IMAGE_TOKENS_[i].token === token) return FILL_IMAGE_TOKENS_[i];
  }
  for (i = 0; i < FILL_ROW_TOKENS_.length; i++) {
    if (FILL_ROW_TOKENS_[i].token === token) return FILL_ROW_TOKENS_[i];
  }
  return null;
}

// 這個字串在三個地方出現（拒絕訊息、檢查設定、產生紀錄），所以只寫一次。
function columnContractText_(def) {
  return def.columns.join('｜');
}

// 走訪本文所有表格，定位每一個填入式標記。
// ⚠️ **絕不**從 findText 的結果往上爬父層找位置。那個爬法（topLevelParagraphOf_）
// 存在的目的正好相反 —— 它是用來「拒絕儲存格」的；拿來定位填入式標記會把每一個
// 都退掉。儲存格定位取代了本文插入，這就是這一族 token 在 {{SEC_*}} 做不到的
// 地方做得到的全部原因。
//
// findText 另外跑一次，當成「這個字串到底存不存在」的權威。兩邊不一致
// （findText 找得到、走訪定位不到）就是一條具名的拒絕理由（巢狀表格／清單項目／
// 頁首頁尾），不是猜測，也不會被無聲忽略。這是 scanAnchors_ 搭配
// tokenInHeaderOrFooter_ 的同一套兩路比對。
function scanFillTokens_(doc) {
  var out = {
    images: [], rows: [], problems: [], unknown: [], duplicates: [],
    nearMiss: [], anyFillLike: false, found: {}
  };
  var body = null;
  try { body = doc.getBody(); } catch (errB) { body = null; }

  // 1) 先用既有的殘留掃描一次拿到「文件裡所有長得像 token 的字串 + 出現次數 +
  //    在哪個容器」。重用它而不是另寫一套，是因為那一套已經處理過無窮迴圈防護
  //    與三容器的問題，而且兩邊對「什麼算一個 token」的定義必須一致。
  var all = [];
  try { all = leftoverTokens_(doc); } catch (errL) { all = []; }
  var known = {};
  var i, j;
  for (i = 0; i < SECTIONS_.length; i++) known[SECTIONS_[i].token] = true;
  for (i = 0; i < COVER_TOKENS_.length; i++) known[COVER_TOKENS_[i]] = true;
  for (i = 0; i < OWNER_FILLED_TOKENS_.length; i++) known[OWNER_FILLED_TOKENS_[i]] = true;
  for (i = 0; i < FILL_IMAGE_TOKENS_.length; i++) known[FILL_IMAGE_TOKENS_[i].token] = true;
  for (i = 0; i < FILL_ROW_TOKENS_.length; i++) known[FILL_ROW_TOKENS_[i].token] = true;

  for (i = 0; i < all.length; i++) {
    var rec = all[i];
    var isFillLike = /^\{\{[圖列]_/.test(rec.text);
    if (isFillLike) out.anyFillLike = true;
    var def = fillDefByToken_(rec.text);
    if (def) {
      out.found[def.id] = { count: rec.count, where: rec.where };
      if (rec.count > 1) {
        out.duplicates.push(rec.text + ' 在範本裡出現了 ' + rec.count + ' 次（' + rec.where +
          '），系統無法判斷要放哪一個，請只保留一個。');
      }
      continue;
    }
    if (isFillLike) { out.unknown.push(rec.text); continue; }
    if (!known[rec.text] && rec.text.indexOf('{{#BEGIN_') !== 0) out.nearMiss.push(describeLeftover_(rec));
  }

  // 2) 走訪本文的表格，把每一個認得的標記定位到 (表格, 列, 欄)。
  var located = {};
  if (body) {
    var tables = [];
    try { tables = body.getTables() || []; } catch (errT) { tables = []; }
    for (var ti = 0; ti < tables.length; ti++) {
      var table = tables[ti];
      var nr = 0;
      try { nr = table.getNumRows(); } catch (errR) { nr = 0; }
      for (var r = 0; r < nr; r++) {
        var row = null;
        try { row = table.getRow(r); } catch (errRow) { row = null; }
        if (!row) continue;
        var nc = 0;
        try { nc = row.getNumCells(); } catch (errC) { nc = 0; }
        for (var c = 0; c < nc; c++) {
          var cell = null;
          try { cell = row.getCell(c); } catch (errCell) { cell = null; }
          if (!cell) continue;
          var text = '';
          try { text = String(cell.getText() || '').replace(/^\s+|\s+$/g, ''); } catch (errTx) { text = ''; }
          if (text.indexOf('{{') === -1) continue;
          for (j = 0; j < FILL_IMAGE_TOKENS_.length + FILL_ROW_TOKENS_.length; j++) {
            var d = (j < FILL_IMAGE_TOKENS_.length)
              ? FILL_IMAGE_TOKENS_[j]
              : FILL_ROW_TOKENS_[j - FILL_IMAGE_TOKENS_.length];
            if (located[d.id]) continue;
            if (text.indexOf(d.token) === -1) continue;
            var tableIndex = -1;
            try { tableIndex = body.getChildIndex(table); } catch (errIdx) { tableIndex = -1; }
            located[d.id] = {
              def: d, tableIndex: tableIndex, rowIndex: r, cellIndex: c,
              numCells: nc, cellText: text, alone: (text === d.token)
            };
          }
        }
      }
    }
  }

  // 2b) 走訪定位到、但第 1 步沒看到的，一律補進 found。
  //     leftoverTokens_ 每個容器有 300 次的迴圈防護上限，撞到上限時會漏掉後面的
  //     token —— 那種情況下「定位得到卻不寫」會是一次無聲的遺漏，而無聲遺漏正是
  //     這整套檢查要消滅的東西。兩邊取聯集，寧可多報一條位置問題。
  for (j = 0; j < FILL_IMAGE_TOKENS_.length + FILL_ROW_TOKENS_.length; j++) {
    var dd = (j < FILL_IMAGE_TOKENS_.length)
      ? FILL_IMAGE_TOKENS_[j]
      : FILL_ROW_TOKENS_[j - FILL_IMAGE_TOKENS_.length];
    if (!out.found[dd.id] && located[dd.id]) {
      out.found[dd.id] = { count: 1, where: '內文' };
      out.anyFillLike = true;
    }
  }

  // 3) 逐一驗位置。沒定位到但 findText 找得到＝放錯容器，要具名說出來。
  for (j = 0; j < FILL_IMAGE_TOKENS_.length + FILL_ROW_TOKENS_.length; j++) {
    var def2 = (j < FILL_IMAGE_TOKENS_.length)
      ? FILL_IMAGE_TOKENS_[j]
      : FILL_ROW_TOKENS_[j - FILL_IMAGE_TOKENS_.length];
    var hit = out.found[def2.id];
    if (!hit) continue;                       // 範本沒放這個標記 —— 不是錯誤，見下方註解。
    var loc = located[def2.id];
    if (!loc) {
      if (String(hit.where || '').indexOf('頁首') !== -1 || String(hit.where || '').indexOf('頁尾') !== -1) {
        out.problems.push(def2.token + ' 被放在頁首或頁尾裡。填入式標記必須放在本文的表格儲存格，' +
          '頁首／頁尾只能放版面元素（院徽、頁碼）。');
      } else {
        out.problems.push(def2.token + '：文件裡找得到這串字，但它不在本文的表格儲存格裡' +
          '（可能在巢狀表格、清單項目或純段落裡）。' +
          (def2.kind === 'image'
            ? '圖片標記必須單獨放進一個 1×1 表格的儲存格。'
            : '資料列標記必須打在樣板列最左邊那一格。'));
      }
      continue;
    }
    if (def2.kind === 'image') {
      if (!loc.alone) {
        out.problems.push(def2.token + ' 所在的儲存格裡還有別的文字（目前內容：「' +
          (loc.cellText.length > 40 ? loc.cellText.substring(0, 40) + '…' : loc.cellText) +
          '」）。圖片標記必須單獨占一個儲存格 —— 系統會先清空該格再放圖，格子裡的圖說文字會一起被清掉。' +
          '請把圖說移到表格外面或下一列。');
        continue;
      }
      out.images.push(loc);
    } else {
      if (loc.cellIndex !== 0) {
        out.problems.push(def2.token + ' 必須打在樣板列最左邊那一格，目前在第 ' + (loc.cellIndex + 1) +
          ' 欄。系統是以「標記所在的那一列」當樣板複製的，欄位對應從該列第一欄開始算。');
        continue;
      }
      if (loc.numCells < def2.columns.length) {
        out.problems.push(def2.token + ' 所在的表格只有 ' + loc.numCells + ' 欄，這個標記需要 ' +
          def2.columns.length + ' 欄。\n　　這張表的欄位順序必須是（由左至右）：' + columnContractText_(def2) +
          '。\n　　請把該表格補到 ' + def2.columns.length + ' 欄，或把這個標記刪掉。' +
          '（多出來的欄位系統不會動，可以留給您自己填寫。）');
        continue;
      }
      out.rows.push(loc);
    }
  }
  return out;
}

// 唯一的模式判定點。
// 回 { mode, anchors, fill, coverMissing }。
//
// secPresent 刻意用「這個字串在文件裡存不存在」而不是「它是不是一個合格的錨點」：
// 一個不小心掉進表格儲存格的 {{SEC_摘要}} 必須繼續是**錨點式的位置錯誤**
// （scanAnchors_ 本來就會具名指出它），而不是無聲地把整份文件翻成填入式。
function scanTemplate_(doc) {
  var anchors = scanAnchors_(doc);
  var fill = scanFillTokens_(doc);

  var secPresent = false;
  var secFound = [];
  for (var i = 0; i < SECTIONS_.length; i++) {
    if (tokenExistsAnywhere_(doc, SECTIONS_[i].token)) {
      secPresent = true;
      secFound.push(SECTIONS_[i].token);
    }
  }
  var fillPresent = fill.anyFillLike;
  var fillFound = [];
  for (var k = 0; k < FILL_IMAGE_TOKENS_.length + FILL_ROW_TOKENS_.length; k++) {
    var d = (k < FILL_IMAGE_TOKENS_.length)
      ? FILL_IMAGE_TOKENS_[k]
      : FILL_ROW_TOKENS_[k - FILL_IMAGE_TOKENS_.length];
    if (fill.found[d.id]) fillFound.push(d.token);
  }

  var mode = 'none';
  if (secPresent && fillPresent) mode = 'both';
  else if (secPresent) mode = 'anchor';
  else if (fillPresent) mode = 'fill';

  // COVER_TOKENS_SILENT_ 裡的 token 缺席不算缺 —— 舊的 21 章骨架範本因此在
  // 附錄C 的警告清單上一個字都不會變。
  var coverMissing = [];
  for (var c = 0; c < anchors.coverMissing.length; c++) {
    if (COVER_TOKENS_SILENT_.indexOf(anchors.coverMissing[c]) === -1) coverMissing.push(anchors.coverMissing[c]);
  }

  return {
    mode: mode, anchors: anchors, fill: fill, coverMissing: coverMissing,
    secFound: secFound, fillFound: fillFound,
    coverSilentMissing: (anchors.coverMissing.length !== coverMissing.length)
  };
}

// 回傳拒絕訊息；可以用就回空字串。
// **檢查設定與產生流程共用這一個函式**，所以「檢查說沒問題、產生卻失敗」不可能
// 發生 —— 這是 scanAnchors_ 上方那條規則的延伸，不是新規則。
function templateRefusalMessage_(scan) {
  if (scan.mode === 'none') {
    var m = '這份報告範本裡找不到任何可用的標記，無法判斷要怎麼產生報告。\n' +
      '　• 章節錨點式：範本要有 ' + plainToken_('{{SEC_摘要}}') + ' 這類錨點（原字要含兩層大括號），' +
      '每一個單獨占一個本文段落，系統會把一整章內容插在那裡。\n' +
      '　• 填入式：範本要有 圖_… （打在 1×1 表格的儲存格裡）或 列_… （打在樣板列最左邊那一格），同樣含兩層大括號。\n' +
      '　目前可用的填入式標記共 ' + (FILL_IMAGE_TOKENS_.length + FILL_ROW_TOKENS_.length) + ' 個：' +
      plainTokens_(tokensOfDefs_(FILL_IMAGE_TOKENS_)).join('、') + '、' +
      plainTokens_(tokensOfDefs_(FILL_ROW_TOKENS_)).join('、') + '。';
    if (scan.fill.nearMiss.length) {
      m += '\n範本裡找到這些看起來像標記、但系統不認得的字串：' + scan.fill.nearMiss.join('、') +
        '。標記必須逐字相符，多一個空白也會對不上。';
    }
    return m;
  }
  if (scan.mode === 'both') {
    return '這份報告範本同時含有章節錨點與填入式標記，系統無法判斷要用哪一種方式產生，已中止。\n' +
      '　• 找到的章節錨點：' + plainTokens_(scan.secFound).join('、') + '\n' +
      '　• 找到的填入式標記：' + plainTokens_(scan.fillFound).join('、') + '\n' +
      '兩者的運作方式完全不同：錨點會被一整章內容「取代」，填入式只把圖與資料列「填進」您已經畫好的表格。' +
      '混用會產出一份半成品。\n' +
      '請擇一：把填入式標記全部刪掉（沿用原本 21 章的範本），或把 SEC_… 錨點全部刪掉（使用您自己的報告版型）。';
  }
  if (scan.mode !== 'fill') return '';

  var parts = [];
  if (scan.fill.unknown.length) {
    parts.push('範本裡有系統不認得的填入式標記：' + scan.fill.unknown.join('、') + '。\n' +
      '可用的圖片標記：' + plainTokens_(tokensOfDefs_(FILL_IMAGE_TOKENS_)).join('、') + '\n' +
      '可用的資料列標記：' + plainTokens_(tokensOfDefs_(FILL_ROW_TOKENS_)).join('、') + '\n' +
      '標記必須逐字相符（含底線與中文字），多一個空白也會對不上。');
  }
  if (scan.fill.duplicates.length) parts.push('　• ' + scan.fill.duplicates.join('\n　• '));
  if (scan.fill.problems.length) parts.push('填入式標記的位置有問題：\n　• ' + scan.fill.problems.join('\n　• '));
  return parts.length ? parts.join('\n\n') : '';
}

function tokensOfDefs_(defs) {
  var out = [];
  for (var i = 0; i < defs.length; i++) out.push(defs[i].token);
  return out;
}

// 取代兩個呼叫點的 assertRequiredAnchors_(scan)。錨點式直接轉呼叫既有函式，
// 訊息逐字相同 —— 既有那條已經產出過真實報告的路一個位元都沒變。
function assertTemplateUsable_(scan) {
  if (scan.mode === 'anchor') {
    assertRequiredAnchors_(scan.anchors);
    return;
  }
  var m = templateRefusalMessage_(scan);
  if (m) throw new Error(m);
}

// ⚠️ 刻意**不拒絕**「預期的 {{圖_*}}／{{列_*}} 少了幾個」。
// 這份手稿是業主自己的：他沒有畫框的那張圖，就是他不要的那張圖。檢查設定會把
// 每一個缺席的標記列成 ⚠ 提醒（那是它的工作），但缺圖不該擋住產生。
// 身分類的封面 token 同理只警告不擋 —— 文件最後自動附加的「報告產生紀錄」
// 一定會印出報告編號、產生時間、機構代號與演習代號，所以填入式的 PDF 不可能
// 匿名到看不出是哪一輪產生的，即使業主在手稿裡用手打了院名。
function planFillSlots_(fill) {
  var list = [];
  var i;
  for (i = 0; i < fill.images.length; i++) {
    list.push({ id: fill.images[i].def.id, t: fill.images[i].tableIndex, r: fill.images[i].rowIndex });
  }
  for (i = 0; i < fill.rows.length; i++) {
    list.push({ id: fill.rows[i].def.id, t: fill.rows[i].tableIndex, r: fill.rows[i].rowIndex });
  }
  // 依文件順序排，對話框的進度才會由上而下讀過整份手稿。
  list.sort(function (a, b) {
    if (a.t !== b.t) return a.t - b.t;
    return a.r - b.r;
  });
  var out = [];
  for (i = 0; i < list.length; i++) out.push(list[i].id);
  out.push(FILL_RECORD_ID_);
  return out;
}

// ===================================================================
// 文件寫入游標
// ===================================================================

// 章節內容一律插在「BEGIN 標記」與「錨點」之間，兩者都在章節寫完時才移除。
// 這條不變式讓步驟可以安全重試：重試時若發現 BEGIN 標記還在，就把標記到錨點
// 之間的元素全部刪掉再重寫，不會產生重複內容；若連錨點都不在了，代表那一章
// 已經寫完，直接跳過。
function beginMarker_(sectionId) {
  return '{{#BEGIN_' + sectionId + '}}';
}

function openCursor_(doc, sectionId, token) {
  var body = doc.getBody();
  var anchorHit = body.findText(tokenPattern_(token));
  if (!anchorHit) return null; // 錨點不在了 = 這一章已經寫完，重試時直接跳過。
  var anchorPara = topLevelParagraphOf_(body, anchorHit.getElement());
  if (!anchorPara) {
    throw new Error('章節錨點 ' + token + ' 不在本文的最上層段落，無法插入內容。');
  }
  var marker = beginMarker_(sectionId);
  var markerHit = body.findText(tokenPattern_(marker));
  if (markerHit) {
    // 上一次嘗試寫到一半就中斷了。先把殘留內容清掉再重寫。
    var markerPara = topLevelParagraphOf_(body, markerHit.getElement());
    if (markerPara) {
      var mIdx = body.getChildIndex(markerPara);
      var aIdx = body.getChildIndex(anchorPara);
      for (var k = aIdx - 1; k > mIdx; k--) {
        try { body.getChild(k).removeFromParent(); } catch (err) {}
      }
      return { body: body, doc: doc, index: body.getChildIndex(anchorPara), marker: marker, token: token };
    }
  }
  var anchorIndex = body.getChildIndex(anchorPara);
  body.insertParagraph(anchorIndex, marker);
  return { body: body, doc: doc, index: anchorIndex + 1, marker: marker, token: token };
}

function closeCursor_(cursor) {
  var body = cursor.body;
  removeParagraphByText_(body, cursor.marker);
  removeParagraphByText_(body, cursor.token);
}

function removeParagraphByText_(body, text) {
  try {
    var hit = body.findText(tokenPattern_(text));
    if (!hit) return false;
    var para = topLevelParagraphOf_(body, hit.getElement());
    if (!para) return false;
    para.removeFromParent();
    return true;
  } catch (err) {
    return false;
  }
}

// 標題層級只指定語意（HEADING1/2/3），長相完全由範本的具名樣式決定。
// 這就是為什麼範本是必要條件而不是便利設施：業主想改字型大小，改的是文件的
// 樣式定義，不是這支程式。
function heading_(cursor, text, level) {
  var p = cursor.body.insertParagraph(cursor.index++, String(text == null ? '' : text));
  try {
    var h = DocumentApp.ParagraphHeading;
    var want = level === 1 ? h.HEADING1 : (level === 2 ? h.HEADING2 : h.HEADING3);
    if (want !== undefined && want !== null) p.setHeading(want);
  } catch (err) {
    // 樣式設不起來只是外觀問題，內容還在，不值得中斷整章。
  }
  return p;
}

function para_(cursor, text) {
  return cursor.body.insertParagraph(cursor.index++, String(text == null ? '' : text));
}

function bullet_(cursor, text) {
  try {
    var li = cursor.body.insertListItem(cursor.index++, String(text == null ? '' : text));
    try { li.setGlyphType(DocumentApp.GlyphType.BULLET); } catch (err) {}
    return li;
  } catch (err2) {
    cursor.index--;
    return para_(cursor, '・' + String(text == null ? '' : text));
  }
}

// 表格一律全部轉成字串再送進 insertTable：傳進數字或 null 會丟出不易讀的例外，
// 而那會在一章寫到一半時炸掉。
function table_(cursor, rows, note) {
  if (!rows || !rows.length) return null;
  var capped = rows;
  var truncated = 0;
  if (rows.length > TABLE_ROW_CAP_ + 1) {
    capped = rows.slice(0, TABLE_ROW_CAP_ + 1);
    truncated = rows.length - capped.length;
  }
  var cells = [];
  for (var i = 0; i < capped.length; i++) {
    var line = [];
    for (var j = 0; j < capped[i].length; j++) {
      var v = capped[i][j];
      line.push(v === null || v === undefined ? '' : String(v));
    }
    cells.push(line);
  }
  var t = null;
  try {
    t = cursor.body.insertTable(cursor.index++, cells);
  } catch (err) {
    cursor.index--;
    para_(cursor, '（本節表格無法插入：' + msg_(err) + '，以下改以逐列文字呈現）');
    for (var r = 0; r < cells.length; r++) para_(cursor, cells[r].join('　｜　'));
    return null;
  }
  if (truncated > 0) {
    para_(cursor, '（本表資料共 ' + (rows.length - 1) + ' 列，為控制產生時間僅列出前 ' +
      TABLE_ROW_CAP_ + ' 列，其餘 ' + truncated + ' 列請查閱「' + SNAPSHOT_SHEET_NAME_ + '」工作表。）');
  }
  if (note) para_(cursor, note);
  return t;
}

// ===================================================================
// 報告快照 工作表
// ===================================================================

// 為什麼需要這張表：(1) 直接補掉缺陷 D3 —— 報告裡每一個標籤與數字都在這一刻
// 被凍結，業主下個月改 項目與問題 或 對應指標 不會再回頭改寫這份已發出報告的
// 依據。(2) 它是「十四、與前次演習比較」唯一可能的資料來源。(3) PDF 不可機讀，
// 這張表是「這份 PDF 說了什麼」的唯一機器可讀副本，報告編號 把 Doc／PDF／
// 快照列三者串起來。(4) 業主不開儀表板也能用試算表自己的篩選功能對帳。
//
// 刻意不記錄的：任何 人員代號、任何逐評核官分數、任何 觀察紀錄 原文。
// 即使使用者勾了識別模式，快照仍然只有彙總值 —— 識別資料只存在於那一份
// Doc／PDF 裡，不會沉澱進業主的試算表、長期累積成一份逐評核官資料集。
// 這一條沒有開關。
// createIfMissing=false 時不建立工作表，只回 {missingSheet:true}。
// 選單的「檢查設定」用這個模式。那個入口的用途是「按了沒反應時去看哪裡壞了」，
// 而在演習進行中的設定試算表上長出一個業主沒要求的新分頁，正是模態對話框存在
// 要防的那件事（plan §1.1 的 D5、owner-guide §11 的鐵則）。檢查就只檢查。
function ensureSnapshotSheet_(ss, createIfMissing) {
  var sh = ss.getSheetByName(SNAPSHOT_SHEET_NAME_);
  if (!sh && createIfMissing === false) {
    return { sheet: null, colIndex: null, width: 0, missingSheet: true };
  }
  if (!sh) {
    try {
      sh = ss.insertSheet(SNAPSHOT_SHEET_NAME_);
    } catch (err) {
      throw new Error('無法建立「' + SNAPSHOT_SHEET_NAME_ + '」工作表：' + msg_(err) +
        '\n請確認這個 Google 帳號對本試算表有編輯權限。');
    }
    sh.getRange(1, 1, 1, SNAPSHOT_COLUMNS_.length).setValues([SNAPSHOT_COLUMNS_]);
    try {
      sh.getRange(1, 1, sh.getMaxRows(), SNAPSHOT_COLUMNS_.length).setNumberFormat('@');
      sh.setFrozenRows(1);
    } catch (err2) {}
  }
  var lastCol = Math.max(sh.getLastColumn(), SNAPSHOT_COLUMNS_.length);
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var colIndex = {};
  var missing = [];
  for (var i = 0; i < SNAPSHOT_COLUMNS_.length; i++) {
    var name = SNAPSHOT_COLUMNS_[i];
    var at = -1;
    for (var j = 0; j < header.length; j++) {
      if (String(header[j] || '').replace(/^\s+|\s+$/g, '') === name) { at = j; break; }
    }
    if (at === -1) missing.push(name);
    else colIndex[name] = at;
  }
  // 絕不猜欄位位置、絕不覆寫業主自己加的欄：缺欄就指名缺哪一欄並中止。
  if (missing.length) {
    throw new Error('「' + SNAPSHOT_SHEET_NAME_ + '」工作表缺少欄位：' + missing.join('、') +
      '\n請在該工作表的標頭列補上這些欄名（欄位順序不限，程式以欄名比對），' +
      '或把整個工作表刪掉讓程式重新建立。');
  }
  return { sheet: sh, colIndex: colIndex, width: lastCol, missingSheet: false };
}

function snapshotRowsFor_(payload, runId, generatedAtText) {
  var meta = payload.meta || {};
  var prefix = meta.scenePrefix || 'SCENE';
  var groups = [
    ['analysis', payload.analysisRows || []],
    ['coverage', payload.coverageRows || []],
    ['learning', payload.learningRows || []]
  ];
  var out = [];
  for (var g = 0; g < groups.length; g++) {
    var label = groups[g][0];
    var rows = groups[g][1];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      out.push({
        '報告編號': runId,
        '產生時間': generatedAtText,
        '報告狀態': '產生中',
        '機構代號': String(meta.tenant || ''),
        '演習代號': String(r.exerciseId || meta.exercise || ''),
        '分組': label,
        '問題ID': String(r.questionId || ''),
        '階段': String(r.stage || ''),
        '項目名稱': String(r.itemName || ''),
        '場景編號': shortScene_(r.itemName, prefix),
        '測試場景與目標': String(r.goal || ''),
        '指標': String(r.indicator || ''),
        '評核潛能': String(r.potential || ''),
        '4S 元素': String(r.s4 || ''),
        '評核題目': String(r.question || ''),
        '評核人數': String((r.scores || []).length),
        '平均': num_(r.mean, 4),
        '標準差': num_(r.sd, 4),
        '未觸發數': String(r.untriggered === undefined ? '' : r.untriggered),
        '標籤來源': String(r.labelSource || '')
      });
    }
  }
  return out;
}

// 只追加，永不清空、永不覆寫既有列。一次 setValues 批次寫入。
function appendSnapshot_(ss, payload, runId, generatedAtText) {
  var info = ensureSnapshotSheet_(ss);
  var objs = snapshotRowsFor_(payload, runId, generatedAtText);
  if (!objs.length) return { startRow: 0, count: 0, statusCol: info.colIndex['報告狀態'] + 1 };
  var startRow = info.sheet.getLastRow() + 1;
  var values = [];
  for (var i = 0; i < objs.length; i++) {
    var line = [];
    for (var c = 0; c < info.width; c++) line.push('');
    for (var key in objs[i]) {
      if (!Object.prototype.hasOwnProperty.call(objs[i], key)) continue;
      line[info.colIndex[key]] = objs[i][key];
    }
    values.push(line);
  }
  // 這張表只追加、永不清空，所以它一定會撞到工作表的列數上限（新建時預設
  // 1000 列）。getRange 超出 maxRows 會丟出英文的「Those rows are out of
  // bounds」，而且是在快照階段 —— 業主會看到一個沒有任何中文指引的失敗。
  // 先把格子擴出來，並且多留 100 列，免得每一輪都擴一次。
  var need = startRow + values.length - 1;
  var maxRows = info.sheet.getMaxRows();
  if (need > maxRows) {
    try {
      info.sheet.insertRowsAfter(maxRows, (need - maxRows) + 100);
      // 新長出來的列沒有繼承 '@' 格式，補設一次（理由同下）。
      info.sheet.getRange(maxRows + 1, 1, info.sheet.getMaxRows() - maxRows, info.width)
        .setNumberFormat('@');
    } catch (errGrow) {
      throw new Error('「' + SNAPSHOT_SHEET_NAME_ + '」工作表的列數不足，而且無法自動增加：' +
        msg_(errGrow) + '\n請手動在該工作表底部新增至少 ' + (need - maxRows) + ' 列後再試一次。');
    }
  }
  var range = info.sheet.getRange(startRow, 1, values.length, info.width);
  // 先設 '@' 再寫值：反過來的話「10-2」「2026-01」在寫入當下就已經被 Sheets
  // 轉成日期，之後再改格式只會看到 45292 這種序列值。
  try { range.setNumberFormat('@'); } catch (err) {}
  range.setValues(values);
  return { startRow: startRow, count: values.length, statusCol: info.colIndex['報告狀態'] + 1 };
}

// 收尾時只改寫這一輪那段連續範圍的狀態欄（單一 setValues，很便宜）。
function updateSnapshotStatus_(ss, startRow, count, statusCol, text) {
  if (!startRow || !count || !statusCol) return;
  try {
    var sh = ss.getSheetByName(SNAPSHOT_SHEET_NAME_);
    if (!sh) return;
    var values = [];
    for (var i = 0; i < count; i++) values.push([text]);
    sh.getRange(startRow, statusCol, count, 1).setValues(values);
  } catch (err) {
    // 狀態欄改不動不影響報告本身的正確性，不要因此讓收尾失敗。
  }
}

// ===================================================================
// 圖表（能力探測 + 四層回退）
// ===================================================================

// 固定名稱、跨執行重複使用、開始時清空而不是每次新建 —— 執行中途死掉時不會
// 在業主的試算表上堆出一疊垃圾分頁。後端從不以這個名稱讀取任何分頁。
function tempSheet_(ss) {
  var sh = ss.getSheetByName(TEMP_SHEET_NAME_);
  if (!sh) {
    sh = ss.insertSheet(TEMP_SHEET_NAME_);
    try { sh.hideSheet(); } catch (err) {}
  }
  return sh;
}

function resetTempSheet_(sh) {
  try {
    var charts = sh.getCharts();
    for (var i = 0; i < charts.length; i++) {
      try { sh.removeChart(charts[i]); } catch (err) {}
    }
  } catch (err2) {}
  try { sh.clear(); } catch (err3) {}
}

// ⚠️ 絕對不要寫成 Charts.ChartType.RADAR：如果那個成員不存在，取到的是
// undefined，再傳進 setChartType 會丟出一個完全看不懂的例外。一律用方括號
// 取值並檢查 !== undefined。
// Google Sheets 的「圖表編輯器」UI 確實有雷達圖，但 UI 有某種圖表類型不等於
// Apps Script 的列舉或 Sheets REST 的 ChartSpec 有對應項（REST 的
// BasicChartType 就沒有 radar）。這一點沒有任何實機驗證，所以用探測，不用斷言。
function chartType_(name) {
  try {
    if (typeof Charts === 'undefined' || !Charts || !Charts.ChartType) return null;
    var t = Charts.ChartType[name];
    return (t === undefined || t === null) ? null : t;
  } catch (err) {
    return null;
  }
}

// 整份報告只探測一次，結果存進執行狀態並印在附錄C。
// 請業主在第一次產生報告後回報附錄C 的這一行 —— 這是本機無法執行這段程式碼時
// 唯一的驗證替代手段。
function chartCapability_(ss) {
  var cap = { column: false, radar: false, radarEnum: false, detail: [] };
  cap.radarEnum = chartType_('RADAR') !== null;
  var sh;
  try {
    sh = tempSheet_(ss);
  } catch (err) {
    cap.detail.push('無法建立暫存工作表（' + msg_(err) + '），全部圖表將改以數值表呈現');
    return cap;
  }
  var probe = {
    title: '探測',
    headers: ['項目', '數值'],
    rows: [['甲', 3], ['乙', 4], ['丙', 5]]
  };
  var c1 = tryChartBlob_(sh, probe, 'COLUMN');
  cap.column = !!c1.blob;
  cap.detail.push('直條圖（COLUMN）：' + (cap.column ? '可用' : '不可用（' + c1.error + '）'));
  if (!cap.radarEnum) {
    cap.detail.push('雷達圖（RADAR）：本環境的 Charts.ChartType 沒有這個成員');
  } else {
    var c2 = tryChartBlob_(sh, probe, 'RADAR');
    cap.radar = !!c2.blob;
    cap.detail.push('雷達圖（RADAR）：' + (cap.radar ? '可用' : '不可用（' + c2.error + '）'));
  }
  resetTempSheet_(sh);
  return cap;
}

// 回傳 {blob, error}。任何一步失敗都只回 error，不丟例外 —— 一張圖畫不出來
// 不應該讓整章消失。
function tryChartBlob_(sh, spec, typeName) {
  var type = chartType_(typeName);
  if (type === null) return { blob: null, error: 'Charts.ChartType 沒有 ' + typeName };
  try {
    resetTempSheet_(sh);
    var data = [spec.headers].concat(spec.rows);
    var width = spec.headers.length;
    sh.getRange(1, 1, data.length, width).setValues(data);
    var builder = sh.newChart()
      .setChartType(type)
      .addRange(sh.getRange(1, 1, data.length, width))
      .setPosition(1, width + 2, 0, 0);
    try {
      // 兩倍尺寸出圖、再用 InlineImage 縮回版面寬度，是在 Docs 裡貼高解析度
      // 圖片的慣用手法。若這兩個 option 其實沒被 getAs 採用，結果只是圖略糊，
      // 純外觀問題，不降級、不報錯。
      builder.setOption('width', 1200);
      builder.setOption('height', 740);
      builder.setOption('useFirstColumnAsDomain', true);
      if (spec.title) builder.setOption('title', spec.title);
    } catch (errOpt) {}
    sh.insertChart(builder.build());
    // 沒有 flush，剛建立的圖表有機會回一張空白 PNG（已知的失敗型態是「回圖但
    // 整張白」，不是丟錯），那會無聲地毀掉報告。
    SpreadsheetApp.flush();
    var charts = sh.getCharts();
    if (!charts || !charts.length) return { blob: null, error: '圖表建立後讀不回來' };
    var chart = charts[charts.length - 1];
    var blob = null;
    try {
      blob = chart.getAs('image/png');
    } catch (errAs) {
      try { blob = chart.getBlob(); } catch (errBlob) { blob = null; }
    }
    if (!blob) return { blob: null, error: '無法把圖表轉成圖片' };
    var bytes = 0;
    try { bytes = blob.getBytes().length; } catch (errB) { bytes = 0; }
    if (bytes <= 1000) return { blob: null, error: '產出的圖片疑似空白（' + bytes + ' 位元組）' };
    return { blob: blob, error: '' };
  } catch (err) {
    return { blob: null, error: msg_(err) };
  }
}

// 舊版 Charts 服務的獨立建構器。該服務的伺服器端影像渲染曾被宣告淘汰，
// 所以它永遠只當候補、絕不當主路徑；報告的正確性完全不依賴它。
function legacyChartBlob_(spec) {
  try {
    if (typeof Charts === 'undefined' || !Charts || !Charts.newDataTable) return null;
    // 舊版 DataTable 沒有「缺口」的概念，空白格只能變成 0，而 0 在值域 1–5 的
    // 圖上會被讀成「得 0 分」。含空白格的資料寧可降級到數值表，也不要畫一張
    // 會被誤讀的圖。
    for (var ri = 0; ri < spec.rows.length; ri++) {
      for (var ci = 1; ci < spec.rows[ri].length; ci++) {
        var cv = spec.rows[ri][ci];
        if (cv === '' || cv === null || cv === undefined) return null;
      }
    }
    var dt = Charts.newDataTable().addColumn(Charts.ColumnType.STRING, String(spec.headers[0]));
    for (var h = 1; h < spec.headers.length; h++) {
      dt.addColumn(Charts.ColumnType.NUMBER, String(spec.headers[h]));
    }
    for (var r = 0; r < spec.rows.length; r++) {
      var row = [String(spec.rows[r][0])];
      for (var c = 1; c < spec.rows[r].length; c++) row.push(Number(spec.rows[r][c]) || 0);
      dt.addRow(row);
    }
    var chart = Charts.newColumnChart().setDataTable(dt.build()).setDimensions(1000, 620).build();
    var blob = null;
    try { blob = chart.getAs('image/png'); } catch (err) { blob = chart.getBlob(); }
    if (!blob) return null;
    if (blob.getBytes().length <= 1000) return null;
    return blob;
  } catch (err2) {
    return null;
  }
}

// 四層回退鏈，逐張獨立 —— 一張圖失敗不影響其他圖：
//   1. 原生 Sheets 內嵌圖表（雷達用 RADAR，其餘用 COLUMN/BAR）
//   2. 雷達不可用 → 同一份資料改用 COLUMN 重畫（每一軸變成一根直條，數值完全相同）
//   3. 圖片整條路都失敗 → 插入一張 Google 文件原生表格列出同一組數字
//   4. 連表格都插不進去 → 插入一個段落記錄原因，並指向 報告快照 工作表
// 每一層降級都寫進 warnings[]、顯示在對話框、彙總到附錄C。
function emitChart_(cursor, ctx, spec) {
  if (!spec.rows || !spec.rows.length) {
    para_(cursor, '（' + spec.title + '：本次沒有可呈現的資料。）');
    return;
  }
  var order = [];
  if (spec.type === 'RADAR') {
    if (ctx.cap.radar) order.push('RADAR');
    order.push('COLUMN');
  } else {
    order.push(spec.type);
    if (spec.type !== 'COLUMN') order.push('COLUMN');
  }
  var lastError = '';
  for (var i = 0; i < order.length; i++) {
    if (order[i] === 'COLUMN' && !ctx.cap.column && i > 0) continue;
    var res = tryChartBlob_(ctx.tempSheet, spec, order[i]);
    if (res.blob) {
      if (insertImage_(cursor, res.blob)) {
        if (spec.type === 'RADAR' && order[i] !== 'RADAR') {
          para_(cursor, '本環境不支援雷達圖，已改以長條圖呈現相同數值。');
          ctx.warn('「' + spec.title + '」：雷達圖不可用，已降級為直條圖（數值相同）。');
        }
        para_(cursor, '圖：' + spec.title);
        return;
      }
      lastError = '圖片插入文件失敗';
    } else {
      lastError = res.error;
    }
  }
  var legacy = legacyChartBlob_(spec);
  if (legacy && insertImage_(cursor, legacy)) {
    para_(cursor, '圖：' + spec.title + '（以舊版 Charts 服務產生）');
    ctx.warn('「' + spec.title + '」：內嵌圖表失敗（' + lastError + '），改用舊版 Charts 服務。');
    return;
  }
  // 第 3 層：數值表。
  ctx.warn('「' + spec.title + '」：圖表無法產生（' + lastError + '），已改以數值表呈現。');
  var rows = [spec.headers.slice()];
  for (var r = 0; r < spec.rows.length; r++) {
    var line = [];
    for (var c = 0; c < spec.rows[r].length; c++) {
      line.push(c === 0 ? String(spec.rows[r][c]) : num_(spec.rows[r][c], 2));
    }
    rows.push(line);
  }
  var t = table_(cursor, rows);
  if (t) {
    para_(cursor, '表：' + spec.title + '（本節圖表無法在此環境產生，原因：' + lastError +
      '；已改以數值表呈現，數值與圖表完全相同。）');
  } else {
    // 第 4 層。
    para_(cursor, '⚠ 本節的「' + spec.title + '」既無法產生圖表也無法插入表格（原因：' +
      lastError + '）。同一批數字已經寫進本試算表的「' + SNAPSHOT_SHEET_NAME_ + '」工作表，請由該處查閱。');
    ctx.skip(spec.title, '圖表與表格皆無法插入：' + lastError);
  }
}

function insertImage_(cursor, blob) {
  try {
    var img = cursor.body.insertImage(cursor.index++, blob);
    try {
      var w = img.getWidth();
      var h = img.getHeight();
      if (w && w > IMAGE_WIDTH_PT_) {
        img.setHeight(Math.round(h * (IMAGE_WIDTH_PT_ / w)));
        img.setWidth(IMAGE_WIDTH_PT_);
      }
    } catch (errSize) {}
    return true;
  } catch (err) {
    cursor.index--;
    return false;
  }
}

// ===================================================================
// 輸出位置與寫入權限
// ===================================================================

// 不靠猜：真的建立一個 0 位元組的暫存檔再立刻丟進垃圾桶。
// 「以為有權限、寫到一半才失敗」會留下一份半成品 Doc 在業主的 Drive 上。
// ss 是這一輪已經解析出來的設定試算表（選單模式＝容器，網頁模式＝註冊表那一列
// 指到的那一份）。沒設 REPORT_OUTPUT_FOLDER_ID 時就用它的上層資料夾 ——
// 一場演習一份設定檔之後，報告會落在那一場自己的設定檔旁邊，比「腳本剛好綁在
// 哪一份試算表」合理。
function resolveOutputFolder_(cfg, ss) {
  var folder = null;
  if (cfg.outputFolderId) {
    try {
      folder = DriveApp.getFolderById(cfg.outputFolderId);
    } catch (err) {
      throw new Error('找不到輸出資料夾，或這個 Google 帳號沒有它的權限。\n' +
        '請檢查指令碼屬性 ' + PROP_OUTPUT_FOLDER_ + '（資料夾網址 /folders/ 後面那一段），' +
        '或把它清空改用預設位置。\n原始訊息：' + msg_(err));
    }
  } else {
    try {
      var parents = DriveApp.getFileById(ss.getId()).getParents();
      if (parents.hasNext()) folder = parents.next();
    } catch (err2) {
      folder = null;
    }
    if (!folder) {
      try { folder = DriveApp.getRootFolder(); } catch (err3) { folder = null; }
    }
    if (!folder) {
      throw new Error('找不到可用的輸出資料夾。請設定指令碼屬性 ' + PROP_OUTPUT_FOLDER_ + ' 指定一個資料夾。');
    }
  }
  return folder;
}

function probeFolderWritable_(folder) {
  var tmp = null;
  try {
    tmp = folder.createFile(Utilities.newBlob('', 'text/plain', '_報告寫入測試.tmp'));
  } catch (err) {
    throw new Error('輸出資料夾「' + safeName_(folder) + '」無法寫入：' + msg_(err) +
      '\n請確認這個 Google 帳號對該資料夾有「編輯者」權限。');
  }
  try { tmp.setTrashed(true); } catch (err2) {}
  return true;
}

function safeName_(f) {
  try { return f.getName(); } catch (err) { return '（無法讀取名稱）'; }
}

// ===================================================================
// 時間格式
// ===================================================================

function formatGeneratedAt_(iso) {
  var tz = tz_();
  try {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm') + '（' + tz + '）';
  } catch (err) {
    return String(iso || '');
  }
}

// 後端的 exerciseDate 已經是 formatCellValue_ 格式化過的字串（yyyy/MM/dd），
// 但業主也可能在 演習資訊 填「115年6月12日」這種純文字。看起來像日期就重新
// 格式化，不像就原樣輸出 —— 絕不猜，也絕不把看不懂的字串變成空白。
function formatExerciseDate_(raw) {
  var s = String(raw == null ? '' : raw).replace(/^\s+|\s+$/g, '');
  if (!s) return '';
  if (!/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s)) return s;
  try {
    var parts = s.split(/[^0-9]+/);
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return s;
    return Utilities.formatDate(d, tz_(), 'yyyy/MM/dd');
  } catch (err) {
    return s;
  }
}

function makeRunId_() {
  var now = new Date();
  var stamp = Utilities.formatDate(now, tz_(), 'yyyyMMdd-HHmm');
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var rnd = '';
  for (var i = 0; i < 6; i++) rnd += chars.charAt(Math.floor(Math.random() * chars.length));
  return 'R' + stamp + '-' + rnd;
}

// ===================================================================
// 封面 token 替換
// ===================================================================

// 頁首／頁尾是分離的 Body，對 body 呼叫 replaceText 不會影響它們，所以三個
// 容器各做一次（各自 null 檢查）。token 不存在時 replaceText 完全靜默，
// 所以驗證關卡才要先用 findText 確認每個 token 在不在、缺的列成警告。
function applyCoverTokens_(doc, map) {
  var targets = [];
  try { targets.push(doc.getBody()); } catch (err) {}
  try { targets.push(doc.getHeader()); } catch (err2) {}
  try { targets.push(doc.getFooter()); } catch (err3) {}
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    if (!t) continue;
    for (var key in map) {
      if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
      try {
        t.replaceText(tokenPattern_(key), String(map[key] == null ? '' : map[key]));
      } catch (err4) {}
    }
  }
}

function coverTokenMap_(payload, st) {
  var m = payload.meta || {};
  var rowCounts = (payload.analysisRows || []).length + (payload.coverageRows || []).length +
    (payload.learningRows || []).length;
  return {
    '{{機構名稱}}': txt_(m.orgName),
    '{{演習名稱}}': txt_(m.exerciseName || m.displayName),
    '{{演習主題}}': txt_(m.exerciseTopic),
    '{{演習類別}}': txt_(m.exerciseCategory),
    '{{演習日期}}': txt_(formatExerciseDate_(m.exerciseDate)),
    // 儀表板「說明」KPI 卡的同一個值（演習資訊 工作表的「說明」列）。
    '{{演習說明}}': txt_(m.exerciseDesc),
    // fallback 模式下 meta.tenant/exercise 是空字串，絕不填使用者帶進來的
    // 假代號 —— 在紙本報告上印一個其實沒有路由效果的機構代號會誤導判讀。
    '{{機構代號}}': m.tenant ? String(m.tenant) : '—（單一演習模式）',
    '{{演習代號}}': m.exercise ? String(m.exercise) : '—（單一演習模式）',
    '{{評核官人數}}': String((m.evaluatorCodes || []).length),
    '{{資料列數}}': '原始 ' + String(m.recordRowCount || 0) + ' 列／納入統計 ' + rowCounts + ' 題',
    '{{報告產生時間}}': st.generatedAtText,
    '{{報告編號}}': st.runId,
    '{{匿名模式}}': st.identified ? '⚠ 含可識別評核官代號' : '已匿名（評核官 1…N）'
  };
}

// ===================================================================
// 驗證關卡（選單的「檢查設定」與產生流程共用）
// ===================================================================

// 這是「按了沒反應」時唯一的除錯入口：不取得鎖、不建立報告文件、不寫入任何
// 一列評分或快照資料，而且每一關都獨立回報，不會因為第 3 關失敗就看不到第 7
// 關的結果。
//
// ⚠️ 誠實揭露：「完全不寫任何東西」做不到，因為有兩件事只能用實做才驗得出來，
// 用猜的就失去這個入口的意義。這兩件事對話框也會原字說出來：
//   (1) 輸出資料夾寫入權限 —— 建立一個 0 位元組暫存檔再立刻丟進垃圾桶。
//   (2) 圖表能力 —— 在隱藏分頁「_報告暫存」寫入一組假資料、畫一張圖、隨即清空。
// 除此之外不碰任何工作表；「報告快照」在檢查模式下刻意不建立。
// target === undefined → 容器選單模式（「檢查設定」選單項目，ReportDialog 直接
//   呼叫 .reportValidateOnly()，零個引數）。行為與改這一版之前逐字相同。
// target === {...} → 網頁模式（action=reportCheck）。
function reportValidateOnly(target) {
  var checks = [];
  var ok = true;
  function add(label, pass, detail) {
    checks.push({ label: label, ok: !!pass, detail: String(detail || '') });
    if (!pass) ok = false;
  }

  checks.push({
    label: '程式版本', ok: true,
    detail: REPORT_BUILD_ + '　（這份原始碼同時貼在容器綁定專案與獨立部署的報告 Web App；' +
      '兩邊印出來的版本不一樣就是其中一份沒重貼。）'
  });

  var st = target ? readActiveRunFor_(target) : readRunState_();
  if (st && st.status === 'running') {
    var age = Date.now() - Number(st.startedAt || 0);
    add('上一輪執行狀態', age > RUN_STALE_MS_,
      age > RUN_STALE_MS_
        ? '上一輪（' + st.runId + '）停在「產生中」但已超過 15 分鐘，視為中斷，可以重新產生。'
        : '上一輪（' + st.runId + '）正在產生中。請等它完成，或使用選單的「重設產生狀態」。');
  } else {
    add('上一輪執行狀態', true, st && st.runId ? '上一份：' + st.runId + '（' + statusText_(st.status) + '）' : '沒有進行中的產生作業。');
  }

  var cfg = null;
  try {
    cfg = requireConfig_(target);
    add('指令碼屬性', true, (cfg.webMode
        ? '必填項齊備（網頁模式的分析金鑰來自網址，不讀 ' + PROP_ANALYSIS_KEY_ + '）；單次時間預算 '
        : '必填三項齊備；單次時間預算 ') + cfg.budgetMs + ' ms。' +
      (cfg.tenant || cfg.exercise ? '　指定租戶：' + (cfg.tenant || '（空）') + ' / ' + (cfg.exercise || '（空）') : '　未指定租戶（單一演習模式）。'));
  } catch (err) {
    add('指令碼屬性', false, msg_(err));
    return { ok: false, checks: checks };
  }

  // 這一輪要寫 報告快照／_報告暫存 的那份試算表。解析失敗時不要讓後面三關
  // 跟著丟一堆看起來無關的錯誤，而是直接指名原因。
  var ss = null;
  try {
    ss = targetSpreadsheet_(cfg.ssId);
    add('設定試算表', true, '「' + safeName_(ss) + '」可開啟。' +
      (cfg.webMode ? '　（本次的 ' + SNAPSHOT_SHEET_NAME_ + ' 與 ' + TEMP_SHEET_NAME_ + ' 都會寫在這一份。）' : ''));
  } catch (errSs) {
    add('設定試算表', false, msg_(errSs));
  }

  var tpl = null;
  try {
    tpl = openTemplateDoc_(cfg.templateId);
    add('報告範本', true, '可開啟：' + safeName_(tpl.file));
  } catch (err2) {
    add('報告範本', false, msg_(err2));
  }

  var scan = null;
  if (tpl) {
    try {
      // 與產生流程**同一支** scanTemplate_／同一段拒絕訊息，所以
      // 「檢查說沒問題、產生卻失敗」不可能發生（scanAnchors_ 上方那條規則的延伸）。
      scan = scanTemplate_(tpl.doc);
      var refusal = templateRefusalMessage_(scan);
      add('範本模式',
        (scan.mode === 'anchor' || scan.mode === 'fill'),
        scan.mode === 'anchor' ? '章節錨點式（{{SEC_*}}）—— 系統把一整章內容插在每個錨點的位置。'
          : (scan.mode === 'fill' ? '填入式（{{圖_*}}／{{列_*}}）—— 系統只把圖與資料列填進您已經畫好的表格。'
            : refusal));

      if (scan.mode === 'anchor') {
        var foundIds = [];
        var missingOptional = [];
        var missingRequired = [];
        for (var i = 0; i < SECTIONS_.length; i++) {
          var sec = SECTIONS_[i];
          if (scan.anchors.found[sec.id]) foundIds.push(sec.title);
          else if (sec.required) missingRequired.push(sec.token + '（' + sec.title + '）');
          else missingOptional.push(sec.token + '（' + sec.title + '）');
        }
        add('必要章節錨點', missingRequired.length === 0,
          missingRequired.length ? '缺少：' + missingRequired.join('、') : '六個必要錨點齊備。');
        add('錨點位置', scan.anchors.problems.length === 0,
          scan.anchors.problems.length ? scan.anchors.problems.join('　／　') : '所有錨點都單獨占一個本文最上層段落。');
        checks.push({
          label: '將產生的章節', ok: true,
          detail: '共 ' + foundIds.length + ' 章：' + foundIds.join('、') +
            (missingOptional.length ? '　｜　範本未放錨點、因此不產生：' + missingOptional.join('、') : '')
        });
      } else if (scan.mode === 'fill') {
        pushFillChecks_(checks, add, scan);
      }

      // 封面 token（兩種模式都印）。原本這一行寫死「全部 12 個」，加了
      // {{演習說明}} 之後那個數字就會是錯的，所以改成動態計數。
      var coverRequired = COVER_TOKENS_.length - COVER_TOKENS_SILENT_.length;
      var descPresent = !scan.coverSilentMissing;
      checks.push({
        label: '封面 token', ok: true,
        detail: (scan.coverMissing.length
          ? '⚠ 範本裡找不到這些 token（不影響產生，只是這些欄位不會被填）：' + scan.coverMissing.join('、')
          : '全部 ' + coverRequired + ' 個封面 token 都在範本裡。') +
          '　｜　選填：{{演習說明}}' + (descPresent ? '（已放置，會填入 演習資訊 的「說明」）' : '（未放置，略過）')
      });
    } catch (err3) {
      add('範本標記掃描', false, '掃描範本時發生錯誤：' + msg_(err3));
    }
  }

  if (ss) {
    try {
      var folder = resolveOutputFolder_(cfg, ss);
      probeFolderWritable_(folder);
      add('輸出資料夾', true, '「' + safeName_(folder) + '」可寫入（已用 0 位元組暫存檔實測並刪除）。' +
        (cfg.webMode ? '　⚠ 從分析平台產生時，檔案建立在這個 Web App 部署帳號的雲端硬碟裡，' +
          '不是點按鈕那個人的；若開啟後顯示沒有權限，請向系統管理者索取存取權。' : ''));
    } catch (err4) {
      add('輸出資料夾', false, msg_(err4));
    }
  } else {
    add('輸出資料夾', false, '設定試算表解析失敗，無法決定預設輸出位置。');
  }

  var payload = null;
  try {
    payload = fetchAnalysis_(cfg);
    add('取得分析資料', true, 'HTTP 200，JSON 解析成功。');
  } catch (err5) {
    add('取得分析資料', false, msg_(err5));
  }

  if (payload) {
    var m = payload.meta || {};
    // 這是擋住「腳本綁在 A 院的設定表上，金鑰卻把資料路由到 B 院」的唯一一道
    // 防線 —— 那種錯誤產出的 PDF 會印著 A 院的封面與 B 院的分數。
    // 提示要指對地方：網頁模式的代號來自網址，叫人去改 REPORT_TENANT 是錯的。
    var fromWhere = cfg.webMode ? '網址參數 ?t=／&ex=' : '指令碼屬性 ' + PROP_TENANT_ + '／' + PROP_EXERCISE_;
    if (cfg.tenant || cfg.exercise) {
      var tOk = (!cfg.tenant || String(m.tenant || '') === cfg.tenant) &&
        (!cfg.exercise || String(m.exercise || '') === cfg.exercise);
      add('租戶身分比對', tOk, tOk
        ? '後端回的 tenant/exercise 與' + fromWhere + '一致（' + txt_(m.tenant) + ' / ' + txt_(m.exercise) + '）。'
        : '不一致！' + fromWhere + ' 要求 ' + (cfg.tenant || '（空）') + ' / ' + (cfg.exercise || '（空）') +
          '，後端實際回 ' + txt_(m.tenant) + ' / ' + txt_(m.exercise) + '。' +
          (cfg.webMode
            ? '請確認這支報告部署的 ' + PROP_REGISTRY_ID_ + ' 與後端 ConfigWithSubmit.gs 的 REGISTRY_SPREADSHEET_ID 是同一份註冊表。'
            : '請檢查 ' + PROP_ANALYSIS_KEY_ + ' 是否用到了別場演習的金鑰。'));
    } else {
      add('租戶身分比對', true, (cfg.webMode
          ? '這個部署未啟用租戶註冊表，網址上的代號沒有路由效果，'
          : '未設定 ' + PROP_TENANT_ + '／' + PROP_EXERCISE_ + '，') +
        '略過比對（後端 tenantSource=' + txt_(m.tenantSource) + '）。');
    }
    // 比對對象是「這一輪即將寫入 報告快照 的那份試算表」，不是「腳本剛好綁在
    // 哪一份」。網頁模式下這一關因此比以前強：它證明的是「後端讀的檔案 ==
    // 快照要寫進去的檔案」，而不只是「操作者打開了對的試算表」。
    // 仍然維持非失敗的 ⚠ 提示 —— 改過檔名是完全正當的事。
    var activeName = ss ? safeName_(ss) : '';
    checks.push({
      label: '設定檔名稱比對', ok: true,
      detail: !activeName
        ? '無法取得本次目標試算表的名稱，略過比對。'
        : ((m.configFileName && m.configFileName !== activeName)
          ? '⚠ 後端讀的設定檔叫「' + m.configFileName + '」，本次要寫入的試算表叫「' + activeName +
            '」。若只是改過檔名可以忽略；若不是同一份檔案，報告會印出別場演習的數字。'
          : '一致（' + txt_(m.configFileName) + '）。')
    });

    var total = (payload.analysisRows || []).length + (payload.coverageRows || []).length +
      (payload.learningRows || []).length;
    var codes = (m.evaluatorCodes || []).length;
    add('資料非空', total > 0 && codes >= 1, total > 0 && codes >= 1
      ? '三組列數合計 ' + total + ' 題，評核官 ' + codes + ' 人，原始 ' + (m.recordRowCount || 0) + ' 列。'
      : '紀錄表目前沒有可用的評分資料，請確認是否已有評核官送出。');
    checks.push({
      label: '資料量', ok: true,
      detail: total > 400
        ? '⚠ 共 ' + total + ' 題，產生時間會較長，部分章節可能被時間預算跳過（會在附錄C／附錄D 標示）。'
        : '共 ' + total + ' 題，在正常範圍內。'
    });

    var rwg = verifyRwg_(payload);
    checks.push({
      label: 'r_wg 本機驗算', ok: true,
      detail: rwg.note + (rwg.reasons.length ? '　值得注意的題目：' + rwg.reasons.slice(0, 8).join('；') +
        (rwg.reasons.length > 8 ? ' …等 ' + rwg.reasons.length + ' 題' : '') : '')
    });

    // 填入式才印：業主正在手工擺標記，先知道哪一張表會長成幾列，比產生完再
    // 回頭看便宜得多。
    if (scan && scan.mode === 'fill') pushFillPreviewChecks_(checks, scan, payload);
  }

  if (ss) {
    try {
      var cap = chartCapability_(ss);
      // ⚠ 誠實揭露：這一關與上面的「輸出資料夾」是整個檢查流程裡唯二會寫東西的
      // 兩步 —— 它必須真的畫一張圖才知道能不能畫，而畫圖需要一份資料落在某個
      // 工作表上。寫的對象只有隱藏分頁 _報告暫存（固定名稱、跨執行重複使用、
      // 探測完就清空），不會碰任何正式工作表，後端也從不以這個名稱讀取任何分頁。
      // 對話框會把這兩項副作用原字印給業主看。
      // 網頁模式下**要連檔名一起說**：操作者看不到自己正在動哪一份試算表。
      checks.push({
        label: '圖表能力探測', ok: true,
        detail: cap.detail.join('　／　') +
          '　（探測會在試算表「' + safeName_(ss) + '」的隱藏分頁「' + TEMP_SHEET_NAME_ +
          '」寫入並隨即清除一組假資料，不會動到任何正式工作表，也不會建立任何檔案。）'
      });
    } catch (err6) {
      checks.push({ label: '圖表能力探測', ok: true, detail: '探測失敗（' + msg_(err6) + '），圖表將全部改以數值表呈現。' });
    }

    try {
      // createIfMissing=false 不能改。它存在的理由（不要在一場正在進行的演習的
      // 設定檔上長出業主沒要求的新分頁）在 HTTP 這一側只有更強：呼叫端可能是
      // 一位從來沒見過那份試算表的醫院使用者。
      var info = ensureSnapshotSheet_(ss, false);
      if (info.missingSheet) {
        add('報告快照工作表', true, '「' + SNAPSHOT_SHEET_NAME_ +
          '」尚未建立；第一次產生報告時會自動建立（本檢查刻意不建立它）。');
      } else {
        add('報告快照工作表', true, '「' + SNAPSHOT_SHEET_NAME_ + '」欄位齊備，目前 ' +
          Math.max(0, info.sheet.getLastRow() - 1) + ' 列。');
      }
    } catch (err7) {
      add('報告快照工作表', false, msg_(err7));
    }
  } else {
    checks.push({ label: '圖表能力探測', ok: true, detail: '設定試算表解析失敗，未探測。' });
    add('報告快照工作表', false, '設定試算表解析失敗，無法檢查。');
  }

  return { ok: ok, checks: checks };
}

// -------------------------------------------------------------------
// 檢查設定：填入式專屬的幾列
// -------------------------------------------------------------------
//
// 為什麼這幾列值得存在：業主**正在手工把這些標記打進他的手稿裡**，而他一定會
// 打錯其中一個。標記打錯字時什麼都不會發生 —— 那張圖就是沒出現，而他要翻完
// 整份 PDF 才會發現。這幾列就是在產生之前把它說出來。
// 這裡讀的是 scanTemplate_ 的同一份結果，所以與拒絕條件不可能不一致。
function pushFillChecks_(checks, add, scan) {
  var i, lines;

  // 圖片標記
  var imgFound = [], imgMissing = [];
  for (i = 0; i < FILL_IMAGE_TOKENS_.length; i++) {
    var d = FILL_IMAGE_TOKENS_[i];
    if (scan.fill.found[d.id]) imgFound.push(d.token + '（' + d.title + '）');
    else imgMissing.push(d.token + '（' + d.title + '）');
  }
  checks.push({
    label: '圖片標記（{{圖_*}}）', ok: true,
    detail: '找到 ' + imgFound.length + ' / ' + FILL_IMAGE_TOKENS_.length + ' 個：' +
      (imgFound.length ? imgFound.join('、') : '（一個都沒有）') +
      (imgMissing.length ? '　｜　⚠ 範本未放、因此不產生：' + imgMissing.join('、') +
        '（缺圖不是錯誤 —— 您沒有畫框的位置就是您不要的圖）' : '')
  });

  // 資料列標記：每一個都印「目前 N 欄／需要 M 欄」與契約的欄位順序。
  var rowFound = [], rowMissing = [];
  for (i = 0; i < FILL_ROW_TOKENS_.length; i++) {
    var rd = FILL_ROW_TOKENS_[i];
    if (!scan.fill.found[rd.id]) { rowMissing.push(rd.token + '（' + rd.title + '）'); continue; }
    var loc = null;
    for (var k = 0; k < scan.fill.rows.length; k++) {
      if (scan.fill.rows[k].def.id === rd.id) { loc = scan.fill.rows[k]; break; }
    }
    rowFound.push(rd.token + '：所在表格目前 ' + (loc ? loc.numCells : '？') + ' 欄／需要 ' +
      rd.columns.length + ' 欄　欄位順序：' + columnContractText_(rd));
  }
  checks.push({
    label: '資料列標記（{{列_*}}）', ok: true,
    detail: (rowFound.length ? rowFound.join('　／　') : '（一個都沒有）') +
      (rowMissing.length ? '　｜　⚠ 範本未放、因此不產生：' + rowMissing.join('、') : '')
  });

  // 位置／重複／不認得 —— 這三類是真的會擋住產生的。
  lines = [];
  if (scan.fill.unknown.length) lines.push('不認得的標記：' + scan.fill.unknown.join('、'));
  if (scan.fill.duplicates.length) lines.push(scan.fill.duplicates.join('　／　'));
  if (scan.fill.problems.length) lines.push(scan.fill.problems.join('　／　'));
  add('填入式標記的位置與拼字', lines.length === 0,
    lines.length ? lines.join('　／　') : '所有標記都拼寫正確、各出現一次，而且位置合格。');

  // 匿名：識別模式的三道門有一道在這個模式下永遠不成立，報告必須自己說出來，
  // 不能讓操作者以為勾了就有。
  checks.push({
    label: '匿名模式（填入式）', ok: true,
    detail: '填入式範本沒有評核官差異的輸出位置，本次一律匿名；' +
      '勾選「附上可識別的評核官代號」與「附上附錄B」都不會生效。'
  });
}

// 本次各標記預計填入的筆數。0 筆也要印 —— 那一格會變成「（本次沒有可列出的
// 資料）」，業主最好在產生之前就知道。
function pushFillPreviewChecks_(checks, scan, payload) {
  // 這幾支列資料建構器是純函式，只讀 payload／stats／meta／prefix，
  // 不碰文件也不碰試算表，所以在檢查流程裡呼叫是安全的。
  var meta = payload.meta || {};
  var lite = {
    payload: payload, stats: payload.stats || {}, meta: meta,
    prefix: meta.scenePrefix || 'SCENE'
  };
  var parts = [];
  for (var i = 0; i < FILL_ROW_TOKENS_.length; i++) {
    var d = FILL_ROW_TOKENS_[i];
    if (!scan.fill.found[d.id]) continue;
    var n = fillRowData_(d, lite).values.length;
    parts.push(plainToken_(d.token) + '：' + n + ' 列' + (n === 0 ? '（會印「本次沒有可列出的資料」）' : ''));
  }
  var cells = abilityCells_(lite);
  checks.push({
    label: '本次預計填入的列數', ok: true,
    detail: (parts.length ? parts.join('；') : '範本沒有放任何資料列標記。') +
      '　｜　目前 12 個 潛能×4S 交叉格中有 ' + cells.length + ' 格有資料（優勢／待改善前三都從這幾格取，同分同名次全部列入）。'
  });

  // 這個版型裝不下的東西，附上本次的實際筆數。
  checks.push({
    label: '本模式不會產生的內容', ok: true,
    detail: fillModeCoverage_({ payload: payload, stats: payload.stats || {}, meta: meta, st: { runId: '（本次尚未產生）' } }).join('　／　')
  });
}

// ===================================================================
// 產生流程：第一步
// ===================================================================

// 寫入順序鐵則：全部驗證通過，才寫執行狀態 → 寫 報告快照（狀態「產生中」）
// → 複製範本成一份全新 Doc。這一步之前，Drive 上沒有任何新檔案、試算表上
// 沒有任何新列。
//
// 連點兩次不可能覆寫，四重保險：
//   (a) tryLock(0)
//   (b) 執行狀態的 running 檢查
//   (c) 最強的一條 —— 每一輪都複製出一份全新的 Doc（檔名帶報告編號），
//       程式從不寫入任何既有的報告檔案，所以就算鎖與狀態都失效，最壞結果是
//       兩份各自獨立的報告，永遠不會是半份蓋掉一份好的
//   (d) 報告快照 只追加，絕不清空或覆寫既有列
//
// 網頁模式（opts.target）只動其中一條：(a) 的 tryLock(0) 換成「短鎖 + 每場次
// 一個 REPORT_ACTIVE_<醫院>/<演習> 標記」。LockService 的鎖是**整個專案**共用的，
// 在 HTTP 入口下會讓 A 院產報告時 B 院直接失敗，而且一握就是一次呼叫的六分鐘。
// (b) 改成逐場次判斷，(c)(d) 原封不動 —— 最壞情況仍然是兩份各自獨立的完整報告，
// 永遠不會是半份蓋掉一份好的。
function reportStart(opts) {
  var lock = null;
  var st = null;
  var ss = null;
  var target = (opts && opts.target) || null;
  var activeKey = target ? activeMarkerKey_(target) : '';
  var runId = '';
  var claimed = false;
  try {
    opts = opts || {};

    if (target) {
      // 先掃掉過期的執行狀態：(1) 屬性額度（一輪約 8KB／專案約 500KB），
      // (2) 卡在「產生中」的快照列要在這裡被標成「中斷」—— 但**只掃同一場次**，
      //     絕不去動別家醫院飛行中的列。
      sweepStaleRuns_(target);
      lock = briefLock_();
      var live = readActiveRunFor_(target);
      if (live && live.status === 'running' &&
          (Date.now() - Number(live.startedAt || 0)) < RUN_STALE_MS_) {
        var busy = reportError_('這場演習已經有一份報告正在產生中（編號 ' + live.runId + '）。\n' +
          (live.docUrl ? '文件連結：' + live.docUrl + '\n' : '') +
          '請等它完成，或在產生面板按「捨棄這一輪」之後再試一次。', 'REPORT_BUSY');
        // 把「是哪一輪」帶在錯誤物件上，failure_ 會把它放進回應的 runId。
        // 不這樣做的話回應的 runId 是空的（st 此時還不存在），分析平台就給不出
        // 「查看那一輪的狀態」那顆按鈕 —— 而那正是這個分支唯一能提供的動作。
        busy.liveRunId = live.runId || '';
        busy.liveDocUrl = live.docUrl || '';
        throw busy;
      }
      // 在這裡就先占位：報告編號要等驗證做完才有意義，但「這場次有人在跑」
      // 必須在任何驗證之前就成立，否則連點兩下會有兩輪同時通過檢查。
      runId = makeRunId_();
      writeActiveMarker_(activeKey, runId);
      claimed = true;
      releaseLock_(lock);
      lock = null;
    } else {
      lock = acquireLock_();
      var prev = readRunState_();
      if (prev && prev.status === 'running' && (Date.now() - Number(prev.startedAt || 0)) < RUN_STALE_MS_) {
        throw new Error('上一輪報告（編號 ' + prev.runId + '）仍在產生中。\n' +
          (prev.docUrl ? '文件連結：' + prev.docUrl + '\n' : '') +
          '請等它完成，或使用選單的「' + MENU_TITLE_ + ' → 重設產生狀態」之後再試一次。');
      }
    }

    var cfg = requireConfig_(target);

    // 識別模式三道門，缺一不可：勾選、二次確認、範本有 {{SEC_評核官差異}} 錨點。
    // commit 54b33dd 刻意把具名逐評核官分數表從儀表板上拿掉，方案B 不得成為
    // 繞過它的後門，所以伺服器端自己也要檢查一次，不能只信任對話框。
    var identified = opts.identified === true && opts.identifiedConfirmed === true;
    if (opts.identified === true && opts.identifiedConfirmed !== true) {
      throw new Error('識別模式需要二次確認。請重新勾選「附上可識別的評核官代號」並在確認視窗按下確定。');
    }

    var tpl = openTemplateDoc_(cfg.templateId);
    // 範本模式在這裡判定一次，之後整輪都讀 st.mode，不再重判。
    // 位置與 assertRequiredAnchors_ 原本那一行完全相同：仍然在 targetSpreadsheet_、
    // resolveOutputFolder_、fetchAnalysis_、ensureSnapshotSheet_、makeCopy 之前，
    // 所以任何拒絕都發生在 Drive 上出現第一個檔案、試算表上出現第一列之前。
    var scan = scanTemplate_(tpl.doc);
    assertTemplateUsable_(scan);
    var fillMode = (scan.mode === 'fill');

    // 識別模式的第三道門在填入式裡**永遠不成立**：那種範本沒有
    // {{SEC_評核官差異}}，也沒有任何逐評核官資料的輸出位置。所以一律降級為匿名，
    // 而且降級訊息要講填入式的話 —— 叫業主去找一個在這種範本裡不可能存在的錨點，
    // 正是「給錯提示比不給提示更糟」那條教訓。
    if (identified && !(scan.mode === 'anchor' && scan.anchors.found.EVALUATOR)) {
      identified = false;
      opts.identifiedDowngraded = true;
      opts.identifiedDowngradedFill = fillMode;
    }

    // 這一輪要寫 報告快照／_報告暫存 的那份試算表。網頁模式下它是註冊表那一列
    // 的 設定試算表ID；選單模式下就是容器。**在複製範本之前**解析，理由同下面
    // ensureSnapshotSheet_ 那一行：任何「開不起來」都要在 Drive 上出現第一個
    // 檔案之前擋下來。
    ss = targetSpreadsheet_(cfg.ssId);

    var folder = resolveOutputFolder_(cfg, ss);
    probeFolderWritable_(folder);

    var payload = fetchAnalysis_(cfg);
    var meta = payload.meta || {};

    // 提示要指對地方：選單模式的代號來自指令碼屬性，網頁模式來自網址參數。
    // 在網頁模式下叫人去改 REPORT_TENANT，正好是把人送去檢查唯一不相干的東西。
    var whoSet = cfg.webMode ? '網址參數 ?t=' : '指令碼屬性 ' + PROP_TENANT_;
    var whoSetEx = cfg.webMode ? '網址參數 &ex=' : '指令碼屬性 ' + PROP_EXERCISE_;
    var keyHint = cfg.webMode
      ? '這通常表示租戶註冊表那一列的 ' + REG_CONFIGID_ALIASES_[0] + '／' + REG_KEY_ALIASES_[0] +
        ' 與後端解析出來的不是同一場（兩邊的註冊表可能不是同一份）。'
      : '這通常表示 ' + PROP_ANALYSIS_KEY_ + ' 用到了別場演習的金鑰。';
    if (cfg.tenant && String(meta.tenant || '') !== cfg.tenant) {
      throw new Error('租戶身分不符：' + whoSet + ' 要求「' + cfg.tenant +
        '」，但後端回傳的是「' + txt_(meta.tenant) + '」。\n' + keyHint +
        '已中止，以免產出「封面是這一院、分數是另一院」的報告。');
    }
    if (cfg.exercise && String(meta.exercise || '') !== cfg.exercise) {
      throw new Error('演習身分不符：' + whoSetEx + ' 要求「' + cfg.exercise +
        '」，但後端回傳的是「' + txt_(meta.exercise) + '」。已中止。');
    }

    var totalRows = (payload.analysisRows || []).length + (payload.coverageRows || []).length +
      (payload.learningRows || []).length;
    if (totalRows === 0 || (meta.evaluatorCodes || []).length < 1) {
      throw new Error('紀錄表目前沒有可用的評分資料，請確認是否已有評核官送出。');
    }

    ensureSnapshotSheet_(ss); // 欄位不符要在建立任何檔案之前就擋下來。

    if (!runId) runId = makeRunId_();
    var startedAt = Date.now();
    st = {
      runId: runId,
      // 範本模式。⚠️ 它也必須出現在 writeRunState_ 的最小退路 JSON 裡 ——
      // 少了它，一輪在屬性寫入失敗之後續跑時會退回 anchor，開始往業主的手稿裡
      // 插 21 章。
      mode: scan.mode,
      fillInflight: '',
      // 網頁模式一輪一格屬性；選單模式 propKey 為空 → 仍是單一 REPORT_RUN_STATE。
      propKey: target ? (PROP_RUN_PREFIX_ + runId) : '',
      webMode: !!target,
      // runToken 只在 reportStart 的回應裡出現一次，之後任何回應都不再帶它。
      // 這是真正擋住「第二個瀏覽器接手別人那一輪」的那一層 —— 報告編號不是
      // 秘密（它印在封面、檔名與 報告快照 的「報告編號」欄裡）。
      runToken: target ? makeRunToken_() : '',
      hid: target ? String(target.hid || '') : '',
      exid: target ? String(target.exid || '') : '',
      // 目標試算表凍結在這裡。之後每一次 HTTP 呼叫都用這個 ID 重新開檔、
      // **不再讀註冊表** —— 否則產生到一半有人改了註冊表，第七章會落到跟
      // 第三章不同的試算表裡（與「各章節必須來自同一次資料快照」同一條規則）。
      ssId: (function () { try { return ss.getId(); } catch (errGid) { return cfg.ssId || ''; } })(),
      folderName: safeName_(folder),
      busyUntil: 0,
      status: 'running',
      startedAt: startedAt,
      startedAtText: Utilities.formatDate(new Date(startedAt), tz_(), 'yyyy-MM-dd HH:mm'),
      generatedAtText: formatGeneratedAt_(meta.generatedAt),
      fingerprint: fingerprint_(payload),
      identified: identified,
      includeComments: opts.includeComments !== false,
      includeAppendixB: opts.includeAppendixB === true,
      warnings: [],
      skipped: [],
      queue: [],
      unwritten: [],
      aborting: false,
      doneCount: 0,
      totalCount: 0,
      docId: '',
      docUrl: '',
      pdfId: '',
      pdfUrl: '',
      chunkCount: 0,
      snapStartRow: 0,
      snapCount: 0,
      snapStatusCol: 0,
      cap: null,
      rwgNote: ''
    };

    // ⚠️ 在附錄C 會印出來的警告裡**不要寫出完整的 {{…}}**，用 plainToken_ 去掉大括號。
    // 附錄C 是章節階段寫的，而收尾階段第 4 步會掃整份文件找殘留的 {{…}} ——
    // 警告文字裡的 token 會被自己的掃描當成「範本沒替換掉的殘留」抓出來，
    // 於是報告警告自己剛寫進去的東西。
    // 2026-10-09 就是這樣：警告同時列出 {{機構名稱 }}（業主真的打錯的）和
    // {{機構名稱}}（上一則警告自己印進去的），而業主在範本裡只找得到前者，
    // 完全無法判斷第二個是哪來的。
    // （收尾階段才加的警告不受影響 —— 第 4b 步在掃描之後，而且每次都是全新複本。）
    if (opts.identifiedDowngraded) {
      addWarning_(st, opts.identifiedDowngradedFill
        ? '這份範本是填入式（您自己的報告版型），沒有評核官差異的輸出位置，識別模式無處可放，已自動改回匿名模式。'
        : '範本缺少 ' + plainToken_('{{SEC_評核官差異}}') + ' 錨點，識別模式無處輸出，已自動改回匿名模式。');
    }
    if (scan.coverMissing.length) {
      addWarning_(st, '範本缺少封面 token：' + plainTokens_(scan.coverMissing).join('、') + '（這些欄位不會被填）。');
    }
    if (totalRows > 400) {
      addWarning_(st, '資料量較大（' + totalRows + ' 題），產生時間會較長，部分章節可能被時間預算跳過。');
    }
    if (String(meta.tenantSource || '') === 'fallback' && (cfg.tenant || cfg.exercise)) {
      addWarning_(st, '後端 tenantSource 為 fallback，指定的租戶代號沒有實際路由效果（註冊表尚未啟用）。');
    }
    if (target && target.registryOff && (target.requestedHid || target.requestedExid)) {
      addWarning_(st, '這個報告部署未啟用租戶註冊表，網址帶的機構／演習代號沒有路由效果，' +
        '本報告的資料與輸出位置都來自指令碼屬性設定的那一場。');
    }

    var rwg = verifyRwg_(payload);
    st.rwgNote = rwg.note;
    // 指路要指到這個模式真的有的那一節。填入式沒有第四章、也沒有附錄C，
    // 而這則警告會被印進文件最後的「報告產生紀錄」—— 叫讀者去翻一個不存在的
    // 章節，就是這個檔案一再付代價的「給錯提示比不給提示更糟」。
    if (!rwg.match) addWarning_(st, 'r_wg 本機驗算與後端數值不一致，兩個數字都會印在' +
      (fillMode ? '文件最後的「' + FILL_RECORD_TITLE_ + '」' : '第四章與附錄C') + '。');

    st.cap = chartCapability_(ss);
    if (!st.cap.column) addWarning_(st, '本環境無法產生內嵌圖表，所有圖表將改以數值表呈現。');
    if (!st.cap.radar) addWarning_(st, '本環境的雷達圖不可用，雷達圖章節將改以直條圖呈現相同數值。');

    // ---- 以下才開始真的寫東西 ----
    var snap = appendSnapshot_(ss, payload, runId, st.generatedAtText);
    st.snapStartRow = snap.startRow;
    st.snapCount = snap.count;
    st.snapStatusCol = snap.statusCol;
    // 每產生一個「Drive 或試算表上看得到的痕跡」就立刻把執行狀態落地。
    // 不這樣做的話，接下來任何一步丟錯（複製範本、插橫幅、替換 token、
    // saveAndClose）都會讓業主手上多出一疊狀態停在「產生中」的快照列、
    // 甚至一份孤兒 Doc，而「開啟上一份報告」卻回答「尚未產生過報告」，
    // 沒有任何東西把那些殘留物連回這一輪。寫屬性很便宜，孤兒檔案很貴。
    writeRunState_(st);

    var baseName = runId + ' ' + (meta.displayName || meta.orgName || '演習評核') + ' 評核報告';
    var copyFile;
    try {
      copyFile = tpl.file.makeCopy(baseName + WIP_SUFFIX_, folder);
    } catch (errCopy) {
      throw new Error('無法複製報告範本：' + msg_(errCopy) +
        '\n請確認這個 Google 帳號對範本有「檢視」以上權限、對輸出資料夾有「編輯」權限。');
    }
    st.docId = copyFile.getId();
    st.docUrl = 'https://docs.google.com/document/d/' + st.docId + '/edit';
    st.baseName = baseName;
    writeRunState_(st); // 文件一存在就記下來（理由同上）。

    var doc = DocumentApp.openById(st.docId);
    // 草稿橫幅：若這一輪被瀏覽器關掉，這份文件自己說得出「我還沒寫完」。
    try {
      doc.getBody().insertParagraph(0, DRAFT_BANNER_);
    } catch (errBanner) {
      addWarning_(st, '無法插入草稿橫幅：' + msg_(errBanner));
    }
    applyCoverTokens_(doc, coverTokenMap_(payload, st));

    var plan = fillMode ? planFillSlots_(scan.fill) : planFromScan_(scan.anchors, opts);
    st.queue = plan;
    // 附錄D 要能說出「範本沒放錨點、所以沒產生」是哪幾章，而 queue 會被逐章
    // shift 掉，所以另外留一份完整的章節清單。
    st.plannedIds = plan.slice();
    st.totalCount = plan.length;
    doc.saveAndClose();

    st.chunkCount = cachePayload_(runId, payload);
    if (!st.chunkCount) {
      addWarning_(st, '無法把分析資料存進快取，之後每個步驟都會重新向後端取一次（會比較慢，但資料一致性由指紋把關）。');
    }
    writeRunState_(st);

    return progress_(st, '已建立報告文件、寫入 ' + st.snapCount + ' 列快照', false);
  } catch (err) {
    // 若已經寫過快照（亦即錯誤發生在「開始真的寫東西」之後），把那一段的狀態欄
    // 標成「中斷」並留下執行紀錄 —— 與 reportContinue 的 catch 同一套處理。
    // 沒有這一段的話，失敗會留下一批永遠停在「產生中」的列，而下一輪的對帳
    // 完全分不出那是這次的殘留還是另一輪正在跑。
    try {
      if (st && st.runId && st.snapStartRow) {
        st.status = 'failed';
        st.busyUntil = 0;
        addWarning_(st, '產生中斷：' + msg_(err));
        writeRunState_(st);
        // ⚠️ 這裡**不可以**退回 SpreadsheetApp.getActive()：在獨立部署裡它回
        // null，updateSnapshotStatus_ 會在第一行就丟錯、被自己的 try 吞掉，
        // 於是這一輪的快照列永遠停在「產生中」—— 正是這一段存在要防的殘留。
        // ss 一定已經解析好了：st.snapStartRow 只有在 appendSnapshot_(ss, …)
        // 成功之後才會是非零。
        updateSnapshotStatus_(ss || targetSpreadsheet_(st.ssId), st.snapStartRow, st.snapCount,
          st.snapStatusCol, '中斷');
      }
    } catch (err2) {}
    // 占了位子卻沒跑起來，就要把位子還回去，否則這一場要等 15 分鐘才解得開。
    try { if (claimed && activeKey) clearActiveMarker_(activeKey, runId); } catch (err3) {}
    return failure_(err, (st && st.runId) ? st : null);
  } finally {
    releaseLock_(lock);
  }
}

// ===================================================================
// 產生流程：後續步驟
// ===================================================================

function sectionById_(id) {
  for (var i = 0; i < SECTIONS_.length; i++) {
    if (SECTIONS_[i].id === id) return SECTIONS_[i];
  }
  return null;
}

// 進度標籤、附錄D 的標題、以及收尾第 1 步的「未產生」標示都走這裡，
// 所以它必須同時認得錨點式的章節 id 與填入式的 slot id。
function titleOf_(id) {
  var s = sectionById_(id);
  if (s) return s.title;
  var f = fillDefById_(id);
  if (f) return f.title;
  return id;
}

// 這一輪「最後才寫」的清單。填入式沒有附錄C／附錄D，它的對應物是產生紀錄。
function tailIdsFor_(st) {
  return (st && st.mode === 'fill') ? FILL_TAIL_IDS_ : LAST_WRITTEN_SECTIONS_;
}

// 每一次 google.script.run 都是一次獨立執行，各有自己的六分鐘額度。
// 這裡在寫下一章之前檢查本次呼叫已經用掉多少時間，超出預算就結束這次呼叫、
// 回 done:false，由對話框再發一次。**至少寫一章**才檢查預算，否則預算設太小
// 時會變成永遠在來回而不前進。
//
// ⚠️ 第二個參數 target 是後加的，而 ReportDialog.html 呼叫
// `.reportContinue(state.runId)` 只傳一個引數 —— 所以 target === undefined
// 就是容器選單模式，那個檔案一個字都不用改。
//
// HTTP 重試是安全的，靠的是 openCursor_ 的 BEGIN 標記不變式（見該函式上方的
// 註解）：重試時若 BEGIN 標記還在，就先刪掉標記到錨點之間的殘留再重寫；若連
// 錨點都不在了，代表那一章已經寫完、直接跳過。沒有這條不變式，一次網路抖動
// 就會讓某一章在文件裡出現兩遍，所以前端對 reportContinue 的網路錯誤可以、
// 也應該用同一組 runId+runToken 重試一次。
function reportContinue(runId, target) {
  var lock = null;
  var st = null;
  try {
    if (target) {
      // 網頁模式：短鎖只罩「讀—驗—標記飛行中—寫」這一小段，立刻放掉。
      st = beginWebStep_(runId, target);
    } else {
      lock = acquireLock_();
      st = readRunState_();
      if (!st || !st.runId) {
        throw new Error('找不到進行中的產生作業（可能已被「重設產生狀態」清除）。請重新產生一份報告。');
      }
      if (runId && st.runId !== runId) {
        throw new Error('執行紀錄的報告編號（' + st.runId + '）與對話框的（' + runId +
          '）不符，可能有另一輪產生作業插進來了。請重新產生一份報告。');
      }
    }
    if (st.status !== 'running') {
      return progress_(st, '這一輪已經結束（' + statusText_(st.status) + '）', true);
    }

    var cfg = requireConfig_(target);
    var payload = loadPayloadForStep_(st, cfg);
    var ctx = buildContext_(st, payload, cfg);

    var doc;
    try {
      doc = DocumentApp.openById(st.docId);
    } catch (errOpen) {
      throw new Error('無法開啟這一輪的報告文件（可能被刪除或移到垃圾桶）：' + msg_(errOpen) +
        '\n請用選單的「重設產生狀態」之後重新產生一份。');
    }

    var stepStart = Date.now();
    var wrote = [];
    var aborted = false;
    while (st.queue.length) {
      // 跨步驟總預算：超過就不再寫新章節。
      //
      // ⚠️ 不可以直接收尾。附錄C／附錄D 的寫入順序被刻意排到最後（它們的內容
      // 是「這一輪發生了什麼」的總結），所以「剩下的章節全部放棄」會優先犧牲掉
      // 正好是唯一會說出「這份報告不完整、哪幾章沒產生、圖表降級成什麼樣」的
      // 那兩章，讀者只剩封面橫幅與檔名後綴可以察覺。
      // 作法：把這兩章留在佇列裡、其餘移進 st.unwritten（收尾時就地標示），
      // 然後**結束這一次呼叫**，由對話框再發一次 —— 下一次呼叫有全新的六分鐘
      // 額度，兩章附錄用不到幾秒，不必在已經逼近上限的這一次裡硬擠。
      if (!st.aborting && (Date.now() - Number(st.startedAt || 0)) > TOTAL_BUDGET_MS_) {
        var keep = [], drop = [];
        var tailIds = tailIdsFor_(st);
        for (var qi = 0; qi < st.queue.length; qi++) {
          if (tailIds.indexOf(st.queue[qi]) === -1) drop.push(st.queue[qi]);
          else keep.push(st.queue[qi]);
        }
        if (drop.length) {
          st.aborting = true;
          st.unwritten = (st.unwritten || []).concat(drop);
          // 在這裡就記進 skipped，而不是等收尾 —— 附錄D 印的就是 skipped，
          // 而附錄D 會在收尾**之前**被寫出來。
          for (var di = 0; di < drop.length; di++) {
            addSkipped_(st, titleOf_(drop[di]), '時間預算用盡，未產生');
          }
          addWarning_(st, '已超過跨步驟總時間預算，' + drop.length +
            (st.mode === 'fill' ? ' 個區塊未產生；仍會補上文件最後的「' + FILL_RECORD_TITLE_ + '」以記錄這件事。'
              : ' 章未產生；仍會補上附錄C／附錄D 以記錄這件事。'));
          st.queue = keep;
          if (!keep.length) { aborted = true; break; }
          continue; // 以保留的附錄章節重跑迴圈（下面的逐步預算會讓它結束這次呼叫）。
        }
        // drop 為空＝只剩附錄C／附錄D。那兩章只是在記錄「這一輪發生了什麼」，
        // 很便宜，直接寫完；為此把報告標成「部分完成」反而是錯的描述。
      }
      if (wrote.length && (Date.now() - stepStart) > cfg.budgetMs) break;
      var id = st.queue[0];
      // 單一章節自己的截止時間（第九章會逐群檢查它）。
      ctx.deadline = stepStart + cfg.budgetMs;
      // 填入式走平行的寫入器，不是在 writeSection_ 裡加 if —— 錨點式那條路
      // （已經產出過真實報告的那一條）因此一個位元都沒變。
      if (st.mode === 'fill') writeFillSlot_(doc, id, ctx);
      else writeSection_(doc, id, ctx);
      st.queue.shift();
      st.doneCount++;
      wrote.push(titleOf_(id));
    }

    var finished = false;
    var partialRun = aborted || st.aborting === true;
    var label = wrote.length ? ('已完成：' + wrote.join('、')) : '沒有章節需要產生';
    if (!st.queue.length || aborted) {
      finalizeReport_(doc, st, ctx, partialRun);
      finished = true;
      label = partialRun ? '已收尾（部分完成）' : '已完成並匯出 PDF';
    } else {
      try { doc.saveAndClose(); } catch (errSave) {}
    }
    st.busyUntil = 0; // 這一次 HTTP 呼叫結束了，放掉「飛行中」旗標。
    writeRunState_(st);
    return progress_(st, label, finished);
  } catch (err) {
    if (st && st.runId && st.status === 'running') {
      st.status = 'failed';
      st.busyUntil = 0;
      addWarning_(st, '產生中斷：' + msg_(err));
      try { writeRunState_(st); } catch (err2) {}
      try {
        // 同 reportStart 的 catch：絕不退回 getActive()（獨立部署裡它是 null，
        // 整段會被自己的 try 吞掉，留下一批停在「產生中」的快照列）。
        // ctx 可能在建構時就失敗了，所以還要能從執行狀態裡的 ssId 重開。
        updateSnapshotStatus_((ctx && ctx.ss) ? ctx.ss : targetSpreadsheet_(st.ssId),
          st.snapStartRow, st.snapCount, st.snapStatusCol, '中斷');
      } catch (err3) {}
    }
    return failure_(err, st);
  } finally {
    releaseLock_(lock);
  }
}

function buildContext_(st, payload, cfg) {
  // ⚠️ 每一次呼叫都從**執行狀態裡凍結的 ssId** 重開，不從註冊表重新解析。
  // ctx.ss 有三個下游：繪圖暫存分頁（tempSheet_）、第三章的 readLocalCriteria_
  // （評分標準），以及 finalizeReport_ 的 updateSnapshotStatus_。
  // 行為改變值得講明白：第三章的評分尺度從此來自「該場演習自己的設定檔」，
  // 不再是「腳本剛好綁在哪一份」；設定檔被複製時忘了帶 評分標準 分頁的場次，
  // 會拿到 readLocalCriteria_ 既有的那句錯誤說明，而不是別場的尺度。
  var ss = targetSpreadsheet_(st.ssId);
  var meta = payload.meta || {};
  var ctx = {
    st: st,
    ss: ss,
    cfg: cfg,
    payload: payload,
    meta: meta,
    stats: payload.stats || {},
    identified: !!st.identified,
    includeComments: st.includeComments !== false,
    includeAppendixB: st.includeAppendixB === true,
    anonMap: buildAnonMap_(meta.evaluatorCodes),
    cap: st.cap || { column: false, radar: false, detail: [] },
    prefix: meta.scenePrefix || 'SCENE',
    rwg: verifyRwg_(payload),
    deadline: Date.now() + cfg.budgetMs,
    tempSheet: null
  };
  ctx.warn = function (text) { addWarning_(st, text); };
  ctx.skip = function (title, reason) { addSkipped_(st, title, reason); };
  try {
    ctx.tempSheet = tempSheet_(ss);
  } catch (err) {
    ctx.cap = { column: false, radar: false, detail: ['暫存工作表不可用：' + msg_(err)] };
  }
  return ctx;
}

// 一章寫壞了不可以讓整輪死掉：把錯誤印在那一章裡、記進 warnings 與附錄D，
// 然後繼續下一章。一份少了一章但自己說出來的報告，遠好過一個紅色錯誤框。
function writeSection_(doc, id, ctx) {
  var sec = sectionById_(id);
  if (!sec) return;
  var cursor = null;
  try {
    cursor = openCursor_(doc, id, sec.token);
  } catch (err) {
    ctx.warn(sec.title + '：無法定位章節錨點（' + msg_(err) + '），本章未產生。');
    ctx.skip(sec.title, '錨點定位失敗：' + msg_(err));
    return;
  }
  if (!cursor) return; // 錨點已不在 = 這一章先前已經寫完，重試時直接跳過。
  try {
    buildSection_(id, cursor, ctx);
  } catch (err2) {
    try {
      para_(cursor, '⚠ 本節在產生時發生錯誤：' + msg_(err2) +
        '　同一批數字已經寫進本試算表的「' + SNAPSHOT_SHEET_NAME_ + '」工作表，請由該處查閱。');
    } catch (err3) {}
    ctx.warn(sec.title + '：產生失敗（' + msg_(err2) + '）。');
    ctx.skip(sec.title, msg_(err2));
  }
  try {
    closeCursor_(cursor);
  } catch (err4) {
    ctx.warn(sec.title + '：清除錨點標記失敗（' + msg_(err4) + '），文件裡可能殘留 {{ }} 字樣。');
  }
}

// 收尾固定順序：移除殘留錨點與 BEGIN 標記 → 移除草稿橫幅 → 改名 →
// doc.saveAndClose() → 才 getAs('application/pdf')。
// 沒有先 saveAndClose 就匯出會得到舊版或空白的 PDF，這是這條路上最經典的陷阱。
function finalizeReport_(doc, st, ctx, aborted) {
  var body = null;
  try { body = doc.getBody(); } catch (err) { body = null; }

  // 1) 還沒寫的章節：錨點就地換成一句說明。一份不完整的報告必須在封面、
  //    檔名、附錄三處都自己說出來，不能只是少了一章。
  //    st.unwritten 是「總預算用盡時被讓出位置的章節」—— 它們在被讓出的當下
  //    就已經記進 skipped（附錄D 比收尾早寫），所以這裡只補標錨點、不重複記。
  var deferred = (st.unwritten || []).slice();
  var remaining = (st.queue || []).slice();
  var all = remaining.concat(deferred);
  var fillMode = (st.mode === 'fill');
  if (body) {
    for (var i = 0; i < all.length; i++) {
      // ⚠️ body.replaceText **會走訪表格**，所以一個沒輪到的 {{圖_*}}／{{列_*}}
      // 不論躲在哪一格都會被就地換掉。這也正是 applyCoverTokens_ 不必為了
      // {{演習說明}} 落在手稿的儲存格裡而加任何一行程式的原因。
      var def = fillMode ? fillDefById_(all[i]) : sectionById_(all[i]);
      if (!def) continue;
      if (def.token) {
        try {
          body.replaceText(tokenPattern_(def.token), '（本節未產生：產生程序依時間預算中止）');
        } catch (err2) {}
      }
      if (i < remaining.length) ctx.skip(def.title, '時間預算用盡，未產生');
    }
    // 2) 殘留的 BEGIN 標記（上一次寫到一半留下的）。
    //    填入式從不建立 BEGIN 標記（它不用 openCursor_），所以整段跳過。
    if (!fillMode) {
      for (var j = 0; j < SECTIONS_.length; j++) {
        try { removeParagraphByText_(body, beginMarker_(SECTIONS_[j].id)); } catch (err3) {}
      }
    }
  }

  var partial = aborted || all.length > 0;

  // 3) 草稿橫幅：完成才移除，部分完成時刻意留著。
  if (body && !partial) {
    try { removeParagraphByText_(body, DRAFT_BANNER_); } catch (err4) {}
  } else if (body && partial) {
    try {
      // 指路要指到這個模式真的有的那一節：填入式沒有附錄D，它的對應物是文件
      // 最後自動附加的「報告產生紀錄」。叫讀者去翻一個不存在的附錄，就是這個
      // 檔案一再付代價的那種「錯誤提示比沒有提示更糟」。
      body.replaceText(tokenPattern_(DRAFT_BANNER_),
        '草稿 — 產生未完成（本報告有 ' + all.length + ' 節未產生，詳見' +
        (fillMode ? '文件最後的「' + FILL_RECORD_TITLE_ + '」' : '附錄D') + '，請勿分發）');
    } catch (err5) {}
  }

  // 4) 殘留的 {{ 掃描：token 打錯字時 replaceText 完全靜默，PDF 上就會留著
  //    一串 {{機構名稱}}。這一關是最後一次抓到它的機會。
  //    改成「列出實際殘留的 token、並扣掉刻意不填的那幾個」：原本只做
  //    findText('\\{\\{') 的存在性判斷，於是 {{報告版次}} 讓它每次都響（見
  //    OWNER_FILLED_TOKENS_ 的註解），而且就算真的響了也不說是哪一個。
  if (body) {
    try {
      var leftovers = leftoverTokens_(doc);
      var unexpected = [];
      for (var li = 0; li < leftovers.length; li++) {
        if (OWNER_FILLED_TOKENS_.indexOf(leftovers[li].text) === -1) {
          unexpected.push(describeLeftover_(leftovers[li]));
        }
      }
      if (unexpected.length) {
        addWarning_(st, '文件裡有未被替換的 token：' + unexpected.join('、') +
          '　範本把 token 打錯字時 replaceText 是完全靜默的，會原樣印在 PDF 上。');
      }
    } catch (err6) {}
  }

  // 4b) 附錄C 是在章節階段產生的，但上面第 3、4 步的警告是收尾階段才加的 ——
  //     它們**永遠**趕不上附錄C。2026-10-09 的實測正是如此：對話框顯示兩則警告，
  //     報告裡只記了一則。而委員會看到的是報告，不是對話框；對話框一關就沒了。
  //     交付物漏記已知瑕疵，比位置不漂亮嚴重得多，所以補在文件最後。
  if (body) {
    try {
      var printed = st.warningsPrintedCount || 0;
      var late = (st.warnings || []).slice(printed);
      if (late.length) {
        var tail = { body: body, index: body.getNumChildren() };
        // 兩種模式的「前一節叫什麼」不同：錨點式是附錄C，填入式是產生紀錄。
        var printedIn = fillMode ? FILL_RECORD_TITLE_ : '附錄C';
        heading_(tail, printedIn + ' 補記：產生收尾階段的警告', 2);
        para_(tail, '以下警告在' + printedIn + ' 產生之後才發生，因此沒有列在上面那一節裡。');
        for (var lw = 0; lw < late.length; lw++) bullet_(tail, late[lw]);
        st.warningsPrintedCount = st.warnings.length;
      }
    } catch (err6b) {}
  }

  // 5) 改名。
  var finalName = (st.baseName || st.runId) + (partial ? PARTIAL_SUFFIX_ : '');
  try {
    doc.setName(finalName);
  } catch (err7) {
    try { DriveApp.getFileById(st.docId).setName(finalName); } catch (err8) {}
  }

  // 6) 存檔關閉，之後這個 doc 物件就不能再用了。
  try {
    doc.saveAndClose();
  } catch (err9) {
    addWarning_(st, '文件存檔時發生問題：' + msg_(err9));
  }

  // 7) 匯出 PDF。
  try {
    var file = DriveApp.getFileById(st.docId);
    var blob = file.getAs('application/pdf').setName(finalName + '.pdf');
    var folder = resolveOutputFolder_(ctx.cfg, ctx.ss);
    var pdf = folder.createFile(blob);
    st.pdfId = pdf.getId();
    st.pdfUrl = 'https://drive.google.com/file/d/' + st.pdfId + '/view';
  } catch (errPdf) {
    addWarning_(st, '無法匯出 PDF：' + msg_(errPdf) +
      '　Google 文件本身已經產生完成，可以直接在文件裡用「檔案 → 下載 → PDF」匯出。');
  }

  st.status = partial ? 'partial' : 'done';
  st.queue = [];
  st.aborting = false;
  updateSnapshotStatus_(ctx.ss, st.snapStartRow, st.snapCount, st.snapStatusCol,
    partial ? '部分完成' : '完成');
}

function progress_(st, label, done) {
  return {
    ok: true,
    runId: st.runId,
    step: st.doneCount || 0,
    totalSteps: st.totalCount || 0,
    label: String(label || ''),
    done: !!done,
    status: st.status,
    identified: !!st.identified,
    warnings: (st.warnings || []).slice(),
    docUrl: st.docUrl || '',
    pdfUrl: st.pdfUrl || ''
  };
}

function failure_(err, st) {
  return {
    ok: false,
    // st 為 null 時仍可能知道「是哪一輪擋住的」（REPORT_BUSY 會把它掛在錯誤物件
    // 上）。選單模式永遠不會設 liveRunId，所以這一項對那條路是死碼。
    runId: st ? st.runId : ((err && err.liveRunId) || ''),
    step: st ? (st.doneCount || 0) : 0,
    totalSteps: st ? (st.totalCount || 0) : 0,
    label: '已中止',
    done: true,
    status: 'failed',
    error: msg_(err),
    // 純增欄位，給 HTTP 這一側分辨「這一輪死了」與「這次呼叫根本沒進得去
    // 那一輪」（RUN_NOT_FOUND／RUN_TOKEN_MISMATCH／REPORT_BUSY）。
    // ReportDialog.html 只讀 ok／error，多一個鍵對它完全沒有影響。
    errorCode: (err && err.reportCode) || 'REPORT_FAILED',
    warnings: st ? (st.warnings || []).slice() : [],
    docUrl: st ? (st.docUrl || '') : ((err && err.liveDocUrl) || ''),
    pdfUrl: ''
  };
}

// ===================================================================
// 章節分派
// ===================================================================

// 用 switch 分派而不是在 SECTIONS_ 裡直接存函式參考：純粹是為了不依賴
// 「頂層 var 初始化時函式宣告已經提升」這個細節，少一個不必要的假設。
function buildSection_(id, cursor, ctx) {
  switch (id) {
    case 'TOC': return sectionToc_(cursor, ctx);
    case 'SUMMARY': return sectionSummary_(cursor, ctx);
    case 'BASIC': return sectionBasic_(cursor, ctx);
    case 'METHOD': return sectionMethod_(cursor, ctx);
    case 'QUALITY': return sectionQuality_(cursor, ctx);
    case 'OVERALL': return sectionOverall_(cursor, ctx);
    case 'S4': return sectionS4_(cursor, ctx);
    case 'POTENTIAL': return sectionPotential_(cursor, ctx);
    case 'COVERAGE': return sectionCoverage_(cursor, ctx);
    case 'SCENE': return sectionScene_(cursor, ctx);
    case 'LEARNING': return sectionLearning_(cursor, ctx);
    case 'RANKING': return sectionRanking_(cursor, ctx);
    case 'COMMENTS': return sectionComments_(cursor, ctx);
    case 'EVALUATOR': return sectionEvaluator_(cursor, ctx);
    case 'PREV': return sectionPrev_(cursor, ctx);
    case 'ACTION': return sectionAction_(cursor, ctx);
    case 'CONCLUSION': return sectionConclusion_(cursor, ctx);
    case 'APPA': return sectionAppendixA_(cursor, ctx);
    case 'APPB': return sectionAppendixB_(cursor, ctx);
    case 'APPC': return sectionAppendixC_(cursor, ctx);
    case 'APPD': return sectionAppendixD_(cursor, ctx);
    default: return;
  }
}

// ===================================================================
// 章節共用小工具
// ===================================================================

var NO_THRESHOLD_NOTE_ = '本系統未設定合格門檻，以下數值為描述性統計，不代表達標或未達標。';

function sortByMeanAsc_(rows) {
  return rows.slice().sort(function (a, b) {
    var x = a.mean === null ? 99 : Number(a.mean);
    var y = b.mean === null ? 99 : Number(b.mean);
    return x - y;
  });
}

function sortByMeanDesc_(rows) {
  return sortByMeanAsc_(rows).reverse();
}

function rowLabel_(ctx, r) {
  var scene = shortScene_(r.itemName, ctx.prefix);
  var ind = cleanIndicator_(r.indicator);
  return (scene ? scene + '｜' : '') + (ind || r.questionId || '');
}

// 4S 類別排序與 Analysis.html 的 renderS4 一致（偏好順序優先、其餘字典序），
// 這樣報告的第六章與儀表板的 4S 分頁列出來的順序是一樣的。
function s4Keys_(stats) {
  var keys = [];
  var s4 = stats.s4 || {};
  for (var k in s4) {
    if (Object.prototype.hasOwnProperty.call(s4, k)) keys.push(k);
  }
  keys.sort(function (a, b) {
    var ia = S4_PREFERRED_ORDER_.indexOf(a), ib = S4_PREFERRED_ORDER_.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a < b ? -1 : (a > b ? 1 : 0);
  });
  return keys;
}

// 容器綁定的好處之一：評分標準 就在同一份試算表裡，直接讀，不經網路也不需金鑰。
function readLocalCriteria_(ss) {
  try {
    var sh = ss.getSheetByName('評分標準');
    if (!sh) return { error: '找不到「評分標準」工作表（本章的評分尺度表改以後端定義的說明呈現）。' };
    var values = sh.getDataRange().getValues();
    if (!values.length) return { error: '「評分標準」工作表是空的。' };
    var header = values[0];
    var cols = { '分數': -1, '標籤': -1, '說明': -1 };
    for (var c = 0; c < header.length; c++) {
      var name = String(header[c] || '').replace(/^\s+|\s+$/g, '');
      if (Object.prototype.hasOwnProperty.call(cols, name) && cols[name] === -1) cols[name] = c;
    }
    if (cols['分數'] === -1) return { error: '「評分標準」工作表缺少「分數」欄。' };
    var out = [];
    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      if (row[cols['分數']] === '' || row[cols['分數']] === null) continue;
      out.push([
        String(row[cols['分數']]),
        cols['標籤'] === -1 ? '' : String(row[cols['標籤']] || ''),
        cols['說明'] === -1 ? '' : String(row[cols['說明']] || '')
      ]);
    }
    return { rows: out };
  } catch (err) {
    return { error: '讀取「評分標準」工作表時發生錯誤：' + msg_(err) };
  }
}

// ===================================================================
// R_TOC 目錄
// ===================================================================

function sectionToc_(cursor, ctx) {
  var body = cursor.body;
  // plan §3.1 寫「DocumentApp 沒有插入自動目錄的 API」。這一句不一定正確，
  // 但本機無法驗證，所以用 feature-detect 而不是斷言：有就用、沒有就跳過。
  // （頁碼本身確實沒有 API，那一點 plan 是對的，所以頁碼只能放在範本的頁尾。）
  if (typeof body.insertTableOfContents !== 'function') {
    ctx.warn('本環境的 DocumentApp 沒有 insertTableOfContents，目錄未產生。');
    ctx.skip('目錄', '本環境的 DocumentApp 不支援 insertTableOfContents');
    para_(cursor, '（本環境無法自動插入目錄，請在 Google 文件中以「插入 → 目錄」自行加入。）');
    return;
  }
  try {
    body.insertTableOfContents(cursor.index++);
    para_(cursor, '（目錄是在各章節產生之前插入的，項目與頁碼需要重新開啟文件或匯出一次之後才會完整顯示。）');
    ctx.skip('目錄的頁碼', '程式插入的目錄要等文件重新開啟或匯出後才顯示；若目錄為空請重新開啟文件再匯出一次');
  } catch (err) {
    cursor.index--;
    ctx.warn('插入目錄失敗：' + msg_(err));
    ctx.skip('目錄', msg_(err));
    para_(cursor, '（自動目錄插入失敗：' + msg_(err) + '）');
  }
}

// ===================================================================
// R1 一、報告摘要
// ===================================================================

function sectionSummary_(cursor, ctx) {
  var sec = sectionById_('SUMMARY');
  var st = ctx.stats;
  heading_(cursor, sec.title, 1);
  para_(cursor, NO_THRESHOLD_NOTE_);

  var ov = st.overall || {};
  var rows = [['項目', '數值', '說明']];
  rows.push(['總平均', num_(ov.mean, 2), '三項潛能題目的全部評分平均（n=' + (ov.n || 0) + '，SD ' + num_(ov.sd, 2) + '）']);
  for (var i = 0; i < POTENTIALS_.length; i++) {
    var p = (st.potentials || {})[POTENTIALS_[i]] || {};
    rows.push([POTENTIALS_[i] + '潛能', num_(p.mean, 2), 'n=' + (p.n || 0) + '，SD ' + num_(p.sd, 2)]);
  }
  var cov = st.coverage || {};
  rows.push(['演習覆蓋率', num_(cov.mean, 2), 'n=' + (cov.n || 0) + '，SD ' + num_(cov.sd, 2)]);
  rows.push(['r_wg（評核官一致性）', num_(ctx.rwg.local, 4), ctx.rwg.note]);
  // within1 在 Analysis.html 之外，這是第二個真的把它印出來的地方。
  rows.push(['評分相差不超過 1 分的比例', pct_(st.within1),
    '同一題任兩位評核官配對計算，範圍為三項潛能＋覆蓋率題目']);
  var un = st.untriggered || {};
  rows.push(['未觸發率（1 分占比）', pct_(un.rate),
    (un.n || 0) + ' / ' + (un.total || 0) + ' 個評分為 1 分（1 分＝「劇本未走到此條件」；' +
    '範圍為三項潛能＋覆蓋率題目，不含學習）']);
  table_(cursor, rows);

  var pool = chartRows_(ctx.payload);
  var best = sortByMeanDesc_(pool).slice(0, 3);
  var worst = sortByMeanAsc_(pool).slice(0, 3);

  heading_(cursor, '優勢前三', 2);
  if (!best.length) para_(cursor, '沒有可排序的題目。');
  for (var b = 0; b < best.length; b++) {
    bullet_(cursor, rowLabel_(ctx, best[b]) + '　平均 ' + num_(best[b].mean, 2) +
      '（SD ' + num_(best[b].sd, 2) + '）　' + txt_(best[b].question));
  }

  heading_(cursor, '待改善前三', 2);
  if (!worst.length) para_(cursor, '沒有可排序的題目。');
  for (var w = 0; w < worst.length; w++) {
    bullet_(cursor, rowLabel_(ctx, worst[w]) + '　平均 ' + num_(worst[w].mean, 2) +
      '（SD ' + num_(worst[w].sd, 2) + '）　' + txt_(worst[w].question));
  }
}

// ===================================================================
// R2 二、演習基本資料
// ===================================================================

function sectionBasic_(cursor, ctx) {
  var m = ctx.meta;
  heading_(cursor, sectionById_('BASIC').title, 1);
  var counts = (ctx.payload.analysisRows || []).length + (ctx.payload.coverageRows || []).length +
    (ctx.payload.learningRows || []).length;
  var rows = [['項目', '內容']];
  rows.push(['機構名稱', txt_(m.orgName)]);
  rows.push(['演習名稱', txt_(m.exerciseName || m.displayName)]);
  rows.push(['演習主題', txt_(m.exerciseTopic)]);
  rows.push(['演習類別', txt_(m.exerciseCategory)]);
  rows.push(['演習日期', txt_(formatExerciseDate_(m.exerciseDate))]);
  rows.push(['說明', txt_(m.exerciseDesc)]);
  rows.push(['評核官人數', String((m.evaluatorCodes || []).length) + ' 人']);
  rows.push(['納入統計的題數', String(counts) + ' 題（三項潛能 ' + (ctx.payload.analysisRows || []).length +
    '、覆蓋率 ' + (ctx.payload.coverageRows || []).length +
    '、學習 ' + (ctx.payload.learningRows || []).length + '）']);
  rows.push(['紀錄表原始列數', String(m.recordRowCount || 0) + ' 列（去重前）']);
  table_(cursor, rows);

  // 缺口要明講。報告裡出現一個空欄位，讀者會以為是漏填；寫出「系統沒有這項
  // 資料」，才會變成下一次改進的待辦。
  heading_(cursor, '本系統目前無法提供的基本資料', 2);
  bullet_(cursor, '參演單位與參演人數：演習資訊 工作表目前只有機構／演習名稱／主題／類別／日期／說明六個欄位，沒有地方登錄參演規模，報告無法產生這一段。');
  bullet_(cursor, '評核委員名單（姓名、職稱、單位、院內外別）：人員代號 工作表目前是一份只有「代號」一欄的平面清單，沒有任何對應資料，因此報告只能列出人數，無法列出名單。');
}

// ===================================================================
// R3 三、評核方法與評分尺度
// ===================================================================

function sectionMethod_(cursor, ctx) {
  heading_(cursor, sectionById_('METHOD').title, 1);

  heading_(cursor, '1–5 級評分尺度', 2);
  var crit = readLocalCriteria_(ctx.ss);
  if (crit.error) {
    para_(cursor, '⚠ ' + crit.error);
    ctx.warn('評分尺度表：' + crit.error);
  } else if (!crit.rows.length) {
    para_(cursor, '「評分標準」工作表目前沒有任何資料列。');
  } else {
    var rows = [['分數', '標籤', '說明']].concat(crit.rows);
    table_(cursor, rows);
  }

  heading_(cursor, '統計方法', 2);
  bullet_(cursor, '資料來源：評核官透過評核單實際送出的分數。同一題、同一位評核官若送出多次，以最後一次送出為準（重送視為更正）。');
  bullet_(cursor, '三項潛能分析只納入「反應、監測、預期」三類題目；「學習」類題目排除在統計之外，另列於學習潛能觀察一章。');
  bullet_(cursor, '各指標分數為所有評核官對該題評分的算術平均；4S 類別平均為該類別內所有題目 × 所有評核官評分的平均。');
  bullet_(cursor, 'r_wg（within-group agreement index）：逐題計算 r_wg = 1 − S² ∕ σ_E² 再將各題平均。S² 是該題實際評分的樣本變異數（分母 n−1）；σ_E² 是「完全沒有共識」時的期望變異數，假設無共識時各選項等機率時為 (A²−1)∕12，本表為 5 點量表所以 σ_E² = 2。只有一位評核官評過的題目會被跳過，r_wg 為負時依慣例截為 0；兩者都會把平均往上拉，所以發生時會在數字旁註明題數。粗略解讀：≥ 0.90 很高、0.70–0.90 可接受、< 0.70 偏低。範圍涵蓋三項潛能與覆蓋率題目（不含學習）。');
  bullet_(cursor, '「相差不超過 1 分」比例：逐題取該題所有已評分的評核官兩兩配對，計算分數差 ≤ 1 的配對占全部配對的比例。不要求各題的評核官一致，範圍與 r_wg 相同。它與 r_wg 回答的是不同問題：r_wg 問「評分有多集中」，這一項問「有多少對人實際掃得很近」。');
  bullet_(cursor, '未觸發率：評分等於 1 分的個數占該範圍內全部評分的比例。範圍與 r_wg 相同（三項潛能＋覆蓋率題目，不含學習），因此它的分母小於本報告的評分總數。1 分的定義是「劇本未走到此條件」，與 2–5 分的表現評價不同質。');
  bullet_(cursor, '等權聲明：所有題目、所有評核官在各項平均中權重相同。本系統沒有題目權重欄位，也沒有關鍵題標記，因此無法產生加權總分。');
  para_(cursor, '本章除評分尺度取自本試算表的「評分標準」工作表外，所有統計數值均直接取自後端 action=analysis 的回傳值，報告端不另行計算，以確保與分析儀表板完全一致。唯一的例外是 r_wg 的本機驗算，結果列於第四章與附錄C。');
}

// ===================================================================
// R4 四、資料品質與完整性
// ===================================================================

function sectionQuality_(cursor, ctx) {
  var st = ctx.stats;
  var m = ctx.meta;
  heading_(cursor, sectionById_('QUALITY').title, 1);

  heading_(cursor, '未收到任何評分的題目', 2);
  var miss = st.missingQuestions || [];
  if (!miss.length) {
    para_(cursor, '「項目與問題」工作表裡的每一題都至少收到一位評核官的評分。');
  } else {
    var rows = [['題號', '階段', '項目名稱', '測試場景與目標']];
    for (var i = 0; i < miss.length; i++) {
      rows.push([txt_(miss[i].questionId), txt_(miss[i].stage), txt_(miss[i].itemName), txt_(miss[i].goal)]);
    }
    table_(cursor, rows);
    para_(cursor, '共 ' + miss.length + ' 題沒有任何評分。這些題目不會出現在任何圖表上，' +
      '因此若不特別列出，缺漏是隱形的。');
  }

  heading_(cursor, '未觸發（1 分）情形', 2);
  var un = st.untriggered || {};
  para_(cursor, '三項潛能與覆蓋率題目合計 ' + (un.total || 0) + ' 個評分中有 ' + (un.n || 0) +
    ' 個是 1 分，占 ' + pct_(un.rate) + '（本項不含「學習」潛能題目，範圍與 r_wg 相同，' +
    '所以這個分母會小於本報告的評分總數）。1 分的定義是「劇本未走到此條件」，與「表現不佳」不同質；' +
    '未觸發率偏高時，平均分的下降應解讀為劇本覆蓋不足，而不是能力不足。');

  heading_(cursor, '資料列數與去重', 2);
  var dedup = (ctx.payload.analysisRows || []).length + (ctx.payload.coverageRows || []).length +
    (ctx.payload.learningRows || []).length;
  para_(cursor, '紀錄表原始 ' + (m.recordRowCount || 0) + ' 列，去重後納入統計 ' + dedup + ' 題。' +
    '去重規則是（醫院代號, 演習代號, 問題ID）取最後一列，因此同一題多位評核官的分數會合併成一題、' +
    '同一題同一人重複送出只保留最後一次。兩個數字的差額主要來自這兩種合併；' +
    '但另有兩類列不會進入統計：問題ID 或人員代號空白、分數非數值的列，' +
    '以及無法歸入任何潛能分類的題號（見下一段）。因此這個差額不等於「沒有資料遺失」。');
  para_(cursor, '⚠ 需注意：紀錄表裡有分數、但「項目與問題」與「對應指標」兩張表都查不到的題號，' +
    '會因為無法歸入任何潛能分類而整列從統計中消失，且目前沒有任何清單能列出它們' +
    '（上面的缺漏清單是反方向：設定表有、紀錄表沒有）。這類題號在實務上確實出現過，' +
    '因此上一段的差額不應被讀成「所有送出的評分都已納入」。');

  heading_(cursor, '標籤來源', 2);
  var ls = m.labelSourceSummary || {};
  para_(cursor, '送出當時就寫死標籤（快照）' + (ls.snapshot || 0) + ' 題；讀取時對照設定表（join）' +
    (ls.join || 0) + ' 題；兩者皆無 ' + (ls.none || 0) + ' 題。' +
    '「join」的題目，其階段／場景／指標／潛能／4S 標籤反映的是設定試算表「現在」的內容；' +
    '若設定表在本次演習之後被修改過，這些標籤會跟著改變。自本份報告起，' +
    '「' + SNAPSHOT_SHEET_NAME_ + '」工作表已把本次的標籤與數字凍結留存。');

  heading_(cursor, 'r_wg 本機驗算', 2);
  var rwg = ctx.rwg;
  para_(cursor, '後端回傳值：' + num_(rwg.remote, 4) + '；本機以相同公式重算：' +
    num_(rwg.local, 4) + '。' + rwg.note);
  if (rwg.reasons.length) {
    para_(cursor, '以下題目是平均 r_wg 偏低的直接原因，或因覆蓋不足未被納入：');
    for (var r = 0; r < Math.min(rwg.reasons.length, 20); r++) bullet_(cursor, rwg.reasons[r]);
    if (rwg.reasons.length > 20) para_(cursor, '（其餘 ' + (rwg.reasons.length - 20) + ' 題略）');
  }

  heading_(cursor, '本報告無法提供的品質資訊', 2);
  bullet_(cursor, '應評配置表（哪一位評核官應該評哪些場景）：系統沒有這份資料，因此「每個場景是否都有足夠人數評核」無法計算，評核官人數只是「實際出現過的代號聯集」。');
  bullet_(cursor, '紀錄表有、設定表沒有的題號清單：目前沒有任何端點計算這個方向的差集，無法逐筆列出。');
  bullet_(cursor, '合格門檻／目標值：系統沒有門檻欄位，所有數值皆為描述性統計，不代表達標或未達標。');
}

// ===================================================================
// R5 五、總體結果
// ===================================================================

function sectionOverall_(cursor, ctx) {
  var st = ctx.stats;
  heading_(cursor, sectionById_('OVERALL').title, 1);
  var ov = st.overall || {};
  para_(cursor, '三項潛能題目合計 ' + (ov.n || 0) + ' 個評分，平均 ' + num_(ov.mean, 2) +
    '，標準差 ' + num_(ov.sd, 2) + '，最低 ' + num_(ov.min, 0) + ' 分、最高 ' + num_(ov.max, 0) + ' 分。');
  para_(cursor, NO_THRESHOLD_NOTE_);

  // 圖1
  var rows1 = [];
  for (var i = 0; i < POTENTIALS_.length; i++) {
    var p = (st.potentials || {})[POTENTIALS_[i]] || {};
    if (p.mean === null || p.mean === undefined) continue;
    rows1.push([POTENTIALS_[i], Number(p.mean)]);
  }
  emitChart_(cursor, ctx, { title: '圖1　三項潛能平均', type: 'COLUMN', headers: ['潛能', '平均分'], rows: rows1 });
  var t1 = [['潛能', '評分數', '平均', '標準差']];
  for (var j = 0; j < POTENTIALS_.length; j++) {
    var pp = (st.potentials || {})[POTENTIALS_[j]] || {};
    t1.push([POTENTIALS_[j], String(pp.n || 0), num_(pp.mean, 2), num_(pp.sd, 2)]);
  }
  table_(cursor, t1);

  // 圖2：潛能 × 4S 交叉。等角立體圖刻意不重現 —— 它是呈現手法，資料就是
  // stats.potentialByS4，群組直條傳達完全相同的數字。
  // ⚠️ 資料的組法（含「沒有題目的格子一律留空白、絕不填 0」那條規則）抽到
  // specAbilityCross_，與填入式的 {{圖_綜合能力}} 共用同一份 —— 兩套規則會讓
  // 同一場演習在骨架報告與手稿報告上長出不同的柱子。
  var spec2 = specAbilityCross_(ctx);
  var keys = spec2.allKeys;
  var pbs = st.potentialByS4 || {};
  if (keys.length) {
    if (spec2.liveKeys.length && spec2.rows.length) {
      emitChart_(cursor, ctx, { title: '圖2　潛能 × 4S 交叉平均', type: spec2.type, headers: spec2.headers, rows: spec2.rows });
    } else {
      para_(cursor, '（圖2　潛能 × 4S 交叉平均：本次沒有任何潛能與 4S 類別同時有資料的組合。）');
    }
    // 數值表仍列出全部 4S 類別（含整欄沒資料的），因為「這個類別一題都沒有」
    // 本身就是讀者需要知道的資訊，只是不適合畫成圖。
    var t2 = [['潛能'].concat(keys)];
    for (var c = 0; c < POTENTIALS_.length; c++) {
      var line2 = [POTENTIALS_[c]];
      for (var d = 0; d < keys.length; d++) {
        var cell2 = (pbs[POTENTIALS_[c]] || {})[keys[d]] || {};
        line2.push(cell2.n ? num_(cell2.mean, 2) + '（n=' + cell2.n + '）' : '—');
      }
      t2.push(line2);
    }
    table_(cursor, t2, '表：潛能 × 4S 交叉平均（「—」代表該組合沒有對應題目，不是 0 分；' +
      '上圖對這些組合不畫柱子）');
  } else {
    para_(cursor, '本次沒有可用的 4S 分類資料，潛能 × 4S 交叉圖未產生。');
  }
}

// 場景編號對照表：把章節內出現過的每個場景代號對應到完整測試場景文字，附在
// 章節最後。六、4S整備分析本來就有自己這段（建在它自己的場景×4S分群邏輯
// 裡，動它有動搖已驗證輸出的風險，所以刻意不改用這個共用版）；這個版本給
// 七、三項潛能分項分析與八、演習覆蓋率分析用——這兩章先前只印場景代號，
// 讀者得翻到六或九才知道 A1、D2 是什麼，2026-10-11 業主實測就是卡在這裡。
// 邏輯與 sectionS4_ 裡建 scenarioText 的方式相同：優先用 goal，沒有就用
// itemName 原始值；一個場景代號以第一次出現的非空值為準；沒有任何場景代號
// 時整段不輸出（不留一個空標題）。
function scenarioMapTable_(cursor, rows, prefix) {
  var scenarioText = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var code = shortScene_(r.itemName, prefix);
    if (!scenarioText[code]) scenarioText[code] = r.goal || r.itemName || '';
  }
  var codes = [];
  for (var c in scenarioText) {
    if (Object.prototype.hasOwnProperty.call(scenarioText, c)) codes.push(c);
  }
  if (!codes.length) return;
  codes.sort(naturalCompare_);
  heading_(cursor, '場景編號對照表', 2);
  var mapRows = [['場景編號', '測試場景與目標']];
  for (var m = 0; m < codes.length; m++) {
    mapRows.push([codes[m], txt_(scenarioText[codes[m]])]);
  }
  table_(cursor, mapRows);
}

// ===================================================================
// R6 六、4S 整備分析
// ===================================================================

function sectionS4_(cursor, ctx) {
  var st = ctx.stats;
  heading_(cursor, sectionById_('S4').title, 1);
  var keys = s4Keys_(st);
  if (!keys.length) {
    para_(cursor, '本次沒有任何題目帶有 4S 元素標籤，本章沒有可呈現的資料。');
    return;
  }

  // 資料的組法抽到 specS4Means_，與填入式的 {{圖_4S整備}} 共用（理由同圖2）。
  var spec3 = specS4Means_(ctx);
  var rows = spec3.rows;
  emitChart_(cursor, ctx, { title: '圖3　4S 整備平均', type: spec3.type, headers: spec3.headers, rows: rows });

  var t = [['4S 元素', '評分數', '平均', '標準差']];
  for (var j = 0; j < rows.length; j++) {
    var ss = st.s4[rows[j][0]] || {};
    t.push([rows[j][0], String(ss.n || 0), num_(ss.mean, 2), num_(ss.sd, 2)]);
  }
  table_(cursor, t);

  // 各場景對各 4S 的平均。分群規則與 Analysis.html 的 renderS4 相同
  // （以 shortScene 為鍵、取該場景在該 4S 類別下全部評分的平均）。
  // 這裡刻意用「長格式」而不是矩陣：場景數一多，矩陣表會寬到印不下。
  // 分群本身抽到 sceneS4Buckets_，與填入式的 {{圖_場景4S}} 共用（理由同圖2）。
  var buckets = sceneS4Buckets_(ctx);
  var bucket = buckets.bucket;
  var scenarioText = buckets.scenarioText;
  // 對照表排在「各場景在各 4S 類別的平均」**之前**：那張表整欄都是 A1、D2 這種
  // 代號，先給對照表，讀者才有辦法從第一列開始讀懂。放在後面的話，他得先看完
  // 一整張看不懂的表、再回頭對照一次。
  // 它必須放在 sceneS4Buckets_ 之後，因為 scenarioText 是在那裡才填好的 ——
  // 搬動順序時這是唯一的硬限制。
  heading_(cursor, '場景編號對照表', 2);
  var allCodes = [];
  for (var code2 in scenarioText) {
    if (Object.prototype.hasOwnProperty.call(scenarioText, code2)) allCodes.push(code2);
  }
  allCodes.sort(naturalCompare_);
  var mapRows = [['場景編號', '測試場景與目標']];
  for (var mc = 0; mc < allCodes.length; mc++) {
    mapRows.push([allCodes[mc], txt_(scenarioText[allCodes[mc]])]);
  }
  table_(cursor, mapRows);

  heading_(cursor, '各場景在各 4S 類別的平均', 2);
  var detail = [['4S 元素', '場景編號', '評分數', '平均']];
  for (var a = 0; a < keys.length; a++) {
    var codes = [];
    for (var bk in bucket) {
      if (!Object.prototype.hasOwnProperty.call(bucket, bk)) continue;
      var parts = bk.split('␟');
      if (parts[0] === keys[a]) codes.push(parts[1]);
    }
    codes.sort(naturalCompare_);
    for (var c = 0; c < codes.length; c++) {
      var arr = bucket[keys[a] + '␟' + codes[c]];
      detail.push([keys[a], codes[c], String(arr.length), num_(avg_(arr), 2)]);
    }
  }
  if (detail.length > 1) table_(cursor, detail);
  else para_(cursor, '沒有可分群的場景資料。');

}

// ===================================================================
// R7 七、三項潛能分項分析
// ===================================================================

function sectionPotential_(cursor, ctx) {
  heading_(cursor, sectionById_('POTENTIAL').title, 1);
  para_(cursor, NO_THRESHOLD_NOTE_);
  var arows = ctx.payload.analysisRows || [];
  var figureNo = 4;
  for (var i = 0; i < POTENTIALS_.length; i++) {
    var p = POTENTIALS_[i];
    heading_(cursor, p + '潛能', 2);
    var rows = [];
    for (var j = 0; j < arows.length; j++) {
      if (arows[j].potential === p) rows.push(arows[j]);
    }
    var ps = (ctx.stats.potentials || {})[p] || {};
    para_(cursor, '共 ' + rows.length + ' 題、' + (ps.n || 0) + ' 個評分，平均 ' + num_(ps.mean, 2) +
      '，標準差 ' + num_(ps.sd, 2) + '。');
    if (!rows.length) {
      para_(cursor, '本次沒有歸類為「' + p + '」潛能的題目。');
      figureNo++;
      continue;
    }
    // 資料的組法抽到 specPotentialRadar_，與填入式的 {{圖_雷達_*}} 共用（理由同圖2）。
    var specP = specPotentialRadar_(ctx, p);
    emitChart_(cursor, ctx, {
      title: '圖' + figureNo + '　' + p + '潛能各指標平均',
      type: specP.type, headers: specP.headers, rows: specP.rows
    });
    figureNo++;
    var t = [['場景編號', '指標', '評核題目', '平均', '標準差']];
    var sorted = sortByMeanAsc_(rows);
    for (var s = 0; s < sorted.length; s++) {
      t.push([
        shortScene_(sorted[s].itemName, ctx.prefix),
        cleanIndicator_(sorted[s].indicator),
        txt_(sorted[s].question),
        num_(sorted[s].mean, 2),
        num_(sorted[s].sd, 2)
      ]);
    }
    table_(cursor, t, '表：' + p + '潛能指標明細（依平均升冪，最需改善的在最上方）');
  }
  scenarioMapTable_(cursor, arows, ctx.prefix);
}

// ===================================================================
// R8 八、演習覆蓋率分析
// ===================================================================

function sectionCoverage_(cursor, ctx) {
  heading_(cursor, sectionById_('COVERAGE').title, 1);
  var cov = ctx.stats.coverage || {};
  var rows = ctx.payload.coverageRows || [];
  para_(cursor, '覆蓋率題目共 ' + rows.length + ' 題、' + (cov.n || 0) + ' 個評分，平均 ' +
    num_(cov.mean, 2) + '，標準差 ' + num_(cov.sd, 2) + '。');
  para_(cursor, NO_THRESHOLD_NOTE_);
  if (!rows.length) {
    para_(cursor, '本次沒有歸類為「覆蓋率」的題目。');
    return;
  }
  // 資料的組法抽到 specCoverageRadar_，與填入式的 {{圖_覆蓋率}} 共用（理由同圖2）。
  var specC = specCoverageRadar_(ctx);
  emitChart_(cursor, ctx, { title: '圖7　演習覆蓋率各指標平均', type: specC.type, headers: specC.headers, rows: specC.rows });
  var t = [['場景編號', '指標', '評核題目', '平均', '標準差']];
  var sorted = sortByMeanAsc_(rows);
  for (var j = 0; j < sorted.length; j++) {
    t.push([
      shortScene_(sorted[j].itemName, ctx.prefix),
      cleanIndicator_(sorted[j].indicator),
      txt_(sorted[j].question),
      num_(sorted[j].mean, 2),
      num_(sorted[j].sd, 2)
    ]);
  }
  table_(cursor, t, '表：覆蓋率指標明細（依平均升冪）');
  scenarioMapTable_(cursor, rows, ctx.prefix);
  // 量規圖刻意不做：Charts 的 GAUGE 可用性不確定，而且它傳達的資訊就是上面
  // 那一個平均值，做一張圖沒有增加任何東西。
}

// ===================================================================
// R9 九、場景逐項分析
// ===================================================================

// 這是資料量最大的一章，所以它自己逐群檢查時間預算：寫不完的場景群組會被
// 具名列出來並記進附錄D，而不是讓整個步驟撞上六分鐘硬上限被強制終止
// （硬上限終止時連 finally 都不保證會跑，什麼都救不回來）。
function sectionScene_(cursor, ctx) {
  heading_(cursor, sectionById_('SCENE').title, 1);
  var rows = chartRows_(ctx.payload);
  if (!rows.length) {
    para_(cursor, '本次沒有可分群的場景資料。');
    return;
  }
  var groups = {};
  var order = [];
  for (var i = 0; i < rows.length; i++) {
    var name = String(rows[i].itemName || '（未命名項目）');
    if (!groups[name]) {
      groups[name] = { rows: [], goal: '', stage: '' };
      order.push(name);
    }
    groups[name].rows.push(rows[i]);
    if (!groups[name].goal && rows[i].goal) groups[name].goal = rows[i].goal;
    if (!groups[name].stage && rows[i].stage) groups[name].stage = rows[i].stage;
  }
  var self = ctx;
  order.sort(function (a, b) {
    return naturalCompare_(shortScene_(a, self.prefix), shortScene_(b, self.prefix));
  });

  var skipped = [];
  for (var g = 0; g < order.length; g++) {
    if (Date.now() > ctx.deadline) {
      for (var s = g; s < order.length; s++) skipped.push(shortScene_(order[s], ctx.prefix));
      break;
    }
    var name2 = order[g];
    var grp = groups[name2];
    heading_(cursor, shortScene_(name2, ctx.prefix) + '　' + (grp.goal ? grp.goal : name2), 2);
    if (grp.stage) para_(cursor, '所屬階段：' + grp.stage);
    if (grp.goal && grp.goal !== name2) para_(cursor, '測試場景與目標：' + grp.goal);
    var t = [['題號', '評核題目', '評核人數', '平均', '標準差']];
    for (var r = 0; r < grp.rows.length; r++) {
      t.push([
        txt_(grp.rows[r].questionId),
        txt_(grp.rows[r].question),
        String((grp.rows[r].scores || []).length),
        num_(grp.rows[r].mean, 2),
        num_(grp.rows[r].sd, 2)
      ]);
    }
    table_(cursor, t);
    var sorted = sortByMeanDesc_(grp.rows);
    if (sorted.length) {
      var hi = sorted[0], lo = sorted[sorted.length - 1];
      para_(cursor, '本場景最高：' + txt_(hi.question) + '（' + num_(hi.mean, 2) + '）；' +
        '最低：' + txt_(lo.question) + '（' + num_(lo.mean, 2) + '）。');
    }
  }

  if (skipped.length) {
    para_(cursor, '⚠ 以下 ' + skipped.length + ' 個場景因本次執行的時間預算用盡而未產生：' +
      skipped.join('、') + '。這些場景的逐題數字仍完整保存在本試算表的「' +
      SNAPSHOT_SHEET_NAME_ + '」工作表（報告編號 ' + ctx.st.runId + '）。');
    ctx.warn('第九章有 ' + skipped.length + ' 個場景因時間預算未產生。');
    ctx.skip('九、場景逐項分析（部分）', '時間預算用盡，未產生的場景：' + skipped.join('、'));
  }
}

// ===================================================================
// R10 十、學習潛能觀察
// ===================================================================

function sectionLearning_(cursor, ctx) {
  heading_(cursor, sectionById_('LEARNING').title, 1);
  var rows = ctx.payload.learningRows || [];
  // 空陣列時印一句話而不是整章消失：「學習」題目在儀表板上點不到
  // （#ranking 沒有分頁按鈕），報告是唯一出口，章節消失會被讀成「沒有這個面向」。
  if (!rows.length) {
    para_(cursor, '本次演習沒有歸類為「學習」潛能的題目。');
    return;
  }
  para_(cursor, '「學習」潛能題目不納入三項潛能與 4S 統計，因此不會出現在前面各章的任何圖表上；' +
    '本章是這些題目在整份報告中唯一的出口。共 ' + rows.length + ' 題。');
  var t = [['場景編號', '指標', '評核題目', '評核人數', '平均', '標準差']];
  var sorted = sortByMeanAsc_(rows);
  for (var i = 0; i < sorted.length; i++) {
    t.push([
      shortScene_(sorted[i].itemName, ctx.prefix),
      cleanIndicator_(sorted[i].indicator),
      txt_(sorted[i].question),
      String((sorted[i].scores || []).length),
      num_(sorted[i].mean, 2),
      num_(sorted[i].sd, 2)
    ]);
  }
  table_(cursor, t, '表：學習潛能題目明細（依平均升冪）');
}

// ===================================================================
// R11 十一、強弱項排序
// ===================================================================

function sectionRanking_(cursor, ctx) {
  heading_(cursor, sectionById_('RANKING').title, 1);
  var rows = allRows_(ctx.payload);
  if (!rows.length) {
    para_(cursor, '沒有可排序的題目。');
    return;
  }
  para_(cursor, NO_THRESHOLD_NOTE_);
  var head = ['潛能', '場景編號', '評核題目', '平均', '標準差'];

  heading_(cursor, '優勢前十', 2);
  var best = sortByMeanDesc_(rows).slice(0, 10);
  var t1 = [head.slice()];
  for (var i = 0; i < best.length; i++) {
    t1.push([txt_(best[i].potential), shortScene_(best[i].itemName, ctx.prefix),
      txt_(best[i].question), num_(best[i].mean, 2), num_(best[i].sd, 2)]);
  }
  table_(cursor, t1);

  heading_(cursor, '待改善前十', 2);
  var worst = sortByMeanAsc_(rows).slice(0, 10);
  var t2 = [head.slice()];
  for (var j = 0; j < worst.length; j++) {
    t2.push([txt_(worst[j].potential), shortScene_(worst[j].itemName, ctx.prefix),
      txt_(worst[j].question), num_(worst[j].mean, 2), num_(worst[j].sd, 2)]);
  }
  table_(cursor, t2);
}

// ===================================================================
// R12 十二、觀察紀錄彙整
// ===================================================================

function sectionComments_(cursor, ctx) {
  heading_(cursor, sectionById_('COMMENTS').title, 1);
  if (!ctx.includeComments) {
    para_(cursor, '（本次產生時選擇不附上觀察紀錄。）');
    ctx.skip('十二、觀察紀錄彙整', '使用者選擇不附上');
    return;
  }
  // 匿名化擋不住的洞，必須在章首講清楚：代號可以替換，但自由文字裡若寫了
  // 「張護理長」，沒有任何程式手段能遮蔽。
  para_(cursor, '⚠ 觀察紀錄是評核官自由填寫的文字。下方的評核官標示已經過匿名處理，' +
    '但匿名化無法遮蔽文字內容本身可能出現的姓名、職稱或其他可識別資訊。' +
    '分發本報告前請先人工檢視本章內容。');

  var rows = allRows_(ctx.payload);
  var withComments = [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].comments && rows[i].comments.length) withComments.push(rows[i]);
  }
  if (!withComments.length) {
    para_(cursor, '本次演習沒有任何觀察紀錄。（「觀察紀錄」是評核紀錄表的選填欄位，' +
      '若該欄不存在或評核官未填寫，這裡就會是空的。）');
    return;
  }

  var groups = {};
  var order = [];
  for (var j = 0; j < withComments.length; j++) {
    var r = withComments[j];
    var key = (r.stage ? r.stage + '｜' : '') + shortScene_(r.itemName, ctx.prefix);
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(r);
  }
  order.sort(naturalCompare_);
  var total = 0;
  for (var g = 0; g < order.length; g++) {
    heading_(cursor, order[g], 2);
    var list = groups[order[g]];
    for (var k = 0; k < list.length; k++) {
      para_(cursor, '【' + txt_(list[k].questionId) + '】' + txt_(list[k].question) +
        '（平均 ' + num_(list[k].mean, 2) + '）');
      var cs = list[k].comments || [];
      for (var c = 0; c < cs.length; c++) {
        bullet_(cursor, evaluatorLabel_(ctx, cs[c].code) + '：' + String(cs[c].comment || ''));
        total++;
      }
    }
  }
  para_(cursor, '本章共 ' + total + ' 則觀察紀錄，分布於 ' + withComments.length + ' 題。');
}

// ===================================================================
// R13 十三、評核官評分差異分析
// ===================================================================

function sectionEvaluator_(cursor, ctx) {
  heading_(cursor, sectionById_('EVALUATOR').title, 1);
  if (ctx.identified) {
    // 報告本身必須說出自己是什麼，不能靠人記得。
    para_(cursor, '⚠ 本報告以識別模式產生，以下表格印出的是實際的人員代號。' +
      '在十餘人的品管部門中，人員代號等同可還原到個人的假名，請依院內個資規範控管本文件的流通。');
  } else {
    para_(cursor, '以下評核官一律以「評核官 1…N」表示，編號依人員代號排序後的順序指派。' +
      '編號與人員代號的對照表不列於本報告中。');
  }

  var by = ctx.stats.byEvaluator || [];
  if (!by.length) {
    para_(cursor, '沒有可用的評核官統計資料。');
  } else {
    var t = [['評核官', '評分題數', '平均給分', '寬嚴偏離']];
    for (var i = 0; i < by.length; i++) {
      t.push([
        evaluatorLabel_(ctx, by[i].code),
        String(by[i].n || 0),
        num_(by[i].mean, 2),
        (by[i].deviation === null || by[i].deviation === undefined) ? '—' :
          (Number(by[i].deviation) >= 0 ? '+' : '') + num_(by[i].deviation, 2)
      ]);
    }
    table_(cursor, t, '表：各評核官寬嚴傾向。「寬嚴偏離」＝該評核官的平均給分，' +
      '減去他實際評過的那些題目的題目平均；正值偏寬、負值偏嚴。' +
      '用他自己評過的題目當基準，是為了不把「只評了比較難的那幾題」誤判成嚴格。');
  }

  heading_(cursor, '評分離散度最大的前十題', 2);
  var rows = chartRows_(ctx.payload).slice().sort(function (a, b) {
    return Number(b.sd || 0) - Number(a.sd || 0);
  }).slice(0, 10);
  if (!rows.length) {
    para_(cursor, '沒有可比較的題目。');
    return;
  }
  var t2 = [['場景編號', '評核題目', '評核人數', '平均', '標準差']];
  for (var j = 0; j < rows.length; j++) {
    t2.push([
      shortScene_(rows[j].itemName, ctx.prefix),
      txt_(rows[j].question),
      String((rows[j].scores || []).length),
      num_(rows[j].mean, 2),
      num_(rows[j].sd, 2)
    ]);
  }
  table_(cursor, t2, '表：標準差最大的題目。離散度大通常代表題目定義不夠明確、' +
    '或不同評核官看到的是演習的不同片段，是下一次評核前最值得先討論的題目。');
}

// ===================================================================
// R14 十四、與前次演習比較
// ===================================================================

function sectionPrev_(cursor, ctx) {
  heading_(cursor, sectionById_('PREV').title, 1);
  para_(cursor, '本系統尚未保存可比對的前次演習快照，無法產生趨勢比較。' +
    '自本份報告起，「' + SNAPSHOT_SHEET_NAME_ + '」工作表已逐場留存標籤與分數，' +
    '下一場演習即可進行比較。');
  if (!ctx.meta.exercise) {
    para_(cursor, '目前為單一演習模式（後端未啟用租戶註冊表，所有資料都歸在同一場演習底下）。' +
      '要讓不同場次能被區分與比較，需要在後端啟用租戶註冊表並給每一場自己的演習代號。');
  }
}

// ===================================================================
// R15 十五、改善行動計畫
// ===================================================================

function sectionAction_(cursor, ctx) {
  heading_(cursor, sectionById_('ACTION').title, 1);
  para_(cursor, '本表由業主於 Google 文件中自行填寫，系統不產生內容。' +
    '（產出是一份可編輯的 Google 文件，所以給一張空表比省略這一章有用 —— ' +
    'PDCA 閉環是品質委員會最需要的一張表，而系統裡沒有任何資料來源可以自動填它。）');
  var rows = [['建議事項', '負責單位', '完成期限', '追蹤狀態', '驗證方式']];
  for (var i = 0; i < 6; i++) rows.push(['', '', '', '', '']);
  table_(cursor, rows);
}

// ===================================================================
// R16 十六、結論與建議
// ===================================================================

function sectionConclusion_(cursor, ctx) {
  heading_(cursor, sectionById_('CONCLUSION').title, 1);
  para_(cursor, '（請於此處自行撰寫。本系統只產生描述性統計，不產生結論；' +
    '結論需要結合演習當天的現場觀察、院內既有改善計畫與委員會的判斷。）');
}

// ===================================================================
// 附錄A 評核題目與指標對應表
// ===================================================================

function sectionAppendixA_(cursor, ctx) {
  heading_(cursor, sectionById_('APPA').title, 1);
  var groups = [
    ['三項潛能', ctx.payload.analysisRows || []],
    ['覆蓋率', ctx.payload.coverageRows || []],
    ['學習', ctx.payload.learningRows || []]
  ];
  var rows = [['分組', '題號', '評核題目', '指標', '評核潛能', '4S 元素', '標籤來源']];
  for (var g = 0; g < groups.length; g++) {
    var list = groups[g][1];
    for (var i = 0; i < list.length; i++) {
      rows.push([
        groups[g][0],
        txt_(list[i].questionId),
        txt_(list[i].question),
        txt_(list[i].indicator),
        txt_(list[i].potential),
        txt_(list[i].s4),
        labelSourceText_(list[i].labelSource)
      ]);
    }
  }
  if (rows.length === 1) {
    para_(cursor, '沒有可列出的題目。');
    return;
  }
  table_(cursor, rows, '表：「標籤來源」為「快照」代表標籤在送出當時就已寫死；' +
    '「讀取時對照」代表標籤是產生報告當下才從設定試算表查出來的，' +
    '設定表日後被修改時這些標籤會跟著改變。');
}

function labelSourceText_(s) {
  if (s === 'snapshot') return '快照';
  if (s === 'join') return '讀取時對照';
  if (s === 'none') return '無';
  return txt_(s);
}

// ===================================================================
// 附錄B 原始評分資料（逐題 × 逐評核官）
// ===================================================================

// 即使匿名，這仍是一張完整的個別評分矩陣，因此預設不附、需要另外勾選；
// 勾選後仍套用匿名映射，除非識別模式也同時開啟。
function sectionAppendixB_(cursor, ctx) {
  heading_(cursor, sectionById_('APPB').title, 1);
  if (!ctx.includeAppendixB) {
    para_(cursor, '（本次產生時未勾選「附上附錄B 原始評分資料」。這張表即使匿名，' +
      '仍是一份完整的個別評分矩陣，因此預設不附。）');
    ctx.skip('附錄B 原始評分資料', '預設不附，使用者未勾選');
    return;
  }
  var codes = (ctx.meta.evaluatorCodes || []).slice().sort();
  if (!codes.length) {
    para_(cursor, '沒有評核官資料。');
    return;
  }
  var header = ['題號', '場景編號'];
  for (var c = 0; c < codes.length; c++) header.push(evaluatorLabel_(ctx, codes[c]));
  header.push('平均');
  var rows = [header];
  var all = allRows_(ctx.payload);
  for (var i = 0; i < all.length; i++) {
    var r = all[i];
    var byCode = {};
    var sc = r.scores || [];
    for (var s = 0; s < sc.length; s++) byCode[sc[s].code] = sc[s].score;
    var line = [txt_(r.questionId), shortScene_(r.itemName, ctx.prefix)];
    for (var k = 0; k < codes.length; k++) {
      line.push(byCode[codes[k]] === undefined ? '' : String(byCode[codes[k]]));
    }
    line.push(num_(r.mean, 2));
    rows.push(line);
  }
  table_(cursor, rows, '表：空白格代表該評核官沒有評這一題。' +
    (ctx.identified ? '本表以識別模式印出實際人員代號。' : '欄頭為匿名後的評核官編號。'));
}

// ===================================================================
// 附錄C 資料來源與產出資訊
// ===================================================================

// 檔名可以印（這一段資料本來就在金鑰保護的後面），試算表 ID、金鑰、/exec 網址
// 永遠不印 —— 比照後端 meta 的既有分界：檔名不是憑證、ID 是。
function sectionAppendixC_(cursor, ctx) {
  var st = ctx.st;
  heading_(cursor, sectionById_('APPC').title, 1);
  // 這張 provenance 表抽到 appendixCRows_，與填入式文件最後自動附加的
  // 「報告產生紀錄」共用同一份 —— 兩種模式對「這份報告是怎麼來的」不可以各說
  // 各話。裡面包含「產生程式版本」與「產生入口」：這一份原始碼同時手貼在容器
  // 綁定專案與獨立部署的報告 Web App，印出版本是「兩份副本有沒有漂移」唯一從
  // 交付物上看得出來的線索。也包含資料指紋的**雜湊**而不是指紋本身
  // （見 fingerprint_ 上方的註解）。
  table_(cursor, appendixCRows_(ctx));

  // 業主第一次產生報告後，請回報「圖表能力探測結果」這一行 —— 這是開發端
  // 無法執行這段程式碼時，唯一的實機驗證替代手段。
  para_(cursor, '本報告的所有統計數值均取自後端 action=analysis 的回傳值，報告端未另行計算；' +
    '唯一的例外是 r_wg 的本機驗算（結果如上）。資料指紋用於確保報告的各章節都來自同一次資料快照；' +
    '此處只列出它的雜湊值，不列出指紋原文，以免間接揭露評核官代號。');
  para_(cursor, '本附錄刻意不列印任何分析金鑰、試算表 ID、Web App 網址或人員代號對照表。');

  var warnings = st.warnings || [];
  heading_(cursor, '本次產生的警告與降級紀錄', 2);
  if (!warnings.length) {
    para_(cursor, '無。');
  } else {
    for (var w = 0; w < warnings.length; w++) bullet_(cursor, warnings[w]);
  }
  // 記住這一節印到第幾則。收尾階段（finalizeRun_ 第 4b 步）還會再加警告，
  // 那些在這一刻還不存在；靠這個計數才知道有哪些漏掉、要補在文件最後。
  st.warningsPrintedCount = warnings.length;

  var skipped = st.skipped || [];
  heading_(cursor, '被跳過或降級的章節', 2);
  if (!skipped.length) {
    para_(cursor, '無。');
  } else {
    for (var s = 0; s < skipped.length; s++) {
      bullet_(cursor, skipped[s].title + '：' + skipped[s].reason);
    }
  }
}

// ===================================================================
// 附錄D 本報告未涵蓋的項目
// ===================================================================

function sectionAppendixD_(cursor, ctx) {
  heading_(cursor, sectionById_('APPD').title, 1);
  para_(cursor, '以下項目在本報告中沒有對應內容。列出來是為了讓讀者能分辨' +
    '「系統沒有這項資料」與「這次演習表現為零」—— 一份看不出自己缺什麼的報告，' +
    '會讓缺口在下一次演習時原封不動地再出現一次。');

  heading_(cursor, '系統目前沒有資料來源的項目', 2);
  bullet_(cursor, '演習時間軸與反應時間 KPI：紀錄表只有「送出時間」，而那是評核官按下送出的時間，不是事件發生的時間，無法產生通報／到院／檢傷完成的時序分析。');
  bullet_(cursor, '現場照片與影像紀錄：系統沒有檔案上傳機制。');
  bullet_(cursor, '題目權重與關鍵題標記：對應指標 工作表沒有權重欄與關鍵指標欄，所有題目等權，無法計算加權總分，也無法標示「關鍵題未達標」。');
  bullet_(cursor, '模擬傷患數與收治數等參演規模分母：演習資訊 工作表沒有對應欄位。');
  bullet_(cursor, '跨院比較：本報告的資料來源只涵蓋本場演習，沒有其他機構的資料。');
  bullet_(cursor, '合格門檻與達標判定：系統沒有門檻欄位，所有數值皆為描述性統計。');

  var missingAnchors = [];
  for (var i = 0; i < SECTIONS_.length; i++) {
    var sec = SECTIONS_[i];
    if (sec.required) continue;
    // plannedIds 是「範本裡真的找得到錨點」的那些章節；不在裡面＝業主刻意
    // （或不小心）沒放錨點，這一章從頭到尾就沒有被安排產生。
    var planned = ctx.st.plannedIds || [];
    if (planned.indexOf(sec.id) === -1) {
      missingAnchors.push(sec.title + '（範本缺少 ' + sec.token + '）');
    }
  }
  if (missingAnchors.length) {
    heading_(cursor, '範本未放錨點、因此未產生的章節', 2);
    for (var j = 0; j < missingAnchors.length; j++) bullet_(cursor, missingAnchors[j]);
  }

  var skipped = ctx.st.skipped || [];
  if (skipped.length) {
    heading_(cursor, '本次執行中被跳過或降級的項目', 2);
    for (var k = 0; k < skipped.length; k++) {
      bullet_(cursor, skipped[k].title + '：' + skipped[k].reason);
    }
  }

  heading_(cursor, '文件格式上的限制', 2);
  bullet_(cursor, '頁碼、頁首院徽、字型、邊距與簽核欄全部由報告範本負責，本程式不產生也不修改它們（DocumentApp 沒有插入頁碼的 API，這是硬限制而不是取捨）。要調整版面請直接修改範本 Google 文件，不需要改程式。');
  bullet_(cursor, '報告版次、文件編號、製表／審核／核定欄位由業主在產生出來的 Google 文件中自行填寫，系統不保存這些欄位。');
}

// ===================================================================
// 填入式：綜合能力（潛能 × 4S 交叉格）—— 從 Analysis.html 移植
// ===================================================================
//
// ⚠️⚠️ 這是這十二句說明的**第二份副本**。第一份是 Analysis.html 的
// ABILITY_NOTES（搜 'ABILITY_NOTES' 就找得到），兩份必須在同一個 commit 裡一起改。
// 沒有任何執行期檢查抓得到不一致：一份是放在網站根目錄的瀏覽器 JS，一份是手工
// 貼進兩個 Apps Script 專案的 .gs，唯一的辨別方式是把十二個字串 diff 一次。
// 這個 repo 已經為同一件事付過代價 —— Config.gs 與 ConfigWithSubmit.gs 漂移到
// 線上那份**不等於任何一個 commit**（見 apps-script/README.md，2026-10-12）。
//
// ⚠️ 鍵是 潛能 + '×' + 4S 的**原始值**，而 4S 原始值直接來自 對應指標 的
// 「4S 元素」欄（目前是 'Space (空間)' 這種中英並列）。業主哪天把那一欄改成
// 純中文，這十二個鍵就全部對不上，abilityNote_ 會回空字串而「說明」欄整欄變空白
// —— **不會報錯**，而且螢幕與紙本會同時變空白。改試算表標籤時這裡要跟著改。
//
// 句型是「在{4S 的動作片語}上展現出的{潛能}能力」，業主 2026-10-13 定稿：
// 空間→空間規劃與佈署、人員→人員規劃與佈署、物資→物資規劃與管理、
// 系統→系統管理與應用。全部用「規劃」（不是「規畫」），且不加括號。
var ABILITY_NOTES_ = {
  '反應×Space (空間)': '在空間規劃與佈署上展現出的反應能力',
  '反應×Staff (人員)': '在人員規劃與佈署上展現出的反應能力',
  '反應×Stuff (物資)': '在物資規劃與管理上展現出的反應能力',
  '反應×System (系統)': '在系統管理與應用上展現出的反應能力',
  '監測×Space (空間)': '在空間規劃與佈署上展現出的監測能力',
  '監測×Staff (人員)': '在人員規劃與佈署上展現出的監測能力',
  '監測×Stuff (物資)': '在物資規劃與管理上展現出的監測能力',
  '監測×System (系統)': '在系統管理與應用上展現出的監測能力',
  '預期×Space (空間)': '在空間規劃與佈署上展現出的預期能力',
  '預期×Staff (人員)': '在人員規劃與佈署上展現出的預期能力',
  '預期×Stuff (物資)': '在物資規劃與管理上展現出的預期能力',
  '預期×System (系統)': '在系統管理與應用上展現出的預期能力'
};

// ⚠️ 這裡取的是**潛能 × 4S 的交叉格**，不是個別題目。
// 第一章既有的「優勢前三／待改善前三」是逐題的（chartRows_ + sortByMeanDesc_），
// 那是另一個問題的答案。業主手稿寫的是「反應x空間」這種組合名，所以要的一定是
// 交叉格 —— 而且儀表板的報告檢視（renderReportSummary）早就是這樣答的。
// **sectionSummary_ 一個字都不改**：錨點式的輸出必須與今天逐位元相同。
function abilityCells_(ctx) {
  var by = (ctx.stats && ctx.stats.potentialByS4) || {};
  var out = [];
  for (var pot in by) {
    if (!Object.prototype.hasOwnProperty.call(by, pot)) continue;
    var row = by[pot] || {};
    for (var s4 in row) {
      if (!Object.prototype.hasOwnProperty.call(row, s4)) continue;
      var c = row[s4] || {};
      // n:0 的格子代表那個組合完全沒有題目，不是「得 0 分」。放進排序會讓
      // 待改善前三永遠是三個空格，什麼也沒說。
      if (!c.n || c.mean === null || c.mean === undefined) continue;
      out.push({ potential: pot, s4: s4, mean: Number(c.mean), n: c.n });
    }
  }
  return out;
}

function abilityNote_(pot, s4) {
  return ABILITY_NOTES_[String(pot) + '×' + String(s4)] || '';
}

// 「反應x空間」這種顯示名。注意與 abilityNote_ 的不對稱是**刻意的**：
// 標籤只留括號裡的中文，查說明用的鍵卻是 4S 的原字。兩個字串長得很像，很容易
// 混成一個。
function abilityLabel_(pot, s4) {
  var m = String(s4 == null ? '' : s4).match(/[（(]([^）)]+)[）)]/);
  return String(pot) + ' x ' + (m ? m[1] : String(s4 == null ? '' : s4));
}

// 取到第 n 名為止，**同分同名次而且全部列入**（2026-10-12 業主指定）。
// 競賽排名：分數相同給同一個名次，下一個名次跳過被佔用的位次，所以回傳筆數
// 不一定是 n —— 1,1,1 三筆、1,2,2 三筆、1,2,3,3,3 五筆。
// 直接 slice(0,3) 會在同分處硬切，等於從兩個一模一樣的組合裡任選一個印進報告、
// 另一個丟掉，而紙本上看不出曾經發生過這件事。契約裡的「序號」欄就是這個名次。
function rankedTop_(cells, n, asc) {
  var sorted = cells.slice().sort(function (a, b) { return asc ? (a.mean - b.mean) : (b.mean - a.mean); });
  var out = [];
  var rank = 0, prev = null;
  for (var i = 0; i < sorted.length; i++) {
    var c = sorted[i];
    if (prev === null || c.mean !== prev) rank = i + 1;
    if (rank > n) break;
    out.push({ rank: rank, potential: c.potential, s4: c.s4, mean: c.mean, n: c.n });
    prev = c.mean;
  }
  return out;
}

// ===================================================================
// 填入式：場景色譜（與 Analysis.html 的 4S 分頁同一組顏色）
// ===================================================================
//
// ⚠️ 第二份副本警語，與 ABILITY_NOTES_ 同級：色相公式 round(i/(n-1)*300)、
// 飽和度 55%、亮度 45%、以及 n<=1 時回 '#147d83'，全部逐字照抄
// Analysis.html 的 renderS4（搜 'colorOf'）。兩邊必須一致，否則紙本上的色塊
// 指到的場景與螢幕上的色段不是同一個 —— 而兩份文件擺在一起對照正是這張表的用途。
// 場景碼與文字一律**只從 analysisRows 建**（與 renderS4 相同）：換一組列會重新
// 編索引，顏色就整組位移。
function hex2_(v) {
  var n = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16);
  return n.length < 2 ? '0' + n : n;
}

function hslToHex_(h, s, l) {
  var ss = s / 100, ll = l / 100;
  var cc = (1 - Math.abs(2 * ll - 1)) * ss;
  var hp = (((h % 360) + 360) % 360) / 60;
  var x = cc * (1 - Math.abs((hp % 2) - 1));
  var r = 0, g = 0, b = 0;
  if (hp < 1) { r = cc; g = x; }
  else if (hp < 2) { r = x; g = cc; }
  else if (hp < 3) { g = cc; b = x; }
  else if (hp < 4) { g = x; b = cc; }
  else if (hp < 5) { r = x; b = cc; }
  else { r = cc; b = x; }
  var m = ll - cc / 2;
  return '#' + hex2_(r + m) + hex2_(g + m) + hex2_(b + m);
}

function sceneSpectrum_(ctx) {
  var scenarioText = {};
  var arows = ctx.payload.analysisRows || [];
  for (var i = 0; i < arows.length; i++) {
    var code = shortScene_(arows[i].itemName, ctx.prefix);
    if (!scenarioText[code]) scenarioText[code] = arows[i].goal || arows[i].itemName || '';
  }
  var codes = [];
  for (var c in scenarioText) {
    if (Object.prototype.hasOwnProperty.call(scenarioText, c)) codes.push(c);
  }
  codes.sort(naturalCompare_);
  var n = codes.length;
  var color = {};
  for (var k = 0; k < n; k++) {
    color[codes[k]] = (n <= 1) ? '#147d83' : hslToHex_(Math.round(k / (n - 1) * 300), 55, 45);
  }
  return { codes: codes, text: scenarioText, color: color };
}

// ===================================================================
// 填入式：圖表 spec 建構器（錨點式與填入式**共用同一份**）
// ===================================================================
//
// 這五支是從既有章節寫作器裡抽出來的純函式（spec 進 spec 出，不碰文件）。
// 共用而不是複製，是為了不產生第二套「潛能×4S 的空格要不要填 0」的規則 ——
// 那條規則錯一次就會在圖上畫出一根「監測潛能在人員面向得 0 分」的柱子，
// 而那會被當成頭號發現提報。
// ⚠️ 它們動到的是已經產出過真實報告的那條路。抽出來的邏輯逐行照搬、輸出相同，
// 但本機無法執行 .gs —— 合併前必須用骨架範本實跑一次並逐章比對。

function specAbilityCross_(ctx) {
  var st = ctx.stats;
  var keys = s4Keys_(st);
  var pbs = st.potentialByS4 || {};
  // ⚠️ 沒有題目的格子一律留空白，**絕不填 0**（理由見 sectionOverall_ 圖2 的註解）。
  // 整欄都沒有資料的 4S 類別直接不進圖，不留一根空軸。
  var liveKeys = [];
  for (var kk = 0; kk < keys.length; kk++) {
    var hasAny = false;
    for (var pp = 0; pp < POTENTIALS_.length; pp++) {
      var probe = (pbs[POTENTIALS_[pp]] || {})[keys[kk]] || {};
      if (probe.n) { hasAny = true; break; }
    }
    if (hasAny) liveKeys.push(keys[kk]);
  }
  var rows = [];
  for (var a = 0; a < POTENTIALS_.length; a++) {
    var line = [POTENTIALS_[a]];
    var any = false;
    for (var b = 0; b < liveKeys.length; b++) {
      var cell = (pbs[POTENTIALS_[a]] || {})[liveKeys[b]] || {};
      if (cell.n) any = true;
      line.push(cell.n ? Number(cell.mean) : '');
    }
    if (any) rows.push(line);
  }
  return {
    title: '潛能 × 4S 交叉平均', type: 'COLUMN',
    headers: ['潛能'].concat(liveKeys), rows: rows,
    allKeys: keys, liveKeys: liveKeys
  };
}

function specS4Means_(ctx) {
  var st = ctx.stats;
  var keys = s4Keys_(st);
  var rows = [];
  for (var i = 0; i < keys.length; i++) {
    var s = (st.s4 || {})[keys[i]] || {};
    rows.push([keys[i], Number(s.mean || 0)]);
  }
  rows.sort(function (a, b) { return b[1] - a[1]; });
  return { title: '4S 整備平均', type: 'BAR', headers: ['4S 元素', '平均分'], rows: rows };
}

function specPotentialRadar_(ctx, p) {
  var arows = ctx.payload.analysisRows || [];
  var rows = [];
  for (var j = 0; j < arows.length; j++) {
    if (arows[j].potential !== p) continue;
    rows.push([cleanIndicator_(arows[j].indicator) || arows[j].questionId || '（未命名）', Number(arows[j].mean || 0)]);
  }
  return { title: p + '潛能各指標平均', type: 'RADAR', headers: ['指標', '平均分'], rows: rows };
}

function specCoverageRadar_(ctx) {
  var crows = ctx.payload.coverageRows || [];
  var rows = [];
  for (var i = 0; i < crows.length; i++) {
    rows.push([cleanIndicator_(crows[i].indicator) || crows[i].questionId || '（未命名）', Number(crows[i].mean || 0)]);
  }
  return { title: '演習覆蓋率各指標平均', type: 'RADAR', headers: ['指標', '平均分'], rows: rows };
}

// 場景 × 4S 的分群。對照表（scenarioText）刻意建在 4S 過濾**之前**：
// 一個場景的題目若 4S 元素欄留空，它仍然是一個存在的場景，Analysis.html 的
// renderS4 也是用全部 analysisRows 建它的。兩邊規則不一致會讓讀者在儀表板上
// 看到一個場景、在歸檔報告的對照表裡卻找不到，無從判斷哪一份才對。
function sceneS4Buckets_(ctx) {
  var bucket = {};
  var scenarioText = {};
  var arows = ctx.payload.analysisRows || [];
  for (var k = 0; k < arows.length; k++) {
    var r = arows[k];
    var code = shortScene_(r.itemName, ctx.prefix);
    if (!scenarioText[code]) scenarioText[code] = r.goal || r.itemName || '';
    if (!r.s4) continue;
    var key = r.s4 + '␟' + code;
    if (!bucket[key]) bucket[key] = [];
    var sc = r.scores || [];
    for (var s2 = 0; s2 < sc.length; s2++) bucket[key].push(sc[s2].score);
  }
  return { bucket: bucket, scenarioText: scenarioText };
}

// 與 Analysis.html 的 4S 分頁堆疊橫條帶的是同一批數字（那張圖的每個色段標籤
// 印的就是該場景的實際平均）。堆疊本身是呈現手法，不重現。
function specSceneByS4_(ctx) {
  var b = sceneS4Buckets_(ctx);
  var keys = s4Keys_(ctx.stats);
  var codes = [];
  for (var c in b.scenarioText) {
    if (Object.prototype.hasOwnProperty.call(b.scenarioText, c)) codes.push(c);
  }
  codes.sort(naturalCompare_);
  var rows = [];
  for (var i = 0; i < codes.length; i++) {
    var line = [codes[i]];
    var any = false;
    for (var j = 0; j < keys.length; j++) {
      var arr = b.bucket[keys[j] + '␟' + codes[i]];
      // 同樣的「空白不是 0」規則：這個場景在這個 4S 類別下沒有題目就留空。
      if (arr && arr.length) { any = true; line.push(Number(avg_(arr))); } else line.push('');
    }
    if (any) rows.push(line);
  }
  return { title: '各場景在各 4S 類別的平均', type: 'COLUMN', headers: ['場景編號'].concat(keys), rows: rows };
}

// 一個 id 對一張圖。新增圖片標記只要改 FILL_IMAGE_TOKENS_ 與這支。
function fillImageSpec_(def, ctx) {
  switch (def.id) {
    case 'IMG_ABILITY': return specAbilityCross_(ctx);
    case 'IMG_S4': return specS4Means_(ctx);
    case 'IMG_COVERAGE': return specCoverageRadar_(ctx);
    case 'IMG_RADAR_1':
    case 'IMG_RADAR_2':
    case 'IMG_RADAR_3': return specPotentialRadar_(ctx, def.potential);
    case 'IMG_SCENE_S4': return specSceneByS4_(ctx);
    default: return null;
  }
}

// ===================================================================
// 填入式：資料列建構器（輸出就是契約的欄位順序）
// ===================================================================

function abilityValueRows_(list) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    out.push([
      String(list[i].rank),
      abilityLabel_(list[i].potential, list[i].s4),
      num_(list[i].mean, 1),
      abilityNote_(list[i].potential, list[i].s4)
    ]);
  }
  return out;
}

// 回 { values: [][], colors: []|null }。colors 只有場景對照表會用到。
// 一個小數位（num_，不是 toFixed）是刻意的：與儀表板的 mean.toFixed(1) 對齊，
// 同時 null 仍然印「—」而不是一個假的 0。
function fillRowData_(def, ctx) {
  var i;
  var out = [];
  if (def.id === 'ROW_TOP3') {
    return { values: abilityValueRows_(rankedTop_(abilityCells_(ctx), 3, false)), colors: null };
  }
  if (def.id === 'ROW_BOT3') {
    return { values: abilityValueRows_(rankedTop_(abilityCells_(ctx), 3, true)), colors: null };
  }
  if (def.id === 'ROW_COV') {
    var cov = sortByMeanAsc_(ctx.payload.coverageRows || []);
    for (i = 0; i < cov.length; i++) {
      out.push([cleanIndicator_(cov[i].indicator), txt_(cov[i].question), num_(cov[i].mean, 1)]);
    }
    return { values: out, colors: null };
  }
  if (def.id === 'ROW_P1' || def.id === 'ROW_P2' || def.id === 'ROW_P3') {
    var arows = ctx.payload.analysisRows || [];
    var pool = [];
    for (i = 0; i < arows.length; i++) {
      if (arows[i].potential === def.potential) pool.push(arows[i]);
    }
    var sorted = sortByMeanAsc_(pool);
    for (i = 0; i < sorted.length; i++) {
      out.push([
        shortScene_(sorted[i].itemName, ctx.prefix),
        cleanIndicator_(sorted[i].indicator),
        txt_(sorted[i].question),
        num_(sorted[i].mean, 1)
      ]);
    }
    return { values: out, colors: null };
  }
  if (def.id === 'ROW_SCENE') {
    var sp = sceneSpectrum_(ctx);
    var colors = [];
    for (i = 0; i < sp.codes.length; i++) {
      out.push(['●', sp.codes[i], txt_(sp.text[sp.codes[i]])]);
      colors.push(sp.color[sp.codes[i]]);
    }
    return { values: out, colors: colors };
  }
  return { values: [], colors: null };
}

// ===================================================================
// 填入式：儲存格層級的寫入工具
// ===================================================================

// 把一格清成「剛好一個空段落」。
// 不用 cell.clear()：TableCell 一定要至少含一個段落，而且保留第 0 個子元素才
// 留得住業主排好的段落屬性（對齊、行距、字型）—— 降級成文字時那些屬性就是
// 這一格看起來還像不像話的全部依據。由後往前刪，避免索引位移。
function clearCellToSingleParagraph_(cell) {
  for (var i = cell.getNumChildren() - 1; i >= 1; i--) {
    try { cell.getChild(i).removeFromParent(); } catch (err) {}
  }
  var first = null;
  try { first = cell.getChild(0); } catch (err2) { first = null; }
  if (first && first.getType() === DocumentApp.ElementType.PARAGRAPH) {
    var p = first.asParagraph();
    try { p.editAsText().setText(''); } catch (err3) {}
    return p;
  }
  // 第 0 個不是段落（清單項目或表格）：先補一個空段落再把它刪掉，
  // 順序不能顛倒 —— 刪成空儲存格會丟錯。
  var np = cell.insertParagraph(0, '');
  if (first) { try { first.removeFromParent(); } catch (err4) {} }
  return np;
}

function setParaText_(p, text) {
  var s = String(text == null ? '' : text);
  try { p.editAsText().setText(s); } catch (err) {
    try { p.setText(s); } catch (err2) {}
  }
  return p;
}

// 該格可用的寬度（pt）。欄寬設成自動時 getColumnWidth 可能回 null 或丟錯，
// 此時退回 IMAGE_WIDTH_PT_ —— 對契約說的 1×1 表格這個預設是對的（滿版的一格
// 就是本文寬度）。夾在 [120, IMAGE_WIDTH_PT_]，讓一個設錯的欄寬既長不出郵票
// 大小的圖、也撐不破版面。
function cellUsableWidthPt_(table, colIndex, cell) {
  var w = 0;
  try { w = Number(table.getColumnWidth(colIndex)); } catch (err) { w = 0; }
  if (!w || isNaN(w) || w <= 0) return IMAGE_WIDTH_PT_;
  try { w -= Number(cell.getPaddingLeft() || 0); } catch (err2) {}
  try { w -= Number(cell.getPaddingRight() || 0); } catch (err3) {}
  if (!w || isNaN(w)) return IMAGE_WIDTH_PT_;
  if (w < 120) return 120;
  if (w > IMAGE_WIDTH_PT_) return IMAGE_WIDTH_PT_;
  return Math.round(w);
}

// 與 insertImage_ 同一套等比例縮放算術，只是容器不同。
// insertImage_ 本身一個字都不改 —— 錨點式仍然用它。
function insertImageIntoCell_(para, blob, maxWidthPt) {
  var img = para.appendInlineImage(blob);
  try {
    var w = img.getWidth();
    var h = img.getHeight();
    if (w && w > maxWidthPt) {
      img.setHeight(Math.round(h * (maxWidthPt / w)));
      img.setWidth(maxWidthPt);
    }
  } catch (errSize) {}
  try { para.setAlignment(DocumentApp.HorizontalAlignment.CENTER); } catch (err2) {}
  return true;
}

// 寫一格文字並保住格式。
// Text.setText 在把一段文字清空再寫入時不保證保留屬性，所以是「先抓屬性、
// setText、再寫回去」這個 ES5 的穩妥寫法；整段包起來，失敗就退回
// cell.setText（丟格式總比丟掉整列好）。
function setCellText_(cell, text) {
  var s = String(text == null ? '' : text);
  try {
    for (var i = cell.getNumChildren() - 1; i >= 1; i--) {
      try { cell.getChild(i).removeFromParent(); } catch (errC) {}
    }
    var p = cell.getChild(0).asParagraph();
    var attrs = null;
    try { attrs = p.getAttributes(); } catch (err0) { attrs = null; }
    p.editAsText().setText(s);
    if (attrs) { try { p.setAttributes(attrs); } catch (err1) {} }
    return true;
  } catch (err) {
    try { cell.setText(s); return true; } catch (err2) { return false; }
  }
}

// 色塊欄：寫一個實心圓並把前景色設成該場景的色譜顏色。
function setCellTextColored_(cell, text, hex) {
  if (!setCellText_(cell, text)) return false;
  try {
    var t = cell.getChild(0).asParagraph().editAsText();
    var len = String(text == null ? '' : text).length;
    if (len > 0 && hex) t.setForegroundColor(0, len - 1, hex);
  } catch (err) {}
  return true;
}

// ===================================================================
// 填入式：{{圖_*}}
// ===================================================================

// 儲存格版的降級鏈。①②③ 與 emitChart_ 完全共用同一組函式與同一套判斷
// （tryChartBlob_ ／ legacyChartBlob_ ／ ctx.cap），只有第 ④ 段不同。
//
// ⚠️ 第 ④ 段刻意**不插巢狀表格**。Docs 對巢狀表格的支援本來就差，
// TableCell.appendTable 在這個部署上從來沒有被執行過，而且一張巢狀表格會撐破
// 業主為圖片量好的那一格 —— 等於這個降級親手毀掉填入式模式存在的理由。
// 改成在同一格裡逐列寫文字：數字一樣看得到，而且還留在他的框裡。
//
// 不寫圖說。emitChart_ 會補一行「圖：<title>」，但手稿自己畫了圖說，多一段只會
// 把業主量好的格子撐高。降級的那句話改走 warnings[] 與文件最後的產生紀錄。
function emitChartIntoCell_(loc, ctx, spec) {
  var cell = loc.cell;
  if (!spec || !spec.rows || !spec.rows.length) {
    // 沒有資料不是降級，不記警告（與 emitChart_ 的第一行同一個判斷）。
    setParaText_(clearCellToSingleParagraph_(cell), '（' + spec.title + '：本次沒有可呈現的資料。）');
    return;
  }
  var maxW = cellUsableWidthPt_(loc.table, loc.cellIndex, cell);
  var order = [];
  if (spec.type === 'RADAR') {
    if (ctx.cap.radar) order.push('RADAR');
    order.push('COLUMN');
  } else {
    order.push(spec.type);
    if (spec.type !== 'COLUMN') order.push('COLUMN');
  }
  var lastError = '';
  for (var i = 0; i < order.length; i++) {
    if (order[i] === 'COLUMN' && !ctx.cap.column && i > 0) continue;
    var res = tryChartBlob_(ctx.tempSheet, spec, order[i]);
    if (res.blob) {
      var ok = false;
      try {
        // 每一次嘗試前都重新清格：上一次失敗的 appendInlineImage 可能留下殘骸。
        ok = insertImageIntoCell_(clearCellToSingleParagraph_(cell), res.blob, maxW);
      } catch (errIns) { ok = false; }
      if (ok) {
        if (spec.type === 'RADAR' && order[i] !== 'RADAR') {
          ctx.warn('「' + spec.title + '」：雷達圖不可用，已降級為直條圖（數值相同）。');
        }
        return;
      }
      lastError = '圖片插入儲存格失敗';
    } else {
      // plainifyTokens_：lastError 會被寫進儲存格與「報告產生紀錄」，而底層
      // 例外訊息帶著完整 {{…}} 的情形是會發生的（見 plainifyTokens_ 上方）。
      lastError = plainifyTokens_(res.error);
    }
  }
  var legacy = legacyChartBlob_(spec);
  if (legacy) {
    try {
      if (insertImageIntoCell_(clearCellToSingleParagraph_(cell), legacy, maxW)) {
        ctx.warn('「' + spec.title + '」：內嵌圖表失敗（' + lastError + '），改用舊版 Charts 服務。');
        return;
      }
    } catch (errLegacy) {}
  }
  // 第 ④ 段：同一格裡逐列文字。
  ctx.warn('「' + spec.title + '」：圖表無法產生（' + lastError + '），已改在同一格內逐列列出數值。');
  try {
    setParaText_(clearCellToSingleParagraph_(cell),
      '（本環境無法產生「' + spec.title + '」這張圖，以下為同一組數字）');
    for (var r = 0; r < spec.rows.length; r++) {
      var line = String(spec.rows[r][0]);
      for (var c = 1; c < spec.rows[r].length; c++) {
        // 多欄（潛能×4S、場景×4S）要帶欄名，否則一串數字讀不出對應。
        // num_ 會把 '' 印成「—」，所以「這個組合沒有題目」不會被讀成 0 分。
        line += '　' + (spec.headers.length > 2 ? String(spec.headers[c]) + ' ' : '') + num_(spec.rows[r][c], 2);
      }
      cell.appendParagraph(line);
    }
    return;
  } catch (errText) {
    lastError = lastError + '；數值也寫不進儲存格（' + plainifyTokens_(msg_(errText)) + '）';
  }
  // 第 ⑤ 段。
  try {
    setParaText_(clearCellToSingleParagraph_(cell),
      '⚠ 本處的「' + spec.title + '」既無法產生圖表也無法插入數值（原因：' + lastError +
      '）。同一批數字已經寫進設定試算表的「' + SNAPSHOT_SHEET_NAME_ + '」工作表（報告編號 ' +
      ctx.st.runId + '），請由該處查閱。');
  } catch (errLast) {}
  ctx.skip(spec.title, '圖表與數值皆無法寫入儲存格：' + lastError);
}

function fillImageSlot_(loc, ctx, def) {
  var spec = fillImageSpec_(def, ctx);
  if (!spec) {
    setParaText_(clearCellToSingleParagraph_(loc.cell), '（' + def.title + '：系統沒有這張圖的資料來源。）');
    ctx.skip(def.title, '沒有對應的 spec 建構器');
    return;
  }
  spec.title = def.title;
  emitChartIntoCell_(loc, ctx, spec);
}

// ===================================================================
// 填入式：{{列_*}}
// ===================================================================

// 樣板列複製。
//
// 為什麼是「複製列」而不是「append 一列再自己設格式」：
// 框線寬度／顏色是 **Table 層級**的屬性（table.setBorderWidth(0)），所以業主
// 設的隱藏框線本來就會被每一列繼承；但儲存格底色、內距、垂直對齊、段落屬性是
// **逐格**的，appendTableRow() 建出來的是一列預設格式 —— 結果就是「正好帶資料
// 的那幾列」冒出 1pt 黑框，而業主會以為程式把他的表格弄壞了。row.copy() 把
// 那些屬性整組帶過來。
//
// ⚠️ 順序刻意是「先刪樣板列，再逐列插入」。這是在兩種壞結局之間選一個：
// 先刪＝一旦撞到 6 分鐘硬上限（連 finally 都不會跑），結果是**少列**，不會是
// **重複列**；重試時標記已經不在，這個 slot 直接被當成寫完而跳過（與 openCursor_
// 依賴的「錨點不在了＝這一章已寫完」是同一條不變式）。少列比重複列安靜，
// 所以 st.fillInflight 負責把它變成一則具名警告。
function duplicateTemplateRow_(table, rowIndex, values, colors, columnCount) {
  var donor = table.getRow(rowIndex).copy();
  var n = values.length;
  var single = (table.getNumRows() <= 1);
  if (single) {
    // 整張表只有這一列：先把第一份複本插在它後面再刪掉它。
    // 刪掉 Docs 表格的最後一列有機會把整張表一起帶走。
    table.insertTableRow(rowIndex + 1, donor.copy());
    table.removeRow(rowIndex);
  } else {
    table.removeRow(rowIndex);
  }
  var start = rowIndex;
  var already = single ? 1 : 0;
  for (var k = already; k < n; k++) {
    table.insertTableRow(start + k, donor.copy());
  }
  // 填值一律對「已經接上文件」的那一列做（對 detached 的複本動手會丟
  // 「element must be attached」）。
  for (var i = 0; i < n; i++) {
    var row = table.getRow(start + i);
    var cells = row.getNumCells();
    for (var j = 0; j < columnCount && j < cells; j++) {
      if (colors && j === 0) setCellTextColored_(row.getCell(j), values[i][j], colors[i]);
      else setCellText_(row.getCell(j), values[i][j]);
    }
  }
  return n;
}

function fillRowSlot_(loc, ctx, def) {
  var table = loc.table;
  var ti = loc.rowIndex;
  var st = ctx.st;

  // 檢查過了還是再量一次：範本有可能在「檢查設定」與「產生」之間被改過
  // （掃描的是範本本身，複本是掃描之後才建立的）。
  // ⚠️ 訊息裡用 plainToken_ 去掉大括號：這一句會被 writeFillSlot_ 的 catch
  // 寫進儲存格、也會進 warnings[] 與「報告產生紀錄」，帶著完整的 {{…}} 就會
  // 被收尾第 4 步的殘留掃描當成範本打錯字抓出來。
  var cells = table.getRow(ti).getNumCells();
  if (cells < def.columns.length) {
    throw new Error(plainToken_(def.token) + ' 所在的表格只有 ' + cells + ' 欄，這個標記需要 ' +
      def.columns.length + ' 欄（欄位順序由左至右：' + columnContractText_(def) + '）。');
  }
  // 同理再量一次「標記在不在這一列的第一格」。欄位對應是從該列第一欄開始算的，
  // 標記若被挪到第三欄，底下照樣從第 0 格開始寫，於是那個標記原封不動留在
  // PDF 上 —— 一個不會報錯、只會印出來的失敗。掃描關卡已經擋過這件事，這裡
  // 是同一條規則的第二道，理由與上面的欄數複查相同。
  if (loc.cellIndex !== 0) {
    throw new Error(plainToken_(def.token) + ' 不在樣板列的第一格（目前在第 ' + (loc.cellIndex + 1) +
      ' 欄），無法對應欄位順序（由左至右：' + columnContractText_(def) + '）。');
  }

  var data = fillRowData_(def, ctx);
  var values = data.values;
  var colors = data.colors;

  // 零筆：不複製、不刪列。把樣板列就地改成一句說明，其餘欄位清空。
  // 讓一個 {{列_*}} 活著進到 PDF 是這裡要避免的失敗 —— 而且收尾的殘留掃描會把
  // 它報成「範本 token 打錯字」，一則假警報，正好訓練操作者忽略真的那些
  // （2026-10-09 的教訓，見 OWNER_FILLED_TOKENS_）。
  if (!values.length) {
    var row0 = table.getRow(ti);
    setCellText_(row0.getCell(0), '（本次沒有可列出的資料）');
    for (var z = 1; z < def.columns.length && z < row0.getNumCells(); z++) {
      setCellText_(row0.getCell(z), '');
    }
    return;
  }

  var truncated = 0;
  if (values.length > TABLE_ROW_CAP_) {
    truncated = values.length - TABLE_ROW_CAP_;
    values = values.slice(0, TABLE_ROW_CAP_);
    if (colors) colors = colors.slice(0, TABLE_ROW_CAP_);
  }

  // 寫進執行狀態：硬上限砍掉執行時不會跑 finally，這一格是唯一能讓
  // 「寫到一半」留下痕跡的東西。
  st.fillInflight = def.id;
  writeRunState_(st);

  duplicateTemplateRow_(table, ti, values, colors, def.columns.length);

  // 立刻落地，不要等這次呼叫結束才一起寫。
  // 不這樣做的話，硬上限正好落在「寫完了、還沒清旗標」這個窗口時，下一次會
  // 報一則「可能未完整寫入」的假警告 —— 而一則會誤報的警告，正是這個檔案一再
  // 付代價的那種東西（見 OWNER_FILLED_TOKENS_）。
  st.fillInflight = '';
  writeRunState_(st);

  if (truncated > 0) {
    // 截斷絕不多長一列來說明（那會破壞欄位契約），改走警告與產生紀錄。
    ctx.warn('「' + def.title + '」共 ' + (values.length + truncated) + ' 筆，為控制產生時間僅填入前 ' +
      TABLE_ROW_CAP_ + ' 筆，其餘 ' + truncated + ' 筆請查閱「' + SNAPSHOT_SHEET_NAME_ + '」工作表。');
    ctx.skip(def.title, '資料筆數超過單表上限，已截斷 ' + truncated + ' 筆');
  }
}

// ===================================================================
// 填入式：一個 slot 的寫入（writeSection_ 的對應物）
// ===================================================================

// 依 token 重新定位。**每一次 HTTP 呼叫都會重新開一次文件**，所以 scan 階段
// 記下的 Table／TableCell 物件在下一個步驟裡已經失效，不能跨呼叫保存。
function locateFillToken_(doc, token) {
  var body = doc.getBody();
  var tables = [];
  try { tables = body.getTables() || []; } catch (err) { tables = []; }
  for (var ti = 0; ti < tables.length; ti++) {
    var table = tables[ti];
    var nr = 0;
    try { nr = table.getNumRows(); } catch (err2) { nr = 0; }
    for (var r = 0; r < nr; r++) {
      var row = table.getRow(r);
      var nc = row.getNumCells();
      for (var c = 0; c < nc; c++) {
        var cell = row.getCell(c);
        var text = '';
        try { text = String(cell.getText() || ''); } catch (err3) { text = ''; }
        if (text.indexOf(token) !== -1) {
          return { table: table, rowIndex: r, cellIndex: c, cell: cell, numCells: nc };
        }
      }
    }
  }
  return null;
}

// 一個 slot 寫壞了不可以讓整輪死掉 —— 與 writeSection_ 同一條規則：
// 把錯誤寫在那一格裡、記進 warnings 與產生紀錄，然後繼續下一個。
function writeFillSlot_(doc, slotId, ctx) {
  if (slotId === FILL_RECORD_ID_) {
    try {
      writeFillRecord_(doc, ctx);
    } catch (errRec) {
      ctx.warn(FILL_RECORD_TITLE_ + '：寫入失敗（' + plainifyTokens_(msg_(errRec)) + '）。');
      ctx.skip(FILL_RECORD_TITLE_, plainifyTokens_(msg_(errRec)));
    }
    return;
  }
  var def = fillDefById_(slotId);
  if (!def) return;

  var loc = locateFillToken_(doc, def.token);
  if (!loc) {
    // 標記不在了＝上一次已經寫完（與 openCursor_ 的「錨點不在了」同一條不變式）。
    // 唯一的例外是上一次正好死在這個 slot 的寫入途中 —— 那種情況下資料列可能
    // 只寫了一半，必須具名說出來，不能無聲放過。
    if (ctx.st.fillInflight === slotId) {
      // plainToken_：這一則會被印進「報告產生紀錄」，不可以含完整的 {{…}}。
      ctx.warn(plainToken_(def.token) + ' 的資料列可能未完整寫入（上一次呼叫在寫入途中中斷）。');
      ctx.skip(def.title, '上一次呼叫在寫入途中中斷，資料列可能不完整');
      ctx.st.fillInflight = '';
    }
    return;
  }
  try {
    if (def.kind === 'image') fillImageSlot_(loc, ctx, def);
    else fillRowSlot_(loc, ctx, def);
  } catch (err) {
    ctx.st.fillInflight = '';
    // ⚠️ 例外訊息會原樣落進儲存格與「報告產生紀錄」，所以一律先過
    // plainifyTokens_ —— 它裡面可能帶著一個完整的 {{…}}（欄數／位置複查就是
    // 這樣丟的），而那會讓收尾的殘留掃描報告它自己剛寫下去的字。
    var reason = plainifyTokens_(msg_(err));
    try {
      setParaText_(clearCellToSingleParagraph_(loc.cell),
        '⚠ 本處在產生時發生錯誤：' + reason + '　同一批數字已經寫進設定試算表的「' +
        SNAPSHOT_SHEET_NAME_ + '」工作表（報告編號 ' + ctx.st.runId + '），請由該處查閱。');
    } catch (err2) {}
    ctx.warn(def.title + '：產生失敗（' + reason + '）。');
    ctx.skip(def.title, reason);
  }
}

// ===================================================================
// 填入式：文件最後自動附加的「報告產生紀錄」
// ===================================================================

// 附錄C 那張 provenance 表抽成共用建構器：錨點式的附錄C 與填入式的產生紀錄
// 用同一份，兩邊不會各說各話。
function appendixCRows_(ctx) {
  var m = ctx.meta;
  var st = ctx.st;
  var rows = [['項目', '內容']];
  rows.push(['報告編號', st.runId]);
  rows.push(['報告產生時間', st.generatedAtText]);
  rows.push(['產生程式版本', REPORT_BUILD_]);
  rows.push(['產生入口', st.webMode ? '分析平台（報告 Web App）' : '設定試算表的「' + MENU_TITLE_ + '」選單']);
  if (st.folderName) rows.push(['輸出資料夾名稱', String(st.folderName)]);
  rows.push(['設定檔名稱', txt_(m.configFileName)]);
  rows.push(['紀錄檔名稱', txt_(m.recordFileName)]);
  rows.push(['紀錄分頁名稱', txt_(m.recordSheetName)]);
  rows.push(['紀錄表原始列數', String(m.recordRowCount || 0)]);
  rows.push(['機構代號', m.tenant ? String(m.tenant) : '—（單一演習模式）']);
  rows.push(['演習代號', m.exercise ? String(m.exercise) : '—（單一演習模式）']);
  rows.push(['租戶解析來源', txt_(m.tenantSource)]);
  rows.push(['資料指紋（SHA-256 前 16 碼）', fingerprintDigest_(st.fingerprint)]);
  rows.push(['匿名模式', st.identified ? '⚠ 含可識別評核官代號' : '已匿名（評核官 1…N）']);
  rows.push(['r_wg 驗算結論', ctx.rwg.note]);
  rows.push(['圖表能力探測結果', (st.cap && st.cap.detail && st.cap.detail.length)
    ? st.cap.detail.join('；') : '未探測']);
  rows.push(['報告快照工作表', SNAPSHOT_SHEET_NAME_ + '（第 ' + st.snapStartRow + ' 列起共 ' +
    st.snapCount + ' 列，以報告編號關聯）']);
  return rows;
}

// 這個版型裝不下、因此本次沒有輸出的東西（帶本次的實際筆數）。
// 寫出來的理由與附錄D 完全相同：讀者必須分得出「系統沒有這項資料」與
// 「這次演習表現為零」。一份看不出自己缺什麼的報告，會讓缺口在下一次原封不動
// 再出現一次。
function fillModeCoverage_(ctx) {
  var m = ctx.meta;
  var st = ctx.stats;
  var out = [];
  out.push('學習潛能題目 ' + (ctx.payload.learningRows || []).length +
    ' 題：填入式範本沒有對應的表格，本報告未列出。');
  out.push('觀察紀錄 ' + (m.commentCount || 0) +
    ' 則：填入式範本沒有對應的表格，本報告未列出。');
  out.push('未收到任何評分的題目 ' + ((st.missingQuestions || []).length) +
    ' 題：填入式範本沒有對應的表格，本報告未列出（它們不會出現在任何圖上，' +
    '所以若不特別說明，缺漏是隱形的）。');
  out.push('評核官差異：本模式一律匿名，且不輸出任何逐評核官資料。');
  out.push('標準差：填入式的分數欄只有一位小數的平均值，沒有欄位放 SD。');
  out.push('r_wg＝' + num_((st.rwg && st.rwg.mean), 4) + '、相差不超過 1 分比例＝' + pct_(st.within1) +
    '、未觸發率＝' + pct_((st.untriggered || {}).rate) + '：本模式沒有輸出位置，數值記於此處。');
  out.push('附錄A（評核題目與指標對應表）與附錄B（逐題 × 逐評核官原始評分）：本模式不產生。');
  out.push('以上完整數字都在設定試算表的「' + SNAPSHOT_SHEET_NAME_ + '」工作表（報告編號 ' +
    ctx.st.runId + '）與分析儀表板上。');
  return out;
}

// 游標用 finalizeReport_ 第 4b 步同一招：{body, index:getNumChildren()}。
// ⚠️ 這一段固定落在文件最末，也就是業主手稿的簽核欄之後，而且不可關閉。
// 一份會被簽、會被影印歸檔的品質紀錄，必須說得出自己有哪幾張圖降級、哪些內容
// 這個版型裝不下。要移位置是契約變更，不是參數。
function writeFillRecord_(doc, ctx) {
  var body = doc.getBody();
  try { body.appendPageBreak(); } catch (errPb) {}
  var tail = { body: body, doc: doc, index: body.getNumChildren() };

  heading_(tail, FILL_RECORD_TITLE_, 1);
  para_(tail, '本節由報告產生程式自動附加於文件最後，不屬於報告正文。' +
    '它記錄這一次產生的來源、版本與降級情形 —— 一份品質紀錄必須說得出自己是怎麼來的。');

  table_(tail, appendixCRows_(ctx));
  para_(tail, '本報告的所有統計數值均取自後端 action=analysis 的回傳值，報告端未另行計算；' +
    '唯一的例外是 r_wg 的本機驗算（結果如上）。' +
    '本節刻意不列印任何分析金鑰、試算表 ID、Web App 網址或人員代號對照表。');

  var warnings = ctx.st.warnings || [];
  heading_(tail, '本次產生的警告與降級紀錄', 2);
  if (!warnings.length) para_(tail, '無。');
  else for (var w = 0; w < warnings.length; w++) bullet_(tail, warnings[w]);
  // 記住印到第幾則；收尾第 4b 步會補上這之後才發生的警告。
  ctx.st.warningsPrintedCount = warnings.length;

  var skipped = ctx.st.skipped || [];
  heading_(tail, '被跳過或降級的項目', 2);
  if (!skipped.length) para_(tail, '無。');
  else for (var s = 0; s < skipped.length; s++) bullet_(tail, skipped[s].title + '：' + skipped[s].reason);

  heading_(tail, '本報告版型未涵蓋的內容', 2);
  var cov = fillModeCoverage_(ctx);
  for (var i = 0; i < cov.length; i++) bullet_(tail, cov[i]);
}

// ===================================================================
// 網頁入口（只有獨立部署 (B) 會跑到；容器綁定那一份裡這整段是死碼）
// ===================================================================
//
// 這一段讓分析平台（Analysis.html）可以直接叫出報告，不必請業主切到設定試算表
// 去按選單。它是**新增一支 /exec**，不是在 ConfigWithSubmit.gs 上加分支 ——
// 後端「無金鑰分支恰好兩條（設定分支、action=sessions）」那條不變式沒有被動到。
//
// ⚠️ 這支部署的無金鑰行為是**零**：沒帶對金鑰的呼叫只拿得到字串 unauthorized。
//
// 授權規則與 action=analysis 完全相同：網址上的 key 必須逐字等於
// (t, ex) 那一列的 分析金鑰 —— 「讀得到資料的人就報得了這場的報告」是字面成立，
// 不是大致成立。資訊增量因此是零：報告只是把同一份 payload 重新排版。
//
// 新增的不是資訊而是**副作用**。一次成功的呼叫會在「部署這支 Web App 的那個
// Google 帳號」底下：
//   (a) 建立一份 Doc（範本複本）與一份 PDF；
//   (b) 在該場演習的設定試算表追加約 23 列 報告快照，並建立／清空隱藏分頁
//       _報告暫存；
//   (c) 吃掉該帳號的 UrlFetchApp／Docs／執行配額（每次 HTTP 呼叫最多 6 分鐘）。
// 使其可接受的四道界線：
//   • 目的地有界：資料夾只能是 REPORT_OUTPUT_FOLDER_ID 或「解析出來那份設定
//     試算表的上層資料夾」，永遠不是呼叫端指定的；檔名固定是
//     「<報告編號> <顯示名稱> 評核報告」；內容固定是業主範本的複本。
//     寫入路徑上沒有任何一個欄位來自呼叫端。
//   • 寫入分頁有界：只有 報告快照（只追加）與 _報告暫存（固定名稱、會清空），
//     兩者後端都不讀。演習資訊／項目與問題／人員代號／評分標準／對應指標 對這支
//     腳本是唯讀，紀錄試算表則從頭到尾不會被打開。
//   • 跨場次可達範圍有界：(hid, exid) → 設定試算表ID 的對應只來自「分析金鑰等於
//     呈示金鑰」的那一列，而健全性規則 3 禁止同一把金鑰出現在兩個不同的 醫院代號。
//   • 速率有界：每場次一個 REPORT_ACTIVE_ 標記，最多一輪在跑，15 分鐘後過期。
// 剩下的殘餘風險是「一個已經握有該院全部評核資料讀取權的人，拿配額去騷擾部署者
// 的雲端硬碟」—— 比那把金鑰本來就允許的傷害小，而且被上面四條框住。
//
// ⛔ 絕不接受：沒有金鑰的報告請求、與解析列不符的金鑰、解析到無效列的 (t,ex)。

// 代號解析失敗／註冊表問題一律用這個錯誤物件，reportCode 是機器可讀的那一半。
function reportError_(message, code) {
  var err = new Error(message);
  err.reportCode = code;
  return err;
}

// ⚠️ 逐字 'unauthorized'。Analysis.html 會把這個字串原樣印出來，而
// ConfigWithSubmit.gs 的 action=analysis 回的就是這一組 —— 一家醫院的操作者在
// 兩支 /exec 上應該看到同一套詞彙。
function unauthorizedError_() {
  return reportError_('unauthorized', 'UNAUTHORIZED');
}

function jsonOut_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// 這些代碼代表「這次呼叫連進不進得了那一輪都還沒確定」，所以回純錯誤形狀，
// 不回進度形狀 —— 否則前端會把一個驗證失敗誤讀成「那一輪死掉了」。
var PREFLIGHT_CODES_ = ['RUN_NOT_FOUND', 'RUN_TOKEN_MISMATCH', 'REPORT_BUSY'];

// -------------------------------------------------------------------
// 回傳值紅線：整個網頁入口只有這兩個函式組裝回應物件
// -------------------------------------------------------------------
//
// ⚠️ 這兩個函式裡**永遠不得**出現：任何試算表 ID、分析金鑰、ADMIN_KEY、
// REPORT_REGISTRY_ID、註冊表列號、檔案擁有者、紀錄分頁名稱、人員代號、
// 任何儲存格內容。允許出現的只有：報告編號、章節進度、狀態、警告文字、
// Doc／PDF 連結、以及資料夾「名稱」（檔名不是憑證、ID 是 —— 與後端 meta
// 畫的是同一條線）。
// 想多回一個欄位就得改這裡，這也正是這條線查得動的原因
// （對照 ConfigWithSubmit.gs 的 sessionSortable_）。
// ⚠️ 三個自由文字欄位（label／warnings／error）一律再過一次 scrub_。
// 理由不是「現在有洩漏」—— 今天每一個警告的產生點都走過 msg_()。理由是這條
// 紅線的可查性：上面那段註解宣稱「只有這兩個函式組裝回應物件」，但那只有在
// 遮蔽也發生在**這裡**時才是一句真話。警告是先存進指令碼屬性、之後才由
// reportStatus 原樣回放的，遮蔽若只發生在產生點，正確性就取決於「當時
// SECRET_IDS_ 已經註冊完了沒有」—— 一個新增的警告（或一個新的呼叫順序）就能
// 無聲地打破它，而且不會有任何地方報錯。在收口處再擦一次，成本是幾次字串比對。
function webProgressOut_(res, st) {
  var out = {
    ok: res.ok !== false,
    runId: String(res.runId || ''),
    step: Number(res.step || 0),
    totalSteps: Number(res.totalSteps || 0),
    label: scrub_(String(res.label || '')),
    done: !!res.done,
    status: String(res.status || ''),
    identified: !!(st ? st.identified : res.identified),
    warnings: scrubList_(res.warnings),
    docUrl: String(res.docUrl || ''),
    pdfUrl: String(res.pdfUrl || ''),
    folderName: String((st && st.folderName) || ''),
    startedAtText: String((st && st.startedAtText) || ''),
    stale: !!(st && st.status === 'running' &&
      (Date.now() - Number(st.startedAt || 0)) > RUN_STALE_MS_)
  };
  if (res.ok === false) {
    out.error = scrub_(String(res.error || ''));
    out.errorCode = String(res.errorCode || 'REPORT_FAILED');
  }
  return out;
}

function scrubList_(list) {
  var out = [];
  for (var i = 0; i < (list || []).length; i++) out.push(scrub_(String(list[i] == null ? '' : list[i])));
  return out;
}

function webErrorShape_(message, code) {
  // ⚠️ 'unauthorized' 必須逐字，不經 scrub_（它本來就不含任何秘密，而
  // Analysis.html 會把這個字串原樣比對）。
  if (code === 'UNAUTHORIZED') return { error: 'unauthorized', errorCode: 'UNAUTHORIZED' };
  return { error: scrub_(String(message == null ? '' : message)), errorCode: String(code || 'REPORT_FAILED') };
}

function webErrorOut_(err) {
  return webErrorShape_(msg_(err), (err && err.reportCode) || 'REPORT_FAILED');
}

// -------------------------------------------------------------------
// doGet：唯一的 HTTP 入口
// -------------------------------------------------------------------
//
// 全部用 GET + 查詢字串、全部回 HTTP 200（Apps Script 設不了狀態碼），
// 也不帶任何自訂標頭 —— 維持成 CORS simple request，與 Analysis.html 現有的
// action=analysis 呼叫同一個形狀，不會觸發 Apps Script 答不了的 preflight。
function doGet(e) {
  var params = (e && e.parameter) || {};
  // ⚠️ 第一件事，而且要在任何可能丟錯的程式之前：把這次的金鑰交給 scrub_。
  // Apps Script 的連線類例外會把**整個請求網址**（含 &key=）塞進訊息裡，
  // 而那條訊息會一路走到 HTTP 回應、瀏覽器 console 與附錄C。
  try { SECRET_KEY_ = String(params.key == null ? '' : params.key); } catch (errKey) {}
  var action = String(params.action || '');
  try {
    if (action === 'reportCheck') return jsonOut_(webCheck_(params));
    if (action === 'reportStart') return jsonOut_(webStart_(params));
    if (action === 'reportContinue') return jsonOut_(webContinue_(params));
    if (action === 'reportStatus') return jsonOut_(webStatus_(params));
    if (action === 'reportAbandon') return jsonOut_(webAbandon_(params));
    return jsonOut_(webErrorShape_(
      '這個網址是報告產生器，不提供評核單設定或分析資料。' +
      '支援的 action：reportCheck／reportStart／reportContinue／reportStatus／reportAbandon。',
      'BAD_ACTION'));
  } catch (err) {
    return jsonOut_(webErrorOut_(err));
  }
}

// -------------------------------------------------------------------
// 五個 action
// -------------------------------------------------------------------

function webCheck_(params) {
  var target = resolveWebTarget_(params);
  // reportValidateOnly 的每一條 detail 都只印檔名／資料夾名／分頁名／欄名／
  // 計數與代號，不印任何 ID 或金鑰（它本來就是對話框要給業主看的東西）。
  var res = reportValidateOnly(target);
  return { ok: !!res.ok, checks: res.checks };
}

function webStart_(params) {
  var target = resolveWebTarget_(params);
  var res = reportStart({
    target: target,
    includeComments: String(params.includeComments || '') !== '0',
    includeAppendixB: String(params.includeAppendixB || '') === '1',
    // 識別模式的三道門一道都沒少：伺服器端這一關（reportStart 自己檢查
    // identifiedConfirmed）仍然是權威，HTTP 只是把兩個旗標搬過來而已。
    identified: String(params.identified || '') === '1',
    identifiedConfirmed: String(params.identifiedConfirmed || '') === '1'
  });
  var st = res.runId ? readRunStateAt_(PROP_RUN_PREFIX_ + res.runId) : null;
  if (st && st.status && st.status !== 'running') closeWebRun_(target, st);
  var out = webProgressOut_(res, st);
  // runToken **只在這裡回一次**。它不寫進任何其他回應，也不印在文件、檔名或
  // 報告快照裡 —— 報告編號會出現在那三個地方，所以報告編號不是秘密，光靠它
  // 擋不住「同院的另一把瀏覽器插進別人那一輪」。
  if (res.ok !== false && st && st.runToken) out.runToken = String(st.runToken);
  return out;
}

function webContinue_(params) {
  var target = resolveWebTarget_(params);
  target.runToken = String(params.runToken == null ? '' : params.runToken);
  var runId = String(params.runId || '');
  var res = reportContinue(runId, target);
  if (res.ok === false && PREFLIGHT_CODES_.indexOf(String(res.errorCode || '')) !== -1) {
    return webErrorShape_(res.error, res.errorCode);
  }
  var st = readRunStateAt_(PROP_RUN_PREFIX_ + (res.runId || runId));
  if (st && st.status && st.status !== 'running') closeWebRun_(target, st);
  return webProgressOut_(res, st);
}

// 唯讀，而且刻意**不收 runToken 當續跑憑證**：重新整理過的分頁只能問狀態，
// 不能接手。這與今天「業主把對話框關掉」的處境是同一件事，那個情況也接不下去。
function webStatus_(params) {
  var target = resolveWebTarget_(params);
  var runId = String(params.runId || '');
  var st = runId ? readRunStateAt_(PROP_RUN_PREFIX_ + runId) : null;
  if (!st || !st.runId) {
    throw reportError_('找不到報告編號 ' + runId + ' 的紀錄（它可能已經結束並被清除）。', 'RUN_NOT_FOUND');
  }
  assertRunBelongsTo_(st, target);
  return webProgressOut_({
    ok: true,
    runId: st.runId,
    step: st.doneCount || 0,
    totalSteps: st.totalCount || 0,
    label: statusText_(st.status),
    done: st.status !== 'running',
    status: st.status,
    warnings: (st.warnings || []).slice(),
    docUrl: st.docUrl || '',
    pdfUrl: st.pdfUrl || ''
  }, st);
}

// 選單的「重設產生狀態」在 HTTP 這一側的對應動作。沒有它，只能用網頁產報告的
// 醫院在卡住時完全無路可走（那個選單項目需要容器試算表）。
function webAbandon_(params) {
  var target = resolveWebTarget_(params);
  target.runToken = String(params.runToken == null ? '' : params.runToken);
  var runId = String(params.runId || '');
  var lock = briefLock_();
  try {
    var st = readRunStateAt_(PROP_RUN_PREFIX_ + runId);
    if (!st || !st.runId) {
      throw reportError_('找不到報告編號 ' + runId + ' 的紀錄。', 'RUN_NOT_FOUND');
    }
    assertRunBelongsTo_(st, target);
    if (!st.runToken || st.runToken !== target.runToken) {
      throw reportError_('這一輪報告的驗證碼不正確，無法捨棄。', 'RUN_TOKEN_MISMATCH');
    }
    if (st.status === 'running') {
      st.status = 'failed';
      st.busyUntil = 0;
      st.snapPending = true;
      writeRunState_(st);
      try {
        updateSnapshotStatus_(targetSpreadsheet_(st.ssId), st.snapStartRow, st.snapCount,
          st.snapStatusCol, '中斷');
        st.snapPending = false;
      } catch (errSnap) {
        // 標不動就留著 snapPending，下一次同場次的 reportStart 掃描時會補。
      }
    }
    closeWebRun_(target, st);
    return webProgressOut_({
      ok: true, runId: st.runId, step: st.doneCount || 0, totalSteps: st.totalCount || 0,
      label: '已捨棄這一輪', done: true, status: st.status,
      warnings: [], docUrl: st.docUrl || '', pdfUrl: st.pdfUrl || ''
    }, st);
  } finally {
    releaseLock_(lock);
  }
}

// 一把金鑰只能驅動它自己那一場的執行。金鑰已經在 resolveWebTarget_ 對過了，
// 這一關擋的是「拿 A 場的金鑰去動 B 場那一輪」。
function assertRunBelongsTo_(st, target) {
  if (String(st.hid || '') !== String(target.hid || '') ||
      String(st.exid || '') !== String(target.exid || '')) {
    throw reportError_('這一輪報告不屬於目前這場演習。', 'RUN_NOT_FOUND');
  }
}

// -------------------------------------------------------------------
// 場次解析（鏡像 ConfigWithSubmit.gs 的 resolveTenant_）
// -------------------------------------------------------------------
//
// 順序是控制本身，不是實作細節：金鑰比對只需要讀註冊表。在它之前**不得**有
// 任何 DriveApp 呼叫、不得 openById 設定試算表、不得 UrlFetchApp、不得複製
// 範本、不得寫任何指令碼屬性。那個順序就是「沒帶金鑰的呼叫只花掉一次（有快取
// 的）註冊表讀取」與「沒帶金鑰的呼叫可以把部署者的雲端硬碟撐大」的全部差別。
function resolveWebTarget_(params) {
  var rawHid = String(params.t == null ? '' : params.t);
  var rawExid = String(params.ex == null ? '' : params.ex);
  var key = String(params.key == null ? '' : params.key);
  var hid = normSlugR_(rawHid);
  var exid = normSlugR_(rawExid);
  // 有填但格式不合是硬錯誤，絕不悄悄當成沒填 —— 否則一個打錯的代號會靜靜
  // 變成「報了另一場的報告」。
  if (trim_(rawHid) && !hid) {
    throw reportError_('連結裡的機構代號格式不正確，請確認連結是否完整。', 'BAD_CODE');
  }
  if (trim_(rawExid) && !exid) {
    throw reportError_('連結裡的演習代號格式不正確，請確認連結是否完整。', 'BAD_CODE');
  }

  var registryId = prop_(PROP_REGISTRY_ID_);
  rememberSecretId_(registryId);
  if (!registryId) {
    // 註冊表關閉的單一演習模式。master 在還沒有正式註冊表之前就是靠這一支
    // 合併進去的（與後端把 REGISTRY_SPREADSHEET_ID 以 '' 合併同一個姿態）。
    // 此時 t／ex 原樣收下但**對路由零影響**，也因此不會送給後端、不做身分比對。
    var ssId = prop_(PROP_CONFIG_SS_ID_);
    var wantKey = prop_(PROP_ANALYSIS_KEY_);
    rememberSecretId_(ssId);
    if (!ssId || !wantKey) {
      throw reportError_('這個報告部署尚未完成設定：未設定 ' + PROP_REGISTRY_ID_ +
        '（註冊表模式），也沒有同時設定 ' + PROP_CONFIG_SS_ID_ + ' 與 ' +
        PROP_ANALYSIS_KEY_ + '（單一演習模式）。請聯絡系統管理者。', 'REPORT_NOT_CONFIGURED');
    }
    if (!isSpreadsheetIdR_(ssId)) {
      throw reportError_('指令碼屬性 ' + PROP_CONFIG_SS_ID_ + ' 看起來不是試算表 ID。',
        'REPORT_NOT_CONFIGURED');
    }
    if (!key || key !== wantKey) throw unauthorizedError_();
    return {
      hid: '', exid: '', ssId: ssId, analysisKey: wantKey, displayName: '',
      registryOff: true, requestedHid: hid, requestedExid: exid, runToken: ''
    };
  }

  // 註冊表模式下兩個代號都是必填：儀表板本來就知道自己正在看哪一場，
  // 在這裡猜「預設演習」正是會產出一份跟螢幕不一致的報告的做法。
  if (!hid) {
    throw reportError_('這個連結沒有帶機構代號，無法確認要產生哪一場演習的報告。', 'NO_TENANT');
  }
  if (!exid) {
    throw reportError_('這個連結沒有帶演習代號，無法確認要產生哪一場演習的報告。', 'NO_EXERCISE');
  }

  var reg = readReportRegistry_(registryId);
  // 註冊表讀不到時**刻意不退回單一演習模式**。後端的設定分支那樣做是對的
  // （硬擋會讓演習當天全場評核官無法評分），但拒絕產生一份報告不會讓任何事
  // 停擺，而「安靜地報了另一家醫院」會產出一份封面寫錯的、已簽核的 PDF。
  if (!reg.readable || !reg.sheetFound || !reg.rowCount) {
    // ⚠️ 這一句是在金鑰比對**之前**丟的（金鑰就住在註冊表裡，讀不到表就比不了），
    // 所以收件人可能是完全沒有憑證的人 —— 不能說「是哪一關壞了」。
    // 但完全不給線索會變成第二個「報告快照 J1/K1」式的陷阱：只在執行時爆、
    // 指著一份試算表、而且沒有任何東西指出要去看哪裡。折衷是只講**指令碼屬性的
    // 鍵名與分頁名稱**（兩者都寫在公開的 repo 裡，不是憑證），不講 ID、不講原因。
    throw reportError_('目前無法取得演習註冊資料，請稍後再試或聯絡系統管理者。\n' +
      '（系統管理者：請檢查報告部署的指令碼屬性 ' + PROP_REGISTRY_ID_ + ' 指到的檔案是否存在、' +
      '執行帳號有無權限、裡面有沒有「' + REG_SHEET_NAME_ + '」分頁，以及該分頁的表頭是否仍有 ' +
      REG_HID_ALIASES_[0] + '／' + REG_EXID_ALIASES_[0] + '／' + REG_CONFIGID_ALIASES_[0] + '／' +
      REG_RECORDID_ALIASES_[0] + '／' + REG_KEY_ALIASES_[0] + ' 這五欄。）', 'REGISTRY_OFF');
  }

  var hit = null;
  var sameHid = 0;
  for (var i = 0; i < reg.rows.length; i++) {
    var r = reg.rows[i];
    if (r.hid !== hid) continue;
    sameHid++;
    if (r.exid === exid) {
      // 同一組 (醫院, 演習) 出現兩列有效列是不可能的（健全性規則 1 會把整組
      // 標成無效），但不假設 —— 身分絕不取決於列的順序。
      if (hit) throw reportError_('這場演習的註冊資料有問題，請聯絡系統管理者。', 'ROW_INVALID');
      hit = r;
    }
  }
  if (!hit) {
    for (var j = 0; j < reg.invalid.length; j++) {
      if (reg.invalid[j].hid === hid && reg.invalid[j].exid === exid) {
        // 無效列**對解析完全不可見**：只回一句通用訊息，絕不回另一列的資料、
        // 也絕不退回別的場次。具體原因只有後端的 action=selftest 看得到。
        throw reportError_('這場演習的註冊資料有問題，請聯絡系統管理者。', 'ROW_INVALID');
      }
    }
    if (!sameHid) {
      throw reportError_('找不到這家機構的設定（代號：' + hid + '），請確認連結是否正確。', 'NO_TENANT');
    }
    throw reportError_('找不到這場演習（機構：' + hid + '／演習：' + exid + '），請確認連結是否正確。', 'NO_EXERCISE');
  }

  // ⚠️ 授權就在這一行，而且在它之前沒有任何 Drive／Docs／UrlFetch／屬性寫入。
  if (!key || key !== hit.analysisKey) throw unauthorizedError_();

  rememberSecretId_(hit.configId);
  return {
    hid: hid,
    exid: exid,
    // 試算表 ID **只**從註冊表儲存格來，而且已經過 isSpreadsheetIdR_。
    // 代號永遠不會被拿去 openById —— 這條界線就是「這支部署不是任意 Drive
    // 讀取代理」的全部理由。
    ssId: hit.configId,
    analysisKey: key,
    displayName: hit.displayName,
    registryOff: false,
    requestedHid: hid,
    requestedExid: exid,
    runToken: ''
  };
}

// -------------------------------------------------------------------
// 租戶註冊表的最小讀取器
// -------------------------------------------------------------------
//
// ⚠️ 這是 Report.gs 第一段會讀後端資料來源的程式。ConfigWithSubmit.gs 的兩條
// 界線必須一起抄進來，否則這支部署就會變成它刻意沒有變成的那個東西：
//   (1) normSlugR_ —— 代號只允許小寫英數／-／_，最多 32 字，Date 直接拒絕；
//   (2) isSpreadsheetIdR_ —— 任何要進 openById 的字串都得先過它，而且只能
//       來自註冊表儲存格。
function trim_(s) {
  return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
}

function normSlugR_(s) {
  if (s instanceof Date) return '';
  if (s == null) return '';
  var v = String(s).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(v)) return '';
  return v;
}

function isSpreadsheetIdR_(s) {
  if (s instanceof Date) return false;
  return /^[A-Za-z0-9_-]{20,}$/.test(trim_(s));
}

function isNoR_(v) {
  if (v === false) return true;
  var s = trim_(v);
  return s === 'N' || s === 'n' || s === '否' || s === '停用' ||
    s === 'FALSE' || s === 'False' || s === 'false';
}

// 與 ConfigWithSubmit.gs 的 findHeaderCol_ 同一條規則：先整輪精確比對，
// 再做前綴比對。絕不用欄位位置。
function regFindHeaderCol_(header, names) {
  for (var i = 0; i < header.length; i++) {
    if (names.indexOf(String(header[i] || '')) !== -1) return i;
  }
  for (var j = 0; j < header.length; j++) {
    var cell = String(header[j] || '');
    for (var k = 0; k < names.length; k++) {
      if (cell.indexOf(names[k]) === 0) return j;
    }
  }
  return -1;
}

// 回傳 {readable, sheetFound, rowCount, rows:[瘦身列], invalid:[{hid,exid}]}。
// 快取 120 秒，與後端同一個數字。沒有快取的話，一個沒帶金鑰的呼叫每次都會開
// 一次 Drive 檔案 —— 這個端點的 DoS 成本就從「一次快取讀取」跳成「一次開檔」。
// ⚠️ 快取內容含 分析金鑰（後端的 reg:v2 也一樣）。它從不出現在任何回應裡，
// 但新增欄位時要記得這一格是憑證、不是普通字串。
function readReportRegistry_(registryId) {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (errCache) { cache = null; }
  if (cache) {
    var hit = cache.get(REG_CACHE_KEY_);
    if (hit) {
      try { return JSON.parse(hit); } catch (errParse) {}
    }
  }
  var out = { readable: false, sheetFound: false, rowCount: 0, rows: [], invalid: [] };
  try {
    var ss = SpreadsheetApp.openById(registryId);
    out.readable = true;
    var sheet = ss.getSheetByName(REG_SHEET_NAME_);
    if (sheet) {
      out.sheetFound = true;
      readRegRows_(sheet, out);
    }
  } catch (err) {
    // 刪檔／改名／沒權限／ID 填錯都走到這裡。刻意不分類：對報告來說三種的
    // 處置都一樣（拒絕產生），而猜原因只會把人送去檢查沒壞的東西。
  }
  if (cache) {
    try { cache.put(REG_CACHE_KEY_, JSON.stringify(out), REG_CACHE_TTL_); } catch (errPut) {}
  }
  return out;
}

function readRegRows_(sheet, out) {
  var values = sheet.getDataRange().getValues();
  var header = values.length ? values[0] : [];
  var cols = {
    hid: regFindHeaderCol_(header, REG_HID_ALIASES_),
    exid: regFindHeaderCol_(header, REG_EXID_ALIASES_),
    displayName: regFindHeaderCol_(header, REG_NAME_ALIASES_),
    configId: regFindHeaderCol_(header, REG_CONFIGID_ALIASES_),
    recordId: regFindHeaderCol_(header, REG_RECORDID_ALIASES_),
    recordSheet: regFindHeaderCol_(header, REG_RECORDSHEET_ALIASES_),
    analysisKey: regFindHeaderCol_(header, REG_KEY_ALIASES_),
    enabled: regFindHeaderCol_(header, REG_ENABLED_ALIASES_)
  };
  // 必填「欄」不見了＝整張表不能用（rowCount 留 0 → 呼叫端回 REGISTRY_OFF）。
  // 這正是 2026-10-09 那次「有人清掉 G1 表頭」的狀況：報告寧可整個拒絕，
  // 也不能在表頭壞掉時退回去報另一場。
  if (cols.hid === -1 || cols.exid === -1 || cols.configId === -1 ||
      cols.recordId === -1 || cols.analysisKey === -1) return;

  var parsed = [];
  for (var i = 1; i < values.length; i++) {
    if (regBlankRow_(values[i])) continue;
    parsed.push(parseRegRow_(cols, values[i], i + 1));
  }
  out.rowCount = parsed.length;
  assertRegSane_(parsed);
  for (var j = 0; j < parsed.length; j++) {
    var r = parsed[j];
    if (r.reasons.length) {
      // 無效列只留「有這麼一列」，不留原因、不留列號 —— 原因字串只有後端的
      // action=selftest 可以吐。
      out.invalid.push({ hid: r.hid, exid: r.exid });
      continue;
    }
    out.rows.push({
      hid: r.hid, exid: r.exid, displayName: r.displayName,
      configId: r.configId, analysisKey: r.analysisKey, enabled: r.enabled
    });
  }
}

function regBlankRow_(row) {
  for (var i = 0; i < row.length; i++) {
    if (trim_(row[i]) !== '') return false;
  }
  return true;
}

function parseRegRow_(cols, row, rowNumber) {
  var reasons = [];
  var r = {
    hid: regSlugCell_(row[cols.hid], reasons),
    exid: regSlugCell_(row[cols.exid], reasons),
    displayName: cols.displayName !== -1 ? trim_(row[cols.displayName]) : '',
    configId: regIdCell_(row[cols.configId], reasons),
    recordId: regIdCell_(row[cols.recordId], reasons),
    recordSheet: REG_DEFAULT_RECORD_SHEET_,
    analysisKey: trim_(row[cols.analysisKey]),
    // 啟用=N 的列照樣可以產報告，刻意的：演習結束（封存）之後才要做報告，
    // 與後端 action=analysis 不擋 啟用=N 是同一個理由。
    enabled: true,
    rowNumber: rowNumber,
    reasons: reasons
  };
  if (cols.recordSheet !== -1) {
    var sn = trim_(row[cols.recordSheet]);
    if (sn) r.recordSheet = sn;
  }
  if (!r.analysisKey) reasons.push('key-blank');
  if (cols.enabled !== -1) r.enabled = !isNoR_(row[cols.enabled]);
  return r;
}

function regSlugCell_(value, reasons) {
  if (value instanceof Date) { reasons.push('slug-date'); return ''; }
  var raw = trim_(value);
  if (!raw) { reasons.push('slug-blank'); return ''; }
  var slug = normSlugR_(raw);
  if (!slug) { reasons.push('slug-format'); return ''; }
  return slug;
}

function regIdCell_(value, reasons) {
  var raw = trim_(value);
  if (!raw) { reasons.push('id-blank'); return ''; }
  if (!isSpreadsheetIdR_(raw)) { reasons.push('id-format'); return ''; }
  return raw;
}

// 跨列的三條健全性規則，與 ConfigWithSubmit.gs 的 assertRegistrySane_ 同義。
// 為什麼要在這裡再做一次：如果兩邊對「哪一列有效」的判斷不同，報告會先把
// 範本複製好、才在 fetchAnalysis_ 被後端的 ROW_INVALID 擋下來，在業主的雲端
// 硬碟上留下一份孤兒 Doc。規則 2 需要 紀錄試算表ID＋分頁名稱，所以上面即使
// 報告端用不到也照讀。
// 一律「整組都標無效」而不是「第一列優先」：身分不可以取決於列的順序。
function assertRegSane_(rows) {
  markRegDuplicates_(
    rows.filter(function (r) { return r.hid && r.exid; }),
    function (r) { return r.hid + REG_KEY_SEP_ + r.exid; });
  markRegDuplicates_(
    rows.filter(function (r) { return r.recordId; }),
    function (r) { return r.recordId + REG_KEY_SEP_ + r.recordSheet; });
  // 規則 3：同一把金鑰出現在**不同** 醫院代號 才是漏洞；同一家醫院跨場次共用
  // 是刻意允許的（而且是分析平台場次下拉能運作的前提）。
  var byKey = {};
  rows.forEach(function (r) {
    if (!r.analysisKey || !r.hid) return;
    if (!byKey[r.analysisKey]) byKey[r.analysisKey] = [];
    byKey[r.analysisKey].push(r);
  });
  Object.keys(byKey).forEach(function (k) {
    var group = byKey[k];
    group.forEach(function (r) {
      var others = group.filter(function (o) { return o !== r && o.hid && o.hid !== r.hid; });
      if (others.length) r.reasons.push('key-cross-hospital');
    });
  });
  return rows;
}

function markRegDuplicates_(rows, keyOf) {
  var byKey = {};
  rows.forEach(function (r) {
    var k = keyOf(r);
    if (!byKey[k]) byKey[k] = [];
    byKey[k].push(r);
  });
  Object.keys(byKey).forEach(function (k) {
    if (byKey[k].length < 2) return;
    byKey[k].forEach(function (r) { r.reasons.push('duplicate'); });
  });
}

// -------------------------------------------------------------------
// 網頁模式的執行狀態：每輪一格 + 每場次一個標記
// -------------------------------------------------------------------

function makeRunToken_() {
  var chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < 16; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

// ⚠️ 網頁模式刻意**不**用 acquireLock_ 的 tryLock(0)。LockService 的鎖是整個
// 專案共用的：在 HTTP 入口下，A 院產報告會讓 B 院直接拿到「報告正在產生中」，
// 而且一握就是一次呼叫的六分鐘。這裡的鎖只罩「讀—改—寫執行狀態屬性」那一小段，
// 真正的互斥是每場次一個 REPORT_ACTIVE_ 標記，範圍才對。
// 代價要講明白：兩個**不同場次**的執行從此真的會並行，共用部署者的
// UrlFetchApp／Docs／Drive 配額。併發上限是「每場次一輪」，不是「整個專案一輪」。
function briefLock_() {
  var lock = null;
  try { lock = LockService.getScriptLock(); } catch (err) { return null; }
  var got = false;
  try { got = lock.tryLock(10000); } catch (err2) { got = false; }
  if (!got) throw reportError_('系統忙碌中，請稍候再試一次。', 'REPORT_BUSY');
  return lock;
}

function activeMarkerKey_(target) {
  return PROP_ACTIVE_PREFIX_ + (String(target.hid || '') || '-') + '/' +
    (String(target.exid || '') || '-');
}

function writeActiveMarker_(key, runId) {
  try {
    props_().setProperty(key, JSON.stringify({ runId: String(runId), startedAt: Date.now() }));
  } catch (err) {}
}

function readActiveMarker_(key) {
  try {
    var raw = props_().getProperty(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

// 只清自己占的那個位子。別人的位子清掉等於替別人解鎖。
function clearActiveMarker_(key, runId) {
  var cur = readActiveMarker_(key);
  if (!cur) return;
  if (runId && String(cur.runId || '') !== String(runId)) return;
  try { props_().deleteProperty(key); } catch (err) {}
}

function readActiveRunFor_(target) {
  var marker = readActiveMarker_(activeMarkerKey_(target));
  if (!marker || !marker.runId) return null;
  var st = readRunStateAt_(PROP_RUN_PREFIX_ + marker.runId);
  if (st) return st;
  // ⚠️ 標記存在、執行狀態還沒寫 —— 這是 reportStart 裡「已占位、正在跑範本與
  // 後端驗證」的那十幾秒。若在這裡回 null，連點兩下的第二次會看不到第一次、
  // 兩輪一起通過檢查，整個 (b) 層防線就只在「狀態已落地之後」才成立。
  // 用標記自己的時間戳合成一個最小的「產生中」。
  return {
    runId: String(marker.runId),
    status: 'running',
    startedAt: Number(marker.startedAt || 0),
    docUrl: ''
  };
}

// 每一次 reportContinue 的開頭：驗明正身、標記「飛行中」，然後立刻放鎖。
function beginWebStep_(runId, target) {
  var id = String(runId || '');
  if (!id) throw reportError_('這次呼叫沒有帶報告編號。', 'RUN_NOT_FOUND');
  var lock = briefLock_();
  try {
    var st = readRunStateAt_(PROP_RUN_PREFIX_ + id);
    if (!st || !st.runId) {
      throw reportError_('找不到報告編號 ' + id + ' 的紀錄（它可能已經結束並被清除）。請重新產生一份報告。',
        'RUN_NOT_FOUND');
    }
    assertRunBelongsTo_(st, target);
    if (!st.runToken || st.runToken !== String(target.runToken || '')) {
      throw reportError_('這一輪報告的驗證碼不正確。驗證碼只在開始產生時回傳一次，' +
        '重新整理分頁就會遺失，也就無法接續 —— 請改用「捨棄這一輪」之後重新產生。',
        'RUN_TOKEN_MISMATCH');
    }
    if (st.status === 'running' && Number(st.busyUntil || 0) > Date.now()) {
      throw reportError_('這一輪報告的上一次呼叫還在執行中，請稍候再試。', 'REPORT_BUSY');
    }
    if (st.status === 'running') {
      // 這個旗標只能靠時間過期，不能靠程式清：撞到 6 分鐘硬上限的執行會被
      // 直接終止，連 finally 都不保證會跑。
      st.busyUntil = Date.now() + HTTP_CALL_CAP_MS_;
      writeRunState_(st);
    }
    return st;
  } finally {
    releaseLock_(lock);
  }
}

// 終局狀態壓成墓碑：reportStatus 還答得出問題，但不再占著 8KB。
// 快照座標與 ssId 刻意保留 —— snapPending 還沒清掉時，下一次同場次的
// reportStart 要靠它們把停在「產生中」的那幾列補標成「中斷」。
//
// ⚠️ runToken 也必須保留，而且理由不是「順便」：分析平台對 reportContinue 的
// 網路錯誤會用同一組 runId+runToken 自動重試一次（那是設計的一部分，靠
// openCursor_ 的 BEGIN 標記不變式才安全）。最值得重試的一次，正好是「最後一章
// 寫完、PDF 也出了，回應卻掉在路上」那一次 —— 此時這一輪已經被 closeWebRun_
// 壓成墓碑。墓碑若不帶 runToken，beginWebStep_ 的第一個條件就不成立，重試會收到
// RUN_TOKEN_MISMATCH，而不是「這一輪已經結束（完成）」+ 文件／PDF 連結：
// 報告明明好好地躺在雲端硬碟裡，畫面卻說「已中止」，而且連「捨棄這一輪」也會
// 用同一個代碼失敗（webAbandon_ 比的是同一個欄位）。
function tombstoneOf_(st) {
  return {
    tombstone: true,
    propKey: st.propKey || '',
    webMode: st.webMode === true,
    runId: st.runId || '',
    runToken: st.runToken || '',
    hid: st.hid || '',
    exid: st.exid || '',
    ssId: st.ssId || '',
    status: st.status || '',
    identified: !!st.identified,
    startedAt: st.startedAt || 0,
    startedAtText: st.startedAtText || '',
    finishedAt: st.finishedAt || Date.now(),
    doneCount: st.doneCount || 0,
    totalCount: st.totalCount || 0,
    docUrl: st.docUrl || '',
    pdfUrl: st.pdfUrl || '',
    folderName: st.folderName || '',
    snapStartRow: st.snapStartRow || 0,
    snapCount: st.snapCount || 0,
    snapStatusCol: st.snapStatusCol || 0,
    snapPending: st.snapPending === true,
    busyUntil: 0,
    warnings: (st.warnings || []).slice(0, 12)
  };
}

function closeWebRun_(target, st) {
  try { clearActiveMarker_(activeMarkerKey_(target), st.runId); } catch (err) {}
  try {
    st.finishedAt = Date.now();
    props_().setProperty(PROP_RUN_PREFIX_ + st.runId, JSON.stringify(tombstoneOf_(st)));
  } catch (err2) {}
}

// reportStart 之前的清掃。兩個目的：
//   (1) 配額 —— 一輪完整狀態約 8KB，整個專案的指令碼屬性約 500KB，不掃會撐爆，
//       而撐爆時 reportStart 會死在一個看不懂的屬性寫入錯誤上。
//   (2) 把被關掉的分頁留下的「產生中」快照列補標成「中斷」。
// ⚠️ 改快照列的動作**只對同一場次做**：別家醫院飛行中的列絕對不能碰。
// 別的場次只壓成墓碑、保留 snapPending，等那一場自己的下一次 reportStart 處理。
function sweepStaleRuns_(target) {
  var p, keys;
  try { p = props_(); keys = p.getKeys(); } catch (err) { return; }
  var now = Date.now();
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.indexOf(PROP_RUN_PREFIX_) !== 0) continue;
    // ⚠️ 'REPORT_RUN_STATE'.indexOf('REPORT_RUN_') === 0 —— 選單模式那一格的鍵名
    // 正好通過上面的前綴比對。少了這一行，只要有人把同一份原始碼貼成「既是容器
    // 綁定、又有部署」的單一專案，一次網頁端的 reportStart 就會把選單那一輪的
    // 執行狀態壓成墓碑（queue／docId 一起沒了，接不下去也重設不回來），或在它
    // 超過 7 天後直接刪掉。網頁模式永遠不該碰選單模式的那一格。
    if (k === PROP_RUN_STATE_) continue;
    var st = readRunStateAt_(k);
    if (!st || !st.runId) { try { p.deleteProperty(k); } catch (errDel) {} continue; }

    var sameSession = !!target &&
      String(st.hid || '') === String(target.hid || '') &&
      String(st.exid || '') === String(target.exid || '');

    if (st.status === 'running') {
      if ((now - Number(st.startedAt || 0)) <= RUN_STALE_MS_) continue;
      st.status = 'failed';
      st.busyUntil = 0;
      st.snapPending = true;
      try { clearActiveMarker_(PROP_ACTIVE_PREFIX_ +
        (String(st.hid || '') || '-') + '/' + (String(st.exid || '') || '-'), st.runId); } catch (errM) {}
    } else {
      var finishedAt = Number(st.finishedAt || st.startedAt || 0);
      if (finishedAt && (now - finishedAt) > TOMBSTONE_TTL_MS_) {
        try { p.deleteProperty(k); } catch (errDel2) {}
        continue;
      }
      if (st.tombstone && !st.snapPending) continue;
    }

    if (sameSession && st.snapPending && st.snapStartRow) {
      try {
        updateSnapshotStatus_(targetSpreadsheet_(st.ssId), st.snapStartRow, st.snapCount,
          st.snapStatusCol, '中斷');
        st.snapPending = false;
      } catch (errSnap) {}
    }
    try { p.setProperty(k, JSON.stringify(tombstoneOf_(st))); } catch (errPut) {}
  }
}
