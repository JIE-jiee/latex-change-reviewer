import { LatexChange, LatexComment, OffsetRange } from './changeTypes';

export function escapeCommentText(value: string): string {
    return value.replace(/[\\{}%#&_$]/g, ch => ch === '\\' ? '\\textbackslash{}' : `\\${ch}`)
        .replace(/\^/g, '\\textasciicircum{}').replace(/~/g, '\\textasciitilde{}');
}

export function unescapeCommentText(value: string): string {
    return value.replace(/\\textbackslash\{\}/g, '\\').replace(/\\textasciicircum\{\}/g, '^')
        .replace(/\\textasciitilde\{\}/g, '~').replace(/\\([{}%#&_$])/g, '$1');
}

function commentFor(target: LatexChange | LatexComment): LatexComment | undefined {
    return 'kind' in target ? target : target.comment;
}

function optionValueRange(source: string, optional: OffsetRange): OffsetRange {
    if (source[optional.start] !== '[' || source[optional.end - 1] !== ']') throw new Error('Invalid optional argument range.');
    return { start: optional.start + 1, end: optional.end - 1 };
}

function escaped(source: string, at: number): boolean {
    let count = 0;
    while (at > 0 && source[--at] === '\\') count++;
    return count % 2 === 1;
}

function splitFields(raw: string): Array<{ start: number; end: number }> {
    const fields: Array<{ start: number; end: number }> = [];
    let depth = 0, start = 0;
    for (let i = 0; i <= raw.length; i++) {
        if (i < raw.length && raw[i] === '{' && !escaped(raw, i)) depth++;
        else if (i < raw.length && raw[i] === '}' && !escaped(raw, i)) {
            if (depth === 0) throw new Error('Unbalanced optional metadata cannot be edited safely.');
            depth--;
        }
        if (i < raw.length && raw[i] === ',' && depth === 0 && !escaped(raw, i) || i === raw.length) {
            fields.push({ start, end: i }); start = i + 1;
        }
    }
    if (depth !== 0) throw new Error('Unbalanced optional metadata cannot be edited safely.');
    return fields;
}

function commentValue(source: string, start: number, end: number): OffsetRange {
    while (start < end && /\s/.test(source[start])) start++;
    while (end > start && /\s/.test(source[end - 1])) end--;
    if (start === end) throw new Error('Empty comment field cannot be edited safely.');
    if (source[start] !== '{') return { start, end };

    let depth = 0;
    for (let i = start; i < end; i++) {
        if (source[i] === '{' && !escaped(source, i)) depth++;
        else if (source[i] === '}' && !escaped(source, i)) {
            if (--depth === 0) {
                if (i !== end - 1) throw new Error('Malformed comment field cannot be edited safely.');
                return { start: start + 1, end: i };
            }
        }
    }
    throw new Error('Malformed comment field cannot be edited safely.');
}

function metadataComment(source: string, optional?: OffsetRange): { value: OffsetRange; fields: string[]; removeRange?: OffsetRange; hasField?: boolean } | undefined {
    if (!optional) return undefined;
    const body = optionValueRange(source, optional);
    const raw = source.slice(body.start, body.end);
    const segments = splitFields(raw);
    const fields = segments.map(s => raw.slice(s.start, s.end));
    const candidates = segments.filter(s => /^\s*comment\b/.test(raw.slice(s.start, s.end)));
    const matches = candidates.filter(s => /^\s*comment\s*=/.test(raw.slice(s.start, s.end)));
    if (matches.length !== candidates.length) throw new Error('Malformed comment field cannot be edited safely.');
    if (matches.length > 1) throw new Error('Duplicate comment fields cannot be edited safely.');
    if (!matches.length) return { value: { start: body.end, end: body.end }, fields, hasField: false };
    const seg = matches[0];
    const field = raw.slice(seg.start, seg.end);
    const eq = field.indexOf('=');
    const start = body.start + seg.start + eq + 1;
    const end = body.start + seg.end;
    const content = commentValue(source, start, end);
    let removeStart = seg.start;
    let removeEnd = seg.end;
    if (matches.length === 1) {
        const priorComma = raw.lastIndexOf(',', seg.start);
        const nextComma = raw.indexOf(',', seg.end);
        if (priorComma >= 0) removeStart = priorComma;
        else if (nextComma >= 0) removeEnd = nextComma + 1;
    }
    return { value: content, fields, hasField: true, removeRange: { start: body.start + removeStart, end: body.start + removeEnd } };
}

function edit(source: string, target: LatexChange | LatexComment, plain: string | undefined): { start: number; end: number; text: string } {
    const comment = commentFor(target);
    if (comment?.kind === 'standalone') {
        if (plain === undefined) return { start: comment.start, end: comment.end, text: '' };
        return { ...comment.contentRange, text: escapeCommentText(plain) };
    }
    if (comment?.kind === 'highlight' && plain === undefined) {
        return { start: comment.start, end: comment.end, text: source.slice(comment.anchorRange.start, comment.anchorRange.end) };
    }
    const optional = comment?.optionalRange ?? ('kind' in target ? target.optionalRange : target.optionalRange);
    const existing = metadataComment(source, optional);
    if (plain === undefined && existing?.removeRange) return { ...existing.removeRange, text: '' };
    if (existing?.hasField) {
        const encoded = plain === undefined ? '' : escapeCommentText(plain);
        const alreadyGrouped = source[existing.value.start - 1] === '{';
        const needsGroup = !alreadyGrouped && plain !== undefined && (/[,[\]\r\n]/.test(plain) || plain.trim() !== plain);
        return { start: existing.value.start, end: existing.value.end, text: needsGroup ? `{${encoded}}` : encoded };
    }
    if (plain === undefined) return { start: 0, end: 0, text: '' };
    if (optional) {
        const close = optional.end - 1;
        const rawBody = source.slice(optional.start + 1, close);
        const trailing = rawBody.match(/\s*$/)?.[0].length ?? 0;
        const at = close - trailing;
        const trimmed = rawBody.trim();
        if (trimmed.startsWith(',') || /,\s*,/.test(trimmed)) throw new Error('Malformed optional metadata cannot be edited safely.');
        const separator = trimmed && !trimmed.endsWith(',') ? ', ' : trimmed ? ' ' : '';
        const insertion = `${separator}comment={${escapeCommentText(plain)}}`;
        return { start: at, end: at, text: insertion };
    }
    const anchorStart = 'kind' in target ? target.anchorRange.start : target.start;
    const commandEnd = source.indexOf('{', anchorStart);
    if (commandEnd < 0) throw new Error('Could not locate command argument safely.');
    const nameEnd = source.lastIndexOf('}', commandEnd);
    void nameEnd;
    let i = anchorStart + 1;
    while (i < commandEnd && /[A-Za-z@]/.test(source[i])) i++;
    if (source[anchorStart] !== '\\' || i === anchorStart + 1) throw new Error('Could not locate command name safely.');
    return { start: i, end: i, text: `[comment={${escapeCommentText(plain)}}]` };
}

export function setComment(source: string, target: LatexChange | LatexComment, plain: string): { start: number; end: number; text: string } {
    return edit(source, target, plain);
}

export function removeComment(source: string, target: LatexChange | LatexComment): { start: number; end: number; text: string } {
    return edit(source, target, undefined);
}

export function makeHighlight(text: string, comment: string, authorId?: string): string {
    const id = authorId ? `id=${authorId}, ` : '';
    return `\\highlight[${id}comment={${escapeCommentText(comment)}}]{${text}}`;
}

export function makeStandaloneComment(comment: string, authorId?: string): string {
    const options = authorId ? `[id=${authorId}]` : '';
    return `\\comment${options}{${escapeCommentText(comment)}}`;
}
