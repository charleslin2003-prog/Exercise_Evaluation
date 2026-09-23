// Apps Script variant that also accepts submissions (doPost) and writes them
// into 紀錄表, in addition to serving 演習評核_設定 config (doGet).
// This is the version deployed behind RECORD_URL in Start.dc.html.
// Deploy as a Web App (Extensions > Apps Script > Deploy > New deployment > Web app,
// execute as "Me", access "Anyone"). Start.dc.html fetches the deployed /exec URL.

var CONFIG_SPREADSHEET_ID = '1yiZDnbEFNHddzlTMWaz-bBgI0IvRWXMJ0H3WplyPJDk';

// 紀錄表是另一個試算表，把這裡改成該檔案的 ID。
var RECORD_SPREADSHEET_ID = '1jD6DXmPgTV9664XoIveD_cqNQd9V8vq6aM7EtMoI6FM';
var RECORD_SHEET_NAME = '評核紀錄';
var RECORD_HEADERS = ['演習名稱', '項目名稱', '問題ID', '指標代號', '分數', '人員代號', '送出時間'];

// 問題ID -> 指標代號 對照表，跟紀錄表放在同一個試算表。
var INDICATOR_SHEET_NAME = '指標';
var INDICATOR_HEADERS = ['問題ID', '問題', '問題所屬指標'];

function doGet(e) {
  var ss = SpreadsheetApp.openById(CONFIG_SPREADSHEET_ID);
  return jsonOut_({
    exerciseName: readExerciseName_(ss),
    codes: readCodes_(ss),
    criteria: readCriteria_(ss),
    items: readItems_(ss),
  });
}

function doPost(e) {
  try {
    return jsonOut_(appendSubmission_(JSON.parse(e.postData.contents)));
  } catch (err) {
    return jsonOut_({ ok: false, error: String((err && err.message) || err) });
  }
}

function jsonOut_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Google Sheets 會把以這些字元開頭的字串值當成公式執行；寫入前一律跳脫，
// 避免透過 fillerCode/itemName/問題ID 注入公式（即使下面已用白名單擋掉未知值，
// 這裡仍保留一層防禦）。
var FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@'];
function sanitizeCell_(value) {
  var s = String(value == null ? '' : value);
  if (s.length && FORMULA_TRIGGER_CHARS.indexOf(s.charAt(0)) !== -1) return "'" + s;
  return s;
}

function appendSubmission_(body) {
  var answers = (body && body.answers) || [];
  if (!answers.length) throw new Error('沒有評分資料');

  // 白名單驗證：fillerCode / itemName / 問題ID 都必須是設定表裡真實存在的值，
  // 拒絕任何不在名單內的提交，防止偽造代號或注入任意字串（例如試算表公式）。
  var configSs = SpreadsheetApp.openById(CONFIG_SPREADSHEET_ID);
  var validCodes = readCodes_(configSs).map(function (c) { return c.value; });
  if (validCodes.indexOf(String(body.fillerCode || '')) === -1) {
    throw new Error('未知的人員代號：' + body.fillerCode);
  }
  var item = readItems_(configSs).filter(function (it) { return it.name === body.itemName; })[0];
  if (!item) throw new Error('未知的項目名稱：' + body.itemName);
  var validQuestionIds = item.questions.map(function (q) { return q.id; });
  answers.forEach(function (a) {
    if (validQuestionIds.indexOf(String(a.id || '')) === -1) {
      throw new Error('未知的問題ID：' + a.id);
    }
  });

  // 客戶端重試時會帶同一組 submissionId，避免逾時後重送造成重複列。
  var cacheKey = body.submissionId ? 'sub_' + body.submissionId : '';
  var cache = CacheService.getScriptCache();
  if (cacheKey && cache.get(cacheKey)) return { ok: true, rows: 0, duplicate: true };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (cacheKey && cache.get(cacheKey)) return { ok: true, rows: 0, duplicate: true };

    var sheet = SpreadsheetApp.openById(RECORD_SPREADSHEET_ID).getSheetByName(RECORD_SHEET_NAME);
    if (!sheet) throw new Error('找不到工作表：' + RECORD_SHEET_NAME);
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var col = {};
    for (var i = 0; i < RECORD_HEADERS.length; i++) {
      var at = header.indexOf(RECORD_HEADERS[i]);
      if (at === -1) throw new Error('紀錄表缺少欄位：' + RECORD_HEADERS[i]);
      col[RECORD_HEADERS[i]] = at;
    }

    var exerciseName = readExerciseName_(configSs);
    var indicatorByQuestionId = readIndicatorMap_(SpreadsheetApp.openById(RECORD_SPREADSHEET_ID));
    var now = new Date();
    var rows = answers.map(function (a) {
      var row = [];
      for (var j = 0; j < header.length; j++) row.push('');
      var questionId = String(a.id || '');
      row[col['演習名稱']] = sanitizeCell_(exerciseName);
      row[col['項目名稱']] = sanitizeCell_(body.itemName);
      row[col['問題ID']] = sanitizeCell_(questionId);
      row[col['指標代號']] = sanitizeCell_(indicatorByQuestionId[questionId] || '');
      row[col['分數']] = Number(a.score);
      row[col['人員代號']] = sanitizeCell_(body.fillerCode);
      row[col['送出時間']] = now;
      return row;
    });

    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, header.length).setValues(rows);
    SpreadsheetApp.flush();
    if (cacheKey) cache.put(cacheKey, '1', 21600);
    return { ok: true, rows: rows.length, duplicate: false };
  } finally {
    lock.releaseLock();
  }
}

function readIndicatorMap_(ss) {
  var sheet = ss.getSheetByName(INDICATOR_SHEET_NAME);
  if (!sheet) throw new Error('找不到工作表：' + INDICATOR_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  var header = values[0];
  var idCol = header.indexOf(INDICATOR_HEADERS[0]);
  var indicatorCol = header.indexOf(INDICATOR_HEADERS[2]);
  if (idCol === -1 || indicatorCol === -1) {
    throw new Error(INDICATOR_SHEET_NAME + ' 缺少欄位：' + INDICATOR_HEADERS[0] + ' 或 ' + INDICATOR_HEADERS[2]);
  }
  var map = {};
  for (var i = 1; i < values.length; i++) {
    var id = values[i][idCol];
    if (id === '' || id == null) continue;
    map[String(id)] = String(values[i][indicatorCol] || '');
  }
  return map;
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
