// 演習評核報告產生器（docs/multi-tenant-and-report-plan.md §3.1 的「方案 B」）。
//
// ⚠️ 這是一支**容器綁定**腳本，必須貼在「演習評核_設定」那份試算表底下
// （擴充功能 → Apps Script），不是獨立專案、也不是 Web App。
// 容器綁定腳本**不需要部署**：存檔、重新載入試算表，選單就出現了。
// 這一點就是整個方案 B 的全部理由 —— 業主拉不動「重新部署 Web App」那根槓桿
// （選錯「新增部署」會換掉 /exec 網址、靜靜打壞評核單與分析頁，見 CLAUDE.md
// 「Backend / data architecture」那一節），所以報告功能一行都不能碰
// ConfigWithSubmit.gs。
//
// 它與後端的關係只有一條：用 UrlFetchApp 打 ConfigWithSubmit.gs 的
// `action=analysis`，然後把回傳的數字排版進一份 Google 文件。
// **報告裡的統計數字一律原樣取自該 payload，絕不另算**，否則儀表板與紙本報告
// 會互相打架，而業主沒有任何辦法判斷哪一個才對。唯一的例外是 ICC(2,k) 的
// 「本機驗算」（見 verifyIcc_）：stats.icc2k 是一個裸數字，而且只要有一題
// 只被一位評核官評過，整個資料集就會變 null（plan §4.4），報告必須能具名說出
// 是哪幾題造成的，不然封面印一個「—」沒人知道為什麼。
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

// ===== 指令碼屬性鍵 =====
var PROP_ANALYSIS_KEY_ = 'REPORT_ANALYSIS_KEY';
var PROP_API_URL_ = 'REPORT_API_URL';
var PROP_TEMPLATE_ID_ = 'REPORT_TEMPLATE_DOC_ID';
var PROP_OUTPUT_FOLDER_ = 'REPORT_OUTPUT_FOLDER_ID';
var PROP_TENANT_ = 'REPORT_TENANT';
var PROP_EXERCISE_ = 'REPORT_EXERCISE';
var PROP_BUDGET_ = 'REPORT_TIME_BUDGET_MS';
var PROP_RUN_STATE_ = 'REPORT_RUN_STATE';

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
// ⚠️ 那個上限是**位元組**，而 payload 幾乎全是中文（題目、情境目標、指標、
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
  '階段', '項目名稱', '情境編號', '測試情境與目標', '指標', '評核潛能',
  '4S 元素', '評核題目', '評核人數', '平均', '標準差', '未觸發數', '標籤來源'
];

// 封面 token。範本裡原字打上（含兩層大括號）就會被替換；沒打的不會報錯，
// 只在驗證關卡回報「缺 token」當成警告。
// ⚠️ {{報告版次}} 刻意不在這張表裡：那一格是留給業主在複本裡自己填的。
var COVER_TOKENS_ = [
  '{{機構名稱}}', '{{演習名稱}}', '{{演習主題}}', '{{演習類別}}', '{{演習日期}}',
  '{{機構代號}}', '{{演習代號}}', '{{評核官人數}}', '{{資料列數}}',
  '{{報告產生時間}}', '{{報告編號}}', '{{匿名模式}}'
];

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
  { id: 'SCENE', token: '{{SEC_情境}}', title: '九、情境逐項分析', required: false },
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

var DRAFT_BANNER_ = '草稿 — 產生未完成（本份報告尚未完成，請勿分發）';
var WIP_SUFFIX_ = '（產生中）';
var PARTIAL_SUFFIX_ = '（部分完成）';

// A4 直式、上下左右 2.54cm 時的本文寬度約 451pt。圖片一律縮到這個寬度以內，
// 否則 Google 文件會自己把圖推到超出版面。
var IMAGE_WIDTH_PT_ = 440;
// 單一表格的列數上限。Docs 的表格每一列都是一次 API 動作，上千列會直接吃掉
// 整個時間預算；超過就截斷並在章節尾端說明（截斷必須說出來，不能無聲）。
var TABLE_ROW_CAP_ = 300;

var S4_PREFERRED_ORDER_ = ['Space (空間)', 'Staff (人員)', 'Stuff (物資)', 'System (系統)'];
var POTENTIALS_ = ['回應', '監測', '預期'];

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
    alertError_('無法開啟對話框：' + msg_(err) +
      '\n\n請確認這個 Apps Script 專案裡有一個名為「ReportDialog」的 HTML 檔案' +
      '（檔案 → 新增 → HTML，命名 ReportDialog，再把 apps-script/ReportDialog.html 的內容貼進去）。');
  }
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
    [PROP_ANALYSIS_KEY_, '必填', '本場演習的「分析金鑰」。單一演習模式下＝後端 ConfigWithSubmit.gs 的 ANALYSIS_KEY 常數值；啟用租戶註冊表後＝該列的 分析金鑰。', true],
    [PROP_API_URL_, '必填', '後端 Web App 的 /exec 網址（RECORD_URL 那一支，只有它有 action=analysis）。', false],
    [PROP_TEMPLATE_ID_, '必填', '報告範本 Google 文件的檔案 ID（網址 /d/ 與 /edit 之間那一段）。', false],
    [PROP_OUTPUT_FOLDER_, '選填', '報告 Doc 與 PDF 的輸出資料夾 ID。未設時用這份試算表所在的資料夾。', false],
    [PROP_TENANT_, '選填', '醫院代號。有設就帶上 &t=，並要求後端回的 meta.tenant 完全相符。單一演習模式請留空。', false],
    [PROP_EXERCISE_, '選填', '演習代號。規則同上，對應 &ex=。', false],
    [PROP_BUDGET_, '選填', '單次步驟的時間預算毫秒數，預設 ' + DEFAULT_BUDGET_MS_ + '（低於 6 分鐘硬上限約兩分鐘的安全邊際）。', false],
    [PROP_RUN_STATE_, '程式維護', '執行紀錄，業主不要手動設。卡住時用選單的「重設產生狀態」清除。', false]
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
    '所以不需要、也不應該持有管理金鑰。</p></div>';
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
    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(TEMP_SHEET_NAME_);
    if (sh) {
      resetTempSheet_(sh);
      notes.push('✅ 已清空 ' + TEMP_SHEET_NAME_);
    } else {
      notes.push('ℹ️ 沒有 ' + TEMP_SHEET_NAME_ + ' 分頁，不需要清');
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
// 畫面與紙本報告對不起來（「情境 D2」在兩份文件上指到不同的東西）。
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
function requireConfig_() {
  var cfg = {
    analysisKey: prop_(PROP_ANALYSIS_KEY_),
    apiUrl: prop_(PROP_API_URL_),
    templateId: prop_(PROP_TEMPLATE_ID_),
    outputFolderId: prop_(PROP_OUTPUT_FOLDER_),
    tenant: prop_(PROP_TENANT_),
    exercise: prop_(PROP_EXERCISE_),
    budgetMs: DEFAULT_BUDGET_MS_
  };
  var where = '（設定位置：擴充功能 → Apps Script → ⚙ 專案設定 → 指令碼屬性 → 新增指令碼屬性）';
  var missing = [];
  if (!cfg.analysisKey) missing.push(PROP_ANALYSIS_KEY_ + '：本場演習的分析金鑰，與分析儀表板網址 ?key= 的那一串相同');
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
  return cfg;
}

function readRunState_() {
  try {
    var raw = props_().getProperty(PROP_RUN_STATE_);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    // 壞掉的 JSON 當成「沒有紀錄」，不要讓它把整個功能卡死。
    return null;
  }
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
  copy.iccNote = '';
  return JSON.stringify(copy);
}

// 絕不丟例外。
// 為什麼：這個函式在 reportContinue 的**最後一行**被呼叫，也就是 PDF 已經
// 建好、文件已經寫完之後。讓它丟錯會被外層 catch 接住，把一輪其實已經成功的
// 執行標成 failed、把快照改成「中斷」，而業主手上明明有一份完整的 PDF。
// 寫不進去最壞的後果只是「開啟上一份報告」少一筆紀錄，遠比假失敗輕。
function writeRunState_(st) {
  try {
    props_().setProperty(PROP_RUN_STATE_, serializeRunState_(st));
    return true;
  } catch (err) {
    // 最後手段：只留「找得回那份文件」與「下一個步驟還接得下去」所需的欄位。
    // queue／unwritten／snap 座標／fingerprint 都很小但缺一不可 —— 少了 queue，
    // 下一次 reportContinue 會以為已經寫完而直接收尾，產出一份沒有內容的報告。
    try {
      props_().setProperty(PROP_RUN_STATE_, JSON.stringify({
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
// getDocumentLock() 在容器綁定情境下比較貼切，但 getScriptLock() 一定存在。
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
    throw new Error('後端分析服務回應 HTTP ' + code + '。\n' +
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
      throw new Error('分析金鑰不正確（後端回「unauthorized」）。\n' +
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
// ICC(2,k) 本機驗算（規則「數字一律取自後端」的唯一例外）
// ===================================================================

// 為什麼要重算一次：stats.icc2k 是一個裸數字，而且交集是跨**每一列**取的
// —— 只要有一題只被一位評核官評過，commonCodes 就對整個資料集崩潰，26 列
// 全部拿到 null（plan §4.4）。封面印一個「—」而不說是哪幾題造成的，讀者
// 無從判斷「信度不足」還是「資料結構問題」。這裡用與後端 icc2k_ 逐行相同的
// Shrout–Fleiss 公式重算，並回報納入的評核官數／題數，以及讓交集崩潰的題號。
function verifyIcc_(payload) {
  var rows = chartRows_(payload);
  var out = {
    remote: (payload.stats || {}).icc2k,
    local: null,
    match: false,
    raters: 0,
    questions: rows.length,
    reasons: [],
    note: ''
  };
  if (!rows.length) {
    out.note = '沒有可用的評分列，無法計算。';
    out.match = (out.remote === null || out.remote === undefined);
    return out;
  }
  var common = null;
  for (var i = 0; i < rows.length; i++) {
    var codes = [];
    var sc = rows[i].scores || [];
    for (var j = 0; j < sc.length; j++) codes.push(sc[j].code);
    if (codes.length < 2) {
      out.reasons.push('題號 ' + txt_(rows[i].questionId) + '：只有 ' + codes.length + ' 位評核官評過');
    }
    if (common === null) {
      common = codes.slice();
    } else {
      var before = common.length;
      var next = [];
      for (var k = 0; k < common.length; k++) {
        if (codes.indexOf(common[k]) !== -1) next.push(common[k]);
      }
      if (next.length < before && next.length < 2) {
        out.reasons.push('題號 ' + txt_(rows[i].questionId) + '：評核官交集在此題降到 ' + next.length + ' 人');
      }
      common = next;
    }
  }
  out.raters = common ? common.length : 0;
  if (!common || common.length < 2) {
    out.note = '所有題目共同的評核官不足 2 人，依定義無法計算（後端也會回 null）。';
    out.match = (out.remote === null || out.remote === undefined);
    return out;
  }
  var matrix = [];
  for (var r = 0; r < rows.length; r++) {
    var byCode = {};
    var s2 = rows[r].scores || [];
    for (var m2 = 0; m2 < s2.length; m2++) byCode[s2[m2].code] = s2[m2].score;
    var line = [];
    for (var c = 0; c < common.length; c++) line.push(byCode[common[c]]);
    matrix.push(line);
  }
  var n = matrix.length, kk = common.length;
  if (n < 2) {
    out.note = '題目不足 2 題，依定義無法計算。';
    out.match = (out.remote === null || out.remote === undefined);
    return out;
  }
  var flat = [];
  for (var a = 0; a < matrix.length; a++) flat = flat.concat(matrix[a]);
  var grand = avg_(flat);
  var ssRow = 0, ssCol = 0, ssTotal = 0;
  for (var b = 0; b < matrix.length; b++) {
    var rm = avg_(matrix[b]);
    ssRow += kk * (rm - grand) * (rm - grand);
    for (var d = 0; d < matrix[b].length; d++) ssTotal += (matrix[b][d] - grand) * (matrix[b][d] - grand);
  }
  for (var col = 0; col < kk; col++) {
    var colVals = [];
    for (var e = 0; e < matrix.length; e++) colVals.push(matrix[e][col]);
    var cm = avg_(colVals);
    ssCol += n * (cm - grand) * (cm - grand);
  }
  var msr = ssRow / (n - 1);
  var msc = ssCol / (kk - 1);
  var mse = (ssTotal - ssRow - ssCol) / ((n - 1) * (kk - 1));
  var denom = msr + (msc - mse) / n;
  out.local = denom ? (msr - mse) / denom : null;
  if (out.local === null || out.remote === null || out.remote === undefined) {
    out.match = (out.local === null && (out.remote === null || out.remote === undefined));
  } else {
    out.match = Math.abs(Number(out.local) - Number(out.remote)) <= 1e-6;
  }
  out.note = out.match
    ? '已驗算一致（納入 ' + out.raters + ' 位評核官 × ' + n + ' 題）。'
    : '⚠ 驗算不一致：後端 ' + num_(out.remote, 4) + '，本機 ' + num_(out.local, 4) +
      '（納入 ' + out.raters + ' 位評核官 × ' + n + ' 題）。';
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
        '情境編號': shortScene_(r.itemName, prefix),
        '測試情境與目標': String(r.goal || ''),
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
function resolveOutputFolder_(cfg) {
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
      var parents = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents();
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
function reportValidateOnly() {
  var checks = [];
  var ok = true;
  function add(label, pass, detail) {
    checks.push({ label: label, ok: !!pass, detail: String(detail || '') });
    if (!pass) ok = false;
  }

  var st = readRunState_();
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
    cfg = requireConfig_();
    add('指令碼屬性', true, '必填三項齊備；單次時間預算 ' + cfg.budgetMs + ' ms。' +
      (cfg.tenant || cfg.exercise ? '　指定租戶：' + (cfg.tenant || '（空）') + ' / ' + (cfg.exercise || '（空）') : '　未指定租戶（單一演習模式）。'));
  } catch (err) {
    add('指令碼屬性', false, msg_(err));
    return { ok: false, checks: checks };
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
      scan = scanAnchors_(tpl.doc);
      var foundIds = [];
      var missingOptional = [];
      var missingRequired = [];
      for (var i = 0; i < SECTIONS_.length; i++) {
        var sec = SECTIONS_[i];
        if (scan.found[sec.id]) foundIds.push(sec.title);
        else if (sec.required) missingRequired.push(sec.token + '（' + sec.title + '）');
        else missingOptional.push(sec.token + '（' + sec.title + '）');
      }
      add('必要章節錨點', missingRequired.length === 0,
        missingRequired.length ? '缺少：' + missingRequired.join('、') : '六個必要錨點齊備。');
      add('錨點位置', scan.problems.length === 0,
        scan.problems.length ? scan.problems.join('　／　') : '所有錨點都單獨占一個本文最上層段落。');
      checks.push({
        label: '將產生的章節', ok: true,
        detail: '共 ' + foundIds.length + ' 章：' + foundIds.join('、') +
          (missingOptional.length ? '　｜　範本未放錨點、因此不產生：' + missingOptional.join('、') : '')
      });
      checks.push({
        label: '封面 token', ok: true,
        detail: scan.coverMissing.length
          ? '⚠ 範本裡找不到這些 token（不影響產生，只是這些欄位不會被填）：' + scan.coverMissing.join('、')
          : '全部 12 個封面 token 都在範本裡。'
      });
    } catch (err3) {
      add('章節錨點', false, '掃描範本時發生錯誤：' + msg_(err3));
    }
  }

  try {
    var folder = resolveOutputFolder_(cfg);
    probeFolderWritable_(folder);
    add('輸出資料夾', true, '「' + safeName_(folder) + '」可寫入（已用 0 位元組暫存檔實測並刪除）。');
  } catch (err4) {
    add('輸出資料夾', false, msg_(err4));
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
    if (cfg.tenant || cfg.exercise) {
      var tOk = (!cfg.tenant || String(m.tenant || '') === cfg.tenant) &&
        (!cfg.exercise || String(m.exercise || '') === cfg.exercise);
      add('租戶身分比對', tOk, tOk
        ? '後端回的 tenant/exercise 與指令碼屬性一致（' + txt_(m.tenant) + ' / ' + txt_(m.exercise) + '）。'
        : '不一致！屬性要求 ' + (cfg.tenant || '（空）') + ' / ' + (cfg.exercise || '（空）') +
          '，後端實際回 ' + txt_(m.tenant) + ' / ' + txt_(m.exercise) +
          '。請檢查 ' + PROP_ANALYSIS_KEY_ + ' 是否用到了別場演習的金鑰。');
    } else {
      add('租戶身分比對', true, '未設定 ' + PROP_TENANT_ + '／' + PROP_EXERCISE_ +
        '，略過比對（後端 tenantSource=' + txt_(m.tenantSource) + '）。');
    }
    var activeName = '';
    try { activeName = SpreadsheetApp.getActive().getName(); } catch (errN) {}
    checks.push({
      label: '設定檔名稱比對', ok: true,
      detail: (m.configFileName && activeName && m.configFileName !== activeName)
        ? '⚠ 後端讀的設定檔叫「' + m.configFileName + '」，本試算表叫「' + activeName +
          '」。若只是改過檔名可以忽略；若不是同一份檔案，報告會印出別場演習的數字。'
        : '一致（' + txt_(m.configFileName) + '）。'
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

    var icc = verifyIcc_(payload);
    checks.push({
      label: 'ICC(2,k) 本機驗算', ok: true,
      detail: icc.note + (icc.reasons.length ? '　造成交集縮小的題目：' + icc.reasons.slice(0, 8).join('；') +
        (icc.reasons.length > 8 ? ' …等 ' + icc.reasons.length + ' 題' : '') : '')
    });
  }

  try {
    var cap = chartCapability_(SpreadsheetApp.getActive());
    // ⚠ 誠實揭露：這一關與上面的「輸出資料夾」是整個檢查流程裡唯二會寫東西的
    // 兩步 —— 它必須真的畫一張圖才知道能不能畫，而畫圖需要一份資料落在某個
    // 工作表上。寫的對象只有隱藏分頁 _報告暫存（固定名稱、跨執行重複使用、
    // 探測完就清空），不會碰任何正式工作表，後端也從不以這個名稱讀取任何分頁。
    // 對話框會把這兩項副作用原字印給業主看。
    checks.push({
      label: '圖表能力探測', ok: true,
      detail: cap.detail.join('　／　') +
        '　（探測會在隱藏分頁「' + TEMP_SHEET_NAME_ + '」寫入並隨即清除一組假資料，' +
        '不會動到任何正式工作表，也不會建立任何檔案。）'
    });
  } catch (err6) {
    checks.push({ label: '圖表能力探測', ok: true, detail: '探測失敗（' + msg_(err6) + '），圖表將全部改以數值表呈現。' });
  }

  try {
    var info = ensureSnapshotSheet_(SpreadsheetApp.getActive(), false);
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

  return { ok: ok, checks: checks };
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
function reportStart(opts) {
  var lock = null;
  try {
    opts = opts || {};
    lock = acquireLock_();

    var prev = readRunState_();
    if (prev && prev.status === 'running' && (Date.now() - Number(prev.startedAt || 0)) < RUN_STALE_MS_) {
      throw new Error('上一輪報告（編號 ' + prev.runId + '）仍在產生中。\n' +
        (prev.docUrl ? '文件連結：' + prev.docUrl + '\n' : '') +
        '請等它完成，或使用選單的「' + MENU_TITLE_ + ' → 重設產生狀態」之後再試一次。');
    }

    var cfg = requireConfig_();

    // 識別模式三道門，缺一不可：勾選、二次確認、範本有 {{SEC_評核官差異}} 錨點。
    // commit 54b33dd 刻意把具名逐評核官分數表從儀表板上拿掉，方案B 不得成為
    // 繞過它的後門，所以伺服器端自己也要檢查一次，不能只信任對話框。
    var identified = opts.identified === true && opts.identifiedConfirmed === true;
    if (opts.identified === true && opts.identifiedConfirmed !== true) {
      throw new Error('識別模式需要二次確認。請重新勾選「附上可識別的評核官代號」並在確認視窗按下確定。');
    }

    var tpl = openTemplateDoc_(cfg.templateId);
    var scan = scanAnchors_(tpl.doc);
    assertRequiredAnchors_(scan);

    if (identified && !scan.found.EVALUATOR) {
      identified = false;
      opts.identifiedDowngraded = true;
    }

    var folder = resolveOutputFolder_(cfg);
    probeFolderWritable_(folder);

    var payload = fetchAnalysis_(cfg);
    var meta = payload.meta || {};

    if (cfg.tenant && String(meta.tenant || '') !== cfg.tenant) {
      throw new Error('租戶身分不符：指令碼屬性 ' + PROP_TENANT_ + ' 設為「' + cfg.tenant +
        '」，但後端回傳的是「' + txt_(meta.tenant) + '」。\n' +
        '這通常表示 ' + PROP_ANALYSIS_KEY_ + ' 用到了別場演習的金鑰。已中止，以免產出' +
        '「封面是這一院、分數是另一院」的報告。');
    }
    if (cfg.exercise && String(meta.exercise || '') !== cfg.exercise) {
      throw new Error('演習身分不符：指令碼屬性 ' + PROP_EXERCISE_ + ' 設為「' + cfg.exercise +
        '」，但後端回傳的是「' + txt_(meta.exercise) + '」。已中止。');
    }

    var totalRows = (payload.analysisRows || []).length + (payload.coverageRows || []).length +
      (payload.learningRows || []).length;
    if (totalRows === 0 || (meta.evaluatorCodes || []).length < 1) {
      throw new Error('紀錄表目前沒有可用的評分資料，請確認是否已有評核官送出。');
    }

    var ss = SpreadsheetApp.getActive();
    ensureSnapshotSheet_(ss); // 欄位不符要在建立任何檔案之前就擋下來。

    var runId = makeRunId_();
    var startedAt = Date.now();
    var st = {
      runId: runId,
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
      iccNote: ''
    };

    if (opts.identifiedDowngraded) {
      addWarning_(st, '範本缺少 {{SEC_評核官差異}} 錨點，識別模式無處輸出，已自動改回匿名模式。');
    }
    if (scan.coverMissing.length) {
      addWarning_(st, '範本缺少封面 token：' + scan.coverMissing.join('、') + '（這些欄位不會被填）。');
    }
    if (totalRows > 400) {
      addWarning_(st, '資料量較大（' + totalRows + ' 題），產生時間會較長，部分章節可能被時間預算跳過。');
    }
    if (String(meta.tenantSource || '') === 'fallback' && (cfg.tenant || cfg.exercise)) {
      addWarning_(st, '後端 tenantSource 為 fallback，指定的租戶代號沒有實際路由效果（註冊表尚未啟用）。');
    }

    var icc = verifyIcc_(payload);
    st.iccNote = icc.note;
    if (!icc.match) addWarning_(st, 'ICC(2,k) 本機驗算與後端數值不一致，兩個數字都會印在第四章與附錄C。');

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

    var plan = planFromScan_(scan, opts);
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
        addWarning_(st, '產生中斷：' + msg_(err));
        writeRunState_(st);
        updateSnapshotStatus_(SpreadsheetApp.getActive(), st.snapStartRow, st.snapCount,
          st.snapStatusCol, '中斷');
      }
    } catch (err2) {}
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

function titleOf_(id) {
  var s = sectionById_(id);
  return s ? s.title : id;
}

// 每一次 google.script.run 都是一次獨立執行，各有自己的六分鐘額度。
// 這裡在寫下一章之前檢查本次呼叫已經用掉多少時間，超出預算就結束這次呼叫、
// 回 done:false，由對話框再發一次。**至少寫一章**才檢查預算，否則預算設太小
// 時會變成永遠在來回而不前進。
function reportContinue(runId) {
  var lock = null;
  var st = null;
  try {
    lock = acquireLock_();
    st = readRunState_();
    if (!st || !st.runId) {
      throw new Error('找不到進行中的產生作業（可能已被「重設產生狀態」清除）。請重新產生一份報告。');
    }
    if (runId && st.runId !== runId) {
      throw new Error('執行紀錄的報告編號（' + st.runId + '）與對話框的（' + runId +
        '）不符，可能有另一輪產生作業插進來了。請重新產生一份報告。');
    }
    if (st.status !== 'running') {
      return progress_(st, '這一輪已經結束（' + statusText_(st.status) + '）', true);
    }

    var cfg = requireConfig_();
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
        for (var qi = 0; qi < st.queue.length; qi++) {
          if (LAST_WRITTEN_SECTIONS_.indexOf(st.queue[qi]) === -1) drop.push(st.queue[qi]);
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
          addWarning_(st, '已超過跨步驟總時間預算，' + drop.length + ' 章未產生；' +
            '仍會補上附錄C／附錄D 以記錄這件事。');
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
      writeSection_(doc, id, ctx);
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
    writeRunState_(st);
    return progress_(st, label, finished);
  } catch (err) {
    if (st && st.runId && st.status === 'running') {
      st.status = 'failed';
      addWarning_(st, '產生中斷：' + msg_(err));
      try { writeRunState_(st); } catch (err2) {}
      try {
        updateSnapshotStatus_(SpreadsheetApp.getActive(), st.snapStartRow, st.snapCount,
          st.snapStatusCol, '中斷');
      } catch (err3) {}
    }
    return failure_(err, st);
  } finally {
    releaseLock_(lock);
  }
}

function buildContext_(st, payload, cfg) {
  var ss = SpreadsheetApp.getActive();
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
    icc: verifyIcc_(payload),
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
  if (body) {
    for (var i = 0; i < all.length; i++) {
      var sec = sectionById_(all[i]);
      if (!sec) continue;
      try {
        body.replaceText(tokenPattern_(sec.token), '（本節未產生：產生程序依時間預算中止）');
      } catch (err2) {}
      if (i < remaining.length) ctx.skip(sec.title, '時間預算用盡，未產生');
    }
    // 2) 殘留的 BEGIN 標記（上一次寫到一半留下的）。
    for (var j = 0; j < SECTIONS_.length; j++) {
      try { removeParagraphByText_(body, beginMarker_(SECTIONS_[j].id)); } catch (err3) {}
    }
  }

  var partial = aborted || all.length > 0;

  // 3) 草稿橫幅：完成才移除，部分完成時刻意留著。
  if (body && !partial) {
    try { removeParagraphByText_(body, DRAFT_BANNER_); } catch (err4) {}
  } else if (body && partial) {
    try {
      body.replaceText(tokenPattern_(DRAFT_BANNER_),
        '草稿 — 產生未完成（本報告有 ' + all.length + ' 節未產生，詳見附錄D，請勿分發）');
    } catch (err5) {}
  }

  // 4) 殘留的 {{ 掃描：token 打錯字時 replaceText 完全靜默，PDF 上就會留著
  //    一串 {{機構名稱}}。這一關是最後一次抓到它的機會。
  if (body) {
    try {
      if (body.findText('\\{\\{')) {
        addWarning_(st, '文件裡仍有未被替換的 {{…}} 字樣，請檢查範本的 token 是否打錯字。');
      }
    } catch (err6) {}
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
    var folder = resolveOutputFolder_(ctx.cfg);
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
    runId: st ? st.runId : '',
    step: st ? (st.doneCount || 0) : 0,
    totalSteps: st ? (st.totalCount || 0) : 0,
    label: '已中止',
    done: true,
    status: 'failed',
    error: msg_(err),
    warnings: st ? (st.warnings || []).slice() : [],
    docUrl: st ? (st.docUrl || '') : '',
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
  rows.push(['ICC(2,k)', num_(st.icc2k, 4), ctx.icc.note]);
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
  bullet_(cursor, '三項潛能分析只納入「回應、監測、預期」三類題目；「學習」類題目排除在統計之外，另列於學習潛能觀察一章。');
  bullet_(cursor, '各指標分數為所有評核官對該題評分的算術平均；4S 類別平均為該類別內所有題目 × 所有評核官評分的平均。');
  bullet_(cursor, 'ICC(2,k)：Shrout–Fleiss 雙向隨機效果、平均量測的一致性指標。只取「所有題目都有評分的評核官」交集計算，交集不足 2 人或題目不足 2 題時無法計算。範圍涵蓋三項潛能與覆蓋率題目（不含學習）。');
  bullet_(cursor, '「相差不超過 1 分」比例：逐題取該題所有已評分的評核官兩兩配對，計算分數差 ≤ 1 的配對占全部配對的比例。不要求各題的評核官一致，範圍與 ICC 相同。');
  bullet_(cursor, '未觸發率：評分等於 1 分的個數占該範圍內全部評分的比例。範圍與 ICC 相同（三項潛能＋覆蓋率題目，不含學習），因此它的分母小於本報告的評分總數。1 分的定義是「劇本未走到此條件」，與 2–5 分的表現評價不同質。');
  bullet_(cursor, '等權聲明：所有題目、所有評核官在各項平均中權重相同。本系統沒有題目權重欄位，也沒有關鍵題標記，因此無法產生加權總分。');
  para_(cursor, '本章除評分尺度取自本試算表的「評分標準」工作表外，所有統計數值均直接取自後端 action=analysis 的回傳值，報告端不另行計算，以確保與分析儀表板完全一致。唯一的例外是 ICC(2,k) 的本機驗算，結果列於第四章與附錄C。');
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
    var rows = [['題號', '階段', '項目名稱', '測試情境與目標']];
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
    ' 個是 1 分，占 ' + pct_(un.rate) + '（本項不含「學習」潛能題目，範圍與 ICC 相同，' +
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
    '「join」的題目，其階段／情境／指標／潛能／4S 標籤反映的是設定試算表「現在」的內容；' +
    '若設定表在本次演習之後被修改過，這些標籤會跟著改變。自本份報告起，' +
    '「' + SNAPSHOT_SHEET_NAME_ + '」工作表已把本次的標籤與數字凍結留存。');

  heading_(cursor, 'ICC(2,k) 本機驗算', 2);
  var icc = ctx.icc;
  para_(cursor, '後端回傳值：' + num_(icc.remote, 4) + '；本機以相同的 Shrout–Fleiss 公式重算：' +
    num_(icc.local, 4) + '。' + icc.note);
  if (icc.reasons.length) {
    para_(cursor, '以下題目使「所有題目共同的評核官」交集縮小，是 ICC 無法計算或偏低的直接原因：');
    for (var r = 0; r < Math.min(icc.reasons.length, 20); r++) bullet_(cursor, icc.reasons[r]);
    if (icc.reasons.length > 20) para_(cursor, '（其餘 ' + (icc.reasons.length - 20) + ' 題略）');
  }

  heading_(cursor, '本報告無法提供的品質資訊', 2);
  bullet_(cursor, '應評配置表（哪一位評核官應該評哪些情境）：系統沒有這份資料，因此「每個情境是否都有足夠人數評核」無法計算，評核官人數只是「實際出現過的代號聯集」。');
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
  var keys = s4Keys_(st);
  var pbs = st.potentialByS4 || {};
  if (keys.length) {
    // ⚠️ 沒有題目的格子一律留空白，**絕不填 0**。
    // 這張圖的值域是 1–5 分，一根高度 0 的柱子在圖上讀起來是「這個面向得 0 分」
    // ——「監測潛能在人員面向得 0 分」會被當成頭號發現提報，而真相是那個組合
    // 根本沒有題目。Sheets 的圖表把空白格當成缺口（不畫），正是要的行為；
    // 而數值表那條降級路線收到 '' 時，num_ 也會印成「—」，兩條路一致。
    // 同理，整欄都沒有資料的 4S 類別直接不進圖，不留一根空軸。
    var liveKeys = [];
    for (var kk = 0; kk < keys.length; kk++) {
      var hasAny = false;
      for (var pp = 0; pp < POTENTIALS_.length; pp++) {
        var probe = (pbs[POTENTIALS_[pp]] || {})[keys[kk]] || {};
        if (probe.n) { hasAny = true; break; }
      }
      if (hasAny) liveKeys.push(keys[kk]);
    }
    var headers2 = ['潛能'].concat(liveKeys);
    var rows2 = [];
    for (var a = 0; a < POTENTIALS_.length; a++) {
      var line = [POTENTIALS_[a]];
      var any = false;
      for (var b = 0; b < liveKeys.length; b++) {
        var cell = (pbs[POTENTIALS_[a]] || {})[liveKeys[b]] || {};
        if (cell.n) any = true;
        line.push(cell.n ? Number(cell.mean) : '');
      }
      if (any) rows2.push(line);
    }
    if (liveKeys.length && rows2.length) {
      emitChart_(cursor, ctx, { title: '圖2　潛能 × 4S 交叉平均', type: 'COLUMN', headers: headers2, rows: rows2 });
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

  var rows = [];
  for (var i = 0; i < keys.length; i++) {
    var s = st.s4[keys[i]] || {};
    rows.push([keys[i], Number(s.mean || 0)]);
  }
  rows.sort(function (a, b) { return b[1] - a[1]; });
  emitChart_(cursor, ctx, { title: '圖3　4S 整備平均', type: 'BAR', headers: ['4S 元素', '平均分'], rows: rows });

  var t = [['4S 元素', '評分數', '平均', '標準差']];
  for (var j = 0; j < rows.length; j++) {
    var ss = st.s4[rows[j][0]] || {};
    t.push([rows[j][0], String(ss.n || 0), num_(ss.mean, 2), num_(ss.sd, 2)]);
  }
  table_(cursor, t);

  // 各情境對各 4S 的平均。分群規則與 Analysis.html 的 renderS4 相同
  // （以 shortScene 為鍵、取該情境在該 4S 類別下全部評分的平均）。
  // 這裡刻意用「長格式」而不是矩陣：情境數一多，矩陣表會寬到印不下。
  heading_(cursor, '各情境在各 4S 類別的平均', 2);
  var bucket = {};
  var scenarioText = {};
  var arows = ctx.payload.analysisRows || [];
  for (var k = 0; k < arows.length; k++) {
    var r = arows[k];
    // 對照表要建在 4S 過濾**之前**：Analysis.html 的 renderS4 就是用全部
    // analysisRows 建它的，而一個情境的題目若 4S 元素欄留空，它仍然是一個
    // 存在的情境。兩邊規則不一致會讓讀者在儀表板上看到一個情境、在歸檔報告的
    // 對照表裡卻找不到，無從判斷哪一份才對。
    var code = shortScene_(r.itemName, ctx.prefix);
    if (!scenarioText[code]) scenarioText[code] = r.goal || r.itemName || '';
    if (!r.s4) continue;
    var key = r.s4 + '␟' + code;
    if (!bucket[key]) bucket[key] = [];
    var sc = r.scores || [];
    for (var s2 = 0; s2 < sc.length; s2++) bucket[key].push(sc[s2].score);
  }
  var detail = [['4S 元素', '情境編號', '評分數', '平均']];
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
  else para_(cursor, '沒有可分群的情境資料。');

  heading_(cursor, '情境編號對照表', 2);
  var allCodes = [];
  for (var code2 in scenarioText) {
    if (Object.prototype.hasOwnProperty.call(scenarioText, code2)) allCodes.push(code2);
  }
  allCodes.sort(naturalCompare_);
  var mapRows = [['情境編號', '測試情境與目標']];
  for (var mc = 0; mc < allCodes.length; mc++) {
    mapRows.push([allCodes[mc], txt_(scenarioText[allCodes[mc]])]);
  }
  table_(cursor, mapRows);
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
    var chartRows = [];
    for (var k = 0; k < rows.length; k++) {
      chartRows.push([cleanIndicator_(rows[k].indicator) || rows[k].questionId || '（未命名）', Number(rows[k].mean || 0)]);
    }
    emitChart_(cursor, ctx, {
      title: '圖' + figureNo + '　' + p + '潛能各指標平均',
      type: 'RADAR', headers: ['指標', '平均分'], rows: chartRows
    });
    figureNo++;
    var t = [['情境編號', '指標', '評核題目', '平均', '標準差']];
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
  var chartRows = [];
  for (var i = 0; i < rows.length; i++) {
    chartRows.push([cleanIndicator_(rows[i].indicator) || rows[i].questionId || '（未命名）', Number(rows[i].mean || 0)]);
  }
  emitChart_(cursor, ctx, { title: '圖7　演習覆蓋率各指標平均', type: 'RADAR', headers: ['指標', '平均分'], rows: chartRows });
  var t = [['情境編號', '指標', '評核題目', '平均', '標準差']];
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
  // 量規圖刻意不做：Charts 的 GAUGE 可用性不確定，而且它傳達的資訊就是上面
  // 那一個平均值，做一張圖沒有增加任何東西。
}

// ===================================================================
// R9 九、情境逐項分析
// ===================================================================

// 這是資料量最大的一章，所以它自己逐群檢查時間預算：寫不完的情境群組會被
// 具名列出來並記進附錄D，而不是讓整個步驟撞上六分鐘硬上限被強制終止
// （硬上限終止時連 finally 都不保證會跑，什麼都救不回來）。
function sectionScene_(cursor, ctx) {
  heading_(cursor, sectionById_('SCENE').title, 1);
  var rows = chartRows_(ctx.payload);
  if (!rows.length) {
    para_(cursor, '本次沒有可分群的情境資料。');
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
    if (grp.goal && grp.goal !== name2) para_(cursor, '測試情境與目標：' + grp.goal);
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
      para_(cursor, '本情境最高：' + txt_(hi.question) + '（' + num_(hi.mean, 2) + '）；' +
        '最低：' + txt_(lo.question) + '（' + num_(lo.mean, 2) + '）。');
    }
  }

  if (skipped.length) {
    para_(cursor, '⚠ 以下 ' + skipped.length + ' 個情境因本次執行的時間預算用盡而未產生：' +
      skipped.join('、') + '。這些情境的逐題數字仍完整保存在本試算表的「' +
      SNAPSHOT_SHEET_NAME_ + '」工作表（報告編號 ' + ctx.st.runId + '）。');
    ctx.warn('第九章有 ' + skipped.length + ' 個情境因時間預算未產生。');
    ctx.skip('九、情境逐項分析（部分）', '時間預算用盡，未產生的情境：' + skipped.join('、'));
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
  var t = [['情境編號', '指標', '評核題目', '評核人數', '平均', '標準差']];
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
  var head = ['潛能', '情境編號', '評核題目', '平均', '標準差'];

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
  var t2 = [['情境編號', '評核題目', '評核人數', '平均', '標準差']];
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
  var header = ['題號', '情境編號'];
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
  var m = ctx.meta;
  var st = ctx.st;
  heading_(cursor, sectionById_('APPC').title, 1);
  var rows = [['項目', '內容']];
  rows.push(['報告編號', st.runId]);
  rows.push(['報告產生時間', st.generatedAtText]);
  rows.push(['設定檔名稱', txt_(m.configFileName)]);
  rows.push(['紀錄檔名稱', txt_(m.recordFileName)]);
  rows.push(['紀錄分頁名稱', txt_(m.recordSheetName)]);
  rows.push(['紀錄表原始列數', String(m.recordRowCount || 0)]);
  rows.push(['機構代號', m.tenant ? String(m.tenant) : '—（單一演習模式）']);
  rows.push(['演習代號', m.exercise ? String(m.exercise) : '—（單一演習模式）']);
  rows.push(['租戶解析來源', txt_(m.tenantSource)]);
  // ⚠️ 印雜湊、不印指紋本身（見 fingerprint_ 上方的註解）。這一行與後端
  // 「這個分支沒有認證」的慣例同級：改動前請先確認新內容不含任何代號。
  rows.push(['資料指紋（SHA-256 前 16 碼）', fingerprintDigest_(st.fingerprint)]);
  rows.push(['匿名模式', st.identified ? '⚠ 含可識別評核官代號' : '已匿名（評核官 1…N）']);
  rows.push(['ICC 驗算結論', ctx.icc.note]);
  rows.push(['圖表能力探測結果', (st.cap && st.cap.detail && st.cap.detail.length)
    ? st.cap.detail.join('；') : '未探測']);
  rows.push(['報告快照工作表', SNAPSHOT_SHEET_NAME_ + '（第 ' + st.snapStartRow + ' 列起共 ' +
    st.snapCount + ' 列，以報告編號關聯）']);
  table_(cursor, rows);

  // 業主第一次產生報告後，請回報「圖表能力探測結果」這一行 —— 這是開發端
  // 無法執行這段程式碼時，唯一的實機驗證替代手段。
  para_(cursor, '本報告的所有統計數值均取自後端 action=analysis 的回傳值，報告端未另行計算；' +
    '唯一的例外是 ICC(2,k) 的本機驗算（結果如上）。資料指紋用於確保報告的各章節都來自同一次資料快照；' +
    '此處只列出它的雜湊值，不列出指紋原文，以免間接揭露評核官代號。');
  para_(cursor, '本附錄刻意不列印任何分析金鑰、試算表 ID、Web App 網址或人員代號對照表。');

  var warnings = st.warnings || [];
  heading_(cursor, '本次產生的警告與降級紀錄', 2);
  if (!warnings.length) {
    para_(cursor, '無。');
  } else {
    for (var w = 0; w < warnings.length; w++) bullet_(cursor, warnings[w]);
  }

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
