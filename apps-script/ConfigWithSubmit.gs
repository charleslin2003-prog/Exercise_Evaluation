// Apps Script variant that also accepts submissions (doPost) and writes them
// into 紀錄表, in addition to serving 演習評核_設定 config (doGet).
// This is the version deployed behind RECORD_URL in Start.dc.html.
// Deploy as a Web App (Extensions > Apps Script > Deploy > New deployment > Web app,
// execute as "Me", access "Anyone"). Start.dc.html fetches the deployed /exec URL.

var CONFIG_SPREADSHEET_ID = '1yiZDnbEFNHddzlTMWaz-bBgI0IvRWXMJ0H3WplyPJDk';

// 紀錄表是另一個試算表，把這裡改成該檔案的 ID。
var RECORD_SPREADSHEET_ID = '1jD6DXmPgTV9664XoIveD_cqNQd9V8vq6aM7EtMoI6FM';
var RECORD_SHEET_NAME = '評核紀錄';
// 評核紀錄 的欄位分成「必要」跟「選填」兩類。必要欄（問題ID/分數/人員代號/
// 送出時間）一定要存在，缺了就丟錯；選填欄視實際表格有沒有那一欄決定要不要
// 寫，沒有就跳過，不會報錯——這是因為業主已經把表格從舊版（演習名稱/項目
// 名稱/問題ID/指標代號/分數/人員代號/送出時間）換成新版（情境階段/演練單元/
// 評核題號/分數/人員代號/送出時間），拿掉了演習名稱/指標代號、把項目名稱拆
// 成情境階段+演練單元兩欄。兩種表格都要能動，用別名 + 選填解決，不要求哪
// 一種格式。
var RECORD_ID_ALIASES_ = ['問題ID', '評核題號'];
var RECORD_SCORE_ALIASES_ = ['分數'];
var RECORD_CODE_ALIASES_ = ['人員代號'];
var RECORD_TIME_ALIASES_ = ['送出時間'];
var RECORD_EXERCISE_ALIASES_ = ['演習名稱'];
var RECORD_ITEM_ALIASES_ = ['項目名稱'];
var RECORD_STAGE_ALIASES_ = ['情境階段'];
var RECORD_SCENE_ALIASES_ = ['演練單元'];
var RECORD_INDICATOR_ALIASES_ = ['指標代號'];

// 問題ID -> 指標代號 對照表，跟「演習評核_設定」放在同一個試算表（是設定
// 資料的一部分，不是送出後才產生的紀錄，所以歸在 CONFIG_SPREADSHEET_ID 底
// 下，不是 RECORD_SPREADSHEET_ID）。多了「評核潛能」「4S 元素」兩欄供分析
// 頁彙總用（讀取用 readIndicatorFull_，寫入 評核紀錄 用的 readIndicatorMap_
// 仍只取前三種欄位，不受影響）。每欄都接受多種欄名別名（見
// INDICATOR_*_ALIASES_，跟 readItems_ 的 findHeaderCol_ 共用同一套「開頭比
// 對」邏輯），因為業主的試算表常直接沿用原始 Excel 欄名而不是這裡的精簡欄名。
var INDICATOR_SHEET_NAME = '對應指標';
var INDICATOR_ID_ALIASES_ = ['問題ID', '評核題號'];
var INDICATOR_TEXT_ALIASES_ = ['問題', '具體評核題目'];
var INDICATOR_TAG_ALIASES_ = ['問題所屬指標', '單一指標對應'];
var INDICATOR_POTENTIAL_ALIASES_ = ['評核潛能'];
var INDICATOR_S4_ALIASES_ = ['4S 元素', '單一 4S 元素'];

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
    // buildAnalysis_ 常見的失敗原因是 指標 分頁還沒補上 評核潛能/4S 元素 兩欄
    // （或欄名對不上）；包起來讓 Analysis.html 至少能顯示清楚的錯誤訊息，
    // 而不是 Apps Script 未捕捉例外時丟出的那種通用 HTML 錯誤頁。
    try {
      return jsonOut_(buildAnalysis_());
    } catch (err) {
      return jsonOut_({ error: String((err && err.message) || err) });
    }
  }
  var ss = SpreadsheetApp.openById(CONFIG_SPREADSHEET_ID);
  var info = readExerciseInfo_(ss);
  return jsonOut_({
    orgName: info.org,
    exerciseName: info.name,
    exerciseTopic: info.topic,
    exerciseCategory: info.category,
    exerciseDate: info.date,
    exerciseDesc: info.desc,
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
  var items = readItems_(configSs);
  var item = findLeafByName_(items, body.itemName);
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

  // 必要欄：缺了就直接報錯。選填欄：找不到就是 -1，寫入時直接跳過那一欄，
  // 不報錯——業主的表格現在是「情境階段/演練單元」版本（拿掉了演習名稱/
  // 項目名稱/指標代號），但舊版「演習名稱/項目名稱/指標代號」格式也要能繼續
  // 動，所以這幾欄當選填處理。
  var idCol = findHeaderCol_(header, RECORD_ID_ALIASES_);
  var scoreCol = findHeaderCol_(header, RECORD_SCORE_ALIASES_);
  var codeCol = findHeaderCol_(header, RECORD_CODE_ALIASES_);
  var timeCol = findHeaderCol_(header, RECORD_TIME_ALIASES_);
  if (idCol === -1 || scoreCol === -1 || codeCol === -1 || timeCol === -1) {
    throw new Error('紀錄表缺少欄位：' + RECORD_ID_ALIASES_.join('/') + ' / ' +
      RECORD_SCORE_ALIASES_.join('/') + ' / ' + RECORD_CODE_ALIASES_.join('/') + ' / ' + RECORD_TIME_ALIASES_.join('/'));
  }
  var exerciseCol = findHeaderCol_(header, RECORD_EXERCISE_ALIASES_);
  var itemCol = findHeaderCol_(header, RECORD_ITEM_ALIASES_);
  var stageCol = findHeaderCol_(header, RECORD_STAGE_ALIASES_);
  var sceneCol = findHeaderCol_(header, RECORD_SCENE_ALIASES_);
  var indicatorCol = findHeaderCol_(header, RECORD_INDICATOR_ALIASES_);

  var exerciseName = exerciseCol !== -1 ? readExerciseInfo_(configSs).name : '';
  var indicatorByQuestionId = indicatorCol !== -1 ? readIndicatorMap_(configSs) : null;
  var stageIndex = (stageCol !== -1 || sceneCol !== -1) ? indexQuestionsByStage_(items) : null;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (cacheKey && cache.get(cacheKey)) return { ok: true, rows: 0, duplicate: true };

    var now = new Date();
    var rows = answers.map(function (a) {
      var row = [];
      for (var j = 0; j < header.length; j++) row.push('');
      var questionId = String(a.id || '');
      if (exerciseCol !== -1) row[exerciseCol] = sanitizeCell_(exerciseName);
      if (itemCol !== -1) row[itemCol] = sanitizeCell_(body.itemName);
      if (stageCol !== -1) row[stageCol] = sanitizeCell_((stageIndex[questionId] || {}).stage || '');
      if (sceneCol !== -1) row[sceneCol] = sanitizeCell_((stageIndex[questionId] || {}).itemName || body.itemName);
      row[idCol] = sanitizeCell_(questionId);
      if (indicatorCol !== -1) row[indicatorCol] = sanitizeCell_(indicatorByQuestionId[questionId] || '');
      row[scoreCol] = Number(a.score);
      row[codeCol] = sanitizeCell_(body.fillerCode);
      row[timeCol] = now;
      return row;
    });

    var startRow = sheet.getLastRow() + 1;
    // Google Sheets 對「1-1」「2-1」這種帶數字和連字號的字串，就算是透過
    // setValues() 寫入（不是手動貼上），一樣可能自動誤判成日期，寫進去之後
    // 讀出來就變成一整串日期字串（不是原本的問題ID）。寫入前把這幾個文字欄
    // 的儲存格格式強制設成「純文字」('@')，之後就不會再被誤判——這一步要在
    // setValues 之前做，格式要先套用到目標儲存格上。
    var textColIndexes = [idCol, codeCol, exerciseCol, itemCol, stageCol, sceneCol, indicatorCol].filter(function (c) { return c !== -1; });
    textColIndexes.forEach(function (c) {
      sheet.getRange(startRow, c + 1, rows.length, 1).setNumberFormat('@');
    });
    sheet.getRange(startRow, 1, rows.length, header.length).setValues(rows);
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
  var idCol = findHeaderCol_(header, INDICATOR_ID_ALIASES_);
  var indicatorCol = findHeaderCol_(header, INDICATOR_TAG_ALIASES_);
  if (idCol === -1 || indicatorCol === -1) {
    throw new Error(INDICATOR_SHEET_NAME + ' 缺少欄位：' + INDICATOR_ID_ALIASES_.join('/') + ' 或 ' + INDICATOR_TAG_ALIASES_.join('/'));
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
  var idCol = findHeaderCol_(header, INDICATOR_ID_ALIASES_);
  var textCol = findHeaderCol_(header, INDICATOR_TEXT_ALIASES_);
  var indicatorCol = findHeaderCol_(header, INDICATOR_TAG_ALIASES_);
  var potentialCol = findHeaderCol_(header, INDICATOR_POTENTIAL_ALIASES_);
  var s4Col = findHeaderCol_(header, INDICATOR_S4_ALIASES_);
  if ([idCol, textCol, indicatorCol, potentialCol, s4Col].indexOf(-1) !== -1) {
    throw new Error(INDICATOR_SHEET_NAME + ' 缺少欄位：' +
      INDICATOR_ID_ALIASES_.join('/') + ' / ' + INDICATOR_TEXT_ALIASES_.join('/') + ' / ' +
      INDICATOR_TAG_ALIASES_.join('/') + ' / ' + INDICATOR_POTENTIAL_ALIASES_.join('/') + ' / ' +
      INDICATOR_S4_ALIASES_.join('/'));
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
  var exerciseInfo = readExerciseInfo_(configSs);
  var stageIndex = indexQuestionsByStage_(readItems_(configSs));
  var indicatorFull = readIndicatorFull_(configSs);

  var sheet = recordSs.getSheetByName(RECORD_SHEET_NAME);
  if (!sheet) throw new Error('找不到工作表：' + RECORD_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  var header = values[0];
  var idCol = findHeaderCol_(header, RECORD_ID_ALIASES_);
  var codeCol = findHeaderCol_(header, RECORD_CODE_ALIASES_);
  var scoreCol = findHeaderCol_(header, RECORD_SCORE_ALIASES_);
  if (idCol === -1 || codeCol === -1 || scoreCol === -1) {
    throw new Error(RECORD_SHEET_NAME + ' 缺少欄位：' + RECORD_ID_ALIASES_.join('/') + ' / ' +
      RECORD_CODE_ALIASES_.join('/') + ' / ' + RECORD_SCORE_ALIASES_.join('/'));
  }
  // 項目名稱/演練單元其中一個存在就拿來當 fallback（優先用 stageIndex 現查
  // 的結果，這欄只在該題已經從 項目與問題 移除時墊底用）。
  var itemFallbackCol = findHeaderCol_(header, RECORD_ITEM_ALIASES_.concat(RECORD_SCENE_ALIASES_));

  var byQuestion = {};
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var id = String(row[idCol] || '');
    var code = String(row[codeCol] || '');
    var score = Number(row[scoreCol]);
    if (!id || !code || isNaN(score)) continue;
    if (!byQuestion[id]) byQuestion[id] = { itemName: itemFallbackCol !== -1 ? String(row[itemFallbackCol] || '') : '', byCode: {} };
    byQuestion[id].byCode[code] = score;
  }

  var rows = Object.keys(byQuestion).map(function (id) {
    var meta = indicatorFull[id] || { question: '', indicator: '', potential: '', s4: '' };
    var stageInfo = stageIndex[id] || { stage: '', itemName: byQuestion[id].itemName, goal: '' };
    var codes = Object.keys(byQuestion[id].byCode).sort();
    var scores = codes.map(function (c) { return { code: c, score: byQuestion[id].byCode[c] }; });
    var vals = scores.map(function (s) { return s.score; });
    return {
      questionId: id,
      stage: stageInfo.stage,
      itemName: stageInfo.itemName || byQuestion[id].itemName,
      goal: stageInfo.goal || '',
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
  // 學習潛能的題目不納入三項潛能/4S 統計（跟業主參考 Demo 的排除規則一致），
  // 但排序視圖（Analysis.html 的「排序視圖」分頁）需要看到它，所以另外整組
  // 吐出來，不算進 stats。
  var learningRows = rows.filter(function (r) { return r.potential === '學習'; });

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

  // 潛能 x 4S 交叉統計，給 Analysis.html 的立體圖用（12 格：3 潛能 x 實際出現
  // 過的 4S 類別）。某個組合如果完全沒有對應題目，summarize_([]) 會回傳
  // n:0/mean:null，前端看到 n===0 就跳過那一格不畫。
  stats.potentialByS4 = {};
  ['回應', '監測', '預期'].forEach(function (p) {
    stats.potentialByS4[p] = {};
    Object.keys(s4Labels).forEach(function (label) {
      var pool = analysisRows.filter(function (r) { return r.potential === p && r.s4 === label; });
      stats.potentialByS4[p][label] = summarize_(flattenScores_(pool));
    });
  });

  var codeSet = {};
  rows.forEach(function (r) { r.scores.forEach(function (s) { codeSet[s.code] = true; }); });

  return {
    meta: {
      orgName: exerciseInfo.org,
      exerciseName: exerciseInfo.name,
      exerciseTopic: exerciseInfo.topic,
      exerciseCategory: exerciseInfo.category,
      exerciseDate: exerciseInfo.date,
      exerciseDesc: exerciseInfo.desc,
      generatedAt: new Date().toISOString(),
      evaluatorCodes: Object.keys(codeSet).sort(),
    },
    analysisRows: analysisRows,
    coverageRows: coverageRows,
    learningRows: learningRows,
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

// 問題ID -> {stage, itemName, goal}：stage 取第一層分組名稱，itemName 取該
// 問題所屬葉節點（最底層）的名稱，跟 評核紀錄 的「項目名稱」欄一致；goal 是
// 該葉節點（SCENE）的「測試情境與目標」簡述，readItems_ 已經掛在葉節點上。
function indexQuestionsByStage_(nodes) {
  var out = {};
  nodes.forEach(function (root) {
    if (root.questions) {
      root.questions.forEach(function (q) { out[q.id] = { stage: root.name, itemName: root.name, goal: root.goal || '' }; });
    } else if (root.children) {
      indexChildren_(root.children, root.name, out);
    }
  });
  return out;
}

function indexChildren_(nodes, stageName, out) {
  nodes.forEach(function (n) {
    if (n.questions) {
      n.questions.forEach(function (q) { out[q.id] = { stage: stageName, itemName: n.name, goal: n.goal || '' }; });
    } else if (n.children) {
      indexChildren_(n.children, stageName, out);
    }
  });
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
// 命中，才退而求其次找「開頭比對」。一定要先做完整的完全相等再做開頭比對
// （不能同一欄位內兩種比對一起做），不然像「問題」這個別名會在完全相等版
// 找到「問題」欄之前，就先用開頭比對誤中「問題ID」欄（因為「問題ID」也是
// 「問題」開頭）。開頭比對是為了因應像「單一指標對應\n(RAG / 覆蓋率)」這種
// 欄名後面接不固定補充文字或換行的情況。
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
