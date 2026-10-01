import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { makeRevision, mergeChanges, SourceEdit, trackEdit } from '../src/changeTransforms';
import { parseChanges } from '../src/parser';

function apply(source: string, edit: SourceEdit): string {
    return source.slice(0, edit.start) + edit.text + source.slice(edit.end);
}

test('plain insert, delete, and replace produce standard revisions and useful cursors', () => {
    const insertBase = 'alpha beta';
    const insert = trackEdit(insertBase, { start: 6, end: 6, text: 'new ' });
    assert.ok('edit' in insert);
    const inserted = apply('alpha new beta', insert.edit);
    assert.equal(inserted, 'alpha \\added{new }beta');
    assert.equal(inserted[insert.cursor], '}');

    const deleteBase = 'alpha beta';
    const deletion = trackEdit(deleteBase, { start: 6, end: 10, text: '' });
    assert.ok('edit' in deletion);
    assert.equal(apply('alpha ', deletion.edit), 'alpha \\deleted{beta}');
    assert.equal(deletion.cursor, 6);

    const replaceBase = 'same token';
    const replacement = trackEdit(replaceBase, { start: 5, end: 10, text: 'token' });
    assert.ok('edit' in replacement);
    assert.equal(apply('same token', replacement.edit), 'same \\replaced{token}{token}');
    assert.equal(replacement.cursor, 'same \\replaced{token}{token}'.indexOf('}{'));
});

test('fragments are accepted but clearly identified preambles are protected', () => {
    const fragment = trackEdit('plain text', { start: 5, end: 5, text: 'x' });
    assert.ok('edit' in fragment);
    const preamble = '\\documentclass{article}\n\\usepackage{x}\n\\begin{document}Body';
    const result = trackEdit(preamble, { start: preamble.indexOf('article'), end: preamble.indexOf('article') + 7, text: 'report' });
    assert.ok('reason' in result);
    const body = trackEdit(preamble, { start: preamble.indexOf('Body'), end: preamble.length, text: 'Text' });
    assert.ok('edit' in body);

    const falseStarts = [
        '\\documentclass{article}\n% \\begin{document}\nBody',
        String.raw`\documentclass{article}\verb|\begin{document}|Body`,
        String.raw`\documentclass{article}\newcommand{\x}{\begin{document}}Body`,
    ];
    for (const source of falseStarts) {
        const start = source.indexOf('Body');
        assert.ok('reason' in trackEdit(source, { start, end: start + 4, text: 'Text' }), source);
    }
    const packageDecoys = [
        '% \\usepackage{x}\nBody',
        String.raw`\verb|\usepackage{x}| Body`,
        String.raw`\newcommand{\x}{\usepackage{x}}Body`,
    ];
    for (const source of packageDecoys) {
        const start = source.indexOf('Body');
        assert.ok('edit' in trackEdit(source, { start, end: start + 4, text: 'Text' }), source);
    }
    const requiredPackage = String.raw`\RequirePackage{x}` + '\nBody';
    const requiredStart = requiredPackage.indexOf('Body');
    assert.ok('reason' in trackEdit(requiredPackage, { start: requiredStart, end: requiredStart + 4, text: 'Text' }));
});

test('complete references and inline math can be revised without shortening their ranges', () => {
    const reference = String.raw`See \eqref{eq:a}.`;
    const refStart = reference.indexOf('\\eqref');
    const refEnd = refStart + String.raw`\eqref{eq:a}`.length;
    const refEdit = trackEdit(reference, { start: refStart, end: refEnd, text: String.raw`\eqref{eq:b}` });
    assert.ok('edit' in refEdit);
    assert.equal(apply(reference, refEdit.edit), String.raw`See \replaced{\eqref{eq:b}}{\eqref{eq:a}}.`);

    const formula = String.raw`x=$R=1$!`;
    const mathStart = formula.indexOf('$');
    const mathEnd = formula.lastIndexOf('$') + 1;
    const mathEdit = trackEdit(formula, { start: mathStart, end: mathEnd, text: '$R=2$' });
    assert.ok('edit' in mathEdit);
    assert.equal(apply(formula, mathEdit.edit), String.raw`x=\replaced{$R=2$}{$R=1$}!`);
});

test('unsafe comment, verbatim, paragraph, structure, and partial math edits are refused', () => {
    const cases: Array<[string, number, number, string]> = [
        ['text % note\nnext', 6, 10, ''],
        ['\\begin{verbatim}raw\\end{verbatim}', 18, 21, 'new'],
        ['one\n\ntwo', 1, 7, 'x'],
        ['x=$a+b$', 3, 5, 'z'],
        ['\\section{Title}', 1, 5, 'Head'],
        [String.raw`\newcommand{\x}[1]{body}`, 20, 24, 'edit'],
        ['text', 2, 2, '%comment'],
    ];
    for (const [source, start, end, text] of cases) assert.ok('reason' in trackEdit(source, { start, end, text }), source);
});

test('unclosed inline math edits and pasted fragments are left to native editing', () => {
    const fragments = ['$unfinished', String.raw`\(unfinished`, String.raw`\[unfinished`];
    for (const source of fragments) {
        const start = source.indexOf('unfinished') + 2;
        assert.ok('reason' in trackEdit(source, { start, end: start + 3, text: 'new' }), source);
        assert.ok('reason' in trackEdit('plain text', { start: 5, end: 5, text: source }), source);
    }
    const crossing = 'before $unfinished';
    assert.ok('reason' in trackEdit(crossing, { start: 0, end: crossing.length, text: 'replacement' }));
});

test('added updates stay added and deleting all its content removes the empty wrapper', () => {
    const source = String.raw`\added{new}`;
    const start = source.indexOf('new');
    const update = trackEdit(source, { start: start + 1, end: start + 2, text: 'E' });
    assert.ok('edit' in update);
    assert.equal(apply(source.slice(0, start + 1) + 'E' + source.slice(start + 2), update.edit), String.raw`\added{nEw}`);

    const deletion = trackEdit(source, { start, end: start + 3, text: '' });
    assert.ok('edit' in deletion);
    const afterNative = source.slice(0, start) + source.slice(start + 3);
    assert.equal(apply(afterNative, deletion.edit), '');
});

test('replaced new branch edits preserve old text, restore it, and become deleted when emptied', () => {
    const source = String.raw`\replaced[id=alice,comment={reviewed}]{new}{old}`;
    const open = source.indexOf('{new}') + 1;
    const update = trackEdit(source, { start: open + 1, end: open + 2, text: 'E' });
    assert.ok('edit' in update);
    const native = source.slice(0, open + 1) + 'E' + source.slice(open + 2);
    assert.equal(apply(native, update.edit), native);
    assert.ok(native.includes('{old}'));

    const exact = String.raw`\replaced{new}{old}`;
    const newStart = exact.indexOf('{new}') + 1;
    const restore = trackEdit(exact, { start: newStart, end: newStart + 3, text: 'old' });
    assert.ok('edit' in restore);
    const restoreAfterNative = exact.slice(0, newStart) + 'old' + exact.slice(newStart + 3);
    assert.equal(apply(restoreAfterNative, restore.edit), 'old');

    const emptyStart = exact.indexOf('{new}') + 1;
    const empty = trackEdit(exact, { start: emptyStart, end: emptyStart + 3, text: '' });
    assert.ok('edit' in empty);
    const emptyAfterNative = exact.slice(0, emptyStart) + exact.slice(emptyStart + 3);
    assert.equal(apply(emptyAfterNative, empty.edit), String.raw`\deleted{old}`);
    assert.equal(apply(emptyAfterNative, empty.edit).includes('id=alice'), false);

    const annotated = String.raw`\replaced[id=alice,comment={keep}]{x}{y}`;
    const annotatedStart = annotated.indexOf('{x}') + 1;
    const annotatedEmpty = trackEdit(annotated, { start: annotatedStart, end: annotatedStart + 1, text: '' });
    assert.ok('edit' in annotatedEmpty);
    const annotatedAfter = annotated.slice(0, annotatedStart) + annotated.slice(annotatedStart + 1);
    assert.equal(apply(annotatedAfter, annotatedEmpty.edit), String.raw`\deleted[id=alice,comment={keep}]{y}`);
});

test('session merges continuous deletions and typing over a generated deletion', () => {
    const source = String.raw`B\deleted[id=alice]{C}`;
    const start = source.indexOf('\\deleted');
    const end = source.length;
    const previous = { start, end };
    const removePrevious = trackEdit(source, { start: 0, end: 1, text: '' }, undefined, previous);
    assert.ok('edit' in removePrevious);
    assert.equal(apply(source.slice(1), removePrevious.edit), String.raw`\deleted[id=alice]{BC}`);
    assert.equal(removePrevious.cursor, 0);

    const insert = trackEdit(source, { start, end: start, text: 'new' }, undefined, previous);
    assert.ok('edit' in insert);
    assert.equal(apply(source.slice(0, start) + 'new' + source.slice(start), insert.edit), String.raw`B\replaced[id=alice]{new}{C}`);
    assert.equal('}'[0], String.raw`B\replaced[id=alice]{new}{C}`[insert.cursor]);
});

test('merge requires directly adjacent matching authors and does not lose comments', () => {
    const source = String.raw`\added[id=a]{one}\added[id=a]{two}`;
    const changes = parseChanges(source).changes;
    const merged = mergeChanges(source, changes);
    assert.ok('start' in merged);
    assert.equal(apply(source, merged), String.raw`\added[id=a]{onetwo}`);

    const spaced = String.raw`\added{one} \added{two}`;
    assert.ok('reason' in mergeChanges(spaced, parseChanges(spaced).changes));
    const authors = String.raw`\added[id=a]{one}\added[id=b]{two}`;
    assert.ok('reason' in mergeChanges(authors, parseChanges(authors).changes));
    const commented = String.raw`\added[id=a,comment={note}]{one}\added[id=a]{two}`;
    assert.ok('reason' in mergeChanges(commented, parseChanges(commented).changes));

    const nested = String.raw`\added{one\deleted{x}}\added{two}`;
    assert.ok('reason' in mergeChanges(nested, parseChanges(nested).changes));
    const paragraph = String.raw`\added{one

two}\added{three}`;
    assert.ok('reason' in mergeChanges(paragraph, parseChanges(paragraph).changes));
    const math = String.raw`\added{$x$}\added{y}`;
    assert.ok('reason' in mergeChanges(math, parseChanges(math).changes));
});

test('makeRevision includes validated author metadata', () => {
    assert.equal(makeRevision('old', 'new', 'editor_1'), String.raw`\replaced[id=editor_1]{new}{old}`);
    assert.equal(makeRevision('', 'new', ''), String.raw`\added{new}`);
    assert.throws(() => makeRevision('old', 'new', 'unsafe id'), RangeError);
});
