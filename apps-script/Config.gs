// Apps Script for the "演習評核_設定" spreadsheet.
// Deploy as a Web App (Extensions > Apps Script > Deploy > New deployment > Web app,
// execute as "Me", access "Anyone"). Start.dc.html fetches the deployed /exec URL.

var CONFIG_SPREADSHEET_ID = '1yiZDnbEFNHddzlTMWaz-bBgI0IvRWXMJ0H3WplyPJDk';

function doGet(e) {
  var ss = SpreadsheetApp.openById(CONFIG_SPREADSHEET_ID);
  var info = readExerciseInfo_(ss);
  var data = {
    orgName: info.org,
    exerciseName: info.name,
    exerciseTopic: info.topic,
    exerciseDate: info.date,
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
function readExerciseInfo_(ss) {
  var values = ss.getSheetByName('演習資訊').getDataRange().getValues();
  var info = { org: '', name: '', topic: '', date: '' };
  for (var i = 0; i < values.length; i++) {
    var key = values[i][0];
    var val = String(values[i][1] || '');
    if (key === '機構名稱') info.org = val;
    else if (key === '演習名稱') info.name = val;
    else if (key === '演習主題') info.topic = val;
    else if (key === '演習日期') info.date = val;
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
function findHeaderCol_(header, names) {
  for (var i = 0; i < names.length; i++) {
    var at = header.indexOf(names[i]);
    if (at !== -1) return at;
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

  var root = { children: [], index: {} };
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[groupCols[0]]) continue;
    var cursor = root;
    for (var g = 0; g < groupCols.length; g++) {
      var key = String(row[groupCols[g]] || '');
      if (!key) break;
      if (!cursor.index[key]) {
        var node = { name: key, children: [], index: {} };
        cursor.index[key] = node;
        cursor.children.push(node);
      }
      cursor = cursor.index[key];
    }
    cursor.questions = cursor.questions || [];
    cursor.questions.push({ id: String(row[idCol] || ''), text: String(row[textCol] || '') });
  }
  return stripGroupInternals_(root.children);
}

function stripGroupInternals_(nodes) {
  return nodes.map(function (n) {
    return n.questions ? { name: n.name, questions: n.questions } : { name: n.name, children: stripGroupInternals_(n.children) };
  });
}
