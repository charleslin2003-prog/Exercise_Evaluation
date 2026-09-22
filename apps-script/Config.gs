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

function readItems_(ss) {
  var values = ss.getSheetByName('項目與問題').getDataRange().getValues();
  var header = values[0];
  var nameCol = header.indexOf('項目名稱');
  var idCol = header.indexOf('問題ID');
  var textCol = header.indexOf('問題內容');
  var order = [];
  var map = {};
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var name = row[nameCol];
    if (!name) continue;
    if (!map[name]) {
      map[name] = [];
      order.push(name);
    }
    map[name].push({ id: String(row[idCol] || ''), text: String(row[textCol] || '') });
  }
  return order.map(function (name) {
    return { name: name, questions: map[name] };
  });
}
