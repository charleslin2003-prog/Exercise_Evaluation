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

// 問題ID -> 指標代號 對照表，跟紀錄表放在同一個試算表。多了「評核潛能」
// 「4S 元素」兩欄供分析頁彙總用（讀取用 readIndicatorFull_，寫入 評核紀錄
// 用的 readIndicatorMap_ 仍只取前三欄，不受影響）。
var INDICATOR_SHEET_NAME = '指標';
var INDICATOR_HEADERS = ['問題ID', '問題', '問題所屬指標', '評核潛能', '4S 元素'];

// 分析頁（Analysis.html）用的存取金鑰：Analysis.html 是一個不公開連結、
// 不會被 Start.dc.html 引用到的獨立頁面，但因為 CONFIG_URL/RECORD_URL 兩個
// /exec 網址本身已經寫在 Start.dc.html 原始碼裡（任何評核官手機都看得到），
// 不能只靠「多一個 action 參數」擋人，所以另外要求帶一把只存在於
// Analysis.html 原始碼裡的亂數金鑰。部署前務必把下面這個值換成自己產生的
// 隨機字串，並且要跟 Analysis.html 裡的 ANALYSIS_KEY 保持一致。
var ANALYSIS_KEY = 'WrHSeTn1bkVtD2C9QriISkCy2Q_I8Jub';

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'analysis') {
    if (!e.parameter.key || e.parameter.key !== ANALYSIS_KEY) {
      return jsonOut_({ error: 'unauthorized' });
    }
    return jsonOut_(buildAnalysis_());
  }
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
  var item = findLeafByName_(readItems_(configSs), body.itemName);
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

  // 這些都是唯讀查詢，不用等鎖就能先做；recordSs 只 open 一次重複使用，
  // 避免對同一份試算表多打一次 API（doPost 常被嫌慢，很大一部分就是每個
  // SpreadsheetApp 呼叫都是一次網路來回，能少一次是一次）。
  var recordSs = SpreadsheetApp.openById(RECORD_SPREADSHEET_ID);
  var sheet = recordSs.getSheetByName(RECORD_SHEET_NAME);
  if (!sheet) throw new Error('找不到工作表：' + RECORD_SHEET_NAME);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = {};
  for (var i = 0; i < RECORD_HEADERS.length; i++) {
    var at = header.indexOf(RECORD_HEADERS[i]);
    if (at === -1) throw new Error('紀錄表缺少欄位：' + RECORD_HEADERS[i]);
    col[RECORD_HEADERS[i]] = at;
  }
  var exerciseName = readExerciseName_(configSs);
  var indicatorByQuestionId = readIndicatorMap_(recordSs);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (cacheKey && cache.get(cacheKey)) return { ok: true, rows: 0, duplicate: true };

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

// 分析頁用：問題ID -> {question, indicator, potential, s4} 完整對照表。
function readIndicatorFull_(ss) {
  var sheet = ss.getSheetByName(INDICATOR_SHEET_NAME);
  if (!sheet) throw new Error('找不到工作表：' + INDICATOR_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  var header = values[0];
  var idCol = header.indexOf(INDICATOR_HEADERS[0]);
  var textCol = header.indexOf(INDICATOR_HEADERS[1]);
  var indicatorCol = header.indexOf(INDICATOR_HEADERS[2]);
  var potentialCol = header.indexOf(INDICATOR_HEADERS[3]);
  var s4Col = header.indexOf(INDICATOR_HEADERS[4]);
  if ([idCol, textCol, indicatorCol, potentialCol, s4Col].indexOf(-1) !== -1) {
    throw new Error(INDICATOR_SHEET_NAME + ' 缺少欄位：' + INDICATOR_HEADERS.join(' / '));
  }
  var map = {};
  for (var i = 1; i < values.length; i++) {
    var id = values[i][idCol];
    if (id === '' || id == null) continue;
    map[String(id)] = {
      question: String(values[i][textCol] || ''),
      indicator: String(values[i][indicatorCol] || ''),
      potential: String(values[i][potentialCol] || ''),
      s4: String(values[i][s4Col] || ''),
    };
  }
  return map;
}

// 彙總 評核紀錄 目前所有已送出的分數，依潛能/4S/指標分組並計算統計量，
// 供 Analysis.html 畫雷達圖、4S 長條圖、逐題明細與一致性統計。
// 同一題同一位評核官若送出過不只一次，以試算表裡較晚的那列為準。
function buildAnalysis_() {
  var configSs = SpreadsheetApp.openById(CONFIG_SPREADSHEET_ID);
  var recordSs = SpreadsheetApp.openById(RECORD_SPREADSHEET_ID);
  var exerciseName = readExerciseName_(configSs);
  var stageIndex = indexQuestionsByStage_(readItems_(configSs));
  var indicatorFull = readIndicatorFull_(recordSs);

  var sheet = recordSs.getSheetByName(RECORD_SHEET_NAME);
  if (!sheet) throw new Error('找不到工作表：' + RECORD_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  var header = values[0];
  var col = {};
  RECORD_HEADERS.forEach(function (h) { col[h] = header.indexOf(h); });

  var byQuestion = {};
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var id = String(row[col['問題ID']] || '');
    var code = String(row[col['人員代號']] || '');
    var score = Number(row[col['分數']]);
    if (!id || !code || isNaN(score)) continue;
    if (!byQuestion[id]) byQuestion[id] = { itemName: String(row[col['項目名稱']] || ''), byCode: {} };
    byQuestion[id].byCode[code] = score;
  }

  var rows = Object.keys(byQuestion).map(function (id) {
    var meta = indicatorFull[id] || { question: '', indicator: '', potential: '', s4: '' };
    var stageInfo = stageIndex[id] || { stage: '', itemName: byQuestion[id].itemName };
    var codes = Object.keys(byQuestion[id].byCode).sort();
    var scores = codes.map(function (c) { return { code: c, score: byQuestion[id].byCode[c] }; });
    var vals = scores.map(function (s) { return s.score; });
    return {
      questionId: id,
      stage: stageInfo.stage,
      itemName: stageInfo.itemName || byQuestion[id].itemName,
      potential: meta.potential,
      s4: meta.s4,
      indicator: meta.indicator,
      question: meta.question,
      scores: scores,
      mean: mean_(vals),
      sd: sd_(vals),
    };
  });

  var analysisRows = rows.filter(function (r) { return r.potential === '回應' || r.potential === '監測' || r.potential === '預期'; });
  var coverageRows = rows.filter(function (r) { return r.potential.indexOf('覆蓋率') !== -1; });

  // 一致性統計（ICC / within1）沿用業主參考 Demo 的範圍：三項潛能 + 覆蓋率
  // 一起算，反映評核官整體評分習慣，不只侷限在三項潛能題目。
  var consistencyRows = analysisRows.concat(coverageRows);
  var stats = {
    overall: summarize_(flattenScores_(analysisRows)),
    potentials: {},
    s4: {},
    coverage: summarize_(flattenScores_(coverageRows)),
    icc2k: icc2k_(consistencyRows),
    within1: within1_(consistencyRows),
  };
  ['回應', '監測', '預期'].forEach(function (p) {
    stats.potentials[p] = summarize_(flattenScores_(analysisRows.filter(function (r) { return r.potential === p; })));
  });
  var s4Labels = {};
  analysisRows.forEach(function (r) { if (r.s4) s4Labels[r.s4] = true; });
  Object.keys(s4Labels).forEach(function (label) {
    stats.s4[label] = summarize_(flattenScores_(analysisRows.filter(function (r) { return r.s4 === label; })));
  });

  var codeSet = {};
  rows.forEach(function (r) { r.scores.forEach(function (s) { codeSet[s.code] = true; }); });

  return {
    meta: {
      exerciseName: exerciseName,
      generatedAt: new Date().toISOString(),
      evaluatorCodes: Object.keys(codeSet).sort(),
    },
    analysisRows: analysisRows,
    coverageRows: coverageRows,
    stats: stats,
  };
}

function flattenScores_(rows) {
  var out = [];
  rows.forEach(function (r) { r.scores.forEach(function (s) { out.push(s.score); }); });
  return out;
}

function mean_(arr) {
  if (!arr.length) return null;
  var sum = 0;
  arr.forEach(function (v) { sum += v; });
  return sum / arr.length;
}

function sd_(arr) {
  if (arr.length < 2) return 0;
  var m = mean_(arr);
  var sq = 0;
  arr.forEach(function (v) { sq += (v - m) * (v - m); });
  return Math.sqrt(sq / (arr.length - 1));
}

function summarize_(arr) {
  if (!arr.length) return { n: 0, mean: null, sd: null, min: null, max: null };
  return { n: arr.length, mean: mean_(arr), sd: sd_(arr), min: Math.min.apply(null, arr), max: Math.max.apply(null, arr) };
}

// ICC(2,k)：雙向隨機效果、平均量測的一致性（Shrout & Fleiss）。只用「所有
// 題目都有評分的評核官代號交集」組成完整矩陣，交集不足 2 人或題目不足 2
// 題時回傳 null（資料還太少，算了也沒意義）。
function icc2k_(rows) {
  if (!rows.length) return null;
  var commonCodes = null;
  rows.forEach(function (r) {
    var codes = r.scores.map(function (s) { return s.code; });
    commonCodes = commonCodes === null ? codes.slice() : commonCodes.filter(function (c) { return codes.indexOf(c) !== -1; });
  });
  if (!commonCodes || commonCodes.length < 2) return null;

  var matrix = rows.map(function (r) {
    var byCode = {};
    r.scores.forEach(function (s) { byCode[s.code] = s.score; });
    return commonCodes.map(function (c) { return byCode[c]; });
  });
  var n = matrix.length, k = commonCodes.length;
  if (n < 2) return null;

  var grand = mean_(matrix.reduce(function (acc, row) { return acc.concat(row); }, []));
  var ssRow = 0, ssCol = 0, ssTotal = 0;
  matrix.forEach(function (row) {
    var rm = mean_(row);
    ssRow += k * (rm - grand) * (rm - grand);
    row.forEach(function (v) { ssTotal += (v - grand) * (v - grand); });
  });
  for (var j = 0; j < k; j++) {
    var cm = mean_(matrix.map(function (row) { return row[j]; }));
    ssCol += n * (cm - grand) * (cm - grand);
  }
  var msr = ssRow / (n - 1);
  var msc = ssCol / (k - 1);
  var mse = (ssTotal - ssRow - ssCol) / ((n - 1) * (k - 1));
  var denom = msr + (msc - mse) / n;
  return denom ? (msr - mse) / denom : null;
}

// 任兩位評核官對同一題評分「相差不超過 1 分」的比例：逐題取該題所有已
// 評分的評核官兩兩配對計算，不要求所有題目的評核官交集一致。
function within1_(rows) {
  var agree = 0, total = 0;
  rows.forEach(function (r) {
    var scores = r.scores.map(function (s) { return s.score; });
    for (var a = 0; a < scores.length; a++) {
      for (var b = a + 1; b < scores.length; b++) {
        total++;
        if (Math.abs(scores[a] - scores[b]) <= 1) agree++;
      }
    }
  });
  return total ? agree / total : null;
}

// 問題ID -> {stage, itemName}：stage 取第一層分組名稱，itemName 取該問題
// 所屬葉節點（最底層）的名稱，跟 評核紀錄 的「項目名稱」欄一致。
function indexQuestionsByStage_(nodes) {
  var out = {};
  nodes.forEach(function (root) {
    if (root.questions) {
      root.questions.forEach(function (q) { out[q.id] = { stage: root.name, itemName: root.name }; });
    } else if (root.children) {
      indexChildren_(root.children, root.name, out);
    }
  });
  return out;
}

function indexChildren_(nodes, stageName, out) {
  nodes.forEach(function (n) {
    if (n.questions) {
      n.questions.forEach(function (q) { out[q.id] = { stage: stageName, itemName: n.name }; });
    } else if (n.children) {
      indexChildren_(n.children, stageName, out);
    }
  });
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

function findLeafByName_(nodes, name) {
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n.questions && n.name === name) return n;
    if (n.children) {
      var found = findLeafByName_(n.children, name);
      if (found) return found;
    }
  }
  return null;
}
