import * as vscode from "vscode";

type Language = "en" | "zh-CN" | "ja";

const messages: Record<Language, Record<string, string>> = {
  en: {
    accept: "Accept",
    reject: "Reject",
    next: "Next",
    previous: "Previous",
    disabled: "LaTeX Review is disabled",
    count: "LaTeX Review: {0} changes",
    clean: "LaTeX Review: Clean",
    errors: "LaTeX Review: {0} changes, {1} parse errors",
    stale: "This change is out of date. The review list was refreshed.",
    noCurrent: "Place the cursor inside a change to review it.",
    end: "No more changes in this direction.",
    busy: "A review operation is already in progress.",
    readonly: "This document is read-only.",
    parseError: "Unable to safely parse this change; it was left unchanged.",
    glue: "Resolving this change may join a LaTeX command to following text. Check the result.",
    languageTitle: "Select review interface language",
    languageAuto: "Follow VS Code",
    languageZh: "简体中文",
    languageEn: "English",
    languageJa: "日本語",
    enabled: "LaTeX Review enabled",
    reviewOn: "Review: On",
    reviewOff: "Review: Off",
    enableReview: "Enable review",
    disableReview: "Disable review",
    remaining: "{0} changes remaining",
    currentInfo: "{0} · Change {1} of {2}",
    replaced: "Replacement",
    added: "Addition",
    deleted: "Deletion",
    newText: "New text",
    oldText: "Old text",
    acceptReplaced: "Accept replacement and keep the new text",
    rejectReplaced: "Reject replacement and restore the old text",
    acceptAdded: "Accept addition and keep the added text",
    rejectAdded: "Reject addition and remove the added text",
    acceptDeleted: "Accept deletion and remove the old text",
    rejectDeleted: "Reject deletion and restore the old text",
    locateCurrent: "Locate current change",
    waiting: "Waiting for review changes…"
  },
  "zh-CN": {
    accept: "接受",
    reject: "拒绝",
    next: "下一条",
    previous: "上一条",
    disabled: "LaTeX 修订审阅已关闭",
    count: "LaTeX 修订审阅：{0} 条",
    clean: "LaTeX 修订审阅：已完成",
    errors: "LaTeX 修订审阅：{0} 条，{1} 处解析错误",
    stale: "此修订已过期，审阅列表已刷新。",
    noCurrent: "请将光标放在修订内部以进行审阅。",
    end: "此方向没有更多修订。",
    busy: "正在处理另一项审阅操作。",
    readonly: "此文档为只读状态。",
    parseError: "无法安全解析此修订，内容未更改。",
    glue: "处理此修订可能会使 LaTeX 命令与后续文本粘连，请检查结果。",
    languageTitle: "选择审阅界面语言",
    languageAuto: "跟随 VS Code",
    languageZh: "简体中文",
    languageEn: "English",
    languageJa: "日本語",
    enabled: "已开启 LaTeX 修订审阅",
    reviewOn: "审阅：已开启",
    reviewOff: "审阅：已关闭",
    enableReview: "开启审阅",
    disableReview: "关闭审阅",
    remaining: "剩余 {0} 条修订",
    currentInfo: "{0} · 第 {1}/{2} 条",
    replaced: "替换修订",
    added: "新增修订",
    deleted: "删除修订",
    newText: "新文本",
    oldText: "旧文本",
    acceptReplaced: "接受替换：保留新文本",
    rejectReplaced: "拒绝替换：恢复旧文本",
    acceptAdded: "接受新增：保留新增文本",
    rejectAdded: "拒绝新增：撤销新增内容",
    acceptDeleted: "接受删除：移除旧文本",
    rejectDeleted: "拒绝删除：恢复旧文本",
    locateCurrent: "定位当前修订",
    waiting: "正在等待审阅修订……"
  },
  ja: {
    accept: "承認",
    reject: "却下",
    next: "次へ",
    previous: "前へ",
    disabled: "LaTeX レビューは無効です",
    count: "LaTeX レビュー: {0} 件",
    clean: "LaTeX レビュー: 完了",
    errors: "LaTeX レビュー: {0} 件、解析エラー {1} 件",
    stale: "この変更は古くなっています。レビュー一覧を更新しました。",
    noCurrent: "レビューする変更の中にカーソルを置いてください。",
    end: "この方向に未処理の変更はありません。",
    busy: "別のレビュー操作を実行中です。",
    readonly: "このドキュメントは読み取り専用です。",
    parseError: "この変更を安全に解析できないため、内容を変更しませんでした。",
    glue: "この変更の処理により LaTeX コマンドと後続テキストが連結する可能性があります。結果を確認してください。",
    languageTitle: "レビューの表示言語を選択",
    languageAuto: "VS Code に従う",
    languageZh: "简体中文",
    languageEn: "English",
    languageJa: "日本語",
    enabled: "LaTeX レビューを有効にしました",
    reviewOn: "レビュー：オン",
    reviewOff: "レビュー：オフ",
    enableReview: "レビューを開始",
    disableReview: "レビューを終了",
    remaining: "残り {0} 件",
    currentInfo: "{0} · {1}/{2} 件目",
    replaced: "置換",
    added: "追加",
    deleted: "削除",
    newText: "新しい文",
    oldText: "元の文",
    acceptReplaced: "置換を承認：新しい文を残す",
    rejectReplaced: "置換を却下：元の文に戻す",
    acceptAdded: "追加を承認：追加した文を残す",
    rejectAdded: "追加を却下：追加した文を取り消す",
    acceptDeleted: "削除を承認：元の文を削除する",
    rejectDeleted: "削除を却下：元の文を復元する",
    locateCurrent: "現在の変更へ移動",
    waiting: "レビュー対象を待機中…"
  }
};

function resolveLanguage(): Language {
  const configured = vscode.workspace.getConfiguration("latexReview").get<string>("uiLanguage", "auto");
  if (configured === "zh-CN" || configured === "en" || configured === "ja") {
    return configured;
  }

  const locale = vscode.env.language.toLowerCase();
  if (locale === "zh" || locale === "zh-cn" || locale === "zh-hans") {
    return "zh-CN";
  }
  if (locale === "ja" || locale.startsWith("ja-")) {
    return "ja";
  }
  return "en";
}

export function t(key: string, ...args: (string | number)[]): string {
  let message = messages[resolveLanguage()][key] ?? messages.en[key] ?? key;
  args.forEach((value, index) => {
    message = message.replaceAll(`{${index}}`, String(value));
  });
  return message;
}
