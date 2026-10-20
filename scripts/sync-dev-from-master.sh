#!/usr/bin/env bash
# 把 master 的改動帶進 dev，並確保 dev 仍然指向沙箱。
#
# 為什麼需要這支：dev 曾經卡在 4782edf 六天、落後 20 個 commit，因為每次改動都
# 直接進 master。要讓 dev 跟上，每次都得重做同一套（merge -> 換常數 -> 驗一輪），
# 而那正是人會漏掉的那種工作。漏掉的後果不是編譯錯誤，是測試站靜靜地對著業主的
# 正式試算表讀寫 —— 2026-10-14 已經真的發生過一次。
#
# ⚠️ 這支的第一版有一個會重現那次事故的設計錯誤，對抗式審查抓到並在 clone 裡完整
#    重現：它先讓 git 建立 merge commit、之後才改常數，所以 dev 的 commit 裡是正式
#    值，沙箱修正只在未提交的工作目錄。任何丟掉工作目錄的動作（git restore、IDE
#    revert、關掉視窗）都會留下一個指著醫院正式試算表、而且 git status 乾淨的
#    可推送 tip。
#    現在改成 **--no-commit --no-ff -> 釘常數 -> 驗證 -> 全綠才 commit**：
#    在驗證通過之前，沒有任何東西被提交。失敗就原地停住，`git merge --abort`
#    一句話全部撤銷。
#
# 用法：
#   bash scripts/sync-dev-from-master.sh            # 合併 + 釘常數 + 驗證 + commit
#   bash scripts/sync-dev-from-master.sh --dry-run  # 只驗證磁碟上的內容，不動任何東西
#
# 它永遠不會 push。

set -uo pipefail

# ---- 參數：不認得的一律拒絕 -----------------------------------------------
# 審查實測：原本只比對 $1 是否剛好等於 --dry-run，所以 --dry／--dryrun／-n 都會
# 靜靜地跑成「真的合併並改檔」。一個安全旗標打錯字就選到破壞性模式，不可接受。
DRY=0
case "${1:-}" in
  '')         ;;
  --dry-run)  DRY=1 ;;
  -h|--help)  sed -n '1,30p' "$0"; exit 0 ;;
  *)          printf '不認得的參數：%s\n用法：%s [--dry-run]\n' "$1" "$0" >&2; exit 2 ;;
esac
if [ "$#" -gt 1 ]; then
  printf '這支不接受第二個參數（收到 %s 個）。用法：%s [--dry-run]\n' "$#" "$0" >&2; exit 2
fi

cd "$(git rev-parse --show-toplevel)" || exit 2

say(){ printf '%s\n' "$*"; }
ok(){  printf '  OK      %s\n' "$*"; }
bad(){ printf '  [!]     %s\n' "$*"; FAIL=1; }
note(){ printf '  note    %s\n' "$*"; }
FAIL=0
EXCL=':(exclude).idea'
SQ="'"

# ---- dev 必須是的樣子（這支腳本是「dev 該長怎樣」的唯一真相來源）----------
# 這些值在 dev 的檔案裡本來就是公開的，repo 也是 public，寫在這裡不增加曝光；
# 而 scripts/ 被 .vercelignore 擋著，網站不會送出這支檔案。
SB_CONFIG_URL='https://script.google.com/macros/s/AKfycbxuIddvtDOkaqDw7Hua07VnekLO85W6_u47UZzVVfl0ngSen_ps4-V4rHVVLX1jddwP8A/exec'
SB_RECORD_URL='https://script.google.com/macros/s/AKfycbzQLAJCv3-lMgWeJ6k0zDYdqkepMiycTivwksmuqbkXUZngHSZmtWGh8c9DDs5ykytX/exec'
SB_REPORT_URL='https://script.google.com/macros/s/AKfycbwEeMUSu5W1rXKTpD-9K9bklv3oXkN-Sz6N8vbUuq2l6rq70rmZfDbRtoxMzbI34z_jrg/exec'
SB_CONFIG_SS='1yiZDnbEFNHddzlTMWaz-bBgI0IvRWXMJ0H3WplyPJDk'
SB_RECORD_SS='1jD6DXmPgTV9664XoIveD_cqNQd9V8vq6aM7EtMoI6FM'
SB_REGISTRY_SS='1oab1W2UFo71qeZ-fEz_cYtE__3dNFw_OG_7TzrUZdfk'
# ANALYSIS_KEY 也要釘。dev 與 master 目前共用同一把（CLAUDE.md 說那本身就是問題），
# 所以「兩邊一致」這件事不能當檢查 —— master 一旦輪替，merge 會把新金鑰靜靜帶進
# dev 並通過「前後端一致」。釘住目前這把，輪替就會變成一個看得見的失敗。
SB_ANALYSIS_KEY='WrHSeTn1bkVtD2C9QriISkCy2Q_I8Jub'

# 沙箱允許出現的 /exec 部署 id。白名單比黑名單耐久：黑名單只認得「今天的正式值」，
# 正式環境換過一次網址，名單就過期而腳本照樣報綠（smoke.sh 的 guard_production
# 已經是這樣壞掉的，見 CLAUDE.md）。
SB_EXEC_IDS="AKfycbxuIddv AKfycbzQLAJC AKfycbwEeMUS"

# 網站會送出的檔案 + 兩支要貼進 Apps Script 的後端。
CODE_FILES="Start.dc.html Analysis.html support.js apps-script/Config.gs apps-script/ConfigWithSubmit.gs"

# ---- 0. 前置檢查 ----------------------------------------------------------
say "== 0. 前置檢查 =="
if ! BR=$(git symbolic-ref --quiet --short HEAD); then
  say "  [!] HEAD 不在任何分支上（detached）。先 git switch dev。"; exit 2
fi
if [ "$BR" != "dev" ]; then
  say "  [!] 目前在 ${BR}，這支只能在 dev 上跑。先 git switch dev。"; exit 2
fi
ok "分支 = dev"

# 合併進行中：上一輪停在衝突。此時不能再 merge，也不能把它當成一般的髒目錄。
if [ -e .git/MERGE_HEAD ]; then
  say "  [!] 有一個尚未完成的 merge。先二選一："
  say "        解決衝突後  git add <檔> && git commit     （然後重跑本腳本驗證）"
  say "        或整個撤銷  git merge --abort"
  exit 2
fi

# 髒工作目錄只在「會寫檔」的模式下是問題：merge 會拒絕覆蓋未提交的檔案。
# --dry-run 不 merge 也不改檔，而且「改到一半想先檢查」正是它的用途。
DIRTY=$(git status --porcelain -- . "$EXCL" | head -10)
if [ -n "$DIRTY" ]; then
  if [ "$DRY" = "1" ]; then
    note "工作目錄有未提交的變更（dry-run 驗的是磁碟上的內容，不受影響）："
    printf '%s\n' "$DIRTY" | sed 's/^/            /'
  else
    say "  [!] 工作目錄有未提交的變更，先 commit 或 stash："; printf '%s\n' "$DIRTY"; exit 2
  fi
else
  ok "工作目錄乾淨（.idea 除外）"
fi

if [ "$DRY" != "1" ]; then
  # .idea 被上面的守衛刻意排除，但它是被追蹤的、master 也提交過它（b6bb992）。
  # 它一髒，git merge 會整個拒絕執行 —— 而那不是衝突。先擋在這裡講清楚。
  IDIRTY=$(git status --porcelain -- .idea | grep -v '^??' | head -5)
  if [ -n "$IDIRTY" ]; then
    say "  [!] 被追蹤的 .idea 檔有未提交的變更，git merge 會拒絕執行（不是衝突）："
    printf '%s\n' "$IDIRTY" | sed 's/^/            /'
    say "        處理：git checkout -- .idea   （丟掉 IDE 狀態，不影響程式）"
    exit 2
  fi
fi

if ! git fetch -q origin 2>.gitfetch.err; then
  say "  [!] git fetch 失敗："; sed 's/^/            /' .gitfetch.err; rm -f .gitfetch.err; exit 2
fi
rm -f .gitfetch.err
if ! git rev-parse --verify --quiet origin/master >/dev/null; then
  say "  [!] 找不到 origin/master。遠端名稱或分支名可能不同。"; exit 2
fi
if ! BEHIND=$(git rev-list --count dev..origin/master 2>/dev/null); then
  say "  [!] 無法計算與 origin/master 的距離。"; exit 2
fi
ok "dev 落後 origin/master ${BEHIND} 個 commit"

# ---- 1. 合併（不提交）-----------------------------------------------------
MERGED=0
if [ "$DRY" = "1" ]; then
  say ""; say "== 1. --dry-run：跳過 merge 與改寫，只驗證目前的 dev =="
elif [ "$BEHIND" = "0" ]; then
  say ""; say "== 1. dev 已是最新，不需要 merge（仍會往下驗證）=="
else
  say ""; say "== 1. 合併 origin/master（--no-commit：驗過才提交）=="
  if git merge --no-commit --no-ff origin/master >/dev/null 2>.gitmerge.err; then
    MERGED=1
    ok "合併完成且已暫存，尚未提交"
  else
    CONFLICTS=$(git diff --name-only --diff-filter=U)
    if [ -n "$CONFLICTS" ]; then
      say "  衝突檔案："; printf '%s\n' "$CONFLICTS" | sed 's/^/    /'
      say ""
      say "  這個 repo 最常衝突的是 CLAUDE.md —— master 幾乎每個 commit 都動它，而 dev"
      say "  在 Branch state 那一段有自己的大段落。其次是四個程式檔頂端的註解區塊。"
      say "  真的衝到環境常數那幾行時，意思是 master 換了部署網址或試算表 —— 那是"
      say "  最該停下來看一眼的情況，而且常數一律留 dev 的沙箱值。"
      say ""
      say "  解決後：git add <檔> && git commit，然後重跑本腳本做驗證。"
      say "  想整個撤銷：git merge --abort"
    else
      say "  [!] git merge 失敗，而且沒有任何衝突檔案 —— 這不是衝突，是 git 拒絕執行："
      sed 's/^/            /' .gitmerge.err
      say ""
      say "  （常見原因：有未提交的檔案會被覆蓋、索引鎖住、或遠端狀態異常。"
      say "    上面那段 git 的原文才是真正的原因。）"
    fi
    rm -f .gitmerge.err
    exit 1
  fi
fi
rm -f .gitmerge.err

# ---- 2. 把常數釘回沙箱值 ---------------------------------------------------
# 即使合併沒衝突也要做：master 若在別處動到這些行，git 會安靜地採用它的版本。
# grep 一律用 ^ 錨定：審查實測，不錨定的 grep 會讀到註解裡的那一行，而 sed 只改
# 第 0 欄，兩半讀到不同的行 -> 腳本報成功、檔案其實是正式值。
pin(){ # pin <file> <const-prefix> <value>
  local f="$1" pre="$2" val="$3" cur now n
  n=$(grep -c -E "^${pre}" "$f")
  if [ "$n" != "1" ]; then bad "在 ${f} 找到 ${n} 行 ^${pre}（預期剛好 1 行）"; return 1; fi
  cur=$(grep -E "^${pre}" "$f" | head -1 | cut -d"$SQ" -f2)
  if [ "$cur" = "$val" ]; then ok "已是沙箱值  ${pre}"; return 0; fi
  sed -i "s|^${pre}${SQ}[^${SQ}]*${SQ}|${pre}${SQ}${val}${SQ}|" "$f" || { bad "sed 失敗 ${pre} (${f})"; return 1; }
  now=$(grep -E "^${pre}" "$f" | head -1 | cut -d"$SQ" -f2)
  if [ "$now" = "$val" ]; then say "  已改回  ${pre}(${f})"; else bad "改寫後仍不符 ${pre} (${f})"; fi
}

if [ "$DRY" != "1" ]; then
  say ""; say "== 2. 釘回沙箱常數 =="
  pin Start.dc.html                   "const CONFIG_URL = "            "$SB_CONFIG_URL"
  pin Start.dc.html                   "const RECORD_URL = "            "$SB_RECORD_URL"
  pin Analysis.html                   "const RECORD_URL = "            "$SB_RECORD_URL"
  pin Analysis.html                   "const REPORT_URL = "            "$SB_REPORT_URL"
  pin Analysis.html                   "const ANALYSIS_KEY = "          "$SB_ANALYSIS_KEY"
  pin apps-script/ConfigWithSubmit.gs "var CONFIG_SPREADSHEET_ID = "   "$SB_CONFIG_SS"
  pin apps-script/ConfigWithSubmit.gs "var RECORD_SPREADSHEET_ID = "   "$SB_RECORD_SS"
  pin apps-script/ConfigWithSubmit.gs "var REGISTRY_SPREADSHEET_ID = " "$SB_REGISTRY_SS"
  pin apps-script/ConfigWithSubmit.gs "var ANALYSIS_KEY = "            "$SB_ANALYSIS_KEY"
  pin apps-script/Config.gs           "var CONFIG_SPREADSHEET_ID = "   "$SB_CONFIG_SS"
fi

# ---- 3. 驗證 --------------------------------------------------------------
say ""; say "== 3. 驗證 =="
chk(){ # chk <file> <const-prefix> <expected>
  local got n
  n=$(grep -c -E "^$2" "$1")
  if [ "$n" != "1" ]; then bad "$2(${1}) 有 ${n} 行，預期 1 行"; return; fi
  got=$(grep -E "^$2" "$1" | head -1 | cut -d"$SQ" -f2)
  if [ "$got" = "$3" ]; then ok "$2(${1})"; else bad "$2(${1}) 不是沙箱值"; fi
}
chk Start.dc.html                   "const CONFIG_URL = "            "$SB_CONFIG_URL"
chk Start.dc.html                   "const RECORD_URL = "            "$SB_RECORD_URL"
chk Analysis.html                   "const RECORD_URL = "            "$SB_RECORD_URL"
chk Analysis.html                   "const REPORT_URL = "            "$SB_REPORT_URL"
chk Analysis.html                   "const ANALYSIS_KEY = "          "$SB_ANALYSIS_KEY"
chk apps-script/ConfigWithSubmit.gs "var CONFIG_SPREADSHEET_ID = "   "$SB_CONFIG_SS"
chk apps-script/ConfigWithSubmit.gs "var RECORD_SPREADSHEET_ID = "   "$SB_RECORD_SS"
chk apps-script/ConfigWithSubmit.gs "var REGISTRY_SPREADSHEET_ID = " "$SB_REGISTRY_SS"
chk apps-script/ConfigWithSubmit.gs "var ANALYSIS_KEY = "            "$SB_ANALYSIS_KEY"
chk apps-script/Config.gs           "var CONFIG_SPREADSHEET_ID = "   "$SB_CONFIG_SS"

# 比值，不比整行：行尾若多一段 // 註解，比整行會報出不存在的後端不一致。
V1=$(grep -E "^const RECORD_URL = " Start.dc.html | head -1 | cut -d"$SQ" -f2)
V2=$(grep -E "^const RECORD_URL = " Analysis.html | head -1 | cut -d"$SQ" -f2)
if [ "$V1" = "$V2" ]; then ok "兩頁 RECORD_URL 一致"; else bad "兩頁 RECORD_URL 不一致（儀表板與評核單會讀到不同後端）"; fi
A=$(grep -E "^var CONFIG_SPREADSHEET_ID = " apps-script/ConfigWithSubmit.gs | head -1 | cut -d"$SQ" -f2)
B=$(grep -E "^var CONFIG_SPREADSHEET_ID = " apps-script/Config.gs | head -1 | cut -d"$SQ" -f2)
if [ "$A" = "$B" ]; then ok "兩支後端設定表一致"; else bad "兩支後端設定表不一致"; fi

# 衝突標記：dry-run 容忍髒目錄，而 chk 的 head -1 會讀到衝突區塊的第一半
# （merge 時那是 dev 自己的值），所以每個常數都會通過，檔案其實不能用。
MARK=$(grep -l -E "^(<<<<<<<|>>>>>>>) " $CODE_FILES CLAUDE.md 2>/dev/null | tr '\n' ' ')
if [ -n "$MARK" ]; then bad "檔案裡有未解決的衝突標記：${MARK}"; else ok "沒有未解決的衝突標記"; fi

# 白名單：網站與後端檔案裡出現的每一個 /exec 部署 id 都必須是沙箱那三個之一。
# 這一條才擋得住「master 新增了第四個部署」這種黑名單永遠追不上的情況。
say ""; say "  -- /exec 部署白名單 --"
STRAY=$(grep -oh -E "AKfycb[A-Za-z0-9_-]+" $CODE_FILES 2>/dev/null | cut -c1-12 | sort -u \
        | while read -r id; do case " $SB_EXEC_IDS " in *" $id "*) ;; *) echo "$id";; esac; done)
if [ -n "$STRAY" ]; then
  bad "出現了不在沙箱白名單裡的部署 id："
  printf '%s\n' "$STRAY" | sed 's/^/            /'
else
  ok "只出現沙箱的 /exec 部署"
fi

# 黑名單：掃全部被追蹤的文字檔（不只程式檔），今天已知的正式值一個都不該在 dev 上。
say ""; say "  -- 已知正式值殘留（全部追蹤檔案）--"
PROD_PATTERNS="AKfycbxtcCix AKfycbzA5pE8 AKfycby3amN8 1j3UCbdSKe 11HeRKAHkV 1ZiluDuw7m"
HIT=0
for v in $PROD_PATTERNS; do
  F=$(git grep -l -F "$v" -- . ":(exclude)scripts/sync-dev-from-master.sh" ":(exclude)CLAUDE.md" ":(exclude)docs" 2>/dev/null | tr '\n' ' ')
  if [ -n "$F" ]; then bad "正式值 ${v} 出現在：${F}"; HIT=1; fi
done
if [ "$HIT" = "0" ]; then ok "零正式值殘留（本腳本、CLAUDE.md、docs/ 除外 —— 它們是刻意記錄用的）"; fi

# ---- 4. 只能偵測、無法自動修的部分 ----------------------------------------
say ""; say "== 4. 需要人看的（腳本不自動改文字）=="
STALE=$(grep -l "正式分支（master）" $CODE_FILES 2>/dev/null | tr '\n' ' ')
if [ -n "$STALE" ]; then
  bad "註解仍寫著「正式分支（master）」：${STALE}"
  say "          描述錯分支的註解比沒有註解更糟 —— 它會被當成確認。"
  say "          （master 的註解永遠是這樣寫的，所以每次 merge 都會再觸發一次。）"
else
  ok "程式檔註解沒有殘留的 master 字樣"
fi
# 這一條只警告、不計入 FAIL：它比對的是一句會被改寫的句子，而文件措辭變動
# 不該擋住一次正確的同步。
if grep -q "dev" <(sed -n '/^### Branch state/,/^|/p' CLAUDE.md) 2>/dev/null; then
  ok "CLAUDE.md 的 Branch state 段落有提到 dev"
else
  note "CLAUDE.md 的 Branch state 段落沒提到 dev —— 它會讓人以為正式值表對 dev 也成立。"
  note "（僅提醒，不中止。）"
fi

# ---- 收尾 ------------------------------------------------------------------
say ""
if [ "$FAIL" != "0" ]; then
  say "== 有項目未通過。沒有提交任何東西。 =="
  if [ "$MERGED" = "1" ]; then
    say "   合併已暫存但**未提交**，常數也已改回沙箱值（都還在工作目錄）。"
    say "   修好上面的項目後：git add -A -- . '${EXCL}' && git commit"
    say "   想整個撤銷這次合併：git merge --abort"
  elif [ "$DRY" != "1" ]; then
    say "   常數可能已被改回沙箱值（未提交）。git status 可看，git checkout -- . 可還原。"
  fi
  exit 1
fi
if [ "$DRY" = "1" ]; then
  say "== dry-run 通過：磁碟上的 dev 是正確的沙箱狀態。 =="; exit 0
fi

CHANGED=$(git status --porcelain -- . "$EXCL" | wc -l | tr -d ' ')
if [ "$MERGED" = "1" ] || [ "$CHANGED" != "0" ]; then
  git add -A -- . "$EXCL" || { say "  [!] git add 失敗"; exit 1; }
  if git diff --cached --quiet && [ "$MERGED" != "1" ]; then
    say "== 全部通過，且沒有任何改動需要提交。 =="
    exit 0
  fi
  git commit -q -m "Sync dev with master, keeping the sandbox constants

由 scripts/sync-dev-from-master.sh 產生。合併 origin/master 之後，把環境常數
釘回沙箱值，並通過全部驗證才提交 —— 在驗證通過之前沒有任何東西被提交，所以
dev 的任何一個 commit 都不會帶著正式試算表 ID。" || { say "  [!] git commit 失敗"; exit 1; }
  say "== 全部通過，已提交： =="
  git log --oneline -1 | sed 's/^/   /'
  say ""
  say "   接著：git push origin dev   （這會部署測試站）"
else
  say "== 全部通過，且不需要任何改動。 =="
fi
exit 0
