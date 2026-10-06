// Apps Script for the "演習評核_設定" spreadsheet.
// Deploy as a Web App (Extensions > Apps Script > Deploy > New deployment > Web app,
// execute as "Me", access "Anyone"). Start.dc.html fetches the deployed /exec URL.

// ⚠️ 測試分支（dev）：測試用設定表，master 上的正式值是
// '1j3UCbdSKeOip4Nz-Ymek-mjAH3bGTqiZyI3G__-ubdQ'。
var CONFIG_SPREADSHEET_ID = '1yiZDnbEFNHddzlTMWaz-bBgI0IvRWXMJ0H3WplyPJDk';  // 演習評核_設定（測試）

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
  var info = { org: '', name: '', topic: '', category: '', date: '', desc: '' };
  for (var i = 0; i < values.length; i++) {
    var key = values[i][0];
    var val = formatCellValue_(values[i][1]);
    if (key === '機構名稱') info.org = val;
    else if (key === '演習名稱') info.name = val;
    else if (key === '演習主題' || key === '主題') info.topic = val;
    else if (key === '演習類別') info.category = val;
    else if (key === '演習日期') info.date = val;
    else if (key === '說明') info.desc = val;
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
    if (row[scoreCol] === '' || row[scoreCol] == null) continue;
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
// 前兩層另外接受具名欄位當別名：「層1」也可以叫「情境階段」、「層2」也可以
// 叫「演練單元」（比對順序：先找「層N」，找不到才找別名）；深度 3 層以上
// 只認「層N」，沒有具名別名。問題ID/問題內容兩欄同理，也接受「評核題號」
// 「評核題目」這種別名。
// 有分組的節點回傳 { name, children }，最底層（葉節點）回傳 { name, questions }。
var GROUP_HEADER_ALIASES_ = [['情境階段'], ['演練單元']];
var ID_HEADER_ALIASES_ = ['問題ID', '評核題號'];
var TEXT_HEADER_ALIASES_ = ['問題內容', '評核題目', '具體評核題目'];
// 選填欄：每個葉節點（最底層分組，例如 SCENE）的簡要說明，取自這一欄的第一
// 筆值，掛在葉節點的 goal 上，給 Start.dc.html 選擇畫面當作該情境的列表文字
// 用（配合數字徽章顯示）。沒有這欄就是空字串，前端會退回原本只顯示編號。
var GOAL_HEADER_ALIASES_ = ['測試情境與目標', '測試情境'];
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
function readItems_(ss) {
  var values = ss.getSheetByName('項目與問題').getDataRange().getValues();
  var header = values[0];
  var groupCols = [];
  for (var lvl = 1; ; lvl++) {
    var at = header.indexOf('層' + lvl);
    if (at === -1 && GROUP_HEADER_ALIASES_[lvl - 1]) at = findHeaderCol_(header, GROUP_HEADER_ALIASES_[lvl - 1]);
    if (at === -1) break;
    groupCols.push(at);
  }
  if (!groupCols.length) {
    var nameCol = header.indexOf('項目名稱');
    if (nameCol === -1) throw new Error('項目與問題缺少欄位：項目名稱 或 層1/情境階段');
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
