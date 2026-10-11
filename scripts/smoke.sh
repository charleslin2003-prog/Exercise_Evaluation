#!/usr/bin/env bash
# 演習評核後端回歸測試。
#
# 為什麼存在：這些檢查本來每次都是手打 curl 重跑一遍，於是「重新部署之後有沒有
# 回歸」實際上取決於當天有沒有人記得測。後端沒有 CI，Apps Script 也沒有部署鉤子，
# 所以這支腳本就是這個專案唯一的自動化防線。
#
#   bash scripts/smoke.sh                 # 唯讀檢查，可以無限次重跑、可以排程
#   bash scripts/smoke.sh --with-write    # 多跑「真的送出一筆分數」的寫入隔離測試
#
# 退出碼 0 = 全過，1 = 有失敗。排程 agent 看退出碼就夠。
#
# ⚠️ 只打沙箱。正式站的網址刻意沒有寫在這裡，而且 guard_production 會擋下任何
#    指向正式 /exec 的 BASE —— 回歸測試對著真實醫院的資料跑是不能接受的。
#
# ⚠️ scripts/ 已列入 .vercelignore。這個檔案若被部署，等於把沙箱金鑰的取得方式
#    公開在網站上。新增任何測試檔案前先確認那一行還在。

set -uo pipefail

# ---- 設定 ----------------------------------------------------------------
# 沙箱 RECORD_URL。與 Start.dc.html / Analysis.html 的 const 同一個值；那兩個檔案
# 本來就把它明文送到每支手機上，所以這裡不是新的曝光。
BASE="${EVAL_RECORD_URL:-https://script.google.com/macros/s/AKfycbzQLAJCv3-lMgWeJ6k0zDYdqkepMiycTivwksmuqbkXUZngHSZmtWGh8c9DDs5ykytX/exec}"

HOSPITAL="${EVAL_HOSPITAL:-wanfang-7f3a2c}"
CLINIC="${EVAL_CLINIC:-clinic-9b4e1d}"

# 分析金鑰從環境變數讀，不寫進檔案。沒給就跳過需要金鑰的檢查而不是失敗 ——
# 排程跑唯讀檢查不該因為少一把金鑰就整個紅掉。
#   export EVAL_KEY_MAIN=...     （醫院預設場次的分析金鑰）
#   export EVAL_KEY_CLINIC=...   （分院的分析金鑰）
KEY_MAIN="${EVAL_KEY_MAIN:-}"
KEY_CLINIC="${EVAL_KEY_CLINIC:-}"

WITH_WRITE=0
[ "${1:-}" = "--with-write" ] && WITH_WRITE=1

PASS=0; FAIL=0; SKIP=0

# ---- 工具 ----------------------------------------------------------------
guard_production() {
  # 正式部署的 /exec id 前綴。指到這些就立刻中止。
  case "$BASE" in
    *AKfycbzBiivE*|*AKfycbyIEReG*)
      echo "拒絕執行：BASE 指向正式部署。這支腳本只能打沙箱。" >&2; exit 2;;
  esac
}

# Apps Script 偶爾回 Google 的 HTML 錯誤頁而不是 JSON，重試三次。
get() {
  local url="$1" r i
  for i in 1 2 3; do
    r=$(curl -sL --max-time 60 "$url" 2>/dev/null)
    case "$r" in \{*) printf '%s' "$r"; return 0;; esac
    sleep 3
  done
  printf '{"__fail":"端點三次都沒回 JSON"}'
}

post() {
  local body="$1" r i
  for i in 1 2 3; do
    r=$(curl -sL --max-time 60 -H 'Content-Type: text/plain;charset=utf-8' \
          --data-binary "$body" "$BASE" 2>/dev/null)
    case "$r" in \{*) printf '%s' "$r"; return 0;; esac
    sleep 3
  done
  printf '{"__fail":"端點三次都沒回 JSON"}'
}

# jq 不一定有，node 一定有（這個 repo 已經用 node 跑過好幾套測試架）。
jget() { node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    let j;try{j=JSON.parse(s)}catch(e){console.log("__PARSE_FAIL__");return}
    let v=j;for(const k of process.argv[1].split(".")){ if(v==null){v=undefined;break} v=v[k]; }
    console.log(v===undefined?"":(typeof v==="object"?JSON.stringify(v):String(v)));
  })' "$1"; }

ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; printf '        預期：%s\n        實得：%s\n' "$2" "$3"; }
skip() { SKIP=$((SKIP+1)); printf '  \033[33mSKIP\033[0m  %s （%s）\n' "$1" "$2"; }

expect_eq() { # 名稱 預期 實得
  [ "$2" = "$3" ] && ok "$1" || bad "$1" "$2" "$3"
}
expect_contains() {
  case "$3" in *"$2"*) ok "$1";; *) bad "$1" "包含「$2」" "$3";; esac
}

section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ==========================================================================
guard_production
echo "目標：$BASE"
echo "醫院：$HOSPITAL　分院：$CLINIC　寫入測試：$([ $WITH_WRITE = 1 ] && echo 開 || echo 關)"

# --------------------------------------------------------------------------
section "A. 場次清單（action=sessions，無金鑰分支）"

S=$(get "$BASE?action=sessions&t=$HOSPITAL")
expect_eq "醫院代號正確回傳" "$HOSPITAL" "$(printf '%s' "$S" | jget tenant)"

# 排序必須是 開放中 → 尚未開放 → 已結束。評核官看到的順序就是這個，排錯了
# 他第一眼會看到去年的場次。
ORDER=$(printf '%s' "$S" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
    console.log((j.sessions||[]).map(x=>x.status).join(","))})')
SORTED=$(printf '%s' "$ORDER" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const rank={open:0,future:1,past:2};
    const a=s.trim().split(",").filter(Boolean);
    console.log(a.every((v,i)=>i===0||rank[a[i-1]]<=rank[v])?"ok":"亂序:"+s.trim())})')
expect_eq "排序 開放中→尚未開放→已結束" "ok" "$SORTED"

# 一家醫院只能有一個 預設演習。這條不在後端五條健全性檢查裡 —— 它是
# resolveTenant_ 解析當下才丟 AMBIGUOUS_DEFAULT，症狀是「不帶演習代號的連結
# 整家醫院都打不開」而註冊表看起來完全正常。2026-10-08 精靈第一次試跑就踩到。
NDEF=$(printf '%s' "$S" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
    console.log((j.sessions||[]).filter(x=>x.isDefault).length)})')
expect_eq "預設演習恰好一個" "1" "$NDEF"

# 紅線檢查。CLAUDE.md 寫明這個分支完全沒有驗證、每支評核官手機都會抓它，
# 回傳裡永遠不得出現試算表 ID、金鑰、分頁名稱、檔案擁有者、列號。
# 這條規則存在很久，但「實際上沒有人在跑」—— 自動化它正是這支腳本最有價值的部分。
LEAK=$(printf '%s' "$S" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const bad=[];
    if(/[A-Za-z0-9_-]{30,}/.test(s)) bad.push("疑似試算表ID或金鑰（30+ 字元 token）");
    ["評核紀錄","設定試算表","紀錄試算表","檔案擁有者","rowNumber","registryWarning","analysisKey","@gmail.com"]
      .forEach(w=>{ if(s.includes(w)) bad.push(w); });
    console.log(bad.length?bad.join("、"):"乾淨")})')
expect_eq "回傳不含任何機密欄位" "乾淨" "$LEAK"

expect_eq "未知醫院代號硬錯誤，不退回 fallback" "NO_TENANT" \
  "$(get "$BASE?action=sessions&t=definitely-not-a-hospital" | jget errorCode)"

# 跨租戶隔離需要第二個租戶當對照組。它是測試裝置，不是系統的一部分 ——
# 業主把它從註冊表刪掉是完全合理的操作（2026-10-11 就發生了）。
# 那要回報成「沒驗到」，不是「驗失敗」：一個因為裝置不見而紅掉的測試，會讓人
# 開始忽略整份輸出，而這份輸出裡有真正重要的紅線檢查。
C=$(get "$BASE?action=sessions&t=$CLINIC")
CLINIC_ERR=$(printf '%s' "$C" | jget errorCode)
if [ "$CLINIC_ERR" = "NO_TENANT" ]; then
  skip "跨醫院隔離" "對照租戶 $CLINIC 不在註冊表裡"
else
  CROSS=$(printf '%s' "$C" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
      console.log(JSON.stringify(s).includes("萬芳")?"看得到萬芳的場次":"只看得到自己的")})')
  expect_eq "跨醫院隔離" "只看得到自己的" "$CROSS"
fi

# --------------------------------------------------------------------------
section "B. 設定分支（無金鑰，每支手機都會抓）"

D=$(get "$BASE?t=$HOSPITAL")
expect_eq "預設演習可解析（非 AMBIGUOUS_DEFAULT）" "" "$(printf '%s' "$D" | jget errorCode)"
expect_eq "tenantSource=registry" "registry" "$(printf '%s' "$D" | jget tenantSource)"

F=$(get "$BASE")
expect_eq "不帶參數仍走 fallback（已發出的舊連結不能壞）" "fallback" "$(printf '%s' "$F" | jget tenantSource)"

CFGLEAK=$(printf '%s' "$D" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const j=JSON.parse(s),bad=[];
    ["configId","recordId","recordSheet","analysisKey","registryWarning","rowNumber"]
      .forEach(k=>{ if(k in j) bad.push(k); });
    console.log(bad.length?bad.join("、"):"乾淨")})')
expect_eq "設定 payload 不含路由內部欄位" "乾淨" "$CFGLEAK"

# --------------------------------------------------------------------------
section "C. 送出閘門（這些都是「被拒絕」，不會寫入任何資料）"

mk_body() { printf '{"submissionId":"smoke-%s-%s","fillerCode":"TEST-USER","itemName":"SCENE A1","answers":[{"id":"1-1","score":3},{"id":"1-2","score":3}],"tenant":"%s","exercise":"%s"}' "$2" "$(date +%s%N)" "$1" "$2"; }

# 逐一找出目前處於各狀態的場次，而不是寫死代號 —— 寫死的話註冊表一改測試就爛。
FUTURE=$(printf '%s' "$S" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
    const f=(j.sessions||[]).find(x=>x.status==="future");console.log(f?f.exercise:"")})')
PAST=$(printf '%s' "$S" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
    const f=(j.sessions||[]).find(x=>x.status==="past");console.log(f?f.exercise:"")})')

if [ -n "$FUTURE" ]; then
  expect_eq "尚未開放的場次拒絕送出（$FUTURE）" "OUT_OF_WINDOW" \
    "$(post "$(mk_body "$HOSPITAL" "$FUTURE")" | jget errorCode)"
else
  skip "尚未開放的場次拒絕送出" "註冊表裡目前沒有 future 狀態的場次"
fi

if [ -n "$PAST" ]; then
  PR=$(post "$(mk_body "$HOSPITAL" "$PAST")" | jget errorCode)
  case "$PR" in
    OUT_OF_WINDOW|DISABLED) ok "已結束的場次拒絕送出（$PAST → $PR）";;
    *) bad "已結束的場次拒絕送出（$PAST）" "OUT_OF_WINDOW 或 DISABLED" "$PR";;
  esac
else
  skip "已結束的場次拒絕送出" "註冊表裡目前沒有 past 狀態的場次"
fi

# --------------------------------------------------------------------------
section "D. 分析端點授權"

if [ -n "$KEY_MAIN" ]; then
  # 這一條不需要第二個租戶：沒帶金鑰一律擋。
  expect_eq "無金鑰讀分析被拒" "UNAUTHORIZED"     "$(get "$BASE?action=analysis&t=$HOSPITAL" | jget errorCode)"
  if [ -n "$KEY_CLINIC" ] && [ "$CLINIC_ERR" != "NO_TENANT" ]; then
    expect_eq "分院金鑰讀不到萬芳" "UNAUTHORIZED"       "$(get "$BASE?action=analysis&t=$HOSPITAL&key=$KEY_CLINIC" | jget errorCode)"
    # 要用別家的金鑰打一個**存在**的租戶，才是在驗授權。租戶不存在時回的是
    # NO_TENANT，那只證明「查無此醫院」，跟金鑰擋不擋得住無關。
    expect_eq "萬芳金鑰讀不到分院" "UNAUTHORIZED"       "$(get "$BASE?action=analysis&t=$CLINIC&key=$KEY_MAIN" | jget errorCode)"
  else
    skip "跨租戶金鑰隔離" "對照租戶 $CLINIC 不存在，或未設定 EVAL_KEY_CLINIC"
  fi
else
  skip "分析端點授權" "未設定 EVAL_KEY_MAIN"
fi

# --------------------------------------------------------------------------
section "E. 寫入隔離（會真的寫一筆到分院的紀錄分頁）"

if [ $WITH_WRITE = 1 ]; then
  if [ -z "$KEY_MAIN" ] || [ -z "$KEY_CLINIC" ]; then
    skip "寫入隔離" "需要兩把金鑰才能驗證寫入前後的列數"
  else
    BEFORE_M=$(get "$BASE?action=analysis&t=$HOSPITAL&key=$KEY_MAIN" | jget meta.recordRowCount)
    SID="smoke-iso-$(date +%s%N)"
    BODY=$(printf '{"submissionId":"%s","fillerCode":"TEST-USER","itemName":"SCENE A1","answers":[{"id":"1-1","score":3},{"id":"1-2","score":3}],"tenant":"%s","exercise":"2026a"}' "$SID" "$CLINIC")
    R1=$(post "$BODY")
    expect_eq "寫入分院成功" "true" "$(printf '%s' "$R1" | jget ok)"
    # 同一個 submissionId 重送必須被 CacheService 去重，否則客戶端逾時重試就會
    # 產生重複列。
    R2=$(post "$BODY")
    expect_eq "冪等：重送同一個 submissionId 不再寫入" "true" "$(printf '%s' "$R2" | jget duplicate)"
    AFTER_M=$(get "$BASE?action=analysis&t=$HOSPITAL&key=$KEY_MAIN" | jget meta.recordRowCount)
    expect_eq "萬芳的紀錄完全沒被動到" "$BEFORE_M" "$AFTER_M"
  fi
else
  skip "寫入隔離" "預設關閉，要跑請加 --with-write"
fi

# --------------------------------------------------------------------------
printf '\n\033[1m結果\033[0m  通過 %d　失敗 %d　略過 %d\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ] || exit 1
