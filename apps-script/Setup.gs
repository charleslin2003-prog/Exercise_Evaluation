// 演習場次管理精靈（試作）。
//
// ⚠️ 這是一支**容器綁定**腳本，必須貼在「租戶註冊表」那份試算表底下
// （擴充功能 → Apps Script），不是獨立專案、也不是 Web App。
// 容器綁定腳本**不需要部署**：存檔、重新載入試算表，選單就出現了。這一點跟
// Report.gs 的理由完全一樣 —— 業主拉不動「重新部署 Web App」那根槓桿（選錯
// 「新增部署」會換掉 /exec 網址、靜靜打壞評核單與分析頁），所以這支腳本一行都
// 不碰 ConfigWithSubmit.gs。
//
// 為什麼綁在「租戶註冊表」而不是「演習評核_設定」（Report.gs 的位置）：
// 新增一場演習要同時動三個檔案 —— 註冊表加一列、紀錄檔建分頁、設定檔複製一份
// 並填演習資訊。只有註冊表知道每一家醫院的設定檔 ID 與紀錄檔 ID，從設定檔那頭
// 出發根本不知道還有哪些醫院存在。
//
// ===== 它解決的問題 =====
// 手動開一場新演習今天要做五件事，任何一步錯了都只會得到一句看不懂的錯誤
// （「這場演習的註冊資料有問題」—— 真正的原因藏在預設停用的 action=selftest 裡）：
//   1. 複製設定試算表、填五個分頁
//   2. 到紀錄檔新增分頁、貼表頭
//   3. 自己生一把隨機金鑰
//   4. 到註冊表加一列、填十三欄
//   5. 手工拼出評核表與分析平台的網址
// 這支腳本把 1–5 收進一個對話框，並且**在寫入之前**就跑完後端那五條健全性檢查，
// 把失敗講成中文。
//
// ===== 刻意不做的事 =====
// * 不產生、不儲存、不顯示 ADMIN_KEY。這支腳本從不呼叫 selftest/flush。
// * 不把任何金鑰寫進原始碼。站台網址與範本 ID 走指令碼屬性（見 requireProps_）。
//   .gs 原始碼會被複製、貼上、存進版本控制，金鑰一旦進去就收不回來。
// * 不碰 master。這是 dev 的功能。
//
// ===== 與 ConfigWithSubmit.gs 的耦合 =====
// 下面這些常數與函式是後端那支的**鏡像**，必須一字不差，否則精靈寫出來的列後端
// 讀不到（或讀成別的意思）。改動後端的對應處時，這裡要一起改：
//   REG_COL_（欄位別名）／normSlug_／isSpreadsheetId_／findHeaderCol_／
//   formatDateTime_／五條健全性檢查
// 這是這支腳本唯一的隱性相依，所以集中寫在檔案前半段，不要散出去。

var MENU_TITLE_ = '演習場次管理';
var REGISTRY_SHEET_NAME_ = '租戶註冊表';
var DEFAULT_RECORD_SHEET_NAME_ = '評核紀錄';
var DEFAULT_SCENE_PREFIX_ = 'SCENE';

// 組合鍵的分隔字元，與 ConfigWithSubmit.gs 的 KEY_SEP_ 同一個理由：U+241F 絕對
// 不會出現在業主手打的代號或分頁名稱裡。
var KEY_SEP_ = '␟';

// ===== 指令碼屬性鍵 =====
// SETUP_SITE_BASE        必填，例如 https://exerciseevaluationtest.vercel.app
//                        （結尾不要斜線）。評核表與分析平台的網址都由它組出來。
// SETUP_CONFIG_TEMPLATE  選填。一份「設定試算表範本」的檔案 ID。填了之後，新增
//                        場次時就能選「複製範本」，精靈會複製一份、填好演習資訊，
//                        再把新檔案的 ID 寫進註冊表。沒填就只能沿用既有設定檔。
// SETUP_TARGET_FOLDER    選填。複製出來的設定檔要放哪個資料夾；沒填就放在範本
//                        旁邊（Drive 預設行為）。
var PROP_SITE_BASE_ = 'SETUP_SITE_BASE';
var PROP_CONFIG_TEMPLATE_ = 'SETUP_CONFIG_TEMPLATE';
var PROP_TARGET_FOLDER_ = 'SETUP_TARGET_FOLDER';

// 註冊表欄位別名。**必須與 ConfigWithSubmit.gs 的 REGISTRY_*_ALIASES_ 一致。**
var REG_COL_ = {
  hid:         ['醫院代號', '機構代號'],
  exid:        ['演習代號', '場次代號'],
  name:        ['顯示名稱', '名稱'],
  configId:    ['設定試算表ID', '設定檔ID'],
  recordId:    ['紀錄試算表ID', '紀錄檔ID'],
  recordSheet: ['紀錄分頁名稱', '紀錄分頁'],
  key:         ['分析金鑰', '金鑰'],
  enabled:     ['啟用', '啟用中'],
  from:        ['開放送出起', '送出開始'],
  to:          ['開放送出迄', '送出結束'],
  isDefault:   ['預設演習', '預設'],
  scenePrefix: ['scenePrefix', '情境前綴'],
  owner:       ['檔案擁有者']
};

// 設定試算表必須有的五個分頁。缺任何一個，評核表就開不起來，所以寫入註冊表
// 之前先擋下來 —— 讓錯誤發生在建立場次的當下，而不是演習當天評核官的手機上。
var REQUIRED_CONFIG_SHEETS_ = ['演習資訊', '人員代號', '評分標準', '項目與問題', '對應指標'];

// 紀錄分頁的預設表頭。只有在紀錄檔裡找不到任何既有分頁可抄時才用。
var DEFAULT_RECORD_HEADER_ = ['情境階段', '演練單元', '評核題號', '分數', '人員代號', '送出時間', '觀察紀錄'];


// ======================================================================
// 選單
// ======================================================================

function onOpen() {
  // onOpen 是簡單觸發器：開啟試算表時自動執行。**不需要、也不應該**在 Apps Script
  // 編輯器裡按「執行」手動跑它。
  //
  // 手動跑的話有機會噴 'Cannot call SpreadsheetApp.getUi() from this context.'
  // （2026-10-09 實際發生過）。那句話的成因不只一種 —— 專案根本沒綁定試算表、
  // 綁在文件或表單上、或是編輯器這次執行沒帶到容器脈絡都會長一樣 —— 所以下面
  // 刻意**不**斷言是哪一種。上一版這裡寫死「是獨立專案」，結果那次的專案其實
  // 有正常綁定，等於重蹈 Report.gs 那個「自信地給錯提示」的覆轍。
  // 不確定原因時，列出可能性並指出「這條路本來就不必走」，比猜一個有用。
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (err) {
    throw new Error('拿不到試算表的 UI。\n\n'
      + '如果你是在 Apps Script 編輯器裡按「執行」跑 onOpen —— 不用這樣做。'
      + '選單是在開啟試算表時自動掛上的：存檔之後回到「' + REGISTRY_SHEET_NAME_
      + '」那份試算表按 F5 就會出現。\n\n'
      + '如果是開啟試算表時就出現這個錯誤，那才是真的有問題，依序檢查：'
      + '(1) 這個專案是不是從那份試算表的「擴充功能 → Apps Script」進去的'
      + '（從 Apps Script 首頁新建的是獨立專案，永遠不會有選單）；'
      + '(2) 它綁的是不是試算表而不是文件或表單。\n\n'
      + '（原始錯誤：' + ((err && err.message) || err) + '）');
  }
  ui.createMenu(MENU_TITLE_)
    .addItem('新增一場演習…', 'showSetupDialog')
    .addItem('檢查註冊表', 'showRegistryCheck')
    .addSeparator()
    .addItem('設定說明（指令碼屬性）', 'showSetupPropertyHelp')
    .addToUi();
}

function showSetupDialog() {
  try {
    var t = HtmlService.createTemplateFromFile('SetupDialog');
    var html = t.evaluate().setWidth(720).setHeight(760);
    SpreadsheetApp.getUi().showModalDialog(html, '新增一場演習');
  } catch (err) {
    // Report.gs 在 2026-10-08 踩過這個坑：容器綁定腳本第一次開對話框時若還沒被
    // 授權 script.container.ui，丟出來的是權限錯誤，但它的提示一律叫人去確認
    // HTML 檔案在不在 —— 測試的人因此去檢查了一個本來就沒問題的東西。
    // 這裡先分辨錯誤類型再給提示，不要重蹈覆轍。
    var m = String((err && err.message) || err);
    var hint = '請確認這個專案裡有名為「SetupDialog」與「QrLib」的 HTML 檔案'
      + '（檔案 → 新增 → HTML，名稱必須完全一致）。';
    var authSigns = ['script.container.ui', '權限', '授權', 'permission', 'Authorization', 'authoriz'];
    for (var i = 0; i < authSigns.length; i++) {
      if (m.indexOf(authSigns[i]) !== -1) {
        hint = '這是「授權」問題，不是檔案缺失 —— 檔案在不在都一樣會出現這個錯誤。\n\n'
          + '做法：在 Apps Script 編輯器上方的函式下拉選單選「onOpen」，按「執行」，'
          + '跳出 Google 授權視窗時按「允許」。授權完回到試算表重新整理，再點一次選單。';
        break;
      }
    }
    SpreadsheetApp.getUi().alert('無法開啟對話框：' + m + '\n\n' + hint);
  }
}

// SetupDialog.html 用 <?!= include('QrLib') ?> 把 QR 函式庫整個內嵌進來。
// 刻意內嵌而不是 <script src="https://…/vendor/qrcode.js">：那樣會讓對話框相依於
// 「正式站上剛好有那個檔案」，而 vendor/qrcode.js 目前只在 dev 分支上 —— 指到
// 正式站就是 404，指到測試站就變成「印 QR 要先確定測試站活著」。
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function showSetupPropertyHelp() {
  var p = PropertiesService.getScriptProperties();
  var rows = [
    ['SETUP_SITE_BASE', '必填', '評核表與分析平台的站台網址，結尾不要斜線。例如 https://exerciseevaluationtest.vercel.app'],
    ['SETUP_CONFIG_TEMPLATE', '選填', '設定試算表「範本」的檔案 ID。填了才能用「複製一份新的設定檔」。'],
    ['SETUP_TARGET_FOLDER', '選填', '複製出來的設定檔要放的資料夾 ID。沒填就跟範本放在一起。']
  ];
  var html = '<div style="font:13px/1.7 system-ui,sans-serif;padding:14px">'
    + '<p>設定位置：Apps Script 編輯器左側 <b>專案設定</b> → <b>指令碼屬性</b>。</p>'
    + '<table style="border-collapse:collapse;width:100%;font-size:12px">'
    + '<tr><th style="text-align:left;border-bottom:1px solid #ccc;padding:6px">屬性</th>'
    + '<th style="text-align:left;border-bottom:1px solid #ccc;padding:6px">必要</th>'
    + '<th style="text-align:left;border-bottom:1px solid #ccc;padding:6px">說明</th>'
    + '<th style="text-align:left;border-bottom:1px solid #ccc;padding:6px">目前值</th></tr>';
  for (var i = 0; i < rows.length; i++) {
    var cur = p.getProperty(rows[i][0]) || '（未設定）';
    html += '<tr><td style="padding:6px;border-bottom:1px solid #eee"><code>' + rows[i][0] + '</code></td>'
      + '<td style="padding:6px;border-bottom:1px solid #eee">' + rows[i][1] + '</td>'
      + '<td style="padding:6px;border-bottom:1px solid #eee">' + escapeHtml_(rows[i][2]) + '</td>'
      + '<td style="padding:6px;border-bottom:1px solid #eee"><code>' + escapeHtml_(cur) + '</code></td></tr>';
  }
  html += '</table><p style="margin-top:14px;color:#666">這支腳本不需要、也不會讀取 ADMIN_KEY，'
    + '分析金鑰也不存在指令碼屬性裡；它是精靈<b>寫進註冊表</b>的 —— 新醫院的第一場現生一把，'
    + '同一家醫院之後的場次一律<b>沿用該院既有那把</b>（分析平台只內嵌得了一把金鑰，'
    + '每場一把會讓場次下拉切不過去）。金鑰本身不會顯示在這裡。</p></div>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(680).setHeight(460), '設定說明');
}

function showRegistryCheck() {
  var report = setupCheckRegistry();
  var html = '<div style="font:13px/1.8 system-ui,sans-serif;padding:14px">'
    + '<div style="font-weight:700;margin-bottom:8px">註冊表檢查結果</div>'
    + report.lines.map(function (l) {
        return '<div style="padding:3px 0;color:' + (l.ok ? '#2f7d5b' : '#a84646') + '">'
          + (l.ok ? '✅ ' : '⚠️ ') + escapeHtml_(l.text) + '</div>';
      }).join('')
    + '</div>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(680).setHeight(520), '檢查註冊表');
}


// ======================================================================
// 對話框呼叫的三支 google.script.run 進入點
// ======================================================================

// 對話框一開啟就抓的基本資料：站台網址、既有醫院清單、範本有沒有設定。
// 醫院清單是從註冊表現讀的，所以不會跟真實狀態脫節 —— 這份清單是「本機枚舉」，
// 不是後端端點：後端永遠不回答「有哪些醫院」，那條紅線不動。
function setupBootstrap() {
  var p = PropertiesService.getScriptProperties();
  var table = readRegistryTable_();
  var byHid = {};
  for (var i = 0; i < table.rows.length; i++) {
    var r = table.rows[i];
    if (!r.hid) continue;
    if (!byHid[r.hid]) {
      byHid[r.hid] = { hid: r.hid, label: '', configId: '', recordId: '', scenePrefix: '', exids: [] };
    }
    var h = byHid[r.hid];
    h.exids.push(r.exid);
    // 顯示名稱拿「預設演習」那一列的，沒有預設就拿第一列的 —— 業主通常把醫院
    // 名字寫在裡面（「萬芳醫院急救站 2026 上半年」）。
    if (!h.label || r.isDefault) h.label = r.name || r.hid;
    if (!h.configId) h.configId = r.configId;
    if (!h.recordId) h.recordId = r.recordId;
    if (!h.scenePrefix) h.scenePrefix = r.scenePrefix;
  }
  var hospitals = [];
  for (var k in byHid) { if (byHid.hasOwnProperty(k)) hospitals.push(byHid[k]); }
  hospitals.sort(function (a, b) { return a.hid < b.hid ? -1 : (a.hid > b.hid ? 1 : 0); });

  return {
    siteBase: (p.getProperty(PROP_SITE_BASE_) || '').replace(/\/+$/, ''),
    hasTemplate: !!p.getProperty(PROP_CONFIG_TEMPLATE_),
    hospitals: hospitals,
    headerProblems: table.headerProblems
  };
}

// 由醫事機構代碼產生一個「不可猜」的醫院代號。
//
// 為什麼不直接拿醫事機構代碼當醫院代號：那組代碼是衛福部公開名單上的公開資料，
// 查得到。而 ?t=<醫院代號> 是陌生人與這三件事之間的唯一屏障 —— 列出該院所有場
// 次、讀到完整題庫與評核官代號名單（設定分支沒有驗證，代號是免費給的）、以及
// 對任何開放中且在時間窗內的場次送出分數。後端保留的是每個 (問題ID, 人員代號)
// 的最後一筆，所以外人用真實代號送一筆就會直接覆蓋該評核官的分數，而且畫面上
// 不會有任何異常。把代碼直接當路由代號，等於把那道屏障降成「去查一下公開名單」。
//
// 折衷做法：公開代碼當前綴（代號自我說明，你一眼看得出是哪家醫院），後面接六位
// 隨機十六進位（外人猜不到）。1301200010-a3f9c2 共 17 字，開頭是數字，完全符合
// 後端 normSlug_ 的 ^[a-z0-9][a-z0-9_-]{0,31}$。
function setupSuggestHid(institutionCode) {
  var code = String(institutionCode || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!code) code = 'org';
  var suffix = Utilities.getUuid().replace(/-/g, '').substring(0, 6);
  return normSlug_(code.substring(0, 20) + '-' + suffix);
}

// 主要動作。回傳 { ok, messages, result } —— 失敗時 ok=false、messages 是中文原因
// 陣列，而且**什麼都沒寫**（所有檢查都在任何寫入動作之前跑完）。
function setupCreateSession(payload) {
  var out = { ok: false, messages: [], result: null };
  try {
    var p = PropertiesService.getScriptProperties();
    var siteBase = (p.getProperty(PROP_SITE_BASE_) || '').replace(/\/+$/, '');
    if (!siteBase) {
      out.messages.push('尚未設定 SETUP_SITE_BASE（選單 →「設定說明（指令碼屬性）」）。');
      return out;
    }

    // ---- 1. 欄位正規化與基本格式 ----
    var hid = normSlug_(payload.hid);
    var exid = normSlug_(payload.exid);
    var name = String(payload.name || '').trim();
    var recordSheet = String(payload.recordSheet || '').trim() || (DEFAULT_RECORD_SHEET_NAME_ + '_' + exid);
    var scenePrefix = String(payload.scenePrefix || '').trim() || DEFAULT_SCENE_PREFIX_;

    if (!hid) out.messages.push('醫院代號格式不正確。只能用小寫英數、底線、減號，開頭必須是英數，最長 32 字。');
    if (!exid) out.messages.push('演習代號格式不正確。只能用小寫英數、底線、減號，開頭必須是英數，最長 32 字。');
    if (!name) out.messages.push('請填顯示名稱，評核官會在場次清單上看到這行字。');

    // 開放時間窗是必填，這是刻意的。空白代表「永遠開放」，於是同一家醫院的每一
    // 場（含去年、前年）都會在評核官的清單上顯示「開放中」，他可能挑錯，而且挑
    // 錯了真的送得出去。填了時間窗，當天就只有該場是可送出的。
    var from = parseWhen_(payload.openFrom, '開放送出起', out.messages, true);
    var to = parseWhen_(payload.openTo, '開放送出迄', out.messages, true);
    if (from.ms && to.ms && from.ms >= to.ms) {
      out.messages.push('開放送出迄 必須晚於 開放送出起。');
    }

    if (out.messages.length) return out;

    // ---- 2. 讀註冊表、跑五條健全性檢查（在任何寫入之前）----
    var table = readRegistryTable_();
    if (table.headerProblems.length) {
      out.messages = out.messages.concat(table.headerProblems);
      return out;
    }

    var sameHidRows = table.rows.filter(function (r) { return r.hid === hid; });
    var isNewHospital = sameHidRows.length === 0;

    // 設定檔／紀錄檔來源。既有醫院預設沿用同一家的現有 ID。
    var configId = String(payload.configId || '').trim();
    var recordId = String(payload.recordId || '').trim();
    if (!isNewHospital) {
      if (!recordId) recordId = sameHidRows[0].recordId;
      if (!configId && payload.configMode === 'reuse') configId = sameHidRows[0].configId;
    }

    // 「複製一份新的設定檔」：這是把「上傳時間、地點、題目」變簡單的關鍵。
    // 同一份設定試算表只有一組 演習資訊 與一份 項目與問題，所以兩場內容不同的
    // 演習共用一份設定檔，日期與題目就會互相覆蓋。複製一份才是正解。
    var copiedConfigName = '';
    if (payload.configMode === 'copy') {
      var templateId = p.getProperty(PROP_CONFIG_TEMPLATE_);
      if (!templateId) {
        out.messages.push('要「複製一份新的設定檔」必須先設定 SETUP_CONFIG_TEMPLATE。');
        return out;
      }
      copiedConfigName = name + '｜設定';
      configId = ''; // 實際複製動作延到所有檢查都過了才做，見第 4 步。
    }

    if (payload.configMode !== 'copy' && !isSpreadsheetId_(configId)) {
      out.messages.push('設定試算表ID 格式不正確（應為 20 字以上的英數、底線、減號）。');
    }
    if (!isSpreadsheetId_(recordId)) {
      out.messages.push('紀錄試算表ID 格式不正確（應為 20 字以上的英數、底線、減號）。');
    }
    if (out.messages.length) return out;

    // 規則 1：醫院代號＋演習代號 不可重複（**不分啟用與否**，與後端 2026-10-08
    // 修正後的範圍一致：封存列照樣會被 action=analysis 路由到）。
    for (var i = 0; i < table.rows.length; i++) {
      if (table.rows[i].hid === hid && table.rows[i].exid === exid) {
        out.messages.push('第 ' + table.rows[i].rowNumber + ' 列已經有同一組 醫院代號+演習代號（'
          + hid + ' / ' + exid + '）。請換一個演習代號。');
      }
    }
    // 規則 2：紀錄試算表ID＋分頁名稱 不可重複。這條是缺陷 D1 唯一的硬擋 ——
    // 兩場演習寫進同一張分頁，報告會混在一起，而且紀錄表沒有 演習代號 欄時，
    // 新演習的分數會直接蓋掉舊演習同題號的分數。
    for (var j = 0; j < table.rows.length; j++) {
      if (table.rows[j].recordId === recordId && table.rows[j].recordSheet === recordSheet) {
        out.messages.push('第 ' + table.rows[j].rowNumber + ' 列已經用了同一組 紀錄試算表ID+分頁名稱（'
          + recordSheet + '）。兩場演習會互相覆蓋分數，請換一個分頁名稱。');
      }
    }
    if (out.messages.length) return out;

    // 規則 2b：分析金鑰逐「院」沿用，不逐「場」現生。
    //
    // 這條是精靈自己的規則，**不在**後端那五條健全性檢查裡。後端的規則 3 只擋
    // 「同一把金鑰出現在不同醫院代號」，同一家醫院的多場共用一把是**明文允許**的
    // （assertRegistrySane_ 與本檔 setupCheckRegistry 比的都是 o.hid !== grp[g].hid）。
    //
    // 為什麼要改成沿用：Analysis.html 只內嵌得了一把金鑰
    // （KEY = Q.get('key') || ANALYSIS_KEY），而 action=analysis 比對的是**解析出來
    // 那一列**的金鑰。每場現生一把的時候，標頭的場次下拉列得出所有場次
    // （action=exercises 只要金鑰符合該院任一有效列就授權），但切過去會拿到
    // {"error":"unauthorized"} —— 清單載得到、個別場次讀不到。這個不對稱會讓症狀
    // 看起來像後端壞了，實際上就是這裡每建一列就 randomKey_(32) 造成的。
    //
    // 代價要講明白，這是刻意接受的交換：一把金鑰外洩等於該院**所有**場次外洩，
    // 而輪替金鑰從「改一格」變成「改該院每一列」。「一個分析平台、一把內嵌金鑰、
    // 下拉切得動」這三件事合起來就蘊含了這個代價，不是這裡多付的。
    //
    // 位置也是刻意的：這一段必須留在第 2 步，不能挪到第 4 步真正要用金鑰的地方。
    // 第 4 步已經在 makeCopy／ensureRecordSheet_／clearOtherDefaults_ 之後，在那裡
    // 拒絕會留下一份複製好的設定檔、一張新建的紀錄分頁、以及一列被清掉的預設演習
    // 旗標，卻沒有對應的註冊表列 —— 正是第 4 步的順序註解要避免的殘留狀態。
    var analysisKey = '';
    var keyReused = false;
    var keyRowNumbers = [];
    var keyGroups = [];   // [{ key, rows:[列號] }]。只拿來報告列號，金鑰本身絕不輸出。
    for (var ki = 0; ki < sameHidRows.length; ki++) {
      var existingKey = sameHidRows[ki].key;
      if (!existingKey) continue;
      var slot = -1;
      for (var kg = 0; kg < keyGroups.length; kg++) {
        if (keyGroups[kg].key === existingKey) { slot = kg; break; }
      }
      if (slot === -1) { keyGroups.push({ key: existingKey, rows: [] }); slot = keyGroups.length - 1; }
      keyGroups[slot].rows.push(sameHidRows[ki].rowNumber);
    }

    if (keyGroups.length > 1) {
      // 不替業主挑一把。這裡沒有任何資訊能判斷哪一把才是現在真的在用的那把
      // （註冊表不記「誰發過哪條連結」），挑錯會讓既有的分析連結在某幾場失效。
      // 態度與 resolveTenant_ 對 AMBIGUOUS_DEFAULT 一樣：身分不可以取決於列的順序。
      var groupText = [];
      for (var gi = 0; gi < keyGroups.length; gi++) {
        groupText.push('第 ' + keyGroups[gi].rows.join('、') + ' 列');
      }
      out.messages.push('「' + hid + '」底下既有的 ' + sameHidRows.length + ' 列用了 '
        + keyGroups.length + ' 把不同的分析金鑰（' + groupText.join('；') + '）。'
        + '精靈不會替你挑一把——挑錯會讓既有的分析連結在某幾場失效。'
        + '請先把同一家醫院所有列的分析金鑰統一成同一把'
        + '（複製其中一格貼到其餘幾格即可；後端是逐列比對的，改完 120 秒內生效），'
        + '再回來新增場次。');
      return out;
    }
    if (keyGroups.length === 1) {
      analysisKey = keyGroups[0].key;
      keyReused = true;
      keyRowNumbers = keyGroups[0].rows;
    }

    // ---- 3. 設定試算表的五個分頁檢查（沿用既有設定檔時才需要；複製範本的情形
    //         等複製完再檢查，見第 4 步末尾）----
    if (payload.configMode !== 'copy') {
      var cfgProblems = checkConfigSpreadsheet_(configId);
      if (cfgProblems.length) {
        out.messages = out.messages.concat(cfgProblems);
        return out;
      }
    }

    // ---- 4. 開始寫入。順序刻意是「最難復原的放最後」：
    //         複製設定檔 → 建紀錄分頁 → 寫註冊表一列。
    //         註冊表那一列是最後寫的，所以前面任何一步失敗，都不會留下一列指向
    //         不存在的檔案（那正是 ROW_INVALID 最難查的來源）。----
    var notes = [];

    if (payload.configMode === 'copy') {
      // 一次把目的資料夾指定給 makeCopy，不要先複製再 addFile/removeFile：
      // makeCopy(name) 把檔案放在哪個資料夾是沒有保證的，所以「從根目錄移除」
      // 在檔案根本不在根目錄時會丟錯，而那時設定檔已經建好了 —— 失敗點落在
      // 最尷尬的位置。指定資料夾失敗就退回不指定，並把這件事講出來。
      var template = DriveApp.getFileById(p.getProperty(PROP_CONFIG_TEMPLATE_));
      var folderId = p.getProperty(PROP_TARGET_FOLDER_);
      var copy;
      if (folderId) {
        try {
          copy = template.makeCopy(copiedConfigName, DriveApp.getFolderById(folderId));
        } catch (errFolder) {
          copy = template.makeCopy(copiedConfigName);
          notes.push('指定的資料夾無法使用，設定檔已建在雲端硬碟預設位置：' + errFolder.message);
        }
      } else {
        copy = template.makeCopy(copiedConfigName);
      }
      configId = copy.getId();
      notes.push('已複製設定試算表：' + copiedConfigName + '（ID ' + configId + '）');

      var cfgProblems2 = checkConfigSpreadsheet_(configId);
      if (cfgProblems2.length) {
        // 範本自己就有問題。設定檔已經建好了，但不要再往下寫註冊表 —— 留一列
        // 指向壞掉的設定檔，只會變成演習當天才爆的 ROW_INVALID。
        out.messages.push('範本複製完成，但範本本身缺東西，已停止後續步驟：');
        out.messages = out.messages.concat(cfgProblems2);
        out.messages.push('複製出來的檔案是：' + copiedConfigName + '（可以直接刪掉）。');
        return out;
      }

      // 演習資訊：把對話框填的時間／地點／名稱寫進去。這是「上傳時間地點」那一半。
      writeExerciseInfo_(configId, payload, notes);
    }

    // 紀錄分頁。表頭優先從同一個紀錄檔裡既有的分頁抄 —— 業主可能加過欄位
    // （例如今天才加的 觀察紀錄），照抄才不會讓新場次少一欄。
    ensureRecordSheet_(recordId, recordSheet, notes);

    // 一家醫院只能有一列 預設演習=Y。這條**不在**後端那五條健全性檢查裡 ——
    // 它不會把列標成無效，而是 resolveTenant_ 解析當下才丟 AMBIGUOUS_DEFAULT，
    // 於是整家醫院的「?t= 不帶 ?ex=」連結（也就是精靈自己產的那張醫院通用 QR）
    // 全部死掉。2026-10-08 第一次試跑就踩到了，所以這裡自己擋。
    // 做法是「自動把舊的取消」而不是報錯：使用者勾「設為預設」的意思本來就是
    // 「改成這一場」，報錯只會逼他自己去翻另一列。改了什麼一定寫進 notes。
    if (payload.isDefault) clearOtherDefaults_(table, hid, notes);

    // 分析金鑰。要沿用哪一把（或是要不要現生）在第 2 步就決定完了（見「規則 2b」），
    // 這裡只負責消費結果與把決定講出來。現生的情形用 Utilities.getUuid() 當亂數來源、
    // 不用 Math.random()：這是一把真的憑證，而 Apps Script 沒有 crypto.getRandomValues。
    if (keyReused) {
      notes.push('沿用「' + hid + '」既有的分析金鑰（與第 ' + keyRowNumbers.join('、')
        + ' 列同一把）。下面那條分析平台網址裡的金鑰不是新發的憑證，不要當成新金鑰'
        + '另外發給別人；分析平台的場次下拉切到這一場時也不必換網址。');
    } else {
      analysisKey = randomKey_(32);
      if (isNewHospital) {
        notes.push('「' + hid + '」是註冊表裡的新醫院，已為它產生一把新的分析金鑰。'
          + '同一家醫院之後新增的場次會沿用這一把，不會再生新的。');
      } else {
        notes.push('「' + hid + '」既有的列都沒有填分析金鑰，已產生一把新的。'
          + '⚠️ 那幾列在後端是無效列（分析金鑰空白，評核單與分析平台都打不開），'
          + '請一併把這把金鑰補進去。');
      }
    }

    appendRegistryRow_(table, {
      hid: hid, exid: exid, name: name,
      configId: configId, recordId: recordId, recordSheet: recordSheet,
      key: analysisKey,
      enabled: 'Y',
      from: from.text, to: to.text,
      isDefault: payload.isDefault ? 'Y' : '',
      scenePrefix: scenePrefix,
      owner: String(payload.owner || '').trim()
    });

    // 註冊表有 120 秒快取，剛寫完的列不會立刻生效。與其讓業主以為壞了，不如
    // 直接講明白。（action=flush 可以立刻生效，但它要 ADMIN_KEY，而 ADMIN_KEY
    // 預設是空字串＝停用，這支腳本也刻意不碰它。）
    notes.push('註冊表有 120 秒快取，新場次最多兩分鐘後才會出現在評核表的場次清單上。');

    out.ok = true;
    out.result = {
      hid: hid,
      exid: exid,
      name: name,
      // 給評核官的 QR：只帶 ?t=，讓他自己在清單上挑今天那一場。
      hospitalUrl: siteBase + '/Start.dc.html?t=' + encodeURIComponent(hid),
      // 單場直達，給只負責這一場的人。
      sessionUrl: siteBase + '/Start.dc.html?t=' + encodeURIComponent(hid) + '&ex=' + encodeURIComponent(exid),
      // 分析平台。金鑰在網址裡，所以這條連結本身就是憑證，不要外流。
      analysisUrl: siteBase + '/Analysis.html?t=' + encodeURIComponent(hid) + '&ex=' + encodeURIComponent(exid) + '&key=' + encodeURIComponent(analysisKey),
      // 這把金鑰是沿用的還是現生的。SetupDialog.html 目前沒有讀這個欄位，完成畫面
      // 上那行「分析平台（內含金鑰，勿外流）」兩種情形都成立（沿用的也還是憑證），
      // 所以沒有錯誤訊息，只是少講了一句；要補的話讀這個布林值就夠，不必改 Setup.gs。
      // 在那之前，沿用／現生這件事是靠上面 notes 裡那一行講出來的。
      keyReused: keyReused,
      recordSheet: recordSheet,
      window: from.text + ' ~ ' + to.text,
      notes: notes
    };
    return out;

  } catch (err) {
    out.messages.push('發生未預期的錯誤：' + (err && err.message ? err.message : String(err)));
    return out;
  }
}

// 把後端那五條健全性檢查在本機跑一遍，用中文講結果。
// 這補上目前最痛的一個洞：規則沒過時評核官只會看到「這場演習的註冊資料有問題」，
// 真正的原因只存在於 action=selftest，而 ADMIN_KEY 預設是空字串＝那個端點停用。
function setupCheckRegistry() {
  var lines = [];
  var table = readRegistryTable_();

  if (table.headerProblems.length) {
    for (var h = 0; h < table.headerProblems.length; h++) {
      lines.push({ ok: false, text: table.headerProblems[h] });
    }
    return { lines: lines };
  }
  lines.push({ ok: true, text: '欄位齊全，共 ' + table.rows.length + ' 列資料。' });

  var bad = {};
  function flag(row, why) {
    if (!bad[row.rowNumber]) bad[row.rowNumber] = [];
    bad[row.rowNumber].push(why);
  }

  // 規則 4/5：必填與格式
  for (var i = 0; i < table.rows.length; i++) {
    var r = table.rows[i];
    if (!r.hid) flag(r, '醫院代號 空白或格式不正確');
    if (!r.exid) flag(r, '演習代號 空白或格式不正確');
    if (!r.key) flag(r, '分析金鑰 空白');
    if (!isSpreadsheetId_(r.configId)) flag(r, '設定試算表ID 格式不正確');
    if (!isSpreadsheetId_(r.recordId)) flag(r, '紀錄試算表ID 格式不正確');
  }
  // 規則 1、2：跨列重複（**全部列**，不分啟用）
  groupFlag_(table.rows, function (r) { return r.hid && r.exid ? r.hid + KEY_SEP_ + r.exid : ''; },
    '醫院代號+演習代號 與第 {n} 列重複', flag);
  groupFlag_(table.rows, function (r) { return r.recordId ? r.recordId + KEY_SEP_ + r.recordSheet : ''; },
    '紀錄試算表ID+分頁名稱 與第 {n} 列重複，兩場演習會互相覆蓋分數', flag);
  // 規則 3：同一把金鑰出現在不同醫院代號。空白代號兩側都跳過。
  var byKey = {};
  for (var j = 0; j < table.rows.length; j++) {
    var rr = table.rows[j];
    if (!rr.key || !rr.hid) continue;
    if (!byKey[rr.key]) byKey[rr.key] = [];
    byKey[rr.key].push(rr);
  }
  for (var kk in byKey) {
    if (!byKey.hasOwnProperty(kk)) continue;
    var grp = byKey[kk];
    for (var g = 0; g < grp.length; g++) {
      var others = grp.filter(function (o) { return o !== grp[g] && o.hid && o.hid !== grp[g].hid; });
      if (others.length) {
        flag(grp[g], '分析金鑰 與第 ' + others.map(function (o) { return o.rowNumber; }).join('、') + ' 列（不同醫院代號）相同');
      }
    }
  }

  var badCount = 0;
  for (var n in bad) {
    if (!bad.hasOwnProperty(n)) continue;
    badCount++;
    lines.push({ ok: false, text: '第 ' + n + ' 列：' + bad[n].join('；') });
  }
  if (!badCount) lines.push({ ok: true, text: '五條健全性檢查全部通過，沒有任何無效列。' });

  // 重複的預設演習。這條**不在**後端那五條規則裡，所以不會把列標成無效 ——
  // 它是 resolveTenant_ 解析時才丟的 AMBIGUOUS_DEFAULT，症狀是「不帶演習代號的
  // 連結整家醫院都打不開」，而註冊表看起來完全正常。所以一定要在這裡講出來。
  var defaultsByHid = {};
  for (var d = 0; d < table.rows.length; d++) {
    var dr = table.rows[d];
    if (!dr.hid || !dr.enabled || !dr.isDefault) continue;
    if (!defaultsByHid[dr.hid]) defaultsByHid[dr.hid] = [];
    defaultsByHid[dr.hid].push(dr);
  }
  var dupDefault = false;
  for (var dh in defaultsByHid) {
    if (!defaultsByHid.hasOwnProperty(dh)) continue;
    if (defaultsByHid[dh].length > 1) {
      dupDefault = true;
      lines.push({ ok: false, text: '醫院「' + dh + '」有 ' + defaultsByHid[dh].length + ' 列被標為預設演習（第 '
        + defaultsByHid[dh].map(function (x) { return x.rowNumber; }).join('、') + ' 列）。'
        + '這會讓不帶演習代號的連結（評核官掃的那張醫院通用 QR）整個打不開，錯誤是 AMBIGUOUS_DEFAULT。請只保留一列。' });
    }
  }
  if (!dupDefault) lines.push({ ok: true, text: '每家醫院的預設演習都只有一列。' });

  // 同一家醫院底下出現多把分析金鑰。這**不是**無效列 —— 後端規則 3 只擋跨醫院共用，
  // 同院多場共用一把是明文允許的，所以這些列照樣路由得到、分數照樣寫得進去，
  // setupCheckRegistry 上面那五條也會全綠。但 Analysis.html 只內嵌得了一把金鑰，
  // 所以下拉切到金鑰不同的那一場會回 unauthorized：清單載得到、個別場次讀不到。
  // 那個症狀看起來像後端壞了，而註冊表檢查全綠只會加深誤判，所以即使它不構成無效列，
  // 也一定要在這裡講出來。（新增場次時精靈會直接擋下來，見 setupCreateSession 規則 2b。）
  var keysByHid = {};
  for (var kh = 0; kh < table.rows.length; kh++) {
    var kr = table.rows[kh];
    if (!kr.hid || !kr.key) continue;
    if (!keysByHid[kr.hid]) keysByHid[kr.hid] = {};
    if (!keysByHid[kr.hid][kr.key]) keysByHid[kr.hid][kr.key] = [];
    keysByHid[kr.hid][kr.key].push(kr.rowNumber);
  }
  var mixedKey = false;
  for (var mh in keysByHid) {
    if (!keysByHid.hasOwnProperty(mh)) continue;
    var keyGroupTexts = [];
    for (var mk in keysByHid[mh]) {
      if (!keysByHid[mh].hasOwnProperty(mk)) continue;
      keyGroupTexts.push('第 ' + keysByHid[mh][mk].join('、') + ' 列');
    }
    if (keyGroupTexts.length > 1) {
      mixedKey = true;
      lines.push({ ok: false, text: '醫院「' + mh + '」底下用了 ' + keyGroupTexts.length
        + ' 把不同的分析金鑰（' + keyGroupTexts.join('；') + '）。這不會讓任何一列變成無效列，'
        + '但分析平台只內嵌得了一把，切到金鑰不同的那一場會回 unauthorized'
        + '（場次清單列得出來、資料讀不到）。請把同一家醫院所有列統一成同一把'
        + '（複製其中一格貼到其餘幾格，120 秒後生效）；統一之前，精靈不會讓你在這家醫院新增場次。' });
    }
  }
  if (!mixedKey) {
    lines.push({ ok: true, text: '沒有任何一家醫院底下出現兩把以上的分析金鑰（分析平台的場次下拉切得過去）。' });
  }

  // 時間窗提醒。不是錯誤，但多場次同時進行時它幾乎一定是問題。
  var noWindow = table.rows.filter(function (r) { return r.enabled && !r.from && !r.to; });
  if (noWindow.length > 1) {
    lines.push({ ok: false, text: '有 ' + noWindow.length + ' 列是「啟用=Y 且沒有時間窗」，它們會永遠顯示為「開放中」。'
      + '評核官掃同一張 QR 會同時看到這幾場都可點，可能挑錯。建議補上 開放送出起／迄。' });
  }
  return { lines: lines };
}


// ======================================================================
// 內部工具
// ======================================================================

function registrySheet_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(REGISTRY_SHEET_NAME_);
  if (!sh) {
    throw new Error('這份試算表裡找不到「' + REGISTRY_SHEET_NAME_
      + '」分頁。這支腳本必須貼在租戶註冊表底下，不是設定檔或紀錄檔。');
  }
  return sh;
}

// 讀整張註冊表成物件陣列。刻意**不**在這裡判斷有效無效 —— 呼叫端各自需要不同
// 的視角（新增場次只要查重複，檢查功能要列出所有理由）。
function readRegistryTable_() {
  var sh = registrySheet_();
  var values = sh.getDataRange().getValues();
  var header = values.length ? values[0] : [];
  var cols = {};
  var headerProblems = [];
  for (var key in REG_COL_) {
    if (!REG_COL_.hasOwnProperty(key)) continue;
    cols[key] = findHeaderCol_(header, REG_COL_[key]);
  }
  var required = ['hid', 'exid', 'configId', 'recordId', 'key'];
  for (var i = 0; i < required.length; i++) {
    if (cols[required[i]] === -1) {
      headerProblems.push(REGISTRY_SHEET_NAME_ + ' 缺少必要欄位：' + REG_COL_[required[i]][0]);
    }
  }
  var rows = [];
  if (!headerProblems.length) {
    for (var r = 1; r < values.length; r++) {
      if (isBlankRow_(values[r])) continue;
      rows.push({
        rowNumber: r + 1,
        hid: normSlug_(cell_(values[r], cols.hid)),
        exid: normSlug_(cell_(values[r], cols.exid)),
        name: String(cell_(values[r], cols.name) || '').trim(),
        configId: String(cell_(values[r], cols.configId) || '').trim(),
        recordId: String(cell_(values[r], cols.recordId) || '').trim(),
        recordSheet: String(cell_(values[r], cols.recordSheet) || '').trim() || DEFAULT_RECORD_SHEET_NAME_,
        key: String(cell_(values[r], cols.key) || '').trim(),
        enabled: isYes_(cell_(values[r], cols.enabled)),
        from: String(cell_(values[r], cols.from) || '').trim(),
        to: String(cell_(values[r], cols.to) || '').trim(),
        isDefault: isYes_(cell_(values[r], cols.isDefault)),
        scenePrefix: String(cell_(values[r], cols.scenePrefix) || '').trim()
      });
    }
  }
  return { sheet: sh, header: header, cols: cols, rows: rows, headerProblems: headerProblems };
}

function appendRegistryRow_(table, data) {
  var sh = table.sheet;
  var width = Math.max(table.header.length, 1);
  var row = [];
  for (var i = 0; i < width; i++) row.push('');
  function put(key, value) {
    var at = table.cols[key];
    if (at !== -1 && at < width) row[at] = value;
  }
  put('hid', data.hid); put('exid', data.exid); put('name', data.name);
  put('configId', data.configId); put('recordId', data.recordId); put('recordSheet', data.recordSheet);
  put('key', data.key); put('enabled', data.enabled);
  put('from', data.from); put('to', data.to);
  put('isDefault', data.isDefault); put('scenePrefix', data.scenePrefix); put('owner', data.owner);

  var at = sh.getLastRow() + 1;
  // 先把整列設成純文字格式再寫值。不這樣做的話，像 2026-01 這種演習代號會被
  // 試算表自動吃成日期，後端的 normSlug_ 看到 Date 物件會直接判這一列無效 ——
  // 而且是演習當天才發現。
  sh.getRange(at, 1, 1, width).setNumberFormat('@');
  sh.getRange(at, 1, 1, width).setValues([row]);
  SpreadsheetApp.flush();
}

// 把同一家醫院其他列的 預設演習 清掉。只動那一格，不碰同列其他欄位。
// 只清 啟用=Y 的列：封存列掛著一個 預設=Y 不會造成 AMBIGUOUS_DEFAULT
// （resolveTenant_ 的 defaults 過濾是 r.enabled && r.isDefault），而業主可能
// 刻意留著它當「那一年的主場次」的註記。
function clearOtherDefaults_(table, hid, notes) {
  var at = table.cols.isDefault;
  if (at === -1) return;
  for (var i = 0; i < table.rows.length; i++) {
    var r = table.rows[i];
    if (r.hid !== hid || !r.isDefault || !r.enabled) continue;
    table.sheet.getRange(r.rowNumber, at + 1).setValue('');
    notes.push('原本的預設演習「' + (r.name || r.exid) + '」已取消預設（一家醫院只能有一個預設，'
      + '否則不帶演習代號的連結會整個打不開）。');
  }
}

// 確保紀錄分頁存在，並且有表頭。表頭優先從同一個紀錄檔裡既有的分頁抄。
function ensureRecordSheet_(recordId, sheetName, notes) {
  var ss;
  try {
    ss = SpreadsheetApp.openById(recordId);
  } catch (err) {
    throw new Error('無法開啟紀錄試算表，請確認檔案權限與 ID 是否正確。');
  }
  var sh = ss.getSheetByName(sheetName);
  if (sh) {
    notes.push('紀錄分頁「' + sheetName + '」已存在，沿用它（沒有清空任何資料）。');
    return;
  }
  var header = null;
  var all = ss.getSheets();
  for (var i = 0; i < all.length; i++) {
    var vals = all[i].getDataRange().getValues();
    if (vals.length && String(vals[0][0] || '').trim()) { header = vals[0]; break; }
  }
  if (!header) header = DEFAULT_RECORD_HEADER_.slice();
  sh = ss.insertSheet(sheetName);
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  sh.setFrozenRows(1);
  notes.push('已新增紀錄分頁「' + sheetName + '」，表頭 ' + header.length + ' 欄。');
}

// 把對話框填的 演習名稱／日期／地點／說明 寫進複製出來的設定檔的「演習資訊」。
// 演習資訊 是 key/value 兩欄，readExerciseInfo_ 掃 A 欄找標籤、讀 B 欄，所以
// 這裡用「有就改、沒有就追加」的方式，不動其他列。
function writeExerciseInfo_(configId, payload, notes) {
  var ss = SpreadsheetApp.openById(configId);
  var sh = ss.getSheetByName('演習資訊');
  if (!sh) { notes.push('設定檔裡沒有「演習資訊」分頁，略過時間地點寫入。'); return; }
  var pairs = [];
  if (payload.name) pairs.push(['演習名稱', payload.name]);
  if (payload.exerciseDate) pairs.push(['演習日期', payload.exerciseDate]);
  // 地點目前不是後端認得的獨立欄位（readExerciseInfo_ 只認 機構名稱／演習名稱／
  // 演習主題／演習類別／演習日期／說明／啟用觀察紀錄／低分需說明門檻），所以併進
  // 「說明」。要變成獨立欄位得改兩支後端並重新部署，不值得為了一行字付那個風險。
  var desc = [];
  if (payload.place) desc.push('地點：' + payload.place);
  if (payload.desc) desc.push(payload.desc);
  if (desc.length) pairs.push(['說明', desc.join('　')]);

  var values = sh.getDataRange().getValues();
  for (var i = 0; i < pairs.length; i++) {
    var label = pairs[i][0], value = pairs[i][1], found = -1;
    for (var r = 0; r < values.length; r++) {
      if (String(values[r][0] || '').trim() === label) { found = r + 1; break; }
    }
    if (found === -1) {
      found = sh.getLastRow() + 1;
      sh.getRange(found, 1).setValue(label);
      values.push([label, '']);
    }
    sh.getRange(found, 2).setNumberFormat('@');
    sh.getRange(found, 2).setValue(value);
  }
  notes.push('已寫入演習資訊：' + pairs.map(function (p) { return p[0]; }).join('、') + '。');
}

// 設定試算表的五個分頁檢查。只檢查「存在」與「有表頭」，不檢查內容對不對 ——
// 內容是業主的事，但分頁不見是評核表直接開不起來。
function checkConfigSpreadsheet_(configId) {
  var problems = [];
  var ss;
  try {
    ss = SpreadsheetApp.openById(configId);
  } catch (err) {
    return ['無法開啟設定試算表，請確認檔案權限與 ID 是否正確。'];
  }
  for (var i = 0; i < REQUIRED_CONFIG_SHEETS_.length; i++) {
    var nm = REQUIRED_CONFIG_SHEETS_[i];
    var sh = ss.getSheetByName(nm);
    if (!sh) { problems.push('設定試算表缺少分頁：' + nm); continue; }
    var vals = sh.getDataRange().getValues();
    if (!vals.length || !String(vals[0].join('')).trim()) {
      problems.push('設定試算表的「' + nm + '」分頁是空的（連表頭都沒有）。');
    }
  }
  return problems;
}

// 與 ConfigWithSubmit.gs 的 findHeaderCol_ 完全一致：先整列找完全相同，再找前綴。
// 兩段式是刻意的 —— 業主的表頭常寫成「醫院代號（機構代號）」，完全比對找不到，
// 前綴比對才找得到；但完全比對一定要先跑完，否則「評核題目」會被「評核題號」
// 的前綴規則搶走。
function findHeaderCol_(header, names) {
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

function normSlug_(s) {
  if (s instanceof Date) return '';
  if (s == null) return '';
  var v = String(s).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(v)) return '';
  return v;
}

function isSpreadsheetId_(s) {
  if (s instanceof Date) return false;
  return /^[A-Za-z0-9_-]{20,}$/.test(String(s == null ? '' : s).trim());
}

function isYes_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'y' || s === 'yes' || s === 'true' || s === '是' || s === '1' || s === '啟用';
}

function cell_(row, at) { return at === -1 || at == null ? '' : row[at]; }

function isBlankRow_(row) {
  for (var i = 0; i < row.length; i++) {
    if (String(row[i] == null ? '' : row[i]).trim() !== '') return false;
  }
  return true;
}

// datetime-local 來的字串長這樣：2026-10-08T08:00。寫進試算表時轉成
// 2026/10/08 08:00 —— 後端的 readWindowCell_ 用 new Date(raw) 解析，而那個格式
// 在 V8 上是穩的；ISO 的 T 形式也能解，但業主會直接看這一格，中文習慣的格式
// 比較不會被誤改。
function parseWhen_(raw, label, messages, required) {
  var s = String(raw || '').trim();
  if (!s) {
    if (required) messages.push(label + ' 是必填。留空代表「永遠開放」，會讓舊場次也一直顯示為開放中。');
    return { ms: null, text: '' };
  }
  var d = new Date(s.replace('T', ' ').replace(/-/g, '/'));
  if (isNaN(d.getTime())) {
    messages.push(label + ' 無法判讀成日期時間。');
    return { ms: null, text: '' };
  }
  return { ms: d.getTime(), text: Utilities.formatDate(d, 'Asia/Taipei', 'yyyy/MM/dd HH:mm') };
}

// 分析金鑰。Apps Script 沒有 crypto.getRandomValues，而 Math.random() 不適合用來
// 生憑證，所以用 Utilities.getUuid()（UUIDv4，隨機來源由平台提供）串起來取字元。
function randomKey_(len) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var hex = '';
  while (hex.length < len * 2) hex += Utilities.getUuid().replace(/-/g, '');
  var out = '';
  for (var i = 0; i < len; i++) {
    out += alphabet.charAt(parseInt(hex.substr(i * 2, 2), 16) % alphabet.length);
  }
  return out;
}

function groupFlag_(rows, keyOf, template, flag) {
  var byKey = {};
  for (var i = 0; i < rows.length; i++) {
    var k = keyOf(rows[i]);
    if (!k) continue;
    if (!byKey[k]) byKey[k] = [];
    byKey[k].push(rows[i]);
  }
  for (var kk in byKey) {
    if (!byKey.hasOwnProperty(kk)) continue;
    var grp = byKey[kk];
    if (grp.length < 2) continue;
    for (var g = 0; g < grp.length; g++) {
      var others = [];
      for (var o = 0; o < grp.length; o++) if (grp[o] !== grp[g]) others.push(grp[o].rowNumber);
      flag(grp[g], template.replace('{n}', others.join('、')));
    }
  }
}

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
