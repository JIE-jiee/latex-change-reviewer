import { LatexChange, OffsetRange, ParseResult } from './changeTypes';
import { parseChanges } from './parser';

export interface SourceEdit { start: number; end: number; text: string }
type Result<T> = T | { reason: string };
type RichChange = LatexChange & { optionalRange?: OffsetRange; authorId?: string };
export interface TrackSession { start: number; end: number }
type Span = OffsetRange & { kind: 'comment' | 'verbatim' | 'command' | 'math' | 'unclosedMath' | 'paragraph' | 'definition' | 'structure' };

const fail = (reason: string) => ({ reason });
const escaped = (s: string, at: number): boolean => {
    let n = 0;
    while (at > 0 && s[--at] === '\\') n++;
    return n % 2 === 1;
};

function commandAt(s: string, at: number): { name: string; end: number } | undefined {
    if (s[at] !== '\\' || escaped(s, at)) return undefined;
    let i = at + 1;
    if (i >= s.length) return { name: '', end: i };
    if (/[A-Za-z@]/.test(s[i])) {
        const start = i++;
        while (i < s.length && /[A-Za-z@]/.test(s[i])) i++;
        return { name: s.slice(start, i), end: i };
    }
    return { name: s[i], end: i + 1 };
}

function groupEnd(s: string, openAt: number, open = '{', close = '}'): number | undefined {
    if (s[openAt] !== open) return undefined;
    let depth = 1;
    let brace = 0;
    for (let i = openAt + 1; i < s.length;) {
        if (s[i] === '%' && !escaped(s, i)) {
            while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
            continue;
        }
        const cmd = commandAt(s, i);
        if (cmd?.name === 'verb') {
            const d = s[cmd.end] === '*' ? cmd.end + 1 : cmd.end;
            const delimiter = s[d];
            if (!delimiter || delimiter === '\n' || delimiter === '\r') return undefined;
            const end = s.indexOf(delimiter, d + 1);
            if (end < 0) return undefined;
            i = end + 1;
            continue;
        }
        if (!escaped(s, i)) {
            if (open === '[' && s[i] === '{') brace++;
            else if (open === '[' && s[i] === '}' && brace > 0) brace--;
            else if ((open !== '[' || brace === 0) && s[i] === open) depth++;
            else if ((open !== '[' || brace === 0) && s[i] === close && --depth === 0) return i + 1;
        }
        i++;
    }
    return undefined;
}

function trivia(s: string, i: number): number {
    while (i < s.length) {
        if (/\s/.test(s[i])) { i++; continue; }
        if (s[i] === '%' && !escaped(s, i)) {
            while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
            continue;
        }
        break;
    }
    return i;
}

function commandSpan(s: string, start: number, cmd: { name: string; end: number }): number {
    let i = trivia(s, cmd.end);
    if (s[i] === '*') i = trivia(s, i + 1);
    if (cmd.name === 'verb') {
        const d = s[cmd.end] === '*' ? cmd.end + 1 : cmd.end;
        const delimiter = s[d];
        const end = delimiter ? s.indexOf(delimiter, d + 1) : -1;
        return end < 0 ? s.length : end + 1;
    }
    if (['cite', 'citep', 'citet', 'autocite', 'parencite', 'textcite', 'ref', 'eqref', 'pageref', 'nameref', 'label', 'url'].includes(cmd.name)) {
        if (s[i] === '[') { const end = groupEnd(s, i, '[', ']'); if (!end) return s.length; i = trivia(s, end); }
        if (s[i] === '{') return groupEnd(s, i) ?? s.length;
    }
    if (['href', 'hyperref'].includes(cmd.name)) {
        if (s[i] === '[') { const end = groupEnd(s, i, '[', ']'); if (!end) return s.length; i = trivia(s, end); }
        if (s[i] === '{') { const first = groupEnd(s, i); if (!first) return s.length; i = trivia(s, first); if (s[i] === '{') return groupEnd(s, i) ?? s.length; }
    }
    if (['newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand', 'def', 'gdef', 'edef', 'xdef'].includes(cmd.name)) {
        if (['newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand'].includes(cmd.name)) {
            if (s[i] === '{') { const end = groupEnd(s, i); if (!end) return s.length; i = trivia(s, end); }
            else { const name = commandAt(s, i); if (!name) return s.length; i = trivia(s, name.end); }
            if (s[i] === '[') { const end = groupEnd(s, i, '[', ']'); if (!end) return s.length; i = trivia(s, end); }
            if (s[i] === '[') { const end = groupEnd(s, i, '[', ']'); if (!end) return s.length; i = trivia(s, end); }
            return s[i] === '{' ? groupEnd(s, i) ?? s.length : s.length;
        }
        for (; i < s.length; i++) if (s[i] === '{' && !escaped(s, i)) return groupEnd(s, i) ?? s.length;
    }
    return cmd.end;
}

function spans(s: string): Span[] {
    const out: Span[] = [];
    let inDocument = false;
    for (let i = 0; i < s.length;) {
        if (s[i] === '%' && !escaped(s, i)) {
            let end = i + 1;
            while (end < s.length && s[end] !== '\n' && s[end] !== '\r') end++;
            out.push({ start: i, end, kind: 'comment' }); i = end; continue;
        }
        if (s[i] === '\\' && (s[i + 1] === '(' || s[i + 1] === '[') && !escaped(s, i)) {
            const close = s[i + 1] === '(' ? '\\)' : '\\]';
            const end = s.indexOf(close, i + 2);
            if (end >= 0) { out.push({ start: i, end: end + 2, kind: 'math' }); i = end + 2; continue; }
            out.push({ start: i, end: s.length, kind: 'unclosedMath' }); break;
        }
        const cmd = commandAt(s, i);
        if (cmd) {
            if (cmd.name === 'begin' || cmd.name === 'end') {
                const p = trivia(s, cmd.end);
                const e = s[p] === '{' ? groupEnd(s, p) : undefined;
                if (e) {
                    const env = s.slice(p + 1, e - 1).trim();
                    if (cmd.name === 'begin' && env === 'document') inDocument = true;
                    if (['verbatim', 'verbatim*', 'lstlisting', 'minted'].includes(env) && cmd.name === 'begin') {
                        const token = `\\end{${env}}`;
                        const end = s.indexOf(token, e);
                        const stop = end < 0 ? s.length : end + token.length;
                        out.push({ start: i, end: stop, kind: 'verbatim' }); i = stop; continue;
                    }
                    if (env === 'document' && cmd.name === 'begin') inDocument = true;
                    out.push({ start: i, end: e, kind: 'structure' }); i = e; continue;
                }
            }
            if (cmd.name === 'verb') {
                const end = commandSpan(s, i, cmd);
                out.push({ start: i, end, kind: 'verbatim' }); i = end; continue;
            }
            if (['newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand', 'def', 'gdef', 'edef', 'xdef'].includes(cmd.name)) {
                const end = commandSpan(s, i, cmd);
                out.push({ start: i, end, kind: 'definition' }); i = end; continue;
            }
            if (['section', 'subsection', 'subsubsection', 'chapter', 'part', 'paragraph', 'subparagraph', 'begin', 'end', 'include', 'input', 'usepackage', 'RequirePackage', 'documentclass'].includes(cmd.name)) {
            out.push({ start: i, end: commandSpan(s, i, cmd), kind: 'structure' });
            } else if (['cite', 'citep', 'citet', 'autocite', 'parencite', 'textcite', 'ref', 'eqref', 'pageref', 'nameref', 'label', 'url', 'href', 'hyperref'].includes(cmd.name)) {
                out.push({ start: i, end: commandSpan(s, i, cmd), kind: 'command' });
            } else if (cmd.name === 'par' || cmd.name === '\\' || cmd.name === 'newline') {
                out.push({ start: i, end: cmd.end, kind: 'paragraph' });
            } else {
                out.push({ start: i, end: cmd.end, kind: 'command' });
            }
            i = Math.max(i + 1, cmd.end); continue;
        }
        // Inline math is an indivisible TeX fragment for tracking purposes.
        if (s[i] === '$' && !escaped(s, i)) {
            const double = s[i + 1] === '$';
            const token = double ? '$$' : '$';
            const end = s.indexOf(token, i + token.length);
            if (end >= 0) { out.push({ start: i, end: end + token.length, kind: 'math' }); i = end + token.length; continue; }
            out.push({ start: i, end: s.length, kind: 'unclosedMath' }); break;
        }
        if (!inDocument && s.slice(i).startsWith('\\begin{document}')) inDocument = true;
        i++;
    }
    // A blank line and explicit paragraph command are boundaries; one line break is ordinary source whitespace.
    for (let i = 0; i < s.length - 1; i++) {
        if ((s[i] === '\n' && s[i + 1] === '\n') || (s[i] === '\r' && s[i + 1] === '\n' && s[i + 2] === '\r')) {
            out.push({ start: i, end: i + 2, kind: 'paragraph' });
        }
    }
    return out;
}

function safeRegion(s: string, start: number, end: number, inserted = ''): string | undefined {
    if (start < 0 || end < start || end > s.length) return 'Edit range is outside the source.';
    const ss = spans(s);
    const isInsertion = start === end;
    for (const span of ss) {
        if (span.kind === 'unclosedMath' && (isInsertion
            ? start >= span.start && start <= span.end
            : start < span.end && end > span.start)) return 'An incomplete math fragment cannot be tracked.';
        const hit = isInsertion ? start > span.start && start < span.end : start < span.end && end > span.start;
        if (!hit) continue;
        if (span.kind === 'comment') return 'Edits inside comments are not tracked.';
        if (span.kind === 'verbatim') return 'Edits inside verbatim content are not tracked.';
        if (span.kind === 'definition') return 'Edits inside command definitions are not tracked.';
        if (span.kind === 'structure') return 'Edits involving document structure are not tracked.';
        if (span.kind === 'paragraph') return 'An edit cannot split or cross a paragraph boundary.';
        if ((span.kind === 'command' || span.kind === 'math') && !(start <= span.start && end >= span.end)) {
            return span.kind === 'math' ? 'Select a complete inline math fragment.' : 'Select a complete reference command.';
        }
    }
    if (hasPreamble(s) && !hasDocumentBefore(s, start)) return 'Edits in the preamble are not tracked.';
    if (containsUnescapedPercent(inserted)) return 'Inserted TeX comments could hide the generated revision boundary.';
    if (spans(inserted).some(span => span.kind === 'unclosedMath')) return 'An incomplete math fragment cannot be tracked.';
    const insertedParse = parseChanges(inserted);
    if (insertedParse.changes.length || insertedParse.issues.length) return 'Pasting existing revision commands requires manual review.';
    if (hasBlankLine(inserted)) return 'An edit cannot introduce a paragraph boundary.';
    // Track brace depth with a character scanner; never infer groups from a regex.
    const startDepth = braceDepthAt(s, start);
    const endDepth = braceDepthAt(s, end);
    if (startDepth !== endDepth) return 'Edit splits a TeX group.';
    const newDepth = netBraceDepth(inserted);
    if (newDepth !== 0) return 'An edit cannot leave a TeX group open.';
    // Neither endpoint may split a control sequence token.
    for (const span of ss) if (span.kind === 'command' || span.kind === 'structure' || span.kind === 'definition' || span.kind === 'verbatim') {
        if ((start > span.start && start < span.end) || (end > span.start && end < span.end)) {
            if (!(span.kind === 'command' && start <= span.start && end >= span.end)) return 'Edit splits a TeX command.';
        }
    }
    return undefined;
}

function containsUnescapedPercent(s: string): boolean {
    for (let i = 0; i < s.length; i++) if (s[i] === '%' && !escaped(s, i)) return true;
    return false;
}

function hasPreamble(s: string): boolean {
    return spans(s).some(span => {
        if (span.kind !== 'structure') return false;
        const cmd = commandAt(s, span.start);
        return !!cmd && ['documentclass', 'usepackage', 'RequirePackage'].includes(cmd.name);
    });
}

function braceDepthAt(s: string, stop: number): number {
    let depth = 0;
    for (let i = 0; i < stop; i++) {
        if (s[i] === '%' && !escaped(s, i)) { while (i < stop && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
        if (escaped(s, i)) continue;
        if (s[i] === '{') depth++;
        else if (s[i] === '}') depth--;
    }
    return depth;
}

function netBraceDepth(s: string): number {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '%' && !escaped(s, i)) { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
        if (escaped(s, i)) continue;
        if (s[i] === '{') depth++;
        else if (s[i] === '}') depth--;
    }
    return depth;
}

function hasBlankLine(s: string): boolean {
    let newlines = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '\n' || s[i] === '\r') { newlines++; if (newlines > 1) return true; if (s[i] === '\r' && s[i + 1] === '\n') i++; }
        else if (s[i] !== ' ' && s[i] !== '\t') newlines = 0;
    }
    return false;
}

function hasDocumentBefore(s: string, pos: number): boolean {
    for (const span of spans(s)) {
        if (span.kind !== 'structure' || span.start >= pos) continue;
        const cmd = commandAt(s, span.start);
        if (cmd?.name !== 'begin') continue;
        const open = trivia(s, cmd.end);
        const end = s[open] === '{' ? groupEnd(s, open) : undefined;
        if (end && s.slice(open + 1, end - 1).trim() === 'document' && end <= pos) return true;
    }
    return false;
}

function mapOffset(offset: number, edit: SourceEdit): number {
    if (offset <= edit.start) return offset;
    if (offset >= edit.end) return offset + edit.text.length - (edit.end - edit.start);
    return edit.start + Math.min(edit.text.length, offset - edit.start);
}

function sessionStartAfter(offset: number, edit: SourceEdit): number {
    if (offset < edit.start) return offset;
    if (offset >= edit.end) return offset + edit.text.length - (edit.end - edit.start);
    return edit.start + edit.text.length;
}

function authorFrom(source: string, change: RichChange): string | undefined {
    if (change.authorId) return change.authorId;
    const r = change.optionalRange;
    if (!r) return undefined;
    let i = r.start;
    const end = r.end;
    while (i < end) {
        while (i < end && (/[\s,]/.test(source[i]))) i++;
        const keyStart = i;
        while (i < end && /[A-Za-z0-9_-]/.test(source[i])) i++;
        const key = source.slice(keyStart, i);
        while (i < end && /\s/.test(source[i])) i++;
        if (source[i] !== '=') { while (i < end && source[i] !== ',') i++; continue; }
        i++;
        while (i < end && /\s/.test(source[i])) i++;
        if (key === 'id') {
            const valueStart = i;
            while (i < end && /[A-Za-z0-9_-]/.test(source[i])) i++;
            return source.slice(valueStart, i) || undefined;
        }
        while (i < end && source[i] !== ',') i++;
    }
    return undefined;
}

function validateAuthor(authorId?: string): string | undefined {
    return !authorId || /^[A-Za-z0-9_-]+$/.test(authorId) ? undefined : 'Author id must contain only letters, numbers, underscores, or hyphens.';
}

function revision(oldText: string, newText: string, authorId?: string): string {
    const id = !authorId ? '' : `[id=${authorId}]`;
    if (!oldText) return `\\added${id}{${newText}}`;
    if (!newText) return `\\deleted${id}{${oldText}}`;
    return `\\replaced${id}{${newText}}{${oldText}}`;
}

function cursorInNewArgument(revisionText: string, start: number): number {
    const end = revisionText.indexOf('}{');
    if (end >= 0) return start + end;
    return start + revisionText.length - 1;
}

function allChanges(changes: LatexChange[], into: LatexChange[] = []): LatexChange[] {
    for (const change of changes) { into.push(change); allChanges(change.children, into); }
    return into;
}

function changedBranch(change: LatexChange, edit: SourceEdit): number | undefined {
    const hits = change.args.map((arg, i) => ({ arg, i })).filter(({ arg }) => {
        return edit.start === edit.end ? edit.start >= arg.start && edit.start <= arg.end : edit.start >= arg.start && edit.end <= arg.end;
    });
    return hits.length ? hits[0].i : undefined;
}

/** Convert a user edit into a changes.sty revision, or safely refuse uncertain TeX boundaries. */
export function trackEdit(before: string, edit: SourceEdit, authorId?: string, session?: TrackSession): Result<{ edit: SourceEdit; cursor: number }> {
    if (edit.start < 0 || edit.end < edit.start || edit.end > before.length) return fail('Edit range is outside the source.');
    const badAuthor = validateAuthor(authorId);
    if (badAuthor) return fail(badAuthor);
    const after = before.slice(0, edit.start) + edit.text + before.slice(edit.end);
    const issue = safeRegion(before, edit.start, edit.end, edit.text);
    if (issue) return fail(issue);
    const afterStart = edit.start;
    const afterEnd = edit.start + edit.text.length;
    const parsed: ParseResult = parseChanges(before);
    if (parsed.issues.some(x => edit.start === edit.end ? edit.start >= x.start && edit.start <= x.end : edit.start < x.end && edit.end > x.start)) return fail('A malformed revision overlaps this edit.');
    if (parsed.comments.some(c => c.kind !== 'attached' && (edit.start === edit.end
        ? edit.start > c.start && edit.start < c.end
        : edit.start < c.end && edit.end > c.start))) return fail('Edits involving comment or highlight wrappers require manual review.');
    const candidates = allChanges(parsed.changes).map(change => ({ change, branch: changedBranch(change, edit) }))
        .filter((x): x is { change: LatexChange; branch: number } => x.branch !== undefined)
        .sort((a, b) => (a.change.end - a.change.start) - (b.change.end - b.change.start));
    if (session) {
        const tracked = allChanges(parsed.changes).find(c => c.start === session.start && c.end === session.end) as RichChange | undefined;
        if (tracked) {
            const trackedAuthor = authorId ?? authorFrom(before, tracked);
            const newStart = sessionStartAfter(session.start, edit);
            const newEnd = mapOffset(session.end, edit);
            const branch = tracked.args[0];
            const body = before.slice(branch.start, branch.end);
            if (tracked.type === 'deleted' && edit.start === edit.end && edit.start === session.start && edit.text) {
                const text = revision(body, edit.text, trackedAuthor);
                return { edit: { start: edit.start, end: newEnd, text }, cursor: cursorInNewArgument(text, edit.start) };
            }
            if (tracked.type === 'deleted' && !edit.text && edit.end === session.start && edit.start < edit.end) {
                const text = revision(before.slice(edit.start, edit.end) + body, '', trackedAuthor);
                return { edit: { start: newStart, end: newEnd, text }, cursor: newStart };
            }
            if (tracked.type === 'deleted' && !edit.text && edit.start === session.end && edit.end > edit.start) {
                const text = revision(body + before.slice(edit.start, edit.end), '', trackedAuthor);
                return { edit: { start: newStart, end: newEnd, text }, cursor: newStart };
            }
        }
    }
    if (candidates.length) {
        const { change, branch } = candidates[0];
        if (change.blocked) return fail('Nested revision boundaries are malformed.');
        if (change.type === 'deleted' || (change.type === 'replaced' && branch === 1)) return fail('The preserved old branch cannot be edited automatically.');
        const containingChildren = change.children.filter(child => edit.start < child.end && edit.end > child.start);
        if (containingChildren.length) return fail('This edit crosses a nested revision boundary.');
        const bodyRange = change.args[0];
        const bodyStart = mapOffset(bodyRange.start, edit);
        const bodyEnd = mapOffset(bodyRange.end, edit);
        const body = after.slice(bodyStart, bodyEnd);
        const outerStart = mapOffset(change.start, edit);
        const outerEnd = mapOffset(change.end, edit);
        const cursor = afterEnd;
        if (change.type === 'added' && body.length === 0) return { edit: { start: outerStart, end: outerEnd, text: '' }, cursor: outerStart };
        if (change.type === 'replaced') {
            const oldRange = change.args[1];
            const oldBody = before.slice(oldRange.start, oldRange.end);
            if (body.length === 0) {
                const original = before.slice(change.start, change.end);
                const macroAt = original.indexOf('\\replaced');
                const leading = macroAt < 0 ? '\\deleted' : original.slice(0, macroAt) + '\\deleted' + original.slice(macroAt + '\\replaced'.length, change.args[0].start - change.start - 1);
                const text = `${leading}{${oldBody}}`;
                return { edit: { start: outerStart, end: outerEnd, text }, cursor: outerStart };
            }
            if (body === oldBody) return { edit: { start: outerStart, end: outerEnd, text: oldBody }, cursor: outerStart + oldBody.length };
        }
        // Existing wrapper is still correct; report the changed span without rewriting old branches/options.
        return { edit: { start: afterStart, end: afterEnd, text: after.slice(afterStart, afterEnd) }, cursor };
    }
    const overlapped = allChanges(parsed.changes).some(change => edit.start === edit.end
        ? edit.start > change.start && edit.start < change.end
        : edit.start < change.end && edit.end > change.start);
    if (overlapped) return fail('This edit crosses a revision wrapper or an old branch.');
    if (!edit.text && edit.start === edit.end) return fail('An empty insertion has no change to track.');
    const revisionText = revision(before.slice(edit.start, edit.end), edit.text, authorId);
    const cursor = !edit.text ? afterStart : cursorInNewArgument(revisionText, afterStart);
    return { edit: { start: afterStart, end: afterEnd, text: revisionText }, cursor };
}

function hasComment(s: string): boolean {
    for (let i = 0; i < s.length; i++) if (s[i] === '%' && !escaped(s, i)) return true;
    return false;
}

function macroPrefix(source: string, change: LatexChange): string {
    return source.slice(change.start, Math.max(change.start, change.args[0].start - 1));
}

/** Merge only directly neighboring, same-author and comment-free change macros. */
export function mergeChanges(source: string, changes: LatexChange[]): Result<SourceEdit> {
    if (changes.length < 2) return fail('At least two changes are required.');
    const sorted = [...changes].sort((a, b) => a.start - b.start);
    const first = sorted[0] as RichChange;
    const kind = first.type;
    const prefix = macroPrefix(source, first);
    const comments = parseChanges(source).comments;
    const structure = spans(source);
    for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i] as RichChange;
        if (c.type !== kind || authorFrom(source, c) !== authorFrom(source, first)) return fail('Only changes of the same type and author can merge.');
        if (c.blocked || c.comment || hasComment(source.slice(c.start, c.end)) || comments.some(comment => comment.start < c.end && comment.end > c.start)) {
            return fail('Malformed or commented changes cannot merge.');
        }
        if (c.start < 0 || c.end > source.length || c.end <= c.start) return fail('A change range is invalid.');
        if (c.children.length) return fail('Nested revisions cannot be merged with their parent.');
        if (structure.some(span => span.kind === 'math' || span.kind === 'paragraph' || span.kind === 'structure'
            ? span.start < c.end && span.end > c.start
            : false)) return fail('Changes containing math or document structure cannot merge.');
        if (macroPrefix(source, c) !== prefix) return fail('Changes with different optional metadata cannot merge.');
        if (i && sorted[i - 1].end > c.start) return fail('Nested or overlapping changes cannot merge.');
        if (i && sorted[i - 1].end !== c.start) return fail('Changes must be directly adjacent; preserving the separating whitespace would change its review behavior.');
    }
    const bodies = sorted.map(c => c.args.map(a => source.slice(a.start, a.end)));
    if (kind === 'replaced') {
        const newer = bodies.map(x => x[0]).join('');
        const older = bodies.map(x => x[1]).join('');
        return { start: sorted[0].start, end: sorted[sorted.length - 1].end, text: `${prefix}{${newer}}{${older}}` };
    }
    const join = bodies.map(x => x[0]).join('');
    return { start: sorted[0].start, end: sorted[sorted.length - 1].end, text: `${prefix}{${join}}` };
}

/** Construct an appropriate revision command for a plain text replacement. */
export function makeRevision(oldText: string, newText: string, authorId?: string): string {
    const badAuthor = validateAuthor(authorId);
    if (badAuthor) throw new RangeError(badAuthor);
    if (!oldText && !newText) return '';
    return revision(oldText, newText, authorId);
}
