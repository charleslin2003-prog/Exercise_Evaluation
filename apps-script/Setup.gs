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
  SpreadsheetApp.getUi()
    .createMenu(MENU_TITLE_)
    .addItem('新增一場演習…', 'showSetupDialog')
    .addItem('檢查註冊表', 'showRegistryCheck')
    .addSeparator()
    .addItem('設定說明（指令碼屬性）', 'showSetupPropertyHelp')
    .addToUi();
}

function showSetupDialog() {
  var t = HtmlService.createTemplateFromFile('SetupDialog');
  var html = t.evaluate().setWidth(720).setHeight(760);
  SpreadsheetApp.getUi().showModalDialog(html, '新增一場演習');
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
  html += '</table><p style="margin-top:14px;color:#666">這支腳本不需要、也不會讀取 ADMIN_KEY 或任何分析金鑰；'
    + '分析金鑰是它<b>產生</b>並寫進註冊表的，不會顯示在這裡。</p></div>';
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

    // 分析金鑰。用 Utilities.getUuid() 當亂數來源，不是 Math.random()：這是一把
    // 真的憑證，而 Apps Script 沒有 crypto.getRandomValues。
    var analysisKey = randomKey_(32);

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
