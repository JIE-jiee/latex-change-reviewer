# LaTeX Change Reviewer

在 VS Code 中逐条接受／拒绝 `changes` 风格修订。本地运行，无账号、AI 或网络服务；无需 LaTeX Workshop 或 TeX 编译环境。

## 安装与开始审阅

1. 在 VS Code 命令面板运行 **Extensions: Install from VSIX… / 扩展：从 VSIX 安装**，选择 `artifacts/latex-change-reviewer-0.2.0.vsix`。
2. 打开 `.tex` 文件，点击编辑器标题栏的清单图标，或运行 **LaTeX Review: Toggle Review / LaTeX 审阅：开启／关闭审阅**。标题栏图标固定用于开关审阅。
3. 在修订起始行上方点击 **接受 / 拒绝**。默认自动进入下一条；嵌套修订先处理外层，再审保留分支中的内层。
4. 使用 Ctrl+Z 撤销、Ctrl+Y 重做。插件不主动保存；如果 VS Code 自身启用了自动保存，仍由 VS Code 的设置控制。
5. 再点击标题栏图标或运行开关命令关闭审阅。状态栏的“审阅：开启／关闭”入口只负责开关；独立的修订计数入口负责定位当前或附近修订。关闭不修改正文，工作区会记住开关状态。

命令入口会跟随 VS Code 的显示语言；英文环境可搜索 `LaTeX Review`。在扩展管理中禁用或卸载可完全停用插件。

| 宏 | 接受 | 拒绝 |
|---|---|---|
| `\replaced{新文本}{旧文本}` | 第一个参数 | 第二个参数 |
| `\added{新增文本}` | 参数内容 | 删除整条宏 |
| `\deleted{旧文本}` | 删除整条宏 | 参数内容 |

**新文本在前。** 参数中的首尾换行、缩进、空格、注释全部保留，不格式化。移除宏后的空行也是原文保留的一部分。

## 语言、设置与快捷键

运行 **LaTeX Review: Select Interface Language**，选择简体中文、English、日本語或跟随 VS Code。按钮、状态栏、提示立即切换；命令面板、右键菜单和设置说明跟随 VS Code 本身的显示语言。

| 设置 | 默认 | 用途 |
|---|---|---|
| `latexReview.uiLanguage` | `auto` | `auto` / `zh-CN` / `en` / `ja`；其他语言回退英文 |
| `latexReview.autoGoToNext` | `true` | 接受／拒绝后进入下一条 |
| `latexReview.highlightChanges` | `true` | 轻量标出当前修订 |
| `latexReview.showReviewToolbar` | `true` | 在状态栏显示固定的审阅操作条；关闭后仍可用 CodeLens 和命令 |
| `latexReview.enableDefaultKeybindings` | `true` | 启用插件默认快捷键 |

审阅开启时，固定操作条显示上一条、接受、拒绝、下一条和剩余数量。接受／拒绝按钮会说明本次操作保留的文本，例如“接受替换：保留新文本”。开启时自动定位当前或附近修订。当前修订会用起始行箭头和边框突出显示，并为参数加上“新文本／旧文本”标签，避免只靠颜色辨别。点“定位当前修订”可滚动回当前审阅目标。`latexReview.showReviewToolbar` 可隐藏固定操作条而保留 CodeLens 操作。

以下是两段式组合键：先按 **Ctrl+K**，松开后再按第二组键。

| 第二组键 | 操作 |
|---|---|
| Alt+A | 接受当前修订 |
| Alt+R | 拒绝当前修订 |
| Alt+N | 下一条 |
| Alt+P | 上一条 |
| Alt+T | 开启／关闭审阅 |

标题栏的清单图标始终用于开关审阅；状态栏固定操作条中单独显示修订数量和导航按钮，不会因审阅状态切换其点击含义。命令面板提供 **LaTeX Review: Locate Current Change**，用于滚动到当前审阅目标。

快捷键仅在 LaTeX 编辑器文本获得焦点、非输入法组合输入时生效；接受／拒绝还要求审阅已开启、当前目标有效且文档可写。可以在 VS Code 的快捷键设置中搜索 `latexReview` 改键。默认键位已检查本机用户配置与已安装扩展清单；其他键盘布局和第三方键位插件可能仍冲突。

## 已支持的边界

- 嵌套花括号、公式和引用命令、多行、CRLF、中英日混合文本。
- 可选参数 `[id=..., comment={...}]`、参数间空白与注释、转义 `%` / `{` / `}`。
- 忽略注释、`\verb` / `\verb*`、`verbatim` / `verbatim*` / `lstlisting` / `minted`。
- 排除常见 `\newcommand`、`\renewcommand`、`\providecommand`、`\DeclareRobustCommand` 定义。
- 同行修订编号、光标在参数内定位外层、外层处理后暴露内层、文件末尾不循环。
- 手动编辑后刷新、版本核验、不完整结构诊断、重复提交保护、单步撤销与重做。
- 未保存的 LaTeX 文档、同一文档多编辑器同步、只读文件系统不执行修改。

计数表示当前可独立审阅的最外层条目。外层展开多个内层时数量可能增加。存在解析错误不会显示 Clean；不确定区域停止解析，不猜测范围。

## 已知限制

- 只审阅当前文件，不扫描项目，不提供 Accept All / Reject All。
- 不解释自定义修订宏、TeX 宏展开、复杂条件分支、`\def` / xparse 定义或字符类别变化。请先检查这些文档中的识别结果。
- 原样移除包装不保证所有 TeX 内容的编译语义不变；明确的命令与后续字母粘连会提示检查，其他分组／宏参数语义仍需人工判断。
- CodeLens 显示在源码行上方；同行多条以编号区分，不能变成分别贴在宏旁的行内按钮。全局 `editor.codeLens=false` 会隐藏按钮，请开启 CodeLens 或使用右键／命令。
- 没有 PDF 联动、作者管理、批注编辑或标题栏完整操作组；标题栏只提供固定的审阅开关。可选元数据会随修订包装一起移除。
- 首轮验收平台为 Windows 桌面 VS Code；没有宣称 Web、Remote 或 macOS/Linux 已验证。

## 项目与开发

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

得到 `artifacts/latex-change-reviewer-0.2.0.vsix`。产物版本从 `package.json` 读取。可以分享此文件供他人安装；开发依赖、缓存和测试文件不包含在安装包中。安装包也可从 [GitHub Releases](https://github.com/JIE-jiee/latex-change-reviewer/releases) 下载。未发布 VS Code 市场，暂未授予开源许可证。

## 验收记录

**0.1.0 历史验收记录：**17 项解析／导航单元测试通过；VS Code 1.85.2 与本机 1.139.1 的集成测试通过，0.1.0 VSIX 也在两个版本通过测试。集成检查包含连续撤销重做、按钮绑定目标、过期保护、嵌套导航、同行编号、三语、解析诊断、多编辑器及真实只读文件属性。

另在隔离窗口实际验证鼠标按钮、Ctrl+K 后 Alt+R、Ctrl+Z、自动跳转、状态栏及右键菜单。0.2.0 的 17 项单元测试通过；源码与已安装 VSIX 均通过两个版本的集成测试，包含开启自动定位及绑定目标定位检查。实际点击验证了新增固定操作条接受替换、拒绝删除、导航、撤销和标题栏开关；新旧标签与计数正确更新。当前尚未用用户真实文稿验证自定义宏等特殊工作流。

## English quick start

Install the 0.2.0 VSIX, open a `.tex` document, and use the checklist icon in the editor title bar to toggle review. The fixed status bar action bar provides navigation and Accept / Reject. `\replaced{new}{old}` is new-first. Each decision is independently undoable; the extension does not save the document. Select **LaTeX Review: Select Interface Language** for English, Chinese or Japanese.

## 日本語クイックスタート

0.2.0 の VSIX をインストールし、`.tex` を開いてエディタータイトルのチェックリストアイコンでレビューを切り替えます。固定ステータスバー操作バーから移動・承認・却下できます。`\replaced{新しい文}{元の文}` の順序です。操作ごとに元に戻せます。自動保存は行いません。表示言語は言語選択コマンドから変更できます。
