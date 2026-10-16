// Apps Script for the "演習評核_設定" spreadsheet.
// Deploy as a Web App (Extensions > Apps Script > Deploy > New deployment > Web app,
// execute as "Me", access "Anyone"). Start.dc.html fetches the deployed /exec URL.

// 正式分支（master）：業主正式的設定表。必須跟 ConfigWithSubmit.gs 的
// CONFIG_SPREADSHEET_ID 同值——兩支後端讀同一份設定表，不同值會讓「有沒有帶
// ?t=」的連結看到不同的題目。沙箱值只存在 dev 分支。
var CONFIG_SPREADSHEET_ID = '1j3UCbdSKeOip4Nz-Ymek-mjAH3bGTqiZyI3G__-ubdQ';  // 演習評核_設定

function doGet(e) {
  var ss = SpreadsheetApp.openById(CONFIG_SPREADSHEET_ID);
  var info = readExerciseInfo_(ss);
  var data = {
    orgName: info.org,
    exerciseName: info.name,
    exerciseTopic: info.topic,
    exerciseCategory: info.category,
    exerciseDate: info.date,
    exerciseDesc: info.desc,
    // 這兩個欄位 ConfigWithSubmit.gs 的設定分支一直都有回；這支沒有，所以
    // Start.dc.html 讀到 undefined，而它的判斷是 config.commentEnabled !== false
    // ——undefined !== false 成立，留言框就一直開著。補上之後兩條路徑才一致。
    commentEnabled: info.commentEnabled,
    commentRequiredBelow: info.commentRequiredBelow,
    codes: readCodes_(ss),
    criteria: readCriteria_(ss),
    items: readItems_(ss),
  };
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// 演習資訊 是 key/value 列，A 欄放標籤、B 欄放值，沒有固定標頭列，逐列掃描
// A 欄比對標籤文字。機構名稱/演習主題/演習日期都是選填的，沒填就回空字串，
// 前端據此決定要不要顯示（標題/徽章）。
// 儲存格如果被 Sheets 判讀成日期型別（例如「演習日期」欄填了看起來像日期的
// 值），values[i][1] 拿到的會是真正的 Date 物件，直接 String() 會變成
// 「Sat Oct 03 2026 15:00:00 GMT+0800 (台北標準時間)」這種不是給人看的格式；
// 統一格式化成 yyyy/MM/dd。純文字欄位（機構名稱/演習名稱/演習主題）不會是
// Date，這個判斷對它們無影響。
function formatCellValue_(val) {
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Taipei', 'yyyy/MM/dd');
  return String(val == null ? '' : val);
}
function readExerciseInfo_(ss) {
  var values = ss.getSheetByName('演習資訊').getDataRange().getValues();
  // commentEnabled 預設 true、commentRequiredBelow 預設 0：沒填那兩列就跟以前
  // 一模一樣（留言框開著、永不強制）。
  var info = { org: '', name: '', topic: '', category: '', date: '', desc: '',
    commentEnabled: true, commentRequiredBelow: 0 };
  for (var i = 0; i < values.length; i++) {
    var key = values[i][0];
    var val = formatCellValue_(values[i][1]);
    if (key === '機構名稱') info.org = val;
    else if (key === '演習名稱') info.name = val;
    else if (key === '演習主題' || key === '主題') info.topic = val;
    else if (key === '演習類別') info.category = val;
    else if (key === '演習日期') info.date = val;
    else if (key === '說明') info.desc = val;
    // 下面兩個標籤原本只有 ConfigWithSubmit.gs 認得，於是「關掉觀察紀錄」只在帶
    // ?t= 的連結上生效，不帶參數的舊連結留言框照樣在 —— 因為那條走的是這支
    // Config.gs。兩邊的判斷必須一字不差，否則同一張設定表會因為連結形狀不同而
    // 有兩種行為，而那是沒有人會想到要去查的。
    else if (key === '啟用觀察紀錄') {
      // 只有明確寫 N／否／關閉（或 FALSE，含沒打勾的核取方塊）才關掉；空白或任何
      // 其他值都當成開啟，因為「少一個留言框」比「意外關掉報告唯一的質性資料來源」好修。
      info.commentEnabled = !(val === 'N' || val === 'n' || val === '否' || val === '關閉' ||
        val === 'FALSE' || val === 'False' || val === 'false');
    } else if (key === '低分需說明門檻') {
      // 2 的意思是「評 1 或 2 分要寫說明」。空白、非數字都當 0（永不強制）。
      var threshold = Number(val);
      info.commentRequiredBelow = isNaN(threshold) ? 0 : threshold;
    }
  }
  return info;
}

function readCodes_(ss) {
  var values = ss.getSheetByName('人員代號').getDataRange().getValues();
  var col = values[0].indexOf('代號');
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var v = values[i][col];
    if (v === '' || v == null) continue;
    out.push({ value: String(v), label: String(v) });
  }
  return out;
}

function readCriteria_(ss) {
  var values = ss.getSheetByName('評分標準').getDataRange().getValues();
  var header = values[0];
  var scoreCol = header.indexOf('分數');
  var labelCol = header.indexOf('標籤');
  var descCol = header.indexOf('說明');
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    // 只有空白字元的格子也當空白：Number(' ') 是 0，不擋的話會多出一個假的 0 分等級
    // （評核單多一顆 0 按鈕，舊 1–5 場次的「最低一級」也會被誤判成 0）。
    if (row[scoreCol] === '' || row[scoreCol] == null || String(row[scoreCol]).trim() === '') continue;
    out.push({
      score: Number(row[scoreCol]),
      label: String(row[labelCol] || ''),
      desc: String(row[descCol] || ''),
    });
  }
  return out;
}

// 項目與問題表支援任意層數分組：標頭裡有幾欄「層1」「層2」...就分幾層
// （例如 階段->情境 兩層），沒有「層N」欄位時退回舊版單層行為，直接用
// 「項目名稱」當唯一分組欄，回傳格式與舊版 { name, questions }[] 完全相同。
// 前兩層另外接受具名欄位當別名：「層1」也可以叫「地點」（2026-10-16 業主改名，
// 舊名「場景階段」「情境階段」照收）、「層2」也可以
// 叫「演練單元」（比對順序：先找「層N」，找不到才找別名）；深度 3 層以上
// 只認「層N」，沒有具名別名。問題ID/問題內容兩欄同理，也接受「評核題號」
// 「評核題目」這種別名。
// 有分組的節點回傳 { name, children }，最底層（葉節點）回傳 { name, questions }。
var GROUP_HEADER_ALIASES_ = [['地點', '場景階段', '情境階段'], ['演練單元']];
var ID_HEADER_ALIASES_ = ['問題ID', '評核題號'];
var TEXT_HEADER_ALIASES_ = ['問題內容', '評核題目', '具體評核題目'];
// 選填欄：每個葉節點（最底層分組，例如 SCENE）的簡要說明，取自這一欄的第一
// 筆值，掛在葉節點的 goal 上，給 Start.dc.html 選擇畫面當作該情境的列表文字
// 用（配合數字徽章顯示）。沒有這欄就是空字串，前端會退回原本只顯示編號。
// 2026-10-16 業主把「測試情境」改名「場景說明」：新名放第一個，舊名全部照收。
var GOAL_HEADER_ALIASES_ = ['場景說明', '測試場景與目標', '測試場景', '測試情境與目標', '測試情境'];
// 找標頭列裡符合任一別名的欄位：先找「完全相等」，全部欄位都找過一輪都沒
// 命中，才退而求其次找「開頭比對」（因應欄名後面接不固定補充文字或換行的
// 情況）。一定要先做完整的完全相等再做開頭比對，不然像「問題」這個別名會
// 在找到「問題」欄之前，就先用開頭比對誤中「問題ID」欄。
function findHeaderCol_(header, names) {
  for (var i = 0; i < header.length; i++) {
    var cell = String(header[i] || '');
    if (names.indexOf(cell) !== -1) return i;
  }
  for (var j = 0; j < header.length; j++) {
    var cell2 = String(header[j] || '');
    for (var k = 0; k < names.length; k++) {
      if (cell2.indexOf(names[k]) === 0) return j;
    }
  }
  return -1;
}
// 「層N」表頭的第 N 欄；找不到回傳 -1（readItems_ 的迴圈靠這個 -1 結束，不是錯誤）。
// 阿拉伯數字「層1」以外，也收國字「層一」與全形「層１」：業主 2026-10-16 照著錯誤訊息
// 的「層1」改表頭時，打成的是「層一」，結果兩版後端都不認、兩場評核單一起打不開。
// 前後空白不算（「層一 」也找得到）。
var LEVEL_DIGITS_ZH_ = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
var LEVEL_DIGITS_FULL_ = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９', '１０'];
function levelHeaderCol_(header, lvl) {
  var names = ['層' + lvl];
  if (LEVEL_DIGITS_ZH_[lvl]) names.push('層' + LEVEL_DIGITS_ZH_[lvl]);
  if (LEVEL_DIGITS_FULL_[lvl]) names.push('層' + LEVEL_DIGITS_FULL_[lvl]);
  for (var i = 0; i < header.length; i++) {
    if (names.indexOf(String(header[i] == null ? '' : header[i]).trim()) !== -1) return i;
  }
  return -1;
}
function readItems_(ss) {
  var values = ss.getSheetByName('項目與問題').getDataRange().getValues();
  var header = values[0];
  var groupCols = [];
  for (var lvl = 1; ; lvl++) {
    var at = levelHeaderCol_(header, lvl);
    if (at === -1 && GROUP_HEADER_ALIASES_[lvl - 1]) at = findHeaderCol_(header, GROUP_HEADER_ALIASES_[lvl - 1]);
    if (at === -1) break;
    groupCols.push(at);
  }
  if (!groupCols.length) {
    var nameCol = header.indexOf('項目名稱');
    if (nameCol === -1) throw new Error('項目與問題缺少第一層欄位：請把表頭寫成「層1」（或「層一」、「地點」），單層的表可以用「項目名稱」');
    groupCols = [nameCol];
  }
  var idCol = findHeaderCol_(header, ID_HEADER_ALIASES_);
  var textCol = findHeaderCol_(header, TEXT_HEADER_ALIASES_);
  var goalCol = findHeaderCol_(header, GOAL_HEADER_ALIASES_);

  var root = { children: [], index: {} };
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[groupCols[0]]) continue;
    var cursor = root;
    for (var g = 0; g < groupCols.length; g++) {
      var key = String(row[groupCols[g]] || '');
      if (!key) break;
      if (!cursor.index[key]) {
        var node = { name: key, children: [], index: {}, goal: '' };
        cursor.index[key] = node;
        cursor.children.push(node);
      }
      cursor = cursor.index[key];
    }
    if (goalCol !== -1 && !cursor.goal) cursor.goal = String(row[goalCol] || '');
    cursor.questions = cursor.questions || [];
    cursor.questions.push({ id: String(row[idCol] || ''), text: String(row[textCol] || '') });
  }
  return stripGroupInternals_(root.children);
}

function stripGroupInternals_(nodes) {
  return nodes.map(function (n) {
    return n.questions ? { name: n.name, questions: n.questions, goal: n.goal || '' } : { name: n.name, children: stripGroupInternals_(n.children) };
  });
}
