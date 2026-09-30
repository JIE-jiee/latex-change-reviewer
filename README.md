# LaTeX Change Reviewer — VS Code 的 LaTeX 审阅插件

**在 VS Code 里，一条一条看清修订，再点击接受或拒绝。**

LaTeX Change Reviewer 是一个 **VS Code 插件**，帮助你更方便地审阅 LaTeX 文档中的文本修改。如果你或合作者使用 `\added`、`\deleted`、`\replaced` 标记新增、删除和替换，它可以把这些标记变成可点击的审阅操作。

你可以先对照新旧文字，再决定是否保留修改。点击后，插件会直接更新 .tex 源码，默认带你进入下一条修订。整个过程都在熟悉的 VS Code 编辑器中完成。

## 它怎样帮助你审阅

- **用鼠标逐条决定。** 修订上方显示“接受｜拒绝｜下一条”，底部还有固定操作条，不必反复寻找按钮。
- **看清正在审阅什么。** 当前修订带有箭头和边框，新旧文本以不同底色区分，悬停可查看说明；底部显示当前序号与剩余数量。
- **连贯地检查修改。** 接受或拒绝后自动进入下一条，也可以随时回到上一条。到文件末尾时停止，不会自动绕回开头。
- **点错可以撤销。** 每次决定都能单独用 Ctrl+Z 恢复。插件保留原有换行和空格，不会自动排版或保存文档。
- **按你的习惯使用。** 支持简体中文、English、日本語，可随时开启或关闭审阅，也可以使用辅助快捷键。

插件在本地工作，不会上传文稿。不需要账号、LaTeX Workshop 或 TeX 编译环境。免费使用，采用 [MIT 许可](LICENSE)。

![逐条审阅与当前修订高亮](media/screenshots/review.jpg)

**同一行有多处修订时怎么看按钮？** 插件会在每组按钮前显示 `[1]`、`[2]` 等编号，按这一条源码行中修订出现的先后顺序区分目标。例如，`[1] 接受` 处理第一处修订，`[2] 拒绝` 处理第二处修订；编号相同的“下一条”从对应修订向后导航。即使光标在别处，点击按钮仍处理它对应的修订。文字因窗口宽度自动折成多行，仍属于同一条源码行。这里的编号只用于当前行，处理修订后会重新排列，不是全文修订序号，也不会写入文稿。

## 安装后，三步开始

适用于 Windows 桌面版 **VS Code 1.85.2 或更高版本**。直接安装插件不需要 Node.js。

1. 从 [版本下载页](https://github.com/JIE-jiee/latex-change-reviewer/releases/latest) 下载 .vsix 安装包。在 VS Code 中按 Ctrl+Shift+P，运行 **Extensions: Install from VSIX… / 扩展：从 VSIX 安装**，选择下载的文件。
2. 打开要审阅的 .tex 文件，点击编辑器右上角的**清单图标**，或左下角的**“审阅：已关闭”**，开启审阅。
3. 阅读当前修订的新旧文字，点击**接受**或**拒绝**，然后继续检查下一条。修订上方的按钮和底部固定操作条都可以使用。

再次点击清单图标或左下角的审阅开关即可关闭。开关状态会在当前工作区记住。关闭审阅只隐藏插件界面，不改变文稿。

你仍然可以照常编辑和保存文件。若 VS Code 本身开启了自动保存，保存行为仍由它的设置决定。需要撤销时按 Ctrl+Z；Windows 下可用 Ctrl+Y 重做。

插件尚未上架 VS Code 扩展市场，当前请从公开的 GitHub 版本页下载安装包。使用过程中遇到问题，可在 [问题反馈](https://github.com/JIE-jiee/latex-change-reviewer/issues) 中说明现象，并附上不含隐私内容的最小示例。

## 接受与拒绝会得到什么

插件使用 changes 宏包的标准顺序：**替换命令的新文本在前，旧文本在后。**

| 文档中的修订 | 点击接受 | 点击拒绝 |
|---|---|---|
| `\replaced{新文本}{旧文本}` | 保留新文本 | 恢复旧文本 |
| `\added{新增文本}` | 保留新增文本 | 移除这段新增内容 |
| `\deleted{旧文本}` | 删除旧文本 | 恢复旧文本 |

例如，文档里写着：

~~~latex
实验结果\replaced{显著提高}{略有提高}。
~~~

点击**接受**，得到“实验结果显著提高。”；点击**拒绝**，得到“实验结果略有提高。”。修改会真正写入编辑器中的源码，随后由你决定是否保存。

![接受一条修订后，自动进入下一条](media/screenshots/after-accept.jpg)

多行文字、公式和引用也可以一起审阅。插件精确保留所选文字的原始换行、缩进和空格，所以处理后可能仍有原来参数中的空行。

## 切换语言与调整操作方式

在命令面板搜索 **LaTeX Review**（菜单名称跟随 VS Code 显示语言），运行 **Select Interface Language / 选择界面语言**，选择简体中文、English、日本語或跟随 VS Code。

按钮、底部操作条和提示会立即切换；命令面板、右键菜单和设置说明跟随 VS Code 本身的显示语言。文稿内容不会被翻译。

在 VS Code 设置中搜索 latexReview，可以调整：

| 设置 | 默认行为 |
|---|---|
| `latexReview.autoGoToNext` | 接受或拒绝后自动进入下一条；可关闭 |
| `latexReview.highlightChanges` | 显示当前修订的边框和新旧文本底色；可关闭 |
| `latexReview.showReviewToolbar` | 显示底部固定操作条；可关闭 |
| `latexReview.uiLanguage` | 跟随 VS Code；可选 zh-CN、en、ja |
| `latexReview.enableDefaultKeybindings` | 启用辅助快捷键；可关闭或自行改键 |

鼠标是主要操作方式。习惯键盘操作时，可先按 **Ctrl+K**，松开后再按以下组合：

| 第二组按键 | 操作 |
|---|---|
| Alt+A | 接受当前修订 |
| Alt+R | 拒绝当前修订 |
| Alt+N | 下一条 |
| Alt+P | 上一条 |
| Alt+T | 开启／关闭审阅 |

接受或拒绝当前修订时，把光标放在修订内部即可。底部修订类型与序号按钮可以把视图带回当前目标；剩余数量入口可以定位当前或附近的修订。右键菜单和命令面板也提供审阅操作。

如果看不到修订上方的按钮，请检查 VS Code 的 **Editor: Code Lens** 是否开启，或直接使用底部操作条。快捷键仅在 LaTeX 编辑器获得焦点且未进行输入法组合输入时生效；其他扩展的键位可能需要自行协调。

## 哪些文档适合使用

插件适合在当前 LaTeX 文件中逐条检查 changes 风格的新增、删除和替换，支持多行文字、嵌套花括号、公式、引用、标准可选参数及中英日混合正文。注释、常见代码展示环境和常见命令定义中的修订文字会被忽略。

若修订中还嵌着另一条修订，先处理外层；保留下来的内层修订随后会出现。因此，剩余数量表示当前可以独立处理的条目，外层展开后数量可能增加。

无法确认范围的残缺修订会显示提示并保留原文；存在解析错误时，不会显示“完成”。只读文件可以查看，不能接受或拒绝。

目前只处理当前文件，不扫描整个项目，不提供一键接受全部，也没有 PDF 对照。自定义修订宏、复杂 TeX 条件及特殊宏展开不在支持范围内。移除修订标记可能影响某些 TeX 分组或命令衔接，遇到特殊写法时仍需检查结果。

首轮已在 Windows 桌面版 VS Code 验证；其他系统、Web 和 Remote 环境尚未验证。

## English quick start

**LaTeX Change Reviewer is a VS Code extension for reviewing LaTeX edits one at a time.** Read the old and new text, then click Accept or Reject in the editor or the fixed status bar. Each decision updates your source and moves to the next change by default.

Download the .vsix from [Releases](https://github.com/JIE-jiee/latex-change-reviewer/releases/latest), install it with **Extensions: Install from VSIX…**, open a .tex file, and click the checklist icon to start reviewing. The extension is free to use under the MIT license; the source is public on GitHub. Use `\replaced{new}{old}`. Ctrl+Z undoes each decision. Choose **Select Interface Language** to switch languages.

## 日本語クイックスタート

**LaTeX Change Reviewer は、LaTeX の修正を一件ずつ確認するための VS Code 拡張機能です。** 新旧の文章を見比べ、エディター内またはステータスバーの「承認」「却下」をクリックすると、ソースが更新され、既定では次の変更へ移動します。

[Releases](https://github.com/JIE-jiee/latex-change-reviewer/releases/latest) から .vsix をダウンロードし、**Extensions: Install from VSIX…** でインストールします。.tex を開き、チェックリストアイコンでレビューを開始してください。MIT ライセンスで無料で利用でき、ソースは GitHub で公開されています。`\replaced{新しい文}{元の文}` の順で指定します。Ctrl+Z で操作ごとに元に戻せます。表示言語は言語選択コマンドから切り替えられます。

<details>
<summary>开发：从源码运行、测试与打包</summary>

### 从源码运行

```text
src/                 扩展入口、解析与类型、审阅控制器、导航、动态三语
tests/               解析／导航单元测试、VS Code 集成测试与启动器
.vscode/             F5 启动配置和编译任务
package*.json        清单、依赖锁与静态中英日文案
artifacts/           可安装 VSIX
.cache/              npm 缓存、隔离 VS Code 测试环境和临时文件
PLAN.md              确认目标与验收进度
```

需要 Node.js 20 或更高版本及 VS Code 1.85.2 或更高版本。开发命令从本项目目录执行，不使用全局安装：

```powershell
New-Item -ItemType Directory -Force .cache/tmp, artifacts | Out-Null
$env:TEMP = Join-Path $PWD '.cache/tmp'
$env:TMP = $env:TEMP
npm.cmd ci --cache .cache/npm --no-audit --no-fund
npm.cmd test
```

打开本项目，按 **F5** 启动 Extension Development Host；使用项目内隔离 profile 和扩展目录，不修改日常 VS Code。打开测试 `.tex` 文件并开启审阅即可。

集成测试（自动启动隔离 VS Code）：

```powershell
# 使用本机 VS Code，路径按实际安装位置填写
$env:REVIEW_CODE_EXECUTABLE = '<VS Code 安装路径>\Code.exe'
npm.cmd run test:integration

# 留空 executable，并指定版本，可下载隔离版本进行兼容测试
Remove-Item Env:REVIEW_CODE_EXECUTABLE -ErrorAction SilentlyContinue
$env:REVIEW_CODE_VERSION = '1.85.2'
npm.cmd run test:integration
```

打包：

```powershell
npm.cmd run package
```

得到 `artifacts/latex-change-reviewer-0.2.1.vsix`。产物版本从 `package.json` 读取。可以分享此文件供他人安装；开发依赖、缓存和测试文件不包含在安装包中。安装包也可从 [GitHub Releases](https://github.com/JIE-jiee/latex-change-reviewer/releases) 下载。VS Code 扩展市场素材已准备，发布者为 Unfinished draft（Unfinished-draft），尚未提交市场；采用 MIT 许可，源码公开。


### 准备商店安装包

[商店页面预览](media/store/preview.html) 与 [上架字段](media/store/listing.json) 可用于核对介绍、图标和截图。常规 `npm run package` 生成可试装的预览包，仍使用开发身份。已注册发布者 Unfinished draft（ID：`Unfinished-draft`）。生成正式身份的安装包可运行：

```powershell
npm.cmd run package:marketplace -- --publisher Unfinished-draft
```

此命令只在打包暂存区替换发布者 ID，生成名称带 `-marketplace` 的安装包，不执行发布。通过 [Marketplace 管理页面](https://marketplace.visualstudio.com/manage) 上传前，应核对正式发布者、版本及商店内容。

### 支持细节与验证

解析支持 CRLF、参数间注释、转义百分号与花括号、标准可选参数；忽略 \verb、\verb*、verbatim、verbatim*、lstlisting、minted 和常见 \newcommand、\renewcommand、\providecommand、\DeclareRobustCommand 定义。不展开 \def、xparse、自定义宏、复杂条件或字符类别变化。

0.2.0 已通过 17 项解析／导航单元测试，以及 VS Code 1.85.2 与 1.139.1 的源码和安装包集成测试。隔离窗口中已验证鼠标审阅、导航、开关、快捷键和撤销。尚未验证使用者真实文稿中的特殊宏工作流。

</details>
