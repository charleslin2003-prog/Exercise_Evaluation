// Apps Script variant that also accepts submissions (doPost) and writes them
// into 紀錄表, in addition to serving 演習評核_設定 config (doGet).
// This is the version deployed behind RECORD_URL in Start.dc.html.
// Deploy as a Web App (Extensions > Apps Script > Deploy > New deployment > Web app,
// execute as "Me", access "Anyone"). Start.dc.html fetches the deployed /exec URL.
//
// ⚠️ 與 apps-script/Config.gs 的關係：原本七個函式（readExerciseInfo_/readCodes_/
// readCriteria_/findHeaderCol_/readItems_/formatCellValue_/stripGroupInternals_）
// 兩個檔案逐位元相同。這一版只改這個檔案（Config.gs 即將退役，見
// docs/multi-tenant-and-report-plan.md §6.5），所以 readExerciseInfo_／readCodes_／
// readCriteria_／readItems_ 從現在開始「兩份會漂移」：這裡多了 啟用觀察紀錄／
// 低分需說明門檻 兩個選填標籤，以及缺欄位時丟中文錯誤的防護。Config.gs 那一份
// 沒有。CONFIG_URL 還指著 Config.gs 的部署，所以「沒帶 ?t=/?ex= 的設定載入」
// 行為不變（它本來就不認識租戶註冊表）。

// ⚠️ 測試分支（dev）：這兩個 ID 是個人帳號 charleslin2003@gmail.com 底下的
// 測試用試算表，不是業主正式的那一對。master 分支上的正式值是：
//   CONFIG_SPREADSHEET_ID = '1j3UCbdSKeOip4Nz-Ymek-mjAH3bGTqiZyI3G__-ubdQ'
//   RECORD_SPREADSHEET_ID = '11HeRKAHkVt4N7T8A8BG6EwstPMNc5EL2FZUIDDatGJ8'
// 合併回 master 前務必確認這兩行沒有被帶過去。
var CONFIG_SPREADSHEET_ID = '1yiZDnbEFNHddzlTMWaz-bBgI0IvRWXMJ0H3WplyPJDk';  // 演習評核_設定（測試）

// 紀錄表是另一個試算表，把這裡改成該檔案的 ID。
var RECORD_SPREADSHEET_ID = '1jD6DXmPgTV9664XoIveD_cqNQd9V8vq6aM7EtMoI6FM';  // 演習評核_紀錄（測試，已有 101 列測試資料）
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
// 以下七欄全部是「新增的選填欄」：業主現在那張 6 欄表一欄都沒有，findHeaderCol_
// 會回 -1，寫入時整欄跳過（跟上面那批選填欄同一套模式，見 appendSubmission_），
// 所以不動試算表也不會有任何行為變化。要用就在 評核紀錄 補上對應欄名即可。
// 這些欄的用途是「送出當時就把標籤寫死」，直接補掉 plan §1.1 的缺陷 D3
// （標籤是讀取時才 join 設定表，業主為下一場改題庫就會回頭改寫上一場的報告）。
var RECORD_COMMENT_ALIASES_ = ['觀察紀錄', '觀察意見', '質性觀察', '備註'];
var RECORD_EXERCISEID_ALIASES_ = ['演習代號', '場次代號'];
var RECORD_TENANT_ALIASES_ = ['醫院代號', '機構代號'];
// 注意：這個別名陣列跟設定表那邊的 GOAL_HEADER_ALIASES_（在 readItems_ 上方）刻意分開
// 宣告、不共用變數——一邊是「設定表的來源欄」，一邊是「紀錄表的快照欄」，
// 兩邊將來很可能被業主改成不同欄名。
var RECORD_GOAL_ALIASES_ = ['測試情境與目標', '測試情境'];
var RECORD_POTENTIAL_ALIASES_ = ['評核潛能', '潛能'];
var RECORD_S4_ALIASES_ = ['4S 元素', '4S元素', '單一 4S 元素'];
// 「評核題目」跟 RECORD_ID_ALIASES_ 的「評核題號」只差一個字，但不會互相誤中：
// findHeaderCol_ 先把所有欄位跑完一輪「完全相等」才做「開頭比對」，而開頭比對
// 時「評核題目」不是以「評核題號」開頭（反之亦然）。
var RECORD_QUESTION_ALIASES_ = ['評核題目', '具體評核題目', '問題內容'];
// 觀察紀錄字數上限。前端送出前自己 trim + 切到 500 字，伺服器再切一次；
// 字數或內容絕對不構成「拒絕整筆送出」的理由（分數比留言重要）。
var COMMENT_MAX_LENGTH_ = 500;

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
// 有了租戶註冊表以後，這把金鑰只負責「fallback 租戶」（也就是下面那對寫死的
// 試算表）；註冊表裡的每一列各有自己的 分析金鑰，換金鑰 = 改一格。
var ANALYSIS_KEY = 'WrHSeTn1bkVtD2C9QriISkCy2Q_I8Jub';

// ===== 多租戶路由（方案 A：租戶註冊表）=====
// docs/multi-tenant-and-report-plan.md §2.1 原本建議「刪掉上面那四個常數」。
// 這裡刻意不刪：本次改動的硬規則是「沒有 ?t=/?ex=、而且還沒建註冊表時，每一
// 個端點的行為都要跟今天完全一樣」，所以那四個常數留下來當作永久的
// 「legacy／第一場」租戶（見 fallbackTenant_）。還沒建註冊表時
// REGISTRY_SPREADSHEET_ID 就留空字串——空字串的意思是「整個註冊表機制關閉，
// 一律走 fallback」，連 openById 都不會打一次。
// dev：沙箱註冊表。master（正式）沒有這個常數（早於註冊表）；合併時改回 ''，
// 等正式註冊表建好再填。
var REGISTRY_SPREADSHEET_ID = '1oab1W2UFo71qeZ-fEz_cYtE__3dNFw_OG_7TzrUZdfk';
var REGISTRY_SHEET_NAME = '租戶註冊表';
var DEFAULT_RECORD_SHEET_NAME = '評核紀錄';
// 註冊表快取：設定表「改一格、手機重整就生效」是對業主的承諾，所以設定表
// 永不快取；註冊表是控制平面、改動極少，快取 120 秒換掉每次請求兩趟
// openById。改完想立刻生效就打 action=flush。
var REGISTRY_CACHE_KEY_ = 'reg:v2';
var REGISTRY_CACHE_TTL_ = 120;
// 管理金鑰：只給 action=selftest / action=flush 用，不會出現在任何上架的 HTML
// 裡（由操作者自己打在網址列，或由註冊表那支容器綁定腳本用 UrlFetchApp 帶）。
// 空字串 = 停用：selftest/flush 直接回中文「尚未設定」並且一張試算表都不開。
// 絕對不要把它設成跟 ANALYSIS_KEY 一樣的值。
var ADMIN_KEY = '';

// 註冊表每一欄都用 findHeaderCol_ 比對欄名（絕不用欄位位置），跟 評核紀錄／
// 對應指標 同一套做法。欄名意義見 docs/multi-tenant-and-report-plan.md §2.1。
var REGISTRY_HID_ALIASES_ = ['醫院代號', '機構代號'];
var REGISTRY_EXID_ALIASES_ = ['演習代號', '場次代號'];
var REGISTRY_NAME_ALIASES_ = ['顯示名稱', '名稱'];
var REGISTRY_CONFIGID_ALIASES_ = ['設定試算表ID', '設定檔ID'];
var REGISTRY_RECORDID_ALIASES_ = ['紀錄試算表ID', '紀錄檔ID'];
var REGISTRY_RECORDSHEET_ALIASES_ = ['紀錄分頁名稱', '紀錄分頁'];
var REGISTRY_KEY_ALIASES_ = ['分析金鑰', '金鑰'];
var REGISTRY_ENABLED_ALIASES_ = ['啟用', '啟用中'];
var REGISTRY_FROM_ALIASES_ = ['開放送出起', '送出開始'];
var REGISTRY_TO_ALIASES_ = ['開放送出迄', '送出結束'];
var REGISTRY_DEFAULT_ALIASES_ = ['預設演習', '預設'];
var REGISTRY_SCENEPREFIX_ALIASES_ = ['scenePrefix', '情境前綴'];
// 檔案擁有者 欄是純文件用途：路由不讀它、任何端點（含 selftest）都不回傳它。

// 代號（醫院代號／演習代號）只接受小寫英數加 - 與 _、最多 32 字。兩件事要特別
// 注意：
// (1) Date 直接拒絕。業主手打「2026-01」這種值，Sheets 會自動判讀成日期，拿到
//     的是 Date 物件；String(Date) 出來是「Thu Jan 01 2026 …」，絕對不能拿去
//     當代號（plan §7.2）。所以 演習代號 建議用 2026a 這種不含「連字號+數字」
//     的寫法。
// (2) 代號永遠不會被拿去 openById。試算表 ID 只能從註冊表那一列讀出來——這是
//     避免整個 Web App 變成「任意 Drive 檔案讀取代理」的關鍵分界。
function normSlug_(s) {
  if (s instanceof Date) return '';
  if (s == null) return '';
  var v = String(s).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(v)) return '';
  return v;
}

// 設定試算表ID／紀錄試算表ID 進 openById 之前的格式檢查。格式不合就把那一列
// 標成無效（規則 5），不要拿一個明顯不是 ID 的字串去打 Drive。
function isSpreadsheetId_(s) {
  if (s instanceof Date) return false;
  return /^[A-Za-z0-9_-]{20,}$/.test(String(s == null ? '' : s).trim());
}

// 租戶解析失敗時丟出來的錯誤：message 是直接印給使用者看的中文句子，
// tenantCode 是給程式判斷的代碼。doGet 兩個分支和 doPost 都靠
// tenantCodeOf_ 把它轉成各自的 JSON 錯誤形狀。
function newTenantError_(message, code) {
  var err = new Error(message);
  err.tenantCode = code;
  return err;
}
function tenantCodeOf_(err) {
  return (err && err.tenantCode) || '';
}
function errorOut_(err, defaultCode) {
  return {
    error: String((err && err.message) || err),
    errorCode: tenantCodeOf_(err) || defaultCode,
  };
}

// fallback 租戶：完全由今天就存在的四個常數組成。case (i)/(ii)/(iii) 都回這個
// 物件，所以「沒帶代號、沒建註冊表」時每一行後續程式碼看到的東西跟今天一模
// 一樣（同兩份試算表、同分頁名稱、同 ANALYSIS_KEY、同 'sub_'+id 快取 key）。
// enabled 永遠 true、時間窗永遠 null，所以 啟用 與 開放送出起/迄 兩道閘門在
// fallback 模式下不可能擋到任何人。
function fallbackTenant_() {
  return {
    hid: '',
    exid: '',
    displayName: '',
    configId: CONFIG_SPREADSHEET_ID,
    recordId: RECORD_SPREADSHEET_ID,
    recordSheet: RECORD_SHEET_NAME,
    analysisKey: ANALYSIS_KEY,
    enabled: true,
    isDefault: true,
    openFrom: null,
    openTo: null,
    openFromText: '',
    openToText: '',
    scenePrefix: 'SCENE',
    source: 'fallback',
    rowNumber: 0,
    registryWarning: '',
    requestedHid: '',
    requestedExid: '',
    reasons: [],
  };
}

function cloneTenant_(t) {
  var out = {};
  Object.keys(t).forEach(function (k) { out[k] = t[k]; });
  return out;
}

function isNo_(v) {
  if (v === false) return true;
  var s = String(v == null ? '' : v).trim();
  return s === 'N' || s === 'n' || s === '否' || s === '停用' ||
    s === 'FALSE' || s === 'False' || s === 'false';
}

function isYes_(v) {
  if (v === true) return true;
  var s = String(v == null ? '' : v).trim();
  return s === 'Y' || s === 'y' || s === '是' || s === '預設' || s === '1' ||
    s === 'TRUE' || s === 'True' || s === 'true';
}

function formatDateTime_(ms) {
  return Utilities.formatDate(new Date(ms), 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
}

// 讀代號格（醫院代號／演習代號）。空白是「必填欄位空白」（規則 4）、被判讀成
// 日期與格式不合各有自己的中文理由（規則 5），理由只會出現在 action=selftest，
// 不會進任何評核官手機抓得到的 payload。
function readSlugCell_(value, label, reasons) {
  if (value instanceof Date) {
    reasons.push(label + ' 被試算表判讀成日期，請把該格設成純文字格式');
    return '';
  }
  var raw = String(value == null ? '' : value).trim();
  if (!raw) {
    reasons.push('必填欄位空白：' + label);
    return '';
  }
  var slug = normSlug_(raw);
  if (!slug) {
    reasons.push(label + ' 格式不合（只允許小寫英數、- 與 _，最多 32 字）');
    return '';
  }
  return slug;
}

function readIdCell_(value, label, reasons) {
  var raw = String(value == null ? '' : value).trim();
  if (!raw) {
    reasons.push('必填欄位空白：' + label);
    return '';
  }
  if (!isSpreadsheetId_(raw)) {
    reasons.push(label + ' 格式不合（看起來不是試算表 ID）');
    return '';
  }
  return raw;
}

// 讀時間窗格。空白 = 沒有這一邊的界限；Date 格直接用；文字格試著 parse，
// parse 不出來就把整列標成無效——「看不懂的值」不可以被悄悄當成「不限」，
// 否則業主以為自己關了送出，實際上還開著。
function readWindowCell_(value, label, reasons) {
  if (value instanceof Date) return { ms: value.getTime(), text: formatDateTime_(value.getTime()) };
  var raw = String(value == null ? '' : value).trim();
  if (!raw) return { ms: null, text: '' };
  var parsed = new Date(raw);
  var ms = parsed.getTime();
  if (isNaN(ms)) {
    reasons.push(label + ' 無法判讀成日期時間（請填成 2026/10/06 08:00 這種格式）');
    return { ms: null, text: '' };
  }
  return { ms: ms, text: formatDateTime_(ms) };
}

// 讀整張租戶註冊表。回傳 { configured, readable, sheetFound, rowCount, rows,
// invalidTenants, invalid, warning }：
//   rows            = 通過五條檢查的列（含 啟用=N 的列，action=exercises 要列出來）
//   invalidTenants  = 沒通過的列（還留著 hid/exid，才能把「這場演習註冊資料有問題」
//                     跟「根本沒這家機構」分開回答）
//   invalid         = [{ rowNumber, reasons }]，只給 action=selftest 看
//   warning         = 整張表不可用的原因（case (ii)），只給 action=selftest 看
// REGISTRY_SPREADSHEET_ID 是空字串就回 null（= 機制關閉，連快取都不碰）。
// 這個函式「永不往外丟例外」：控制平面壞掉不應該讓正在進行的演習跟著掛掉，
// 所以失敗一律收斂成 warning，由 resolveTenant_ 決定退回 fallback。
function readRegistry_() {
  if (!REGISTRY_SPREADSHEET_ID) return null;
  var cache = CacheService.getScriptCache();
  var cached = cache.get(REGISTRY_CACHE_KEY_);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (errCache) {
      // 快取內容壞了就當沒快取，重讀一次。
    }
  }
  var out = {
    configured: true,
    readable: false,
    sheetFound: false,
    rowCount: 0,
    rows: [],
    invalidTenants: [],
    invalid: [],
    warning: '',
  };
  try {
    var ss = SpreadsheetApp.openById(REGISTRY_SPREADSHEET_ID);
    out.readable = true;
    var sheet = ss.getSheetByName(REGISTRY_SHEET_NAME);
    if (!sheet) {
      out.warning = '租戶註冊表裡找不到分頁：' + REGISTRY_SHEET_NAME;
    } else {
      out.sheetFound = true;
      readRegistryRows_(sheet, out);
    }
  } catch (err) {
    // 刪檔／改名／沒權限／ID 填錯都會走到這裡。刻意不區分「設定錯誤」和
    // 「暫時性權限抖動」：硬失敗讓演習停擺、或猜一列資料，兩種都更糟。
    out.warning = '無法開啟租戶註冊表（請確認 REGISTRY_SPREADSHEET_ID 與檔案權限）：' +
      String((err && err.message) || err);
  }
  try {
    cache.put(REGISTRY_CACHE_KEY_, JSON.stringify(out), REGISTRY_CACHE_TTL_);
  } catch (errPut) {
    // 快取寫不進去（例如內容過大）不是致命錯誤，下次重讀就是。
  }
  return out;
}

// 把註冊表分頁的內容填進 readRegistry_ 的結果物件。每一欄都用 findHeaderCol_
// 比對欄名，絕不用欄位位置（跟 評核紀錄／對應指標 同一條規則）。
function readRegistryRows_(sheet, out) {
  var values = sheet.getDataRange().getValues();
  var header = values.length ? values[0] : [];
  var cols = {
    hid: findHeaderCol_(header, REGISTRY_HID_ALIASES_),
    exid: findHeaderCol_(header, REGISTRY_EXID_ALIASES_),
    displayName: findHeaderCol_(header, REGISTRY_NAME_ALIASES_),
    configId: findHeaderCol_(header, REGISTRY_CONFIGID_ALIASES_),
    recordId: findHeaderCol_(header, REGISTRY_RECORDID_ALIASES_),
    recordSheet: findHeaderCol_(header, REGISTRY_RECORDSHEET_ALIASES_),
    analysisKey: findHeaderCol_(header, REGISTRY_KEY_ALIASES_),
    enabled: findHeaderCol_(header, REGISTRY_ENABLED_ALIASES_),
    openFrom: findHeaderCol_(header, REGISTRY_FROM_ALIASES_),
    openTo: findHeaderCol_(header, REGISTRY_TO_ALIASES_),
    isDefault: findHeaderCol_(header, REGISTRY_DEFAULT_ALIASES_),
    scenePrefix: findHeaderCol_(header, REGISTRY_SCENEPREFIX_ALIASES_),
  };
  // 五個必填欄的「欄」本身不見了，就不是「某一列有問題」而是整張表不能用：
  // 逐列報「必填欄位空白」只會生出 N 份一樣的雜訊。
  var missing = [];
  if (cols.hid === -1) missing.push(REGISTRY_HID_ALIASES_[0]);
  if (cols.exid === -1) missing.push(REGISTRY_EXID_ALIASES_[0]);
  if (cols.configId === -1) missing.push(REGISTRY_CONFIGID_ALIASES_[0]);
  if (cols.recordId === -1) missing.push(REGISTRY_RECORDID_ALIASES_[0]);
  if (cols.analysisKey === -1) missing.push(REGISTRY_KEY_ALIASES_[0]);
  if (missing.length) {
    out.warning = REGISTRY_SHEET_NAME + ' 缺少必要欄位：' + missing.join('／');
    return;
  }
  var parsed = [];
  for (var i = 1; i < values.length; i++) {
    // 整列全空（業主在表格下方留白）直接跳過，不算資料列也不報錯。
    if (isBlankRow_(values[i])) continue;
    parsed.push(parseRegistryRow_(cols, values[i], i + 1));
  }
  out.rowCount = parsed.length;
  assertRegistrySane_(parsed);
  parsed.forEach(function (t) {
    if (t.reasons.length) {
      out.invalidTenants.push(t);
      out.invalid.push({ rowNumber: t.rowNumber, reasons: t.reasons });
    } else {
      out.rows.push(t);
    }
  });
  if (!out.rowCount) {
    out.warning = REGISTRY_SHEET_NAME + ' 沒有任何資料列';
  } else if (!out.rows.length) {
    out.warning = REGISTRY_SHEET_NAME + ' 的每一列都沒通過檢查，詳情請看 action=selftest';
  }
}

function isBlankRow_(row) {
  for (var i = 0; i < row.length; i++) {
    if (String(row[i] == null ? '' : row[i]).trim() !== '') return false;
  }
  return true;
}

function parseRegistryRow_(cols, row, rowNumber) {
  var reasons = [];
  var t = {
    hid: readSlugCell_(row[cols.hid], REGISTRY_HID_ALIASES_[0], reasons),
    exid: readSlugCell_(row[cols.exid], REGISTRY_EXID_ALIASES_[0], reasons),
    displayName: cols.displayName !== -1 ? String(row[cols.displayName] == null ? '' : row[cols.displayName]).trim() : '',
    configId: readIdCell_(row[cols.configId], REGISTRY_CONFIGID_ALIASES_[0], reasons),
    recordId: readIdCell_(row[cols.recordId], REGISTRY_RECORDID_ALIASES_[0], reasons),
    recordSheet: DEFAULT_RECORD_SHEET_NAME,
    analysisKey: String(row[cols.analysisKey] == null ? '' : row[cols.analysisKey]).trim(),
    enabled: true,
    isDefault: false,
    openFrom: null,
    openTo: null,
    openFromText: '',
    openToText: '',
    scenePrefix: 'SCENE',
    source: 'registry',
    rowNumber: rowNumber,
    registryWarning: '',
    requestedHid: '',
    requestedExid: '',
    reasons: reasons,
  };
  if (cols.recordSheet !== -1) {
    var sheetName = String(row[cols.recordSheet] == null ? '' : row[cols.recordSheet]).trim();
    if (sheetName) t.recordSheet = sheetName;
  }
  if (!t.analysisKey) reasons.push('必填欄位空白：' + REGISTRY_KEY_ALIASES_[0]);
  if (cols.enabled !== -1) t.enabled = !isNo_(row[cols.enabled]);
  if (cols.isDefault !== -1) t.isDefault = isYes_(row[cols.isDefault]);
  if (cols.openFrom !== -1) {
    var from = readWindowCell_(row[cols.openFrom], REGISTRY_FROM_ALIASES_[0], reasons);
    t.openFrom = from.ms;
    t.openFromText = from.text;
  }
  if (cols.openTo !== -1) {
    var to = readWindowCell_(row[cols.openTo], REGISTRY_TO_ALIASES_[0], reasons);
    t.openTo = to.ms;
    t.openToText = to.text;
  }
  if (cols.scenePrefix !== -1) {
    var prefix = String(row[cols.scenePrefix] == null ? '' : row[cols.scenePrefix]).trim();
    if (prefix) t.scenePrefix = prefix;
  }
  // 代號原樣記下來，payload 的 tenant/exercise 一律回這兩個欄位（fallback 模式
  // 下 hid/exid 是空字串，但要把使用者帶來的 ?t=/?ex= 原封不動回給前端）。
  t.requestedHid = t.hid;
  t.requestedExid = t.exid;
  return t;
}

// 組合鍵的分隔字元（U+241F，SYMBOL FOR UNIT SEPARATOR）。選它是因為它絕對不會出現在業主手打的
// 代號、分頁名稱或問題ID 裡，所以 'a' + SEP + 'bc' 不可能跟 'ab' + SEP + 'c'
// 撞在一起。
var KEY_SEP_ = '\u241F';

// 五條檢查，就地把列標成無效（不丟錯：單一列壞掉不該害其他醫院一起不能用）。
// 規則 4/5（必填空白、格式不合）在 parseRegistryRow_ 裡就處理完了，這裡做的是
// 需要「跨列比對」的三條。
function assertRegistrySane_(rows) {
  // 三條規則全部比對「全部」列，不分啟用與否。
  //
  // 規則 1、2 原本只比對 啟用=Y 的列，理由寫的是「已封存（啟用=N）的列不可能被
  // 路由到」。2026-10-08 的稽核證明那句話對不上這支程式：resolveTenant_ 挑列時
  // 完全沒看 enabled（見 valid／pair 兩個 filter），啟用 是解析「之後」才跑的閘門，
  // 而且 action=analysis 刻意不擋 啟用=N（演習結束才要做報告）。封存列照樣會被
  // 路由到，照樣會被 buildAnalysis_ 整張表讀進去。
  //
  // 放著不管的後果正是規則 2 存在的唯一理由（缺陷 D1）：業主照 owner guide §6 把
  // 2026a 設成 啟用=N，隔年複製那一列改成 2027a／啟用=Y，卻忘了換 紀錄分頁名稱。
  // 舊版規則 2 不會響，兩場演習寫進同一張分頁，而今天這種沒有 演習代號 欄的紀錄
  // 表會讓 buildAnalysis_ 的去重鍵塌成只剩 問題ID，新演習的分數直接蓋掉去年的，
  // 已經發出去的報告重跑會變成另一個數字。
  //
  // 規則 1 同理：同一組 醫院代號+演習代號 一列 啟用=Y、一列 啟用=N 時，舊版兩列都
  // 判為有效，resolveTenant_ 收到 pair.length === 2 只能丟 ROW_INVALID，而
  // action=selftest 會回報 invalidRows: [] ——唯一的診斷工具在這個狀況下會說謊。
  //
  // 代號還沒填好的列仍然跳過（它已經因為規則 4/5 無效了，再加一條「重複」只是雜訊）。
  markDuplicates_(
    rows.filter(function (r) { return r.hid && r.exid; }),
    function (r) { return r.hid + KEY_SEP_ + r.exid; },
    function (others) { return '醫院代號+演習代號 與第 ' + others + ' 列重複'; });
  // 這一條是 plan §2.1 要求「必須硬擋」的那一條：「複製了一列但忘記換紀錄檔」
  // 是唯一還能讓缺陷 D1（兩場演習在同一個 問題ID 上互相覆蓋分數）回來的入口。
  // 刻意不是「第一列優先」而是「整組都標無效」，否則身分會取決於列的順序，
  // 同一個 ?t=X&ex=Y 會變成不確定的結果。
  markDuplicates_(
    rows.filter(function (r) { return r.recordId; }),
    function (r) { return r.recordId + KEY_SEP_ + r.recordSheet; },
    function (others) { return '紀錄試算表ID+分頁名稱 與第 ' + others + ' 列重複，兩場演習會互相覆蓋分數'; });
  // 規則 3：已封存那列的 分析金鑰 仍然是一把活的
  // 憑證。同一把金鑰出現在同一個 醫院代號 的不同 演習代號 是「刻意允許」的
  // （一家醫院一把儀表板金鑰、跨場次共用），這也正是遷移那一列能沿用今天這把
  // ANALYSIS_KEY 的原因；出現在不同 醫院代號 才是漏洞（A 院只要改個 ?t= 就能
  // 讀 B 院的儀表板）。
  var byKey = {};
  rows.forEach(function (r) {
    if (!r.analysisKey) return;
    if (!byKey[r.analysisKey]) byKey[r.analysisKey] = [];
    byKey[r.analysisKey].push(r);
  });
  Object.keys(byKey).forEach(function (k) {
    var group = byKey[k];
    group.forEach(function (r) {
      // 醫院代號 空白（或格式不合，readSlugCell_ 讓它變成 ''）的列不參與這條比對，
      // 兩個方向都不參與。少了這兩個 && 守衛，'' !== 'wanfang-…' 會成立，於是一列
      // 還沒填完的草稿會把「同一把金鑰」的好列也一起標成無效——違反這個函式開頭
      // 寫的「單一列壞掉不該害其他醫院一起不能用」。觸發方式平凡到可怕：業主複製
      // 一列準備下一場、醫院代號還沒填就存檔，120 秒內全院連結回 ROW_INVALID，而
      // 解釋原因的 action=selftest 預設是關的（ADMIN_KEY 為空字串）。
      // 空代號那一列本來就已經被規則 4/5 判無效了，不需要這裡再補一刀。
      if (!r.hid) return;
      var others = group.filter(function (o) { return o !== r && o.hid && o.hid !== r.hid; });
      if (!others.length) return;
      r.reasons.push('分析金鑰 與第 ' + others.map(rowNumberOf_).join('、') + ' 列（不同醫院代號）相同');
    });
  });
  return rows;
}

function rowNumberOf_(r) { return r.rowNumber; }

function markDuplicates_(rows, keyOf, reasonOf) {
  var byKey = {};
  rows.forEach(function (r) {
    var k = keyOf(r);
    if (!byKey[k]) byKey[k] = [];
    byKey[k].push(r);
  });
  Object.keys(byKey).forEach(function (k) {
    var group = byKey[k];
    if (group.length < 2) return;
    group.forEach(function (r) {
      var others = group.filter(function (o) { return o !== r; }).map(rowNumberOf_);
      r.reasons.push(reasonOf(others.join('、')));
    });
  });
}

// 解析這一次請求屬於哪一場演習。這是整份檔案最吃重的一段，順序刻意固定：
//
// (0) 代號先取 POST body 的 tenant/exercise，其次才取 query 的 ?t=/?ex=
//     （plan §2.1）。有填但格式不合是「錯誤」，不會被悄悄當成沒填——否則一個
//     打錯的代號會變成「看到 fallback 租戶的資料」。
// (i) REGISTRY_SPREADSHEET_ID === ''（目前上架的狀態）→ 無條件回 fallback，
//     就算帶了 ?t=/?ex= 也一樣。理由：連結有可能在業主建好註冊表之前就先帶著
//     ?t= 流傳出去，把這種連結判成錯誤會在演習當天讓全場評核官無法評分。代號
//     會原樣回在 payload 的 tenant/exercise 裡，但對路由零影響，tenantSource
//     回 'fallback' 讓前端自己判斷。
// (ii) 註冊表有設定但不可用（開不起來／分頁不見／零資料列／沒有一列通過檢查）
//     → 同樣回 fallback，另外把原因放在 registryWarning 上（只有 action=selftest
//     看得到）。控制平面壞掉時，那一家真正在用的醫院必須照樣能評分。
// (iii) 註冊表可用，但沒帶 醫院代號 → 回 fallback。寫死的那兩個常數永久當
//     「legacy／第一場」租戶，這是已經發出去的 LINE 連結在註冊表上線後還能用的
//     原因（plan §5.10：舊訊息會一直留著）。
//     ⚠️ 必須保持成立的前提：註冊表裡那一列遷移資料要指向跟常數「同樣的」兩個
//     試算表 ID，否則「不帶參數」跟「?t=…&ex=…」會看到兩份不同的資料。公布任何
//     連結之前，先用 action=selftest 比對兩條路徑。
// (iv) 註冊表可用又帶了 醫院代號 → 這時候代號才真的決定路由，而且「找不到」
//     一律是硬錯誤，絕不退回 fallback、絕不改用別的列。打錯一個字就看到另一家
//     醫院的資料，是這整段程式唯一真正要防的事。
function resolveTenant_(e, body) {
  var rawHid = (body && body.tenant) || (e && e.parameter && e.parameter.t) || '';
  var rawExid = (body && body.exercise) || (e && e.parameter && e.parameter.ex) || '';
  var hid = normSlug_(rawHid);
  var exid = normSlug_(rawExid);
  if (String(rawHid == null ? '' : rawHid).trim() && !hid) {
    throw newTenantError_('連結裡的機構代號格式不正確，請確認連結是否完整。', 'BAD_CODE');
  }
  if (String(rawExid == null ? '' : rawExid).trim() && !exid) {
    throw newTenantError_('連結裡的演習代號格式不正確，請確認連結是否完整。', 'BAD_CODE');
  }

  var reg = readRegistry_();
  if (!reg) return withRequested_(fallbackTenant_(), hid, exid);           // (i)
  if (!reg.rows.length) {                                                   // (ii)
    var warned = withRequested_(fallbackTenant_(), hid, exid);
    warned.registryWarning = reg.warning || (REGISTRY_SHEET_NAME + ' 目前沒有可用的資料列');
    return warned;
  }
  if (!hid) return withRequested_(fallbackTenant_(), hid, exid);            // (iii)

  // (iv)
  var valid = reg.rows.filter(function (r) { return r.hid === hid; });
  var invalidMatch = (reg.invalidTenants || []).filter(function (r) {
    return r.hid === hid && (!exid || r.exid === exid);
  });
  if (!valid.length) {
    if (invalidMatch.length) {
      throw newTenantError_('這場演習的註冊資料有問題，請聯絡系統管理者。', 'ROW_INVALID');
    }
    throw newTenantError_('找不到這家機構的設定（代號：' + hid + '），請確認連結是否正確。', 'NO_TENANT');
  }
  if (!exid) {
    var defaults = valid.filter(function (r) { return r.enabled && r.isDefault; });
    if (defaults.length === 1) return cloneTenant_(defaults[0]);
    if (!defaults.length) {
      throw newTenantError_('這家機構尚未指定預設演習，請在連結後面加上演習代號。', 'NO_DEFAULT');
    }
    throw newTenantError_('這家機構有多列被標為預設演習，請只保留一列。', 'AMBIGUOUS_DEFAULT');
  }
  var pair = valid.filter(function (r) { return r.exid === exid; });
  if (pair.length === 1) return cloneTenant_(pair[0]);
  if (pair.length > 1) {
    // 規則 1 已經把「啟用=Y 的重複」全部標成無效，所以能走到這裡的只有兩列
    // 以上 啟用=N 的同代號列。照樣不猜，回「註冊資料有問題」。
    throw newTenantError_('這場演習的註冊資料有問題，請聯絡系統管理者。', 'ROW_INVALID');
  }
  if (invalidMatch.length) {
    throw newTenantError_('這場演習的註冊資料有問題，請聯絡系統管理者。', 'ROW_INVALID');
  }
  throw newTenantError_('找不到這場演習（機構：' + hid + '／演習：' + exid + '），請確認連結是否正確。', 'NO_EXERCISE');
}

function withRequested_(t, hid, exid) {
  t.requestedHid = hid;
  t.requestedExid = exid;
  return t;
}

// 送出時間窗：只有 doPost 會擋，設定分支不擋（評核官可以提早打開表單看題目）。
// 設定 payload 改成回報 submitOpen / submitClosedReason，讓前端把「送出」按鈕
// 變灰——而不是收下分數再丟掉。
// now 是新增的「選填」第二個參數：action=sessions 要把同一個時間戳套到整批
// 列上（見 handleSessions_），不傳就跟以前一樣自己取 Date.now()。原本兩個呼叫端
// （設定分支、doPost）一個字都不用改，回傳形狀也完全沒變。
function submitWindowState_(t, now) {
  if (!t.enabled) return { open: false, reason: '這場演習已結束，不再開放評核。' };
  if (now === null || now === undefined) now = Date.now();
  if (t.openFrom !== null && t.openFrom !== undefined && now < t.openFrom) {
    return { open: false, reason: '目前不在開放送出時間內（' + windowText_(t) + '）。' };
  }
  if (t.openTo !== null && t.openTo !== undefined && now > t.openTo) {
    return { open: false, reason: '目前不在開放送出時間內（' + windowText_(t) + '）。' };
  }
  return { open: true, reason: '' };
}

function windowText_(t) {
  return (t.openFromText || '不限') + ' ~ ' + (t.openToText || '不限');
}

// 三個 openById（設定分支 :71、doPost :115、buildAnalysis_ :260）統一收斂到這裡，
// 失敗時給中文訊息而不是 Apps Script 原文的 "You do not have permission…"。
function tenantSheetConfig_(t) {
  try {
    return SpreadsheetApp.openById(t.configId);
  } catch (err) {
    throw new Error('無法開啟設定試算表，請確認檔案權限。');
  }
}

// 紀錄檔同理，另外把 getSheetByName 的 null 防護一起做掉（原本 :138-140 與
// :266-267 兩處各寫一份）。fallback 模式下丟出的字串跟今天完全一樣。
function tenantSheetRecord_(t) {
  var ss;
  try {
    ss = SpreadsheetApp.openById(t.recordId);
  } catch (err) {
    throw new Error('無法開啟紀錄試算表，請確認檔案權限。');
  }
  // 這裡刻意「不」把 t.recordSheet 寫進訊息。doPost 是第三個完全沒有金鑰的分支
  // （另外兩個是設定分支與 action=sessions），而它的 catch 會把 err.message 原封
  // 不動放進回傳的 error 欄位，直接印在評核官畫面上。紀錄分頁名稱在這份專案的
  // 紅線清單裡，只要有 ?t= 連結的人就能靠一次失敗的 POST 把它讀出來。
  // 診斷用的分頁名稱仍然看得到：action=selftest 的 record.sheetName 是直接從
  // t.recordSheet 取的，不經過這個例外，所以這個改動不影響除錯能力。
  var sheet = ss.getSheetByName(t.recordSheet);
  if (!sheet) throw new Error('紀錄試算表裡找不到指定的工作表，請聯絡系統管理者。');
  return { ss: ss, sheet: sheet };
}

function param_(e, name) {
  return (e && e.parameter && e.parameter[name]) || '';
}

function doGet(e) {
  var action = param_(e, 'action');
  // 管理用的兩個 action 先處理，而且在碰任何試算表之前就先驗 ADMIN_KEY。
  if (action === 'selftest') return jsonOut_(handleSelfTest_(e));
  if (action === 'flush') return jsonOut_(handleFlush_(e));
  if (action === 'exercises') return jsonOut_(handleExercises_(e));
  // action=sessions：評核表的場次選單（見 handleSessions_）。它完全沒有金鑰，所以
  // 一定要「分完就 return」，絕對不可以掉進下面的設定分支。位置跟其他 action 排
  // 在一起、且在設定分支之前，所以「認不得的 action 仍然掉到設定分支」這件事沒變。
  if (action === 'sessions') return jsonOut_(handleSessions_(e));

  if (action === 'analysis') {
    var t;
    try {
      t = resolveTenant_(e, null);
    } catch (errTenant) {
      return jsonOut_(errorOut_(errTenant, 'NO_TENANT'));
    }
    // 金鑰比對的對象從全域常數改成「解析出來那一列的 分析金鑰」；fallback 模式
    // 下 t.analysisKey 就是 ANALYSIS_KEY，所以行為與今天相同。回傳字串刻意
    // 保持成 'unauthorized' 一字不差（Analysis.html 直接印它）。
    if (!param_(e, 'key') || param_(e, 'key') !== t.analysisKey) {
      return jsonOut_({ error: 'unauthorized', errorCode: 'UNAUTHORIZED' });
    }
    // 啟用=N 刻意「不」擋分析：演習結束後報告才要開始做。
    // buildAnalysis_ 常見的失敗原因是 指標 分頁還沒補上 評核潛能/4S 元素 兩欄
    // （或欄名對不上）；包起來讓 Analysis.html 至少能顯示清楚的錯誤訊息，
    // 而不是 Apps Script 未捕捉例外時丟出的那種通用 HTML 錯誤頁。
    try {
      return jsonOut_(buildAnalysis_(t));
    } catch (err) {
      return jsonOut_({ error: String((err && err.message) || err), errorCode: 'ANALYSIS_FAILED' });
    }
  }

  // 設定分支。原本 :71-83 完全沒有 try/catch（只有分析分支有），所以分頁改名或
  // 權限問題會讓評核官手機看到 Apps Script 的原始 HTML 錯誤頁（plan §6.2）。
  try {
    var ct = resolveTenant_(e, null);
    if (!ct.enabled) {
      throw newTenantError_('這場演習已結束，不再開放評核。', 'DISABLED');
    }
    var ss = tenantSheetConfig_(ct);
    var info = readExerciseInfo_(ss);
    var win = submitWindowState_(ct);
    // ⚠️ 這個分支「沒有任何驗證」，每一支評核官手機都會抓它，所以
    // payload 裡永遠不准出現：分析金鑰／ADMIN_KEY／任何試算表 ID／紀錄分頁
    // 名稱／註冊表列號／registryWarning／檔案擁有者（plan §6.6）。
    // 下面這些欄位全部是「可以公開」的那一類。
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
      tenant: ct.hid || ct.requestedHid || '',
      exercise: ct.exid || ct.requestedExid || '',
      displayName: ct.displayName || '',
      scenePrefix: ct.scenePrefix || 'SCENE',
      commentEnabled: info.commentEnabled,
      commentRequiredBelow: info.commentRequiredBelow,
      submitOpen: win.open,
      submitClosedReason: win.reason,
      tenantSource: ct.source,
    });
  } catch (err) {
    return jsonOut_(errorOut_(err, 'CONFIG_READ_FAILED'));
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var t = resolveTenant_(e, body);
    if (!t.enabled) {
      throw newTenantError_('這場演習已結束，不再開放評核。', 'DISABLED');
    }
    var win = submitWindowState_(t);
    if (!win.open) {
      throw newTenantError_(win.reason, 'OUT_OF_WINDOW');
    }
    return jsonOut_(appendSubmission_(body, t));
  } catch (err) {
    // ok/error 兩個欄位的形狀跟今天一樣（Start.dc.html 只看這兩個），
    // errorCode 是新增的，前端沒用到也不會壞。
    return jsonOut_({
      ok: false,
      error: String((err && err.message) || err),
      errorCode: tenantCodeOf_(err) || 'SUBMIT_FAILED',
    });
  }
}

function jsonOut_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Google Sheets 會把以這些字元開頭的字串值當成公式執行；寫入前一律跳脫，
// 避免透過 fillerCode/itemName/問題ID 注入公式（即使下面已用白名單擋掉未知值，
// 這裡仍保留一層防禦）。觀察紀錄 是唯一不受白名單保護的自由文字欄，更需要它。
var FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@'];
function sanitizeCell_(value) {
  var s = String(value == null ? '' : value);
  if (s.length && FORMULA_TRIGGER_CHARS.indexOf(s.charAt(0)) !== -1) return "'" + s;
  return s;
}

function appendSubmission_(body, t) {
  var answers = (body && body.answers) || [];
  if (!answers.length) throw new Error('沒有評分資料');

  // 白名單驗證：fillerCode / itemName / 問題ID 都必須是設定表裡真實存在的值，
  // 拒絕任何不在名單內的提交，防止偽造代號或注入任意字串（例如試算表公式）。
  var configSs = tenantSheetConfig_(t);
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
  // ⚠️ CacheService.getScriptCache() 是「整個腳本專案共用一個命名空間」，不加
  // 租戶前綴就等於跨醫院共用同一個去重窗（兩家醫院剛好產生同一個
  // submissionId，第二家的送出會被當成重複而整批丟掉）。但 fallback 模式下
  // 必須保持跟今天「一字不差」的 'sub_' + id——部署那一瞬間正在重試的送出
  // 還是要能被正確去重，所以這裡不是無條件加前綴。
  var cacheKey = '';
  if (body.submissionId) {
    cacheKey = t.source === 'registry'
      ? 'sub_' + t.hid + '/' + t.exid + '_' + body.submissionId
      : 'sub_' + body.submissionId;
  }
  var cache = CacheService.getScriptCache();
  if (cacheKey && cache.get(cacheKey)) return { ok: true, rows: 0, duplicate: true };

  // 這些都是唯讀查詢，不用等鎖就能先做；recordSs 只 open 一次重複使用，
  // 避免對同一份試算表多打一次 API（doPost 常被嫌慢，很大一部分就是每個
  // SpreadsheetApp 呼叫都是一次網路來回，能少一次是一次）。
  var record = tenantSheetRecord_(t);
  var sheet = record.sheet;
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
  // 以下七欄都是新增的選填欄，業主那張 6 欄表全部會回 -1 而被跳過。
  var commentCol = findHeaderCol_(header, RECORD_COMMENT_ALIASES_);
  var exerciseIdCol = findHeaderCol_(header, RECORD_EXERCISEID_ALIASES_);
  var tenantCol = findHeaderCol_(header, RECORD_TENANT_ALIASES_);
  var goalCol = findHeaderCol_(header, RECORD_GOAL_ALIASES_);
  var potentialCol = findHeaderCol_(header, RECORD_POTENTIAL_ALIASES_);
  var s4Col = findHeaderCol_(header, RECORD_S4_ALIASES_);
  var questionCol = findHeaderCol_(header, RECORD_QUESTION_ALIASES_);

  var exerciseName = exerciseCol !== -1 ? readExerciseInfo_(configSs).name : '';
  var indicatorByQuestionId = indicatorCol !== -1 ? readIndicatorMap_(configSs) : null;
  // 評核潛能/4S 元素/評核題目 任一欄存在才讀 對應指標 全表（沿用 :162 的
  // 「要用到才讀」模式，少一趟就少一次網路來回）。
  var indicatorFull = (potentialCol !== -1 || s4Col !== -1 || questionCol !== -1)
    ? readIndicatorFull_(configSs) : null;
  var stageIndex = (stageCol !== -1 || sceneCol !== -1 || goalCol !== -1)
    ? indexQuestionsByStage_(items) : null;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (cacheKey && cache.get(cacheKey)) return { ok: true, rows: 0, duplicate: true };

    var now = new Date();
    var rows = answers.map(function (a) {
      var row = [];
      for (var j = 0; j < header.length; j++) row.push('');
      var questionId = String(a.id || '');
      var stageInfo = stageIndex ? (stageIndex[questionId] || {}) : {};
      var fullInfo = indicatorFull ? (indicatorFull[questionId] || {}) : {};
      if (exerciseCol !== -1) row[exerciseCol] = sanitizeCell_(exerciseName);
      if (itemCol !== -1) row[itemCol] = sanitizeCell_(body.itemName);
      if (stageCol !== -1) row[stageCol] = sanitizeCell_(stageInfo.stage || '');
      if (sceneCol !== -1) row[sceneCol] = sanitizeCell_(stageInfo.itemName || body.itemName);
      row[idCol] = sanitizeCell_(questionId);
      if (indicatorCol !== -1) row[indicatorCol] = sanitizeCell_(indicatorByQuestionId[questionId] || '');
      row[scoreCol] = Number(a.score);
      row[codeCol] = sanitizeCell_(body.fillerCode);
      row[timeCol] = now;
      // 身分欄：fallback 模式下 t.hid/t.exid 都是空字串，寫進去就是空的——
      // 這是刻意的，沒有註冊表時「這場演習叫什麼代號」沒有任何真實答案，
      // 寫個假的進去比留空更糟。
      if (tenantCol !== -1) row[tenantCol] = sanitizeCell_(t.hid || '');
      if (exerciseIdCol !== -1) row[exerciseIdCol] = sanitizeCell_(t.exid || '');
      // 標籤快照：送出當時就把 測試情境／評核潛能／4S 元素／評核題目 寫死，
      // 之後業主為下一場改設定表也不會回頭改寫這一場的報告（缺陷 D3）。
      if (goalCol !== -1) row[goalCol] = sanitizeCell_(stageInfo.goal || '');
      if (potentialCol !== -1) row[potentialCol] = sanitizeCell_(fullInfo.potential || '');
      if (s4Col !== -1) row[s4Col] = sanitizeCell_(fullInfo.s4 || '');
      if (questionCol !== -1) row[questionCol] = sanitizeCell_(fullInfo.question || '');
      // 觀察紀錄：唯一的自由文字欄。前端已經 trim + 切到 500 字，這裡再切一次。
      // 內容或長度「永遠不會」造成整筆送出失敗——分數比留言重要。
      if (commentCol !== -1) {
        row[commentCol] = sanitizeCell_(String(a.comment == null ? '' : a.comment).trim().substring(0, COMMENT_MAX_LENGTH_));
      }
      return row;
    });

    var startRow = sheet.getLastRow() + 1;
    // Google Sheets 對「1-1」「2-1」這種帶數字和連字號的字串，就算是透過
    // setValues() 寫入（不是手動貼上），一樣可能自動誤判成日期，寫進去之後
    // 讀出來就變成一整串日期字串（不是原本的問題ID）。寫入前把這幾個文字欄
    // 的儲存格格式強制設成「純文字」('@')，之後就不會再被誤判——這一步要在
    // setValues 之前做，格式要先套用到目標儲存格上。
    // 新增的 演習代號 欄特別需要它：「2026-01」正是 plan §7.2 點名的自動轉
    // 日期陷阱，而解法本來就在這十行之內。
    var textColIndexes = [idCol, codeCol, exerciseCol, itemCol, stageCol, sceneCol, indicatorCol,
      tenantCol, exerciseIdCol, goalCol, potentialCol, s4Col, questionCol, commentCol]
      .filter(function (c) { return c !== -1; });
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
  var sheet = nullSafeSheet_(ss, INDICATOR_SHEET_NAME);
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
  var sheet = nullSafeSheet_(ss, INDICATOR_SHEET_NAME);
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
//
// 這一版的三個改動（統計本體 :292-350 一行都沒動）：
// 1. 四個 openById/getSheetByName 改成吃解析出來的租戶。
// 2. byQuestion 的鍵從「問題ID」改成「(醫院代號, 演習代號, 問題ID)」組合鍵。
//    方案 A 每場演習各有自己的紀錄檔，所以正常情況下前兩段都是同一個值、
//    分組結果跟今天一模一樣；但如果業主選了「兩場共用一份紀錄檔、用不同分頁」
//    的次要選項、或自己手動把兩場的資料貼進同一張表，組合鍵就是最後一道防線，
//    不會讓兩場的 1-1 互相覆蓋（缺陷 D1）。業主現在那張 6 欄表沒有 醫院代號/
//    演習代號 欄，兩段都是空字串，分組與今天完全相同。
// 3. 標籤改成「快照優先」：紀錄表有對應的快照欄且該格非空就用它，否則才回頭
//    join 設定表（今天的行為），並逐列記下 labelSource 讓報告可以誠實揭露。
//    ⚠️ stage 與 itemName 刻意「不」改優先序——情境階段/演練單元 這兩欄在業主
//    現在那張表上「已經有值」，把它們改成快照優先會立刻改掉今天的輸出數字。
function buildAnalysis_(t) {
  var configSs = tenantSheetConfig_(t);
  var exerciseInfo = readExerciseInfo_(configSs);
  var items = readItems_(configSs);
  var stageIndex = indexQuestionsByStage_(items);
  var indicatorFull = readIndicatorFull_(configSs);

  var record = tenantSheetRecord_(t);
  var sheet = record.sheet;
  var values = sheet.getDataRange().getValues();
  var header = values[0];
  var idCol = findHeaderCol_(header, RECORD_ID_ALIASES_);
  var codeCol = findHeaderCol_(header, RECORD_CODE_ALIASES_);
  var scoreCol = findHeaderCol_(header, RECORD_SCORE_ALIASES_);
  if (idCol === -1 || codeCol === -1 || scoreCol === -1) {
    throw new Error(t.recordSheet + ' 缺少欄位：' + RECORD_ID_ALIASES_.join('/') + ' / ' +
      RECORD_CODE_ALIASES_.join('/') + ' / ' + RECORD_SCORE_ALIASES_.join('/'));
  }
  // 項目名稱/演練單元其中一個存在就拿來當 fallback（優先用 stageIndex 現查
  // 的結果，這欄只在該題已經從 項目與問題 移除時墊底用）。
  var itemFallbackCol = findHeaderCol_(header, RECORD_ITEM_ALIASES_.concat(RECORD_SCENE_ALIASES_));
  // 以下全部是選填欄，業主現在那張表一欄都沒有，全部 -1。
  var rowTenantCol = findHeaderCol_(header, RECORD_TENANT_ALIASES_);
  var rowExerciseIdCol = findHeaderCol_(header, RECORD_EXERCISEID_ALIASES_);
  var snapGoalCol = findHeaderCol_(header, RECORD_GOAL_ALIASES_);
  var snapPotentialCol = findHeaderCol_(header, RECORD_POTENTIAL_ALIASES_);
  var snapS4Col = findHeaderCol_(header, RECORD_S4_ALIASES_);
  var snapIndicatorCol = findHeaderCol_(header, RECORD_INDICATOR_ALIASES_);
  var snapQuestionCol = findHeaderCol_(header, RECORD_QUESTION_ALIASES_);
  var commentCol = findHeaderCol_(header, RECORD_COMMENT_ALIASES_);

  var recordRowCount = Math.max(0, values.length - 1);
  var commentCount = 0;
  var byQuestion = {};
  var order = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var id = String(row[idCol] || '');
    var code = String(row[codeCol] || '');
    var score = Number(row[scoreCol]);
    if (!id || !code || isNaN(score)) continue;
    var rowHid = rowTenantCol !== -1 ? String(row[rowTenantCol] || '') : '';
    var rowExid = rowExerciseIdCol !== -1 ? String(row[rowExerciseIdCol] || '') : '';
    // 縱深防禦，不是主要防線：規則 2 已經擋掉「兩列共用同一張紀錄分頁」的註冊表
    // 設定，這裡是第二道。萬一還是有兩場演習的資料躺在同一張分頁上（例如業主手動
    // 把舊資料貼了進來），報告也不該把別場的分數算進自己的平均、ICC 與評核官人數。
    //
    // 兩個 && 守衛都是必要的，少一個就會變成破壞性改動：
    //   rowHid/rowExid 空字串 -> 一律保留。這兩欄是後來才加的選填欄，加欄位之前
    //     寫進去的歷史資料那兩格是空的，過濾掉會讓舊分數整批從報告上消失。
    //   t.hid/t.exid 空字串   -> fallback 模式（註冊表關閉或沒帶 ?t=），這時沒有
    //     「屬於哪一場」的概念，照樣全部保留，行為與今天位元相同。
    // 今天線上那張 6 欄紀錄表兩個欄位都不存在（兩個 col 都是 -1），所以這段在目前
    // 的資料上完全不會觸發，數字一個都不會變。
    if (rowHid && t.hid && rowHid !== t.hid) continue;
    if (rowExid && t.exid && rowExid !== t.exid) continue;
    var key = rowHid + KEY_SEP_ + rowExid + KEY_SEP_ + id;
    if (!byQuestion[key]) {
      byQuestion[key] = {
        questionId: id,
        hid: rowHid,
        exid: rowExid,
        itemName: itemFallbackCol !== -1 ? String(row[itemFallbackCol] || '') : '',
        snap: { goal: '', potential: '', s4: '', indicator: '', question: '' },
        byCode: {},
        commentByCode: {},
      };
      order.push(key);
    }
    var bucket = byQuestion[key];
    bucket.byCode[code] = score;
    // 快照欄逐列覆寫：同一題同一人以較晚那列為準，標籤也跟著那一列走。
    if (snapGoalCol !== -1 && String(row[snapGoalCol] || '')) bucket.snap.goal = String(row[snapGoalCol]);
    if (snapPotentialCol !== -1 && String(row[snapPotentialCol] || '')) bucket.snap.potential = String(row[snapPotentialCol]);
    if (snapS4Col !== -1 && String(row[snapS4Col] || '')) bucket.snap.s4 = String(row[snapS4Col]);
    if (snapIndicatorCol !== -1 && String(row[snapIndicatorCol] || '')) bucket.snap.indicator = String(row[snapIndicatorCol]);
    if (snapQuestionCol !== -1 && String(row[snapQuestionCol] || '')) bucket.snap.question = String(row[snapQuestionCol]);
    if (commentCol !== -1) {
      var cmt = String(row[commentCol] == null ? '' : row[commentCol]).trim();
      if (cmt) {
        bucket.commentByCode[code] = cmt;
        commentCount++;
      } else if (bucket.commentByCode[code]) {
        // 後來那一列把留言清空了，就跟分數一樣以較晚的為準。
        delete bucket.commentByCode[code];
      }
    }
  }

  var rows = order.map(function (k) {
    var b = byQuestion[k];
    var qid = b.questionId;
    var meta = indicatorFull[qid] || { question: '', indicator: '', potential: '', s4: '' };
    var stageInfo = stageIndex[qid] || { stage: '', itemName: b.itemName, goal: '' };
    var fromSnapshot = false;
    var fromJoin = false;
    function pickLabel(snapValue, joinValue) {
      if (snapValue) {
        fromSnapshot = true;
        return snapValue;
      }
      if (joinValue) {
        fromJoin = true;
        return joinValue;
      }
      return '';
    }
    var goal = pickLabel(b.snap.goal, stageInfo.goal || '');
    var potential = pickLabel(b.snap.potential, meta.potential);
    var s4 = pickLabel(b.snap.s4, meta.s4);
    var indicator = pickLabel(b.snap.indicator, meta.indicator);
    var question = pickLabel(b.snap.question, meta.question);
    var codes = Object.keys(b.byCode).sort();
    var scores = codes.map(function (c) { return { code: c, score: b.byCode[c] }; });
    var vals = scores.map(function (s) { return s.score; });
    var untriggered = 0;
    vals.forEach(function (v) { if (v === 1) untriggered++; });
    return {
      questionId: qid,
      stage: stageInfo.stage,
      itemName: stageInfo.itemName || b.itemName,
      goal: goal,
      potential: potential,
      s4: s4,
      indicator: indicator,
      question: question,
      scores: scores,
      mean: mean_(vals),
      sd: sd_(vals),
      exerciseId: b.exid || t.exid || '',
      comments: Object.keys(b.commentByCode).sort().map(function (c) {
        return { code: c, comment: b.commentByCode[c] };
      }),
      labelSource: fromSnapshot ? 'snapshot' : (fromJoin ? 'join' : 'none'),
      untriggered: untriggered,
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

  // 以下三組是新增的，而且全部是「現有資料的純推導」，沒有要求任何新欄位
  // （plan §3.3 的「不需新資料、只是目前沒人算」那一列）。原有七個 stats 鍵
  // 的計算方式一個字都沒改。
  // 1 分的定義是「劇本未走到此條件」（見 評分標準 工作表），跟 2-5 分放在一起
  // 平均會讓「沒演到」和「表現差」分不出來，所以單獨算一個未觸發率。
  var untriggeredN = 0;
  var untriggeredTotal = 0;
  consistencyRows.forEach(function (r) {
    r.scores.forEach(function (s) {
      untriggeredTotal++;
      if (s.score === 1) untriggeredN++;
    });
  });
  stats.untriggered = {
    n: untriggeredN,
    total: untriggeredTotal,
    rate: untriggeredTotal ? untriggeredN / untriggeredTotal : null,
  };

  // 缺漏清單：項目與問題 裡有、但一分都沒收到的題目。業主看到的「評核官人數」
  // 是實際出現過的代號聯集，所以「哪一題根本沒人評」今天是隱形的。
  var scoredIds = {};
  rows.forEach(function (r) { if (r.scores.length) scoredIds[r.questionId] = true; });
  stats.missingQuestions = [];
  Object.keys(stageIndex).forEach(function (qid) {
    // 項目與問題 裡「有分組名稱、但 評核題號 那一格空白」的列（業主常拿來放
    // 補充說明或分隔列）會讓 readItems_ 產生一筆 id 為空字串的題目，
    // indexQuestionsByStage_ 再把它存成 stageIndex['']。那一筆永遠不可能收到
    // 分數，列進缺漏清單只會在報告上多一列「永遠補不起來的空白題」，
    // 反而讓真正漏掉的題目被淹掉，所以直接略過。
    if (!qid) return;
    if (scoredIds[qid]) return;
    var si = stageIndex[qid];
    stats.missingQuestions.push({
      questionId: qid,
      stage: si.stage || '',
      itemName: si.itemName || '',
      goal: si.goal || '',
    });
  });

  // 各評核官的寬嚴傾向。deviation = 該評核官的平均，減掉「他評過的那些題目」
  // 的題目平均——用他自己評過的題目當基準，才不會把「只評了比較難的那幾題」
  // 誤判成嚴格。報告端要能匿名呈現（只給序號、不給代號）。
  var byEvaluator = {};
  consistencyRows.forEach(function (r) {
    r.scores.forEach(function (s) {
      if (!byEvaluator[s.code]) byEvaluator[s.code] = { scores: [], rowMeans: [] };
      byEvaluator[s.code].scores.push(s.score);
      byEvaluator[s.code].rowMeans.push(r.mean);
    });
  });
  stats.byEvaluator = Object.keys(byEvaluator).sort().map(function (c) {
    var own = mean_(byEvaluator[c].scores);
    var base = mean_(byEvaluator[c].rowMeans);
    return {
      code: c,
      n: byEvaluator[c].scores.length,
      mean: own,
      deviation: (own === null || base === null) ? null : own - base,
    };
  });

  var codeSet = {};
  rows.forEach(function (r) { r.scores.forEach(function (s) { codeSet[s.code] = true; }); });

  // 標籤來源統計只算「真的進到 payload 三個陣列裡」的列：潛能空白的題目
  // （例如紀錄表裡有、對應指標 裡沒有的題號）本來就不會出現在任何圖表上，
  // 把它們算進來只會讓報告上的「快照 N 題／讀取時對照 M 題」跟使用者看到的
  // 列數對不起來。
  var labelSourceSummary = { snapshot: 0, join: 0, none: 0 };
  analysisRows.concat(coverageRows).concat(learningRows).forEach(function (r) {
    labelSourceSummary[r.labelSource] = (labelSourceSummary[r.labelSource] || 0) + 1;
  });

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
      // ⚠️ 這裡刻意「只回真的解析到的身分」，不像設定分支那樣把使用者帶來的
      // 代號原樣回echo。設定分支的 echo 是為了讓前端知道「你帶的參數我收到了」，
      // 但分析頁把 meta.tenant 當成「後端真的從註冊表解析到機構」的判斷依據
      // （Analysis.html 用它決定要不要開放「過去演習」按鈕），而且 meta.tenant/
      // meta.exercise 會被印在報告的「演習代號」徽章與附錄C 上。還沒建註冊表時
      // 有人用 ?t=wanfang-7f3a2c 開儀表板，資料其實來自寫死的那一組試算表，
      // 卻在紙本報告上印出一個機構／場次代號，是會誤導判讀的假身分。
      tenant: t.hid || '',
      exercise: t.exid || '',
      displayName: t.displayName || '',
      scenePrefix: t.scenePrefix || 'SCENE',
      tenantSource: t.source,
      // 檔名可以放在這裡（這個分支有金鑰保護），給報告的附錄C 用；
      // 試算表 ID 永遠不放，檔名不是憑證、ID 是。
      configFileName: configSs.getName(),
      recordFileName: record.ss.getName(),
      recordSheetName: t.recordSheet,
      recordRowCount: recordRowCount,
      commentCount: commentCount,
      labelSourceSummary: labelSourceSummary,
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

// ===== 管理／診斷用的三個 action =====
// 共同前提：ADMIN_KEY 是一把「不會出現在任何上架 HTML 裡」的金鑰，由操作者自己
// 打在網址列，或由註冊表那支容器綁定腳本用 UrlFetchApp 帶。空字串 = 停用，而且
// 停用時連一張試算表都不會打開（驗證在最前面）。
function adminGate_(e) {
  if (!ADMIN_KEY) {
    return { ok: false, error: '尚未設定管理金鑰（ADMIN_KEY），自我檢測未啟用。', errorCode: 'ADMIN_DISABLED' };
  }
  if (param_(e, 'adminKey') !== ADMIN_KEY) {
    return { ok: false, error: '管理金鑰不正確。', errorCode: 'UNAUTHORIZED' };
  }
  return null;
}

function msgOf_(err) {
  return String((err && err.message) || err);
}

// 註冊表快取只有一把 key，flush 就只清這一把。
// ⚠️ 絕對不能呼叫 cache.removeAll，也不能去碰 sub_ 開頭的那些 key：那是 doPost
// 的冪等去重窗，清掉的瞬間，一個正在重試的送出就會 append 出重複列（plan §7.5）。
function handleFlush_(e) {
  var gate = adminGate_(e);
  if (gate) return gate;
  CacheService.getScriptCache().remove(REGISTRY_CACHE_KEY_);
  return { ok: true, flushed: [REGISTRY_CACHE_KEY_] };
}

// action=selftest：業主（或註冊表那支腳本）新增一場演習之後，立刻知道
// 「設定檔讀不讀得到、紀錄檔寫不寫得進去」。
// ⚠️ 回傳內容的紅線：只能有「檔名、分頁名、欄名、數量」。不准有試算表 ID、
// 不准有任何金鑰、不准有 人員代號／問題ID／分數／任何儲存格內容。它也是
// 「註冊表哪一列為什麼無效」與「fallback case (ii) 的 warning」唯一的出口，
// 這兩樣東西刻意不出現在任何評核官手機抓得到的 payload 裡。
function handleSelfTest_(e) {
  var gate = adminGate_(e);
  if (gate) return gate;
  var reg = readRegistry_();
  var registryInfo = {
    configured: !!REGISTRY_SPREADSHEET_ID,
    readable: reg ? !!reg.readable : false,
    sheetFound: reg ? !!reg.sheetFound : false,
    rowCount: reg ? reg.rowCount : 0,
    validRowCount: reg ? reg.rows.length : 0,
    invalidRows: reg ? reg.invalid : [],
    warning: reg ? reg.warning : '',
  };
  var t;
  try {
    t = resolveTenant_(e, null);
  } catch (err) {
    return {
      ok: false,
      error: msgOf_(err),
      errorCode: tenantCodeOf_(err) || 'NO_TENANT',
      tenant: '',
      exercise: '',
      displayName: '',
      tenantSource: '',
      registry: registryInfo,
      messages: ['無法解析這個連結對應的演習：' + msgOf_(err)],
    };
  }
  if (!registryInfo.warning && t.registryWarning) registryInfo.warning = t.registryWarning;
  return doSelfTest_(t, registryInfo);
}

function doSelfTest_(t, registryInfo) {
  var messages = [];
  var ok = true;
  if (!registryInfo.configured) {
    messages.push('尚未設定租戶註冊表（REGISTRY_SPREADSHEET_ID 為空），目前使用程式內建的那一組試算表。');
  } else if (registryInfo.warning) {
    messages.push('⚠️ 註冊表無法使用，已退回程式內建的那一組試算表：' + registryInfo.warning);
  }
  if (registryInfo.invalidRows && registryInfo.invalidRows.length) {
    ok = false;
    registryInfo.invalidRows.forEach(function (bad) {
      messages.push('⚠️ 註冊表第 ' + bad.rowNumber + ' 列無效：' + bad.reasons.join('；'));
    });
  }

  var configReport = {
    readable: false, fileName: '', sheetsFound: [], missingSheets: [],
    codeCount: 0, criteriaCount: 0, leafCount: 0, questionCount: 0, indicatorRowCount: 0,
  };
  try {
    var configSs = tenantSheetConfig_(t);
    configReport.readable = true;
    configReport.fileName = configSs.getName();
    messages.push('✅ 設定檔可讀：' + configReport.fileName);
    ['演習資訊', '人員代號', '評分標準', '項目與問題', INDICATOR_SHEET_NAME].forEach(function (name) {
      if (configSs.getSheetByName(name)) configReport.sheetsFound.push(name);
      else configReport.missingSheets.push(name);
    });
    if (configReport.missingSheets.length) {
      ok = false;
      messages.push('⚠️ 設定檔缺少分頁：' + configReport.missingSheets.join('／'));
    }
    try {
      configReport.codeCount = readCodes_(configSs).length;
    } catch (errCodes) {
      ok = false;
      messages.push('⚠️ 人員代號 讀取失敗：' + msgOf_(errCodes));
    }
    try {
      configReport.criteriaCount = readCriteria_(configSs).length;
    } catch (errCriteria) {
      ok = false;
      messages.push('⚠️ 評分標準 讀取失敗：' + msgOf_(errCriteria));
    }
    try {
      var counted = countItems_(readItems_(configSs));
      configReport.leafCount = counted.leaves;
      configReport.questionCount = counted.questions;
    } catch (errItems) {
      ok = false;
      messages.push('⚠️ 項目與問題 讀取失敗：' + msgOf_(errItems));
    }
    try {
      configReport.indicatorRowCount = Object.keys(readIndicatorFull_(configSs)).length;
    } catch (errInd) {
      ok = false;
      messages.push('⚠️ ' + INDICATOR_SHEET_NAME + ' 讀取失敗（分析頁會壞，評核表單不受影響）：' + msgOf_(errInd));
    }
  } catch (errConfig) {
    ok = false;
    messages.push('❌ 設定檔打不開：' + msgOf_(errConfig));
  }

  var recordReport = {
    readable: false, writable: null, fileName: '', sheetName: t.recordSheet,
    headerColumns: [], rowCount: 0, missingRequired: [], presentOptional: [], absentOptional: [],
  };
  try {
    var record = tenantSheetRecord_(t);
    recordReport.readable = true;
    recordReport.fileName = record.ss.getName();
    messages.push('✅ 紀錄檔可讀：' + recordReport.fileName + '／' + t.recordSheet);
    var lastCol = record.sheet.getLastColumn();
    var header = lastCol ? record.sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    recordReport.headerColumns = header.map(function (h) { return String(h == null ? '' : h); });
    recordReport.rowCount = Math.max(0, record.sheet.getLastRow() - 1);
    [[RECORD_ID_ALIASES_, '問題ID'], [RECORD_SCORE_ALIASES_, '分數'],
      [RECORD_CODE_ALIASES_, '人員代號'], [RECORD_TIME_ALIASES_, '送出時間']].forEach(function (pair) {
      if (findHeaderCol_(header, pair[0]) === -1) recordReport.missingRequired.push(pair[1]);
    });
    if (recordReport.missingRequired.length) {
      ok = false;
      messages.push('⚠️ 紀錄檔缺少必要欄位：' + recordReport.missingRequired.join('／'));
    }
    [[RECORD_EXERCISE_ALIASES_, '演習名稱'], [RECORD_ITEM_ALIASES_, '項目名稱'],
      [RECORD_STAGE_ALIASES_, '情境階段'], [RECORD_SCENE_ALIASES_, '演練單元'],
      [RECORD_INDICATOR_ALIASES_, '指標代號'], [RECORD_COMMENT_ALIASES_, '觀察紀錄'],
      [RECORD_EXERCISEID_ALIASES_, '演習代號'], [RECORD_TENANT_ALIASES_, '醫院代號'],
      [RECORD_GOAL_ALIASES_, '測試情境'], [RECORD_POTENTIAL_ALIASES_, '評核潛能'],
      [RECORD_S4_ALIASES_, '4S 元素'], [RECORD_QUESTION_ALIASES_, '評核題目']].forEach(function (pair) {
      if (findHeaderCol_(header, pair[0]) !== -1) recordReport.presentOptional.push(pair[1]);
      else recordReport.absentOptional.push(pair[1]);
    });
    // 寫入探測刻意「不」append 任何一列、也不動任何一格：掛一個 developer
    // metadata 上去再拿掉，兩步都成功就代表腳本帳號對這份檔案有編輯權。失敗
    // 不代表資料有問題，只代表權限還沒給。
    try {
      var probeKey = 'selftest_' + Date.now();
      record.ss.addDeveloperMetadata(probeKey, '1');
      record.ss.createDeveloperMetadataFinder().withKey(probeKey).find().forEach(function (meta) {
        meta.remove();
      });
      SpreadsheetApp.flush();
      recordReport.writable = true;
      messages.push('✅ 紀錄檔可寫');
    } catch (errWrite) {
      ok = false;
      recordReport.writable = false;
      messages.push('⚠️ 紀錄檔不可寫（請把執行這支腳本的 Google 帳號加成該檔案的編輯者）：' + msgOf_(errWrite));
    }
  } catch (errRecord) {
    ok = false;
    messages.push('❌ 紀錄檔打不開：' + msgOf_(errRecord));
  }

  return {
    ok: ok,
    tenant: t.hid || t.requestedHid || '',
    exercise: t.exid || t.requestedExid || '',
    displayName: t.displayName || '',
    tenantSource: t.source,
    registry: registryInfo,
    config: configReport,
    record: recordReport,
    messages: messages,
  };
}

function countItems_(nodes) {
  var out = { leaves: 0, questions: 0 };
  nodes.forEach(function (n) {
    if (n.questions) {
      out.leaves++;
      out.questions += n.questions.length;
    } else if (n.children) {
      var sub = countItems_(n.children);
      out.leaves += sub.leaves;
      out.questions += sub.questions;
    }
  });
  return out;
}

// action=exercises：列出某一家機構底下的所有場次，給 Analysis.html 那顆目前
// disabled 的「過去演習」按鈕用。授權方式：?t= 加 ?key=，而 key 只要等於「該
// 醫院代號底下任何一列有效列的 分析金鑰」就算通過——檢查規則 3 保證同一把金鑰
// 不會跨兩個 醫院代號，所以這個比法不會讓 A 院列出 B 院的場次。
// ⚠️ 回傳內容永遠不含 設定試算表ID／紀錄試算表ID／紀錄分頁名稱／分析金鑰／
// 檔案擁有者。啟用=N 的列「要」列出來（enabled:false），那正是「過去演習」
// 清單需要的東西。
// action=sessions：給評核表「選擇場次」畫面用的清單。
//
// 跟 action=exercises 的分工是刻意分成兩支函式，不是把 exercises 的金鑰放寬：
//   exercises = 給 Analysis.html 用，有 分析金鑰 保護，所以允許回檔名、也允許
//               為每一列開設定試算表去讀 演習名稱／演習日期。
//   sessions  = 給評核官手機用，完全沒有任何金鑰，所以紅線嚴格得多：只回註冊表
//               裡的文字，一張設定試算表都不開。
// 三個理由，缺一不可：
//   (1) exercises 的 fallback 分支刻意「忽略 ?t=」並改開程式內建的那張設定試算
//       表。那個分支一旦不用金鑰，就等於把 legacy 租戶的 演習名稱／演習日期 發
//       給連 ?t= 都沒帶的任何人——直接違反「不得跨租戶外洩」。
//   (2) 一支函式一條紅線才查得動。exercises 的紅線是「有金鑰，可以回檔名」，
//       sessions 的紅線是「無金鑰，只回註冊表文字」；把兩條紅線塞進同一支函式
//       再用 if (key) 分岔，以後沒人能一眼看出哪個欄位歸哪一條。
//   (3) exercises 會為每一列 openById 一次設定試算表（12 場的醫院 = 12 次）。
//       一支「每支評核官手機都會打、而且不用金鑰」的端點不可以這樣：它跟 doPost
//       共用同一份 Apps Script 配額，會變成免費的配額放大器。所以 sessions 只讀
//       readRegistry_()（本來就有 120 秒快取），一次請求最多一趟註冊表讀取、通常
//       是零趟。這也是為什麼列的標籤用 顯示名稱 而不是 演習名稱——後者在設定試
//       算表裡，這支拿不到。
//
// 憑證就是「知道 醫院代號」這件事本身——跟設定分支今天已經接受的憑證一模一樣
// （Start.dc.html 的網址裡本來就帶著它，而且從不帶任何金鑰）。新增的曝光面要講
// 明白而不是假設：帶著 ?t= 的人今天已經可以無認證拿到整份 項目與問題 題庫、整份
// 人員代號 名冊、全部 評分標準 文字、機構／演習名稱與日期，還能 POST 分數進那一
// 場的紀錄表。sessions 在這之上只多三樣東西：(a) 這家醫院「還有哪些 演習代號」的
// 存在與數量、(b) 每一場的 顯示名稱、(c) 每一場的開放狀態與時間窗文字。(b) 本來知道
// 演習代號 就看得到（設定 payload 一直都回 displayName）。(c) 只有一半是舊的：不開放
// 的場次，submitClosedReason 早就把 windowText_ 原文印在無認證的設定分支上；但場次
// 「開放中」時 submitWindowState_ 回的 reason 是空字串，而且「尚未開放」與「已結束」
// 在設定分支是一字不差的同一句話。所以 sessions 真正新曝光的是「開放中場次的時間窗
// 文字」與「那兩種關閉的區別」——兩樣都不敏感，但這一段的用途就是把差異講準。
// (a) 才是真正的差異，而且必須寫下來：它把 演習代號 從一個弱共享
// 秘密變成可列舉的值，所以一個 ?t= 持有者能亂送分數的範圍，從「預設演習」擴大到
// 「這家醫院所有 啟用=Y 且在時間窗內的場次」。接受的理由是 演習代號 從來就不是憑
// 證（normSlug_ 允許 32 字，但業主實際上都寫 2026a 這種），而「讓同一家醫院的評核
// 官自己列舉自己的場次」正是這次要做的功能本身。
// 邊界也要講清楚：hid 必填且一定過 normSlug_；只看 r.hid === hid 的列；沒有任何端
// 點列得出「有哪些 醫院代號」、也沒有通用字元，所以沒有跨租戶路徑；代號永遠不會被
// 拿去 openById；啟用 與 開放送出起/迄 兩道閘門完全沒動，但它們擋的位置不同：啟用=N
// 在設定分支與 doPost 都回 DISABLED；只是過了時間窗的，只有 doPost 回 OUT_OF_WINDOW，
// 設定分支一直都是照樣回整份表單、只帶 submitOpen:false（本來就有的行為，不是這次放寬）。
//
// ⚠️ 回傳內容的紅線（比 action=selftest 還嚴，因為這支完全沒有驗證）：絕對不准
// 出現 設定試算表ID／紀錄試算表ID／任何試算表 ID、分析金鑰（這支也從不跟它比
// 對）、ADMIN_KEY、紀錄分頁名稱／任何工作表名稱、檔案擁有者、註冊表列號、
// registryWarning、assertRegistrySane_ 的無效理由字串、任何其他 醫院代號 的列、
// 人員代號／問題ID／分數／觀察紀錄／任何儲存格內容、任何檔名（這支根本沒開過
// 檔案，所以物理上拿不到）。程式形狀上也擋了一層：整支端點只有 sessionSortable_
// 一個地方組得出回傳物件，而排序需要的原始欄位（openFrom/openTo/isDefault/exid）
// 放在那個 out 的「外面」，不可能跟著 JSON 回去。
function handleSessions_(e) {
  // t 必填。沒帶 ?t= 就直接回錯，而且刻意連 readRegistry_() 都不呼叫——「沒帶
  // 代號就列出所有醫院」這種行為一次都不能發生，連「讀了但沒用」都不要。
  var rawHid = param_(e, 't');
  if (!String(rawHid == null ? '' : rawHid).trim()) {
    return { error: '連結缺少機構代號，請使用主辦單位提供的連結。', errorCode: 'NO_TENANT_CODE' };
  }
  var hid = normSlug_(rawHid);
  if (!hid) {
    // 下面三個錯誤的中文句子都跟 resolveTenant_ 一字不差：打錯 ?t= 的人在選單上
    // 看到的句子要跟在表單上看到的一樣，否則同一個錯誤會有兩種說法，業主沒辦法
    // 照著任一句去查。
    return { error: '連結裡的機構代號格式不正確，請確認連結是否完整。', errorCode: 'BAD_CODE' };
  }
  var reg = readRegistry_();
  if (!reg || !reg.rows.length) {
    // 註冊表沒設定（master 上 REGISTRY_SPREADSHEET_ID 還是空字串）或整張表不可
    // 用。這個 errorCode 刻意跟其他三個分開：前端只對 REGISTRY_OFF 做「不顯示選
    // 單、照今天的方式直接載入設定」的降級，所以它絕對不能跟 NO_TENANT 混在一起
    // ——混了就會讓 master 上的 ?t= 連結從「進得去表單」變成「看到錯誤畫面」。
    // 對這個呼叫端揭露「註冊表沒開」的邊際曝光是零：設定分支本來就回 tenantSource
    // 給同一支手機。
    return { error: '目前無法取得場次清單。', errorCode: 'REGISTRY_OFF' };
  }
  // 只走 reg.rows（通過五條檢查的列），永遠不列舉 reg.invalidTenants 的內容：
  // 無效列對選單是完全不存在的，不會變成清單裡的一列，也不會退回 fallback 租戶。
  var mine = reg.rows.filter(function (r) { return r.hid === hid; });
  if (!mine.length) {
    var invalidMatch = (reg.invalidTenants || []).filter(function (r) { return r.hid === hid; });
    // 有無效列 -> 回通用句子（無效的理由只有 action=selftest 看得到），不是回空清
    // 單：空清單會讓業主以為自己沒建那一列，而不是建壞了。
    if (invalidMatch.length) {
      return { error: '這場演習的註冊資料有問題，請聯絡系統管理者。', errorCode: 'ROW_INVALID' };
    }
    return { error: '找不到這家機構的設定（代號：' + hid + '），請確認連結是否正確。', errorCode: 'NO_TENANT' };
  }
  // 同一個 now 貫穿整批列。如果讓每一列各自取 Date.now()，剛好落在某一列 開放送出
  // 起 那一毫秒的請求，可能出現「前一列算已結束、後一列算尚未開放」這種自相矛盾
  // 的清單；這也是 submitWindowState_ 多收一個選填 now 的唯一理由。
  var now = Date.now();
  var sortable = mine.map(function (r) { return sessionSortable_(r, now); });
  sortable.sort(compareSessions_);
  return {
    // 原封不動回 normSlug_ 之後的 ?t=，讓前端確認拿到的是自己要的那一家。這個值
    // 本來就是呼叫端自己給的，不構成任何外洩。
    tenant: hid,
    sessions: sortable.map(function (s) { return s.out; }),
  };
}

// 一列註冊資料 -> { 排序用欄位…, out }。
// out 裡只有七個欄位，而且這是整支端點唯一組得出 out 的地方——想多塞一個欄位只
// 能改這裡，所以上面那條紅線永遠只有一個地方要查。排序需要的 openFrom／openTo／
// isDefault／exid 刻意放在 out 外面，物理上不可能跟著 JSON 回去。
function sessionSortable_(r, now) {
  var phase = sessionPhase_(r, now);
  return {
    phaseRank: sessionPhaseRank_(phase.status),
    openFrom: r.openFrom,
    openTo: r.openTo,
    isDefault: !!r.isDefault,
    exid: r.exid,
    out: {
      exercise: r.exid,
      // 顯示名稱 是選填欄，空白就退回拿代號當標籤（醜，但看得懂）。刻意不把它升
      // 級成必填欄位：那會讓現在線上的列變成無效列，連路由一起拖下去。
      label: String(r.displayName == null ? '' : r.displayName).trim() || r.exid,
      status: phase.status,
      statusText: phase.statusText,
      // 時間窗文字早就在 parseRegistryRow_ 裡用 formatDateTime_ 格式化過
      // （yyyy/MM/dd HH:mm），這裡不重新格式化，免得選單跟 windowText_ 的寫法漂開。
      openFromText: r.openFromText || '',
      openToText: r.openToText || '',
      isDefault: !!r.isDefault,
    },
  };
}

// 三段狀態。關鍵：「這場收不收分數」這個判斷「不」在這裡重寫，而是直接問
// submitWindowState_ 並且只讀它的 .open——選單跟 doPost 因此在物理上不可能對同一
// 場演習有不同看法。
// submitWindowState_ 把「還沒開始」跟「已經結束」併成同一句 reason，對 doPost 是對
// 的（它只需要結論「現在不收」），所以 doPost 一行都不動；但選單需要分開：「尚未
// 開放」是叫人晚點再來，「已結束」不是。所以這裡先拿結論，只在結論是「不開放」時
// 才回頭看原始上下界，決定要印哪一個標籤。
// 順序也是刻意的：啟用=N 永遠優先於「開始時間在未來」——一列 啟用=N 但 開放送出起
// 填了未來時間的，算 已結束 而不是 尚未開放。因為 啟用 是業主的手動總開關，選單絕
// 對不可以替一場被關掉的演習承諾「它之後會開」。
function sessionPhase_(t, now) {
  if (submitWindowState_(t, now).open) return { status: 'open', statusText: '開放中' };
  if (t.enabled && t.openFrom !== null && t.openFrom !== undefined && now < t.openFrom) {
    return { status: 'future', statusText: '尚未開放' };
  }
  // 剩下兩種成因刻意併成同一個標籤：(a) 啟用=N（不管時間窗）、(b) 啟用=Y 且已經過
  // 了 開放送出迄。啟用=Y 而 開放送出迄 空白的列永遠走不到這裡——那種列是「永遠開
  // 放中」，正好就是線上 wanfang-7f3a2c/2026a 那一列（兩格時間窗都空白）今天的行為。
  return { status: 'past', statusText: '已結束' };
}

function sessionPhaseRank_(status) {
  if (status === 'open') return 0;
  if (status === 'future') return 1;
  return 2;
}

// 排序在伺服器做，兩個理由：DC 樣板只有 <sc-if>/<sc-for>，沒有排序能力；而且規則
// 放一處，將來第二個使用端也不會排得跟評核表不一樣。
// 開放中 -> 尚未開放 -> 已結束；組內：
//   開放中   預設演習 在最前（它就是「本場」），再比 開放送出起 由早到晚，再比代號
//   尚未開放 開放送出起 由早到晚（快要開的排前面）
//   已結束   開放送出迄 由晚到早（最近結束的排前面），再比代號由大到小
function compareSessions_(a, b) {
  if (a.phaseRank !== b.phaseRank) return a.phaseRank - b.phaseRank;
  if (a.phaseRank === 0) {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    var openCmp = compareTimeNullLast_(a.openFrom, b.openFrom, false);
    if (openCmp) return openCmp;
    return compareText_(a.exid, b.exid);
  }
  if (a.phaseRank === 1) {
    var futureCmp = compareTimeNullLast_(a.openFrom, b.openFrom, false);
    if (futureCmp) return futureCmp;
    return compareText_(a.exid, b.exid);
  }
  var pastCmp = compareTimeNullLast_(a.openTo, b.openTo, true);
  if (pastCmp) return pastCmp;
  return compareText_(b.exid, a.exid);
}

// 空白時間（null）一律排到最後，升冪降冪都一樣。「沒有界限」不是一個可以跟時間比
// 大小的值，硬把它當成 0 或 Infinity，在升冪跟降冪裡必定各錯一次。
function compareTimeNullLast_(x, y, desc) {
  var xn = (x === null || x === undefined);
  var yn = (y === null || y === undefined);
  if (xn && yn) return 0;
  if (xn) return 1;
  if (yn) return -1;
  if (x === y) return 0;
  if (x < y) return desc ? 1 : -1;
  return desc ? -1 : 1;
}

function compareText_(x, y) {
  return x < y ? -1 : (x > y ? 1 : 0);
}

function handleExercises_(e) {
  var key = param_(e, 'key');
  var hid = normSlug_(param_(e, 't'));
  var reg = readRegistry_();
  if (!reg || !reg.rows.length) {
    // fallback 模式：?t= 一律忽略，金鑰比對程式內建的 ANALYSIS_KEY，
    // 回傳只有一個元素的清單（就是那一場寫死的演習）。
    if (!key || key !== ANALYSIS_KEY) return { error: 'unauthorized', errorCode: 'UNAUTHORIZED' };
    var info = { name: '', date: '' };
    try {
      info = readExerciseInfo_(tenantSheetConfig_(fallbackTenant_()));
    } catch (err) {
      // 讀不到就回空字串，不要讓整份清單失敗。
    }
    return {
      tenant: '',
      exercises: [{
        exercise: '',
        displayName: '',
        exerciseName: info.name || '',
        exerciseDate: info.date || '',
        enabled: true,
        isDefault: true,
      }],
    };
  }
  var mine = reg.rows.filter(function (r) { return hid && r.hid === hid; });
  var authorized = false;
  mine.forEach(function (r) { if (key && r.analysisKey === key) authorized = true; });
  if (!authorized) return { error: 'unauthorized', errorCode: 'UNAUTHORIZED' };
  var sorted = mine.slice().sort(function (a, b) { return a.exid < b.exid ? -1 : (a.exid > b.exid ? 1 : 0); });
  return {
    tenant: hid,
    exercises: sorted.map(function (r) {
      var name = '';
      var date = '';
      try {
        var rowInfo = readExerciseInfo_(tenantSheetConfig_(r));
        name = rowInfo.name;
        date = rowInfo.date;
      } catch (errRow) {
        // 某一場的設定檔打不開（權限還沒給、檔案被刪）不該讓整份清單失敗，
        // 那一列就只少了名稱與日期兩個欄位。
      }
      return {
        exercise: r.exid,
        displayName: r.displayName || '',
        exerciseName: name,
        exerciseDate: date,
        enabled: r.enabled,
        isDefault: r.isDefault,
      };
    }),
  };
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
// ⚠️ 這個函式原本跟 apps-script/Config.gs 那一份逐位元相同；從這一版起「兩份
// 會漂移」：這裡多認兩個選填標籤（啟用觀察紀錄／低分需說明門檻），Config.gs
// 沒有。key/value 的形狀本身刻意沒有改動，所以 README.md 那份業主實際在填的
// 對外契約逐字保持有效（plan §2.1）。多出來的兩列是「有填才生效」，業主不填
// 就是今天的行為（留言框開著、不強制說明）。
function readExerciseInfo_(ss) {
  var values = nullSafeSheet_(ss, '演習資訊').getDataRange().getValues();
  var info = {
    org: '', name: '', topic: '', category: '', date: '', desc: '',
    commentEnabled: true, commentRequiredBelow: 0,
  };
  for (var i = 0; i < values.length; i++) {
    var key = values[i][0];
    var val = formatCellValue_(values[i][1]);
    if (key === '機構名稱') info.org = val;
    else if (key === '演習名稱') info.name = val;
    else if (key === '演習主題' || key === '主題') info.topic = val;
    else if (key === '演習類別') info.category = val;
    else if (key === '演習日期') info.date = val;
    else if (key === '說明') info.desc = val;
    else if (key === '啟用觀察紀錄') {
      // 只有明確寫 N／否／關閉（或 FALSE，含沒打勾的核取方塊）才關掉；空白或任何其他值都當成開啟，
      // 因為「少一個留言框」比「意外關掉報告唯一的質性資料來源」好修。
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

// getSheetByName 回 null 的四個地方（演習資訊/人員代號/評分標準/項目與問題）
// 統一走這裡：分頁被改名或刪掉時給一句中文，而不是讓
// 「Cannot read property getDataRange of null」直接噴到評核官手機上（plan §6.2）。
function nullSafeSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('找不到工作表：' + name);
  return sheet;
}

// findHeaderCol_ 加上「找不到就丟中文錯誤」。plan §6.1 點名的那三處裸
// indexOf（readCodes_ 的 代號、readCriteria_ 的 分數/標籤/說明、readItems_ 的
// 問題ID/問題內容）都改用這個：欄名被改到的話，原本會拿到 row[-1] === undefined，
// 整張表「靜靜地變成空的」而且沒有任何錯誤——業主看到空的代號下拉選單，只會
// 以為是評核官還沒送出。
// ⚠️ readItems_ 探測「層N」那個迴圈必須繼續用裸 indexOf：那裡的 -1 是
// 「層數到底了」的迴圈終止條件，不是錯誤。
function safeHeaderCol_(header, aliases, label) {
  var col = findHeaderCol_(header, aliases);
  if (col === -1) throw new Error(label + ' 缺少欄位：' + aliases.join('／'));
  return col;
}

function readCodes_(ss) {
  var values = nullSafeSheet_(ss, '人員代號').getDataRange().getValues();
  var col = safeHeaderCol_(values[0], ['代號'], '人員代號');
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var v = values[i][col];
    if (v === '' || v == null) continue;
    out.push({ value: String(v), label: String(v) });
  }
  return out;
}

function readCriteria_(ss) {
  var values = nullSafeSheet_(ss, '評分標準').getDataRange().getValues();
  var header = values[0];
  var scoreCol = safeHeaderCol_(header, ['分數'], '評分標準');
  var labelCol = safeHeaderCol_(header, ['標籤'], '評分標準');
  var descCol = safeHeaderCol_(header, ['說明'], '評分標準');
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
// 這是「真的選填」，所以刻意不用 safeHeaderCol_，-1 由 readItems_ 裡 goalCol !== -1 的判斷吸收。
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
  var values = nullSafeSheet_(ss, '項目與問題').getDataRange().getValues();
  var header = values[0];
  var groupCols = [];
  for (var lvl = 1; ; lvl++) {
    // 這裡的 -1 是迴圈終止條件（層數到底了），不是錯誤，所以維持裸 indexOf。
    var at = header.indexOf('層' + lvl);
    if (at === -1 && GROUP_HEADER_ALIASES_[lvl - 1]) at = findHeaderCol_(header, GROUP_HEADER_ALIASES_[lvl - 1]);
    if (at === -1) break;
    groupCols.push(at);
  }
  if (!groupCols.length) {
    var nameCol = findHeaderCol_(header, ['項目名稱']);
    if (nameCol === -1) throw new Error('項目與問題缺少欄位：項目名稱 或 層1/情境階段');
    groupCols = [nameCol];
  }
  var idCol = safeHeaderCol_(header, ID_HEADER_ALIASES_, '項目與問題');
  var textCol = safeHeaderCol_(header, TEXT_HEADER_ALIASES_, '項目與問題');
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
