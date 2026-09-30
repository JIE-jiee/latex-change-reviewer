import { ChangeType, LatexChange, OffsetRange, ParseIssue, ParseResult, ReviewDecision } from './changeTypes';

type Group = OffsetRange & { close: number };
type Command = { name: string; end: number };
type Spec = { type: ChangeType; count: number };

const REVIEW: Record<string, Spec> = {
    added: { type: 'added', count: 1 }, deleted: { type: 'deleted', count: 1 }, replaced: { type: 'replaced', count: 2 },
};
const VERBATIM_ENVS = new Set(['verbatim', 'verbatim*', 'lstlisting', 'minted']);
const DEFINITIONS = new Set(['newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand']);

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

function parseOne(text: string, start: number, commandEnd: number, spec: Spec, issues: ParseIssue[], limit: number):
    { change: LatexChange; next: number } | undefined {
    let i = skipTrivia(text, commandEnd, limit);
    if (text[i] === '[') {
        const optional = parseOptional(text, i, limit);
        if (!optional) {
            issues.push({ start, end: limit, message: 'Unclosed optional argument for change command.' });
            return undefined;
        }
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
    for (const arg of args) children.push(...scanRange(text, arg.start, arg.end, childIssues));
    issues.push(...childIssues);
    const change: LatexChange = { type: spec.type, start, end: i, args, children };
    if (childIssues.length) change.blocked = true;
    return { change, next: i };
}

function scanRange(text: string, from: number, to: number, issues: ParseIssue[]): LatexChange[] {
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
        const spec = REVIEW[command.name];
        if (spec) {
            const parsed = parseOne(text, i, command.end, spec, issues, to);
            if (!parsed) break;
            changes.push(parsed.change);
            i = parsed.next;
            continue;
        }
        i = command.end;
    }
    return changes;
}

export function parseChanges(text: string): ParseResult {
    const issues: ParseIssue[] = [];
    return { changes: scanRange(text, 0, text.length, issues), issues };
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
