// Apps Script for the "演習評核_設定" spreadsheet.
// Deploy as a Web App (Extensions > Apps Script > Deploy > New deployment > Web app,
// execute as "Me", access "Anyone"). Start.dc.html fetches the deployed /exec URL.

var CONFIG_SPREADSHEET_ID = '1yiZDnbEFNHddzlTMWaz-bBgI0IvRWXMJ0H3WplyPJDk';

function doGet(e) {
  var ss = SpreadsheetApp.openById(CONFIG_SPREADSHEET_ID);
  var data = {
    exerciseName: readExerciseName_(ss),
    codes: readCodes_(ss),
    criteria: readCriteria_(ss),
    items: readItems_(ss),
  };
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function readExerciseName_(ss) {
  var values = ss.getSheetByName('演習資訊').getDataRange().getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === '演習名稱') return String(values[i][1] || '');
  }
  return '';
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
// 「項目名稱」當唯一分組欄，回傳格式與舊版 { name, questions }[] 完全相同
// （這正是目前 10/3 案例試算表的狀態，改動不需要動試算表）。
// 有分組的節點回傳 { name, children }，最底層（葉節點）回傳 { name, questions }。
function readItems_(ss) {
  var values = ss.getSheetByName('項目與問題').getDataRange().getValues();
  var header = values[0];
  var groupCols = [];
  for (var lvl = 1; ; lvl++) {
    var at = header.indexOf('層' + lvl);
    if (at === -1) break;
    groupCols.push(at);
  }
  if (!groupCols.length) {
    var nameCol = header.indexOf('項目名稱');
    if (nameCol === -1) throw new Error('項目與問題缺少欄位：項目名稱 或 層1');
    groupCols = [nameCol];
  }
  var idCol = header.indexOf('問題ID');
  var textCol = header.indexOf('問題內容');

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
