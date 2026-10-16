# Local Markdown PDF

在 VS Code 本機將 Markdown 匯出成 PDF，先預覽實際結果，確認後再選擇檔名與儲存位置。

[English](README.md) · [開發說明](CONTRIBUTING.md) · [驗收清單](ACCEPTANCE.md)

## 使用畫面

在 Markdown 編輯器內按右鍵，選擇 **Markdown: Export to PDF**。

![Markdown 編輯器的右鍵匯出指令](docs/images/context-menu.png)

確認 PDF 預覽後，按 **Confirm and Export**，再選擇檔名與資料夾。

![Markdown 原始碼與 PDF 預覽並排顯示](docs/images/pdf-preview.png)

截圖使用 VS Code 的 **Quiet Light** 主題，並關閉 Chat。PDF 使用獨立樣式，不受編輯器主題影響。

## 功能

- 匯出編輯器目前內容，包含尚未儲存的修改；儲存的 PDF 與預覽完全相同。
- 程式碼配色可選 **One Light**（預設）或 **GitHub Dark**。
- 支援表格、本機圖片、KaTeX 公式、Mermaid 流程圖與 GitHub 提示區塊。
- 內附字型，支援英文、繁體中文與中英混排。
- A4、頁碼、程式碼長行換行、跨頁表格重複表頭。
- 內附 Chromium，不需另外安裝 Chrome，也不會在第一次匯出時下載元件。

## 平台狀態

| 平台                            | VSIX 檔名後綴  | 驗證狀態               |
| ------------------------------- | -------------- | ---------------------- |
| macOS Apple Silicon             | `darwin-arm64` | 本機轉檔與預覽測試通過 |
| macOS Intel                     | `darwin-x64`   | 待實機驗證             |
| Windows 11 x64                  | `win32-x64`    | 待實機驗證             |
| Ubuntu 22.04 / 24.04 桌面版 x64 | `linux-x64`    | 待實機驗證             |

已提供跨平台建置流程，但不代表所有平台已完成驗收。Windows ARM、其他 Linux 發行版、VS Code 網頁版與遠端工作區不在已驗證範圍。

**Ubuntu 需要事先安裝 Chromium 系統函式庫**，VSIX 不包含這些作業系統元件。乾淨或最小安裝的 Ubuntu 可能需要管理員設定；請在斷網前依開發說明完成準備。

## 從原始碼建置並安裝

先安裝 **Git**、**Node.js 24（含 npm）** 與 **VS Code 1.95 以上版本**。請在實際使用擴充套件的作業系統與架構上建置。下載開發依賴與 Chromium 時需要網路，完成後匯出會在本機執行。

### 1. Clone 專案並安裝依賴

從 GitHub 頁面的 **Code** 選單複製 HTTPS 網址，替換下方的 `<REPOSITORY_URL>`。指令會把專案下載到 `md_to_pdf` 資料夾，因此不受 GitHub 儲存庫名稱影響。

```sh
git clone "<REPOSITORY_URL>" md_to_pdf
cd md_to_pdf
npm ci
npm run prepare:browser
```

### 2. 準備 Ubuntu 系統函式庫（僅 Ubuntu）

macOS 與 Windows 請跳過此步驟。Ubuntu 請在打包前執行，過程可能需要管理員權限：

```sh
node node_modules/playwright-core/cli.js install-deps chromium
```

若將 VSIX 安裝到另一台 Ubuntu，那台電腦也須在斷網前先備妥系統函式庫。

### 3. 建置 VSIX 安裝包

```sh
npm run package
```

這個指令會自動建置程式、打包本機資源、檢查 Chromium 能否啟動，並在專案根目錄產生 VSIX。**不必另外執行 `npm run build`**；單獨執行 build 只會產生建置檔案，不會產生可安裝的 VSIX。

| 建置平台            | 產生的檔案                             |
| ------------------- | -------------------------------------- |
| macOS Apple Silicon | `local-markdown-pdf-darwin-arm64.vsix` |
| macOS Intel         | `local-markdown-pdf-darwin-x64.vsix`   |
| Windows x64         | `local-markdown-pdf-win32-x64.vsix`    |
| Ubuntu x64          | `local-markdown-pdf-linux-x64.vsix`    |

### 4. 安裝到 VS Code

1. 開啟 VS Code，macOS 按 **Cmd+Shift+P**，Windows／Linux 按 **Ctrl+Shift+P**。
2. 執行 **Extensions: Install from VSIX…**。
3. 選取專案資料夾內剛產生的 `.vsix` 檔案。
4. 若 VS Code 提示重新載入視窗，請依提示操作。
5. 開啟 `fixtures/quick-start.md`，在編輯器內按右鍵 → **Markdown: Export to PDF**，即可試用預覽與匯出。

如果終端機已可使用 `code` 指令，也能直接安裝。例如 Apple Silicon Mac：

```sh
code --install-extension ./local-markdown-pdf-darwin-arm64.vsix
```

其他平台請換成表格中對應的檔名。若找不到 `code` 指令，使用上面的 VS Code 選單方式即可。之後修改原始碼時，重新執行 `npm run package`，再安裝新產生的 VSIX。

## 安裝與操作

1. 取得對應平台的 VSIX，或依上方步驟自行建置。目前尚未上架 Marketplace。
2. 在 VS Code 執行 **Extensions: Install from VSIX…**，選取安裝包。
3. 開啟本機 `.md` 檔案。未儲存修改會納入匯出；尚未命名的新文件須先儲存，以解析相對圖片路徑。
4. 編輯器內按右鍵 → **Markdown: Export to PDF**；命令面板也可使用。
5. 若有內容問題，可取消修正，或選 **Continue with Placeholders**，讓 PDF 保留錯誤提示。來源位置會顯示在 Problems 面板。
6. 檢查預覽並按 **Confirm and Export**。
7. 選擇檔名與資料夾。預設使用來源資料夾與同名 `.pdf`；選到既有檔案時由系統詢問是否取代。
8. 完成後按 **Open PDF**，以預設程式開啟。

取消預覽或儲存對話框都不會修改既有 PDF。預覽會隨捲動載入頁面。介面為英文，系統對話框語言依作業系統與 VS Code 設定。

## 外觀與語法

在設定搜尋 `localMarkdownPdf.codeTheme`，選擇 `one-light` 或 `github-dark`。深色配色只套用於程式碼區塊，文件仍為白底；下次產生預覽時生效。未知程式語言以純文字顯示。

- 頁邊距：上 **22 mm**、下 **24 mm**、左右各 **18 mm**。
- 行內程式碼：接近黑色的深藍字＋淺灰底。
- 程式碼內距：上下 14 px、左右 16 px。
- 表格儲存格內距：上下 8 px、左右 9 px。

支援一般 Markdown 語法；公式使用 `$…$`／`$$…$$`，流程圖使用 `mermaid` 程式碼區塊。

```markdown
> [!NOTE]
> 補充說明，可以包含 **粗體** 與 `行內程式碼`。

> [!IMPORTANT]
> 請先檢查預覽，再確認匯出。
```

支援 `NOTE`、`TIP`、`IMPORTANT`、`WARNING`、`CAUTION`；標記須獨占最外層引用區塊的第一行。巢狀或未知標記保留一般引用樣式。`fixtures/` 提供完整範例與邊界案例。

![PDF 預覽中的 Mermaid 流程圖、表格與公式](docs/images/pdf-features.png)

## 離線與限制

VSIX 包含 Chromium、PDF.js、Shiki、KaTeX、Mermaid、樣式與字型。渲染器阻擋外部請求與文件任意腳本；內嵌 HTML 僅接受少量無屬性的文字標籤。

- 圖片支援 PNG、JPEG、GIF、WebP，以 Markdown 所在目錄解析相對路徑。遠端圖片須自行下載並修改引用；SVG 圖檔須先轉成 PNG，Mermaid 產生的 SVG 則可使用。
- 圖片缺失、公式或流程圖錯誤，僅在選擇繼續時留下可辨識提示。部分來源位置只能定位到區塊起始行。
- 超大型流程圖、過寬公式、過高表格列、罕見字與 emoji 仍需檢查。
- PDF 閱讀器複製已換行的 Bash 指令時，可能加入換行字元，執行前請確認。
- 修改來源後須重新產生預覽；首次啟動 Chromium 可能需要數秒。

## 開發與授權

安裝依賴、格式化、測試、截圖重拍及各平台打包方式見 [CONTRIBUTING.md](CONTRIBUTING.md)。GitHub Actions 的 **Package** 工作流程會上傳 VSIX 與範例 PDF，並不會自動發佈 Release 或 Marketplace。

採用 [MIT 授權](LICENSE)；字型保留 OFL 授權，建置產物包含第三方授權聲明。
