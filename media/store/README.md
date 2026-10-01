# LaTeX Change Reviewer

> 已上架 [VS Code 扩展市场](https://marketplace.visualstudio.com/items?itemName=Unfinished-draft.latex-change-reviewer)，发布者：Unfinished draft。

## 中文

### 在 VS Code 里逐条审阅 LaTeX 修改

LaTeX Change Reviewer 是一个 VS Code 插件，让你直接在 `.tex` 源码里编辑并逐条审阅修改。0.3.0 有两个重点：像平常一样编辑，新增、删除和替换会自动记为 LaTeX 修订；再用熟悉的 Word 式流程逐条接受或拒绝，并前往下一条。无需手动输入修订命令，操作也可用 `Ctrl+Z` 撤销。

### 直接编辑，修改自动留下记录

开启**记录修订**后，照常输入、删除、粘贴或替换文字，插件会记录对应修改；还可以为选中文字或修订添加批注。记录默认关闭，只对当前文件和本次会话生效。

![直接编辑留下修订](../screenshots/recording.gif)

### 对照修订，逐条决定接受或拒绝

开启**审阅工具**后，查看每条修订，点击**接受**或**拒绝**，再继续到下一条。也可以阅读、添加和管理批注。这个操作顺序贴近 Word 中逐条处理修订的习惯，决定会直接更新 `.tex` 源码。

![右键批注](../screenshots/comments.jpg)

**审阅工具**与**记录修订**是两个独立开关：一个控制查看和处理现有修订，另一个控制是否记录之后的编辑。关闭一个不会影响另一个；已有文字也不会追溯记录。

记录时，常规输入、删除、粘贴和剪切可成为修订。新输入记为新增，删除原有文字记为删除；选中新旧文字后键入或粘贴，会记为 `\\replaced{新}{旧}`。同一处已有修订时继续编辑会更新其记录，不会在修订里面再套一层。每条修订可附一条批注：添加或编辑会覆盖该条的批注，删除会清除批注；批注保存在修订参数中，可用 Ctrl+Z 撤销／重做。

记录修订不自动保存，文档仍由你保存。输入法组合期间由 VS Code 原生处理，组合结束后再转换为修订；无法可靠识别的外部编辑会保留原结果并暂停记录。快速切换输入法时若组合尚未完成，也可能暂停记录；完成或取消组合后再切换。其他会接管输入的扩展尚未兼容验证。

插件提供清晰的当前修订标记、编辑器内按钮和固定操作条，也可用命令面板、右键菜单或辅助快捷键审阅。支持简体中文、English、日本語界面。

同一条源码行有多处修订时，按钮会用 `[1]`、`[2]` 等编号区分各自的目标，按该行中出现的顺序排列。点击 `[1] 接受` 处理第一处，点击 `[2] 拒绝` 处理第二处；各组“下一条”从对应修订向后导航。自动折行仍算同一条源码行。编号是界面提示，不写入文稿，处理修订后会重新排列。

![当前修订的审阅界面](../screenshots/review.jpg)

### 使用步骤

1. 在 VS Code 扩展面板搜索 **LaTeX Change Reviewer**，选择发布者 **Unfinished draft**，点击安装。
2. 在 VS Code 中打开 `.tex` 文件，点击编辑器标题栏的清单图标开启审阅。
3. 查看新旧文本，点击接受或拒绝；也可导航到上一条或下一条。
4. 修改会留在编辑器中，由你决定何时保存。关闭审阅可再次点击清单图标。

![接受修订后的源码示例](../screenshots/after-accept.jpg)

### 行为与支持范围

- 识别 changes 风格的 `\added{新增}`、`\deleted{旧文}` 和 `\replaced{新文}{旧文}`；替换命令按新文本在前、旧文本在后的顺序处理。
- 接受替换保留新文，拒绝替换恢复旧文；接受新增保留内容，拒绝新增移除内容；接受删除移除旧文，拒绝删除恢复旧文。
- 每次只审阅当前文件中的一条修订。嵌套修订先处理外层，保留的内层之后继续审阅；到末尾停止，不循环。
- 修订记录与审阅工具是两个独立开关。记录按文件、仅在本次会话启用，默认关闭；已有文字不会追溯记录。单条修订最多附一条批注，编辑批注会替换原批注。
- 保留参数内原有字符、空格和换行；不自动排版或保存。工作区可记住审阅开关状态。
- 面向 Windows 桌面版 VS Code 1.85.2 或更高版本。首轮已在 Windows 桌面 VS Code 验证；其他系统、Web 和 Remote 环境尚未验证。
- 适合标准 changes 宏写法。自定义宏、复杂 TeX 条件和特殊宏展开不在支持范围；只读文件不能接受或拒绝。插件不扫描整个项目、不提供批量处理或 PDF 对照。

插件免费使用，采用 MIT 许可。源码和问题反馈见 [GitHub](https://github.com/JIE-jiee/latex-change-reviewer)。可从 [VS Code 扩展市场](https://marketplace.visualstudio.com/items?itemName=Unfinished-draft.latex-change-reviewer) 直接安装。离线安装请选择 GitHub Releases 中带 `-marketplace.vsix` 的正式安装包。

## English

Edit LaTeX as usual in VS Code and let the extension record additions, deletions, replacements, and comments. Then review each change in a familiar Word-style flow: compare the text, click **Accept** or **Reject**, and move to the next. You do not need to type change macros yourself. Recording is off by default; the review and recording switches work independently. Each change can have one comment. Decisions update the open source and can be undone with `Ctrl+Z`. Install in VS Code by searching **LaTeX Change Reviewer** in Extensions and choosing publisher **Unfinished draft**. Windows desktop support has been verified; Web, Remote, and other operating systems have not.

## 日本語

VS Code で通常どおりソースを編集すると、追加・削除・置換が修正として記録され、コメントも付けられます。その後、Word に慣れた流れで一件ずつ内容を確認し、**承認**または**却下**をクリックして次へ進めます。修正コマンドを自分で入力する必要はありません。記録は既定でオフで、レビューと記録のスイッチは独立しています。各変更にはコメントを一件付けられ、決定は `Ctrl+Z` で元に戻せます。VS Code の拡張機能で **LaTeX Change Reviewer** を検索し、発行者 **Unfinished draft** を選んでインストールしてください。Windows デスクトップ版で動作確認済みです。Web、Remote、その他の OS は未検証です。
