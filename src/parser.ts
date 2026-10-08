import { ChangeType, LatexChange, LatexComment, OffsetRange, ParseIssue, ParseResult, ReviewDecision } from './changeTypes';

type Group = OffsetRange & { close: number };
type Command = { name: string; end: number };
type Spec = { type: ChangeType; count: number };
type ScanContext = { comments: LatexComment[] };

const REVIEW: Record<string, Spec> = {
    added: { type: 'added', count: 1 }, deleted: { type: 'deleted', count: 1 }, replaced: { type: 'replaced', count: 2 },
};
const VERBATIM_ENVS = new Set(['verbatim', 'verbatim*', 'lstlisting', 'minted']);
const DEFINITIONS = new Set(['newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand']);
const PRIMITIVE_DEFINITIONS = new Set(['def', 'gdef', 'edef', 'xdef']);

function escaped(text: string, at: number): boolean {
    let n = 0;
    while (at > 0 && text[--at] === '\\') n++;
    return n % 2 === 1;
}

function commandAt(text: string, at: number, limit: number): Command | undefined {
    if (at >= limit || text[at] !== '\\' || escaped(text, at)) return undefined;
    let i = at + 1;
    if (i >= limit) return { name: '', end: i };
    if (/[A-Za-z@]/.test(text[i])) {
        const start = i++;
        while (i < limit && /[A-Za-z@]/.test(text[i])) i++;
        return { name: text.slice(start, i), end: i };
    }
    return { name: text[i], end: i + 1 };
}

function skipComment(text: string, at: number, limit: number): number {
    let i = at + 1;
    while (i < limit && text[i] !== '\n' && text[i] !== '\r') i++;
    return i;
}

function skipTrivia(text: string, from: number, limit: number): number {
    let i = from;
    while (i < limit) {
        if (/\s/.test(text[i])) { i++; continue; }
        if (text[i] === '%' && !escaped(text, i)) { i = skipComment(text, i, limit); continue; }
        break;
    }
    return i;
}

/** Brace-aware scanner; all offsets are bounded by limit, including comments and commands. */
function parseDelimited(text: string, openAt: number, open: string, close: string, limit: number): Group | undefined {
    if (openAt >= limit || text[openAt] !== open) return undefined;
    let depth = 1;
    let braceDepth = 0;
    let i = openAt + 1;
    while (i < limit) {
        const ch = text[i];
        if (ch === '%' && !escaped(text, i)) { i = skipComment(text, i, limit); continue; }
        const command = commandAt(text, i, limit);
        if (command?.name === 'verb') {
            const delimAt = command.end + (text[command.end] === '*' ? 1 : 0);
            const delimiter = text[delimAt];
            if (delimiter && delimiter !== '\n' && delimiter !== '\r') {
                const end = text.indexOf(delimiter, delimAt + 1);
                if (end < 0 || end >= limit) return undefined;
                i = end + 1;
                continue;
            }
            return undefined;
        }
        if (!escaped(text, i)) {
            if (open === '[' && ch === '{') braceDepth++;
            else if (open === '[' && ch === '}' && braceDepth > 0) braceDepth--;
            else if (braceDepth === 0 && ch === open) depth++;
            else if (braceDepth === 0 && ch === close && --depth === 0) return { start: openAt + 1, end: i, close: i };
        }
        i++;
    }
    return undefined;
}

function parseOptional(text: string, at: number, limit: number): Group | undefined {
    return parseDelimited(text, at, '[', ']', limit);
}

/** Find a top-level key=value field without splitting commas inside TeX groups. */
function optionalFields(text: string, range: OffsetRange): Array<{ key: string; value: OffsetRange; rawValue: string; hasEquals: boolean }> {
    const result: Array<{ key: string; value: OffsetRange; rawValue: string; hasEquals: boolean }> = [];
    let from = range.start;
    let braces = 0;
    for (let i = range.start; i <= range.end; i++) {
        const ch = text[i];
        if (i < range.end && ch === '{' && !escaped(text, i)) braces++;
        else if (i < range.end && ch === '}' && !escaped(text, i) && braces > 0) braces--;
        if (i !== range.end && (ch !== ',' || braces !== 0 || escaped(text, i))) continue;
        const segment = text.slice(from, i);
        const equal = segment.indexOf('=');
        if (equal >= 0) {
            const key = segment.slice(0, equal).trim();
            let valueStart = from + equal + 1;
            let valueEnd = i;
            while (valueStart < valueEnd && /\s/.test(text[valueStart])) valueStart++;
            while (valueEnd > valueStart && /\s/.test(text[valueEnd - 1])) valueEnd--;
            result.push({ key, value: { start: valueStart, end: valueEnd }, rawValue: text.slice(valueStart, valueEnd), hasEquals: true });
        } else {
            const key = segment.trim();
            if (key) result.push({ key, value: { start: i, end: i }, rawValue: '', hasEquals: false });
        }
        from = i + 1;
    }
    return result;
}

function fieldContent(text: string, field: { value: OffsetRange }): OffsetRange | undefined {
    const { start, end } = field.value;
    if (end <= start) return undefined;
    if (text[start] === '{') {
        const group = parseDelimited(text, start, '{', '}', end);
        if (!group || group.close !== end - 1) return undefined;
        return { start: group.start, end: group.end };
    }
    return field.value;
}

function parseEnvironmentName(text: string, commandEnd: number, limit: number): { name: string; end: number } | undefined {
    const start = skipTrivia(text, commandEnd, limit);
    const group = parseDelimited(text, start, '{', '}', limit);
    return group ? { name: text.slice(group.start, group.end).trim(), end: group.close + 1 } : undefined;
}

/** Verbatim bodies are raw. Only a standalone literal ending line terminates them. */
function skipEnvironment(text: string, start: number, name: string, limit: number): number | undefined {
    const token = `\\end{${name}}`;
    let at = start;
    while (at < limit) {
        at = text.indexOf(token, at);
        if (at < 0 || at >= limit) return undefined;
        const lineStart = Math.max(text.lastIndexOf('\n', at - 1), text.lastIndexOf('\r', at - 1)) + 1;
        const lineEnd = (() => {
            let end = at + token.length;
            while (end < limit && text[end] !== '\n' && text[end] !== '\r') end++;
            return end;
        })();
        if (/^[ \t]*$/.test(text.slice(lineStart, at)) && /^[ \t]*$/.test(text.slice(at + token.length, lineEnd))) {
            return at + token.length;
        }
        at += token.length;
    }
    return undefined;
}

function skipDefinition(text: string, commandEnd: number, limit: number): number | undefined {
    let i = skipTrivia(text, commandEnd, limit);
    if (text[i] === '*') i = skipTrivia(text, i + 1, limit);
    if (text[i] === '{') {
        const nameGroup = parseDelimited(text, i, '{', '}', limit);
        if (!nameGroup) return undefined;
        i = skipTrivia(text, nameGroup.close + 1, limit);
    } else {
        const name = commandAt(text, i, limit);
        if (!name) return undefined;
        i = skipTrivia(text, name.end, limit);
    }
    if (text[i] === '[') {
        const count = parseOptional(text, i, limit);
        if (!count) return undefined;
        i = skipTrivia(text, count.close + 1, limit);
        if (text[i] === '[') {
            const defaultValue = parseOptional(text, i, limit);
            if (!defaultValue) return undefined;
            i = skipTrivia(text, defaultValue.close + 1, limit);
        }
    }
    if (text[i] !== '{') return undefined;
    const body = parseDelimited(text, i, '{', '}', limit);
    return body ? body.close + 1 : undefined;
}

/**
 * Skip a TeX primitive definition. Unlike \newcommand, the parameter text is
 * an arbitrary token sequence (for example #1#2prefix), so it must not be
 * parsed as an optional argument or scanned for review commands.
 */
function skipPrimitiveDefinition(text: string, commandEnd: number, limit: number): number | undefined {
    let i = skipTrivia(text, commandEnd, limit);
    const target = commandAt(text, i, limit);
    if (!target || !target.name) return undefined;
    i = target.end;

    // TeX reads parameter text up to the opening replacement-text brace.
    // Skip comments and control tokens atomically so escaped braces and
    // control-symbol macro names cannot be mistaken for that brace.
    while (i < limit) {
        if (text[i] === '%' && !escaped(text, i)) {
            i = skipComment(text, i, limit);
            continue;
        }
        const token = commandAt(text, i, limit);
        if (token) {
            i = token.end;
            continue;
        }
        if (text[i] === '{' && !escaped(text, i)) {
            const body = parseDelimited(text, i, '{', '}', limit);
            return body ? body.close + 1 : undefined;
        }
        if (text[i] === '}' && !escaped(text, i)) return undefined;
        i++;
    }
    return undefined;
}

function skipPdfStringDefinitions(text: string, commandEnd: number, limit: number): number | undefined {
    const openAt = skipTrivia(text, commandEnd, limit);
    if (text[openAt] !== '{') return undefined;
    const block = parseDelimited(text, openAt, '{', '}', limit);
    return block ? block.close + 1 : undefined;
}

function parseOne(text: string, start: number, commandEnd: number, spec: Spec, issues: ParseIssue[], limit: number, context: ScanContext):
    { change: LatexChange; next: number } | undefined {
    let i = skipTrivia(text, commandEnd, limit);
    let optionalRange: OffsetRange | undefined;
    let metadata: ReturnType<typeof optionalFields> = [];
    if (text[i] === '[') {
        const optional = parseOptional(text, i, limit);
        if (!optional) {
            issues.push({ start, end: limit, message: 'Unclosed optional argument for change command.' });
            return undefined;
        }
        optionalRange = { start: i, end: optional.close + 1 };
        metadata = optionalFields(text, { start: optional.start, end: optional.end });
        i = skipTrivia(text, optional.close + 1, limit);
    }
    const args: OffsetRange[] = [];
    for (let n = 0; n < spec.count; n++) {
        i = skipTrivia(text, i, limit);
        if (text[i] !== '{') {
            issues.push({ start, end: Math.min(limit, Math.max(start + 1, i)), message: 'Missing or malformed argument for change command.' });
            return undefined;
        }
        const group = parseDelimited(text, i, '{', '}', limit);
        if (!group) {
            issues.push({ start, end: limit, message: 'Unclosed argument for change command; parsing stopped because later ranges are uncertain.' });
            return undefined;
        }
        args.push({ start: group.start, end: group.end });
        i = group.close + 1;
    }
    const children: LatexChange[] = [];
    const childIssues: ParseIssue[] = [];
    for (const arg of args) children.push(...scanRange(text, arg.start, arg.end, childIssues, context));
    issues.push(...childIssues);
    const change: LatexChange = { type: spec.type, start, end: i, args, children };
    change.optionalRange = optionalRange;
    const ids = metadata.filter(field => field.key === 'id');
    if (ids.length === 1 && ids[0].hasEquals) change.authorId = ids[0].rawValue;
    const commentFields = metadata.filter(field => field.key === 'comment');
    if (commentFields.length === 1 && commentFields[0].hasEquals) {
        const contentRange = fieldContent(text, commentFields[0]);
        if (contentRange) {
            const comment: LatexComment = { kind: 'attached', start, end: i, contentRange, anchorRange: { start, end: i }, optionalRange };
            change.comment = comment;
            context.comments.push(comment);
        }
    }
    if (childIssues.length) change.blocked = true;
    return { change, next: i };
}

function scanRange(text: string, from: number, to: number, issues: ParseIssue[], context: ScanContext): LatexChange[] {
    const changes: LatexChange[] = [];
    let i = from;
    while (i < to) {
        if (text[i] === '%' && !escaped(text, i)) { i = skipComment(text, i, to); continue; }
        const command = commandAt(text, i, to);
        if (!command) { i++; continue; }
        if (command.name === 'verb') {
            const delimAt = command.end + (text[command.end] === '*' ? 1 : 0);
            const delimiter = text[delimAt];
            if (!delimiter || delimiter === '\n' || delimiter === '\r') {
                issues.push({ start: i, end: to, message: 'Unclosed \\verb command; parsing stopped because later ranges are uncertain.' });
                break;
            }
            const end = text.indexOf(delimiter, delimAt + 1);
            if (end < 0 || end >= to) {
                issues.push({ start: i, end: to, message: 'Unclosed \\verb command; parsing stopped because later ranges are uncertain.' });
                break;
            }
            i = end + 1;
            continue;
        }
        if (command.name === 'begin') {
            const env = parseEnvironmentName(text, command.end, to);
            if (env && VERBATIM_ENVS.has(env.name)) {
                const end = skipEnvironment(text, env.end, env.name, to);
                if (end === undefined) {
                    issues.push({ start: i, end: to, message: `Unclosed ${env.name} environment; parsing stopped because later ranges are uncertain.` });
                    break;
                }
                i = end;
                continue;
            }
        }
        if (DEFINITIONS.has(command.name)) {
            const end = skipDefinition(text, command.end, to);
            if (end === undefined) {
                issues.push({ start: i, end: to, message: 'Unable to determine the end of a command definition; parsing stopped in this region.' });
                break;
            }
            i = end;
            continue;
        }
        if (PRIMITIVE_DEFINITIONS.has(command.name)) {
            const end = skipPrimitiveDefinition(text, command.end, to);
            if (end === undefined) {
                issues.push({ start: i, end: to, message: 'Unable to determine the end of a TeX primitive definition; parsing stopped in this region.' });
                break;
            }
            i = end;
            continue;
        }
        if (command.name === 'pdfstringdefDisableCommands') {
            const end = skipPdfStringDefinitions(text, command.end, to);
            if (end === undefined) {
                issues.push({ start: i, end: to, message: 'Unable to determine the end of the pdfstring command block; parsing stopped in this region.' });
                break;
            }
            i = end;
            continue;
        }
        const spec = REVIEW[command.name];
        if (spec) {
            const parsed = parseOne(text, i, command.end, spec, issues, to, context);
            if (!parsed) break;
            changes.push(parsed.change);
            i = parsed.next;
            continue;
        }
        if (command.name === 'highlight' || command.name === 'comment') {
            let argAt = skipTrivia(text, command.end, to);
            let optionalRange: OffsetRange | undefined;
            let metadata: ReturnType<typeof optionalFields> = [];
            if (text[argAt] === '[') {
                const opt = parseOptional(text, argAt, to);
                if (!opt) { issues.push({ start: i, end: to, message: 'Unclosed optional argument for comment command.' }); break; }
                optionalRange = { start: argAt, end: opt.close + 1 };
                metadata = optionalFields(text, { start: opt.start, end: opt.end });
                argAt = skipTrivia(text, opt.close + 1, to);
            }
            const arg = parseDelimited(text, argAt, '{', '}', to);
            if (!arg) { i = command.end; continue; }
            const commentFields = metadata.filter(field => field.key === 'comment');
            if (command.name === 'comment') {
                context.comments.push({ kind: 'standalone', start: i, end: arg.close + 1, contentRange: { start: arg.start, end: arg.end }, anchorRange: { start: arg.start, end: arg.end }, optionalRange });
            } else if (commentFields.length === 1 && commentFields[0].hasEquals) {
                const valueRange = fieldContent(text, commentFields[0]);
                if (valueRange) context.comments.push({ kind: 'highlight', start: i, end: arg.close + 1, contentRange: valueRange, anchorRange: { start: arg.start, end: arg.end }, optionalRange });
            }
            changes.push(...scanRange(text, arg.start, arg.end, issues, context));
            i = arg.close + 1;
            continue;
        }
        i = command.end;
    }
    return changes;
}

export function parseChanges(text: string): ParseResult {
    const issues: ParseIssue[] = [];
    const context: ScanContext = { comments: [] };
    const changes = scanRange(text, 0, text.length, issues, context);
    context.comments.sort((a, b) => a.start - b.start);
    return { changes, issues, comments: context.comments };
}

export function replacementText(text: string, change: LatexChange, decision: ReviewDecision): string {
    const index = change.type === 'replaced'
        ? (decision === 'accept' ? 0 : 1)
        : change.type === 'added'
            ? (decision === 'accept' ? 0 : -1)
            : (decision === 'accept' ? -1 : 0);
    if (index < 0) return '';
    const range = change.args[index];
    if (!range || range.start < 0 || range.end > text.length || range.end < range.start) return '';
    return text.slice(range.start, range.end);
}
