# 演習評核流程 — design reference

This is a design mockup created in a visual design tool (an appifact
design canvas), exported as a standalone page. Treat it as a REFERENCE
MOCKUP, not production code: the markup and inline styles carry the
design's precise values — colors, font sizes, spacing, radii, shadows,
layout — which an implementation should replicate faithfully in its own
components and styling system rather than copy wholesale.

## Contents

- `Start.dc.html` — the artboard (a Design Component: an `<x-dc>`
  template + a small logic class). The values to replicate live in its
  inline `style="…"` attributes and the `<helmet><style>` block.
- `support.js`, `vendor/react*.js` — the runtime that renders the
  component in a browser; not part of the design.

## Viewing

Serve the folder (e.g. `python3 -m http.server`) and open `Start.dc.html`;
some browsers block the scripts over file://.

## 設定試算表填寫說明（項目與問題）

畫面上「選擇評核項目」要出現什麼、分幾層選，全部由 `演習評核_設定` 試算表裡
的「項目與問題」工作表決定，不用改程式。這個表有兩種填法：

### 單層（例如目前 10/3 案例，只有 SCENE 項目）

標頭用 `項目名稱`、`問題ID`、`問題內容` 三欄，同一個項目名稱重複幾列就是幾個
問題：

| 項目名稱 | 問題ID | 問題內容 |
|---|---|---|
| SCENE 範例一 | Q1 | 問題內容一 |
| SCENE 範例一 | Q2 | 問題內容二 |
| SCENE 範例二 | Q1 | 問題內容一 |

使用者畫面上會直接看到「範例一」「範例二」兩個按鈕（畫面會自動去掉 `SCENE `
前綴），點下去就直接進評分標準／問卷，沒有中間分層。

### 多層（例如階段→情境兩層）

把 `項目名稱` 換成 `層1`、`層2`（層數不限，要幾層就加幾欄「層N」，N 從 1 開始
連續編號），最後一欄一樣接 `問題ID`、`問題內容`：

| 層1 | 層2 | 問題ID | 問題內容 |
|---|---|---|---|
| 階段一 | 情境甲 | Q1 | 問題內容一 |
| 階段一 | 情境甲 | Q2 | 問題內容二 |
| 階段一 | 情境乙 | Q1 | 問題內容一 |
| 階段二 | 情境丙 | Q1 | 問題內容一 |

使用者畫面上會先看到「階段一」「階段二」兩個按鈕（層1），點進去才看到該階段
底下的情境（層2），點到情境才真正進評分標準／問卷。要加第三層（例如 階段→
情境→子情境）就再多加一欄 `層3`，程式會自動判斷層數，畫面也會自動長出對應的
選擇畫面，不用改 `Start.dc.html` 或 `.gs` 檔。

### 填寫時的注意事項

- 同一列裡，`層1`、`層2`… 由左到右不能中間空白後又填值（例如層1有值、層2留
  空、卻在下一列又對同一個層1值填了層2）——空白的那一層當作「到這裡就是最底
  層」，之後的問題會被歸到那一層底下。
- 每個「層N」欄位裡的名稱，同一層之間可以重複出現在不同分組下（例如兩個階段
  底下都各有一個叫「情境1」的項目），但**同一個分組底下不要有重複的名稱**，
  否則會被視為同一個項目、問題會合併在一起。
- 改這張表不需要重新部署 Apps Script，`doGet` 每次都會重新讀取試算表最新內
  容；但如果連 `.gs` 程式檔本身也改了，才需要照 `CLAUDE.md` 裡的步驟重新部署。

## 設定試算表填寫說明（對應指標，給分析頁 `Analysis.html` 用）

設定試算表（`CONFIG_SPREADSHEET_ID` 那份）裡的「對應指標」工作表，除了原本寫
入 `評核紀錄`「指標代號」用的三欄，`Analysis.html` 還需要多兩欄才能畫潛能雷
達圖和 4S 長條圖。這張表屬於設定資料（定義每題的潛能/4S/指標對應），不是送
出後才產生的紀錄，所以放在設定試算表，不是紀錄試算表：

| 問題ID | 問題 | 問題所屬指標 | 評核潛能 | 4S 元素 |
|---|---|---|---|---|
| 1-1 | 透過預先規劃策略…達到何種層級？ | 預期6 (預先規劃策略) | 預期 | Space (空間) |
| 1-2 | 急救站內外通訊手段…順暢性為何？ | 回應11 (溝通工具) | 回應 | Stuff (物資) |

- `評核潛能` 欄目前只認得三個會進雷達圖/4S 分析的值：`回應`、`監測`、`預期`；
  填 `學習` 的題目會被分析頁整個排除；欄位裡含有「覆蓋率」字樣（例如
  `演習覆蓋率`）的題目會被歸到「覆蓋率」分頁，不混進三項潛能統計。
- `4S 元素` 是自由文字，分析頁會依實際出現過的文字動態分組（不是寫死
  `Space (空間)`/`Staff (人員)`/`Stuff (物資)`/`System (系統)` 這四個字串），
  但同一個 4S 類別要用完全一致的文字，否則會被當成不同類別。
- 這兩欄缺漏或欄名打錯，`doGet?action=analysis` 會直接回錯誤訊息，不會生出
  半殘的圖表；出錯時先檢查這張表的標頭列文字是否跟上面完全一致。
