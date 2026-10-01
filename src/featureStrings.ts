import * as vscode from 'vscode';

type Language = 'en' | 'zh-CN' | 'ja';

const strings: Record<Language, Record<string, string>> = {
  en: {
    addComment: 'Add comment', editComment: 'Edit comment', removeComment: 'Remove comment', nextComment: 'Next comment',
    commentPrompt: 'Write a plain-text comment', commentAuthor: 'LaTeX Review', commentAnchor: 'Comment', end: 'No more comments.',
    trackingOn: 'Track changes: On', trackingOff: 'Track changes: Off', trackingPaused: 'Tracking paused',
    trackingPending: 'Tracking: {0} pending changes', trackingExperimentalWarning: 'Tracking supports body text within the documented scope. Try it on a copy of your document first.',
    unsupportedTracking: 'Tracking is available in writable LaTeX files only.', trackingDiff: 'Show tracked changes',
    trackingUndo: 'Undo tracking change', resumeTracking: 'Resume tracking', markNew: 'Mark selection as added',
    markDeleted: 'Mark selection as deleted', replacePrompt: 'Replacement text', unsafeSelection: 'Select plain text outside an existing change.',
    mergeFailed: 'Unable to merge the selected changes safely.', staleComment: 'This comment is out of date. Refresh the comment list and try again.',
    emptyComment: 'Enter a comment before saving.', commentRemoved: 'Comment removed; its anchor text was kept.',
    reasonPlain: 'This edit could not be recorded. Check the current text before continuing.', commentCount: '{0} comments', pendingInput: 'View unrecorded input',
    invalidAuthor: 'Author ID may contain only letters, numbers, underscores, and hyphens.'
  },
  'zh-CN': {
    addComment: '添加批注', editComment: '编辑批注', removeComment: '移除批注', nextComment: '下一条批注',
    commentPrompt: '输入纯文本批注', commentAuthor: 'LaTeX 修订审阅', commentAnchor: '批注', end: '后面没有批注了。',
    trackingOn: '记录修订：已开启', trackingOff: '记录修订：已关闭', trackingPaused: '修订记录已暂停',
    trackingPending: '记录修订：{0} 处待处理', trackingExperimentalWarning: '记录修订适用于说明中的正文范围，建议先在文档副本中试用。',
    unsupportedTracking: '记录修订仅适用于可写的 LaTeX 文件。', trackingDiff: '显示记录的修订',
    trackingUndo: '撤销记录的修订', resumeTracking: '恢复修订记录', markNew: '将所选内容标记为新增',
    markDeleted: '将所选内容标记为删除', replacePrompt: '替换文本', unsafeSelection: '请选择现有修订范围之外的普通文本。',
    mergeFailed: '无法安全合并所选修订。', staleComment: '此批注已过期，请刷新批注列表后重试。',
    emptyComment: '请输入批注后再保存。', commentRemoved: '已移除批注，锚定文本已保留。',
    reasonPlain: '此次修改未能记录为修订，请检查当前正文后再继续。', commentCount: '{0} 条批注', pendingInput: '查看未写入的输入',
    invalidAuthor: '作者 ID 只能包含英文字母、数字、下划线和连字符。'
  },
  ja: {
    addComment: 'コメントを追加', editComment: 'コメントを編集', removeComment: 'コメントを削除', nextComment: '次のコメント',
    commentPrompt: 'プレーンテキストでコメントを入力', commentAuthor: 'LaTeX Review', commentAnchor: 'コメント', end: 'これ以上コメントはありません。',
    trackingOn: '変更記録：オン', trackingOff: '変更記録：オフ', trackingPaused: '変更記録を一時停止中',
    trackingPending: '変更記録：未処理 {0} 件', trackingExperimentalWarning: '変更記録は説明に記載した本文範囲に対応します。まず文書のコピーでお試しください。',
    unsupportedTracking: '変更記録は書き込み可能な LaTeX ファイルでのみ利用できます。', trackingDiff: '記録した変更を表示',
    trackingUndo: '記録した変更を元に戻す', resumeTracking: '変更記録を再開', markNew: '選択範囲を追加としてマーク',
    markDeleted: '選択範囲を削除としてマーク', replacePrompt: '置換後のテキスト', unsafeSelection: '既存の変更範囲外にある通常のテキストを選択してください。',
    mergeFailed: '選択した変更を安全に統合できませんでした。', staleComment: 'コメントが古くなっています。コメント一覧を更新してから再試行してください。',
    emptyComment: '保存する前にコメントを入力してください。', commentRemoved: 'コメントを削除し、アンカーテキストを残しました。',
    reasonPlain: 'この編集は変更として記録できませんでした。現在の本文を確認してから続けてください。', commentCount: 'コメント {0} 件', pendingInput: '未入力のテキストを確認',
    invalidAuthor: '作成者 ID には英字、数字、アンダースコア、ハイフンのみ使用できます。'
  }
};

function language(): Language {
  const configured = vscode.workspace.getConfiguration('latexReview').get<string>('uiLanguage', 'auto');
  if (configured === 'zh-CN' || configured === 'en' || configured === 'ja') return configured;
  const locale = vscode.env.language.toLowerCase();
  if (locale === 'zh' || locale === 'zh-cn' || locale === 'zh-hans') return 'zh-CN';
  if (locale === 'ja' || locale.startsWith('ja-')) return 'ja';
  return 'en';
}

/** Dynamic feature copy follows latexReview.uiLanguage, then the VS Code display language. */
export function f(key: string, ...args: (string | number)[]): string {
  let message = strings[language()][key] ?? strings.en[key] ?? key;
  args.forEach((value, index) => { message = message.replaceAll(`{${index}}`, String(value)); });
  return message;
}

const localizedReasons: Record<string, [string, string]> = {
  'Edit range is outside the source.': ['編集範囲がソースの範囲外です。', '编辑范围超出了源文本范围。'],
  'Edits inside comments are not tracked.': ['コメント内の編集は記録されません。', '注释中的编辑不会被记录。'],
  'Edits inside verbatim content are not tracked.': ['verbatim 内容内の編集は記録されません。', 'verbatim 内容中的编辑不会被记录。'],
  'Edits inside command definitions are not tracked.': ['コマンド定義内の編集は記録されません。', '命令定义中的编辑不会被记录。'],
  'Edits involving document structure are not tracked.': ['文書構造に関わる編集は記録されません。', '涉及文档结构的编辑不会被记录。'],
  'An edit cannot split or cross a paragraph boundary.': ['段落の境界を分割またはまたぐ編集はできません。', '编辑不能拆分或跨越段落边界。'],
  'Select a complete inline math fragment.': ['インライン数式全体を選択してください。', '请选择完整的行内公式。'],
  'An incomplete math fragment cannot be tracked.': ['未完成の数式は変更として記録できません。', '不完整的公式不能自动记录为修订。'],
  'Select a complete reference command.': ['参照コマンド全体を選択してください。', '请选择完整的引用命令。'],
  'Edits in the preamble are not tracked.': ['プリアンブル内の編集は記録されません。', '导言区中的编辑不会被记录。'],
  'Inserted TeX comments could hide the generated revision boundary.': ['挿入した TeX コメントにより、生成される修正範囲を判別できなくなる可能性があります。', '插入的 TeX 注释可能会遮蔽生成的修订边界。'],
  'Pasting existing revision commands requires manual review.': ['既存の修正コマンドを貼り付けた場合は手動確認が必要です。', '粘贴已有修订命令需要手动检查。'],
  'An edit cannot introduce a paragraph boundary.': ['編集によって段落境界を作ることはできません。', '编辑不能引入段落边界。'],
  'Edit splits a TeX group.': ['編集によって TeX グループが分割されます。', '编辑会拆分 TeX 分组。'],
  'An edit cannot leave a TeX group open.': ['編集後に TeX グループを閉じずに残すことはできません。', '编辑不能留下未闭合的 TeX 分组。'],
  'Edit splits a TeX command.': ['編集によって TeX コマンドが分割されます。', '编辑会拆分 TeX 命令。'],
  'Author id must contain only letters, numbers, underscores, or hyphens.': ['作成者 ID には英字、数字、アンダースコア、ハイフンのみ使用できます。', '作者 ID 只能包含英文字母、数字、下划线和连字符。'],
  'A malformed revision overlaps this edit.': ['形式が不正な修正範囲と編集が重なっています。', '此编辑与格式错误的修订范围重叠。'],
  'Edits involving comment or highlight wrappers require manual review.': ['コメントまたはハイライトの囲みを含む編集は手動確認が必要です。', '涉及批注或高亮标记的编辑需要手动检查。'],
  'Nested revision boundaries are malformed.': ['入れ子になった修正の境界が不正です。', '嵌套修订的边界格式错误。'],
  'The preserved old branch cannot be edited automatically.': ['保持される旧文は自動編集できません。', '保留的旧文本不能自动编辑。'],
  'This edit crosses a nested revision boundary.': ['この編集は入れ子になった修正の境界をまたいでいます。', '此编辑跨越了嵌套修订边界。'],
  'This edit crosses a revision wrapper or an old branch.': ['この編集は修正コマンドまたは旧文の範囲をまたいでいます。', '此编辑跨越了修订标记或旧文本范围。'],
  'An empty insertion has no change to track.': ['空の挿入は記録する変更がありません。', '空插入没有可记录的修改。'],
  'At least two changes are required.': ['統合するには 2 件以上の修正が必要です。', '至少需要两处修订才能合并。'],
  'Only changes of the same type and author can merge.': ['同じ種類で作成者が同じ修正のみ統合できます。', '只能合并类型和作者相同的修订。'],
  'Malformed or commented changes cannot merge.': ['形式が不正な修正やコメント付き修正は統合できません。', '格式错误或带批注的修订不能合并。'],
  'A change range is invalid.': ['修正範囲が無効です。', '修订范围无效。'],
  'Nested revisions cannot be merged with their parent.': ['入れ子になった修正を親の修正と統合することはできません。', '嵌套修订不能与其父级修订合并。'],
  'Changes containing math or document structure cannot merge.': ['数式または文書構造を含む修正は統合できません。', '包含公式或文档结构的修订不能合并。'],
  'Changes with different optional metadata cannot merge.': ['オプションのメタデータが異なる修正は統合できません。', '可选元数据不同的修订不能合并。'],
  'Nested or overlapping changes cannot merge.': ['入れ子または重複する修正は統合できません。', '嵌套或重叠的修订不能合并。'],
  'Changes must be directly adjacent; preserving the separating whitespace would change its review behavior.': ['修正は直接隣接している必要があります。間の空白を残すとレビュー時の動作が変わります。', '修订必须直接相邻；保留中间空白会改变其审阅行为。'],
  'Cutting whole lines is not supported.': ['行全体の切り取りには対応していません。', '暂不支持剪切整行。'],
  'Multiple cursors cannot be recorded.': ['複数カーソルの編集は記録できません。', '无法记录多光标编辑。'],
  'The document changed before the input could be recorded.': ['入力を記録する前に文書が変更されました。', '记录输入前文档已发生变化。'],
  'The editor could not record the input.': ['エディターが入力を記録できませんでした。', '编辑器无法记录此次输入。'],
  'This edit did not come from a supported input command; it was kept without a revision.': ['この編集は対応する入力コマンドによるものではないため、修正として記録せず内容を保持しました。', '此次编辑不是通过受支持的输入命令完成的；内容已保留，但未生成修订。'],
  'Multiple edits or a competing editor change cannot be recorded safely.': ['複数の編集、または別のエディター変更を安全に記録できません。', '无法安全记录多项编辑或其他编辑器中的并发更改。'],
  'The pending edit no longer matches its snapshot.': ['保留中の編集が元のスナップショットと一致しなくなりました。', '待处理的编辑与其快照已不匹配。'],
  'The document changed before recording completed.': ['変更の記録が完了する前に文書が変更されました。', '记录完成前文档已发生变化。'],
  'The editor could not apply the revision.': ['エディターが修正を適用できませんでした。', '编辑器无法应用此修订。']
};

/** Localize known tracking reasons at call time; preserve raw English and fall back for unknown reasons. */
export function explainReason(reason: string): string {
  const current = language();
  if (current === 'en') return reason;
  const localized = localizedReasons[reason];
  return localized ? localized[current === 'ja' ? 0 : 1] : f('reasonPlain');
}
