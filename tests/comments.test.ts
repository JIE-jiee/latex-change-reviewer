import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseChanges } from '../src/parser';
import { escapeCommentText, makeHighlight, makeStandaloneComment, removeComment, setComment, unescapeCommentText } from '../src/comments';

test('attached comments parse only the known comment field and retain full optional range', () => {
    const source = String.raw`\replaced[id={A,B}, extra={x,y}, comment={words \{quoted\}}]{new}{old}`;
    const parsed = parseChanges(source);
    const change = parsed.changes[0];
    assert.equal(change.authorId, '{A,B}');
    assert.deepEqual(change.optionalRange && source.slice(change.optionalRange.start, change.optionalRange.end), '[id={A,B}, extra={x,y}, comment={words \\{quoted\\}}]');
    assert.equal(parsed.comments.length, 1);
    assert.equal(parsed.comments[0].kind, 'attached');
    assert.equal(source.slice(parsed.comments[0].contentRange.start, parsed.comments[0].contentRange.end), String.raw`words \{quoted\}`);
    assert.deepEqual(parsed.comments[0].anchorRange, { start: change.start, end: change.end });
});

test('duplicate comment metadata is left uninterpreted, and highlight still parses nested changes', () => {
    const source = String.raw`\highlight{before \added{x}} \added[id=a,comment={one},comment={two}]{y}`;
    const parsed = parseChanges(source);
    assert.equal(parsed.changes.length, 2);
    assert.equal(parsed.comments.length, 0);
});

test('highlight and standalone comments are collected without becoming changes', () => {
    const source = String.raw`\highlight[comment={focus}]{selected} \comment[id={alice,co}, extra={x,y}]{why {here}}`;
    const parsed = parseChanges(source);
    assert.equal(parsed.changes.length, 0);
    assert.deepEqual(parsed.comments.map(c => c.kind), ['highlight', 'standalone']);
    assert.equal(source.slice(parsed.comments[0].contentRange.start, parsed.comments[0].contentRange.end), 'focus');
    assert.equal(source.slice(parsed.comments[1].contentRange.start, parsed.comments[1].contentRange.end), 'why {here}');
    assert.equal(source.slice(parsed.comments[1].optionalRange!.start, parsed.comments[1].optionalRange!.end), '[id={alice,co}, extra={x,y}]');
});

test('comment text escaping round trips TeX-sensitive punctuation', () => {
    const text = 'a{b}%c_#&$\\\\';
    assert.equal(unescapeCommentText(escapeCommentText(text)), text);
    assert.equal(escapeCommentText('\\alpha'), String.raw`\textbackslash{}alpha`);
});

test('editing a comment preserves other raw metadata and whitespace', () => {
    const source = String.raw`\added[ id=alice , extra={x,y} ]{hello}`;
    const change = parseChanges(source).changes[0];
    const edit = setComment(source, change, 'new % note');
    const updated = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    assert.match(updated, /id=alice/);
    assert.match(updated, /extra=\{x,y\}/);
    assert.match(updated, /comment=\{new \\% note\}/);
    const reparsed = parseChanges(updated);
    assert.equal(reparsed.comments[0].kind, 'attached');
    const removal = removeComment(updated, reparsed.changes[0]);
    const removed = updated.slice(0, removal.start) + removal.text + updated.slice(removal.end);
    assert.match(removed, /id=alice/);
    assert.match(removed, /extra=\{x,y\}/);
    assert.doesNotMatch(removed, /comment=/);
});

test('comment wrappers are emitted with valid metadata structure', () => {
    assert.equal(makeHighlight('text', 'look', 'alice'), String.raw`\highlight[id=alice, comment={look}]{text}`);
    assert.equal(makeHighlight('text', 'look', ''), String.raw`\highlight[comment={look}]{text}`);
    assert.equal(makeStandaloneComment('why'), String.raw`\comment{why}`);
    assert.equal(makeStandaloneComment('why', 'alice'), String.raw`\comment[id=alice]{why}`);
});

test('standalone text can be replaced and removed as a whole macro; highlights unwrap on removal', () => {
    const standalone = String.raw`prefix \comment[id=alice]{old} suffix`;
    const comment = parseChanges(standalone).comments[0];
    const set = setComment(standalone, comment, 'new');
    assert.equal(standalone.slice(0, set.start) + set.text + standalone.slice(set.end), String.raw`prefix \comment[id=alice]{new} suffix`);
    const remove = removeComment(standalone, comment);
    assert.equal(standalone.slice(0, remove.start) + remove.text + standalone.slice(remove.end), 'prefix  suffix');

    const highlighted = String.raw`\highlight[comment={look}]{anchor}`;
    const highlight = parseChanges(highlighted).comments[0];
    const unwrapped = removeComment(highlighted, highlight);
    assert.equal(highlighted.slice(0, unwrapped.start) + unwrapped.text + highlighted.slice(unwrapped.end), 'anchor');
});

test('optional metadata splitting respects odd and even backslash parity around commas', () => {
    const oddSlash = String.raw`\added[id=a,comment=left\,right]{x}`;
    const oddChange = parseChanges(oddSlash).changes[0];
    assert.equal(oddChange.comment && oddSlash.slice(oddChange.comment.contentRange.start, oddChange.comment.contentRange.end), String.raw`left\,right`);
    const oddEdit = setComment(oddSlash, oddChange, 'updated');
    assert.equal(oddSlash.slice(0, oddEdit.start) + oddEdit.text + oddSlash.slice(oddEdit.end), String.raw`\added[id=a,comment=updated]{x}`);

    const evenSlash = String.raw`\added[id=a\\, comment={old}]{x}`;
    const evenChange = parseChanges(evenSlash).changes[0];
    assert.equal(evenChange.comment && evenSlash.slice(evenChange.comment.contentRange.start, evenChange.comment.contentRange.end), 'old');
    const evenEdit = setComment(evenSlash, evenChange, 'new');
    assert.equal(evenSlash.slice(0, evenEdit.start) + evenEdit.text + evenSlash.slice(evenEdit.end), String.raw`\added[id=a\\, comment={new}]{x}`);
});

test('malformed and duplicate comment fields are rejected by editing helpers', () => {
    const malformed = String.raw`\added[id=a,comment={one}{two}]{x}`;
    const malformedChange = parseChanges(malformed).changes[0];
    assert.equal(malformedChange.comment, undefined);
    assert.throws(() => setComment(malformed, malformedChange, 'replacement'), /Malformed comment field/);

    const duplicate = String.raw`\added[id=a,comment={one}, comment={two}]{x}`;
    const duplicateChange = parseChanges(duplicate).changes[0];
    assert.equal(duplicateChange.comment, undefined);
    assert.throws(() => setComment(duplicate, duplicateChange, 'replacement'), /Duplicate comment fields/);

    const malformedDuplicate = String.raw`\added[id=a,comment,comment={two}]{x}`;
    const malformedBareChange = parseChanges(malformedDuplicate).changes[0];
    assert.equal(malformedBareChange.comment, undefined);
    assert.throws(() => setComment(malformedDuplicate, malformedBareChange, 'replacement'), /Malformed comment field/);
});

test('adding metadata preserves exact optional whitespace and handles an existing trailing separator', () => {
    const source = String.raw`\added[  id={author\,one}   ]{x}`;
    const change = parseChanges(source).changes[0];
    const edit = setComment(source, change, 'note');
    const updated = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    assert.equal(updated, String.raw`\added[  id={author\,one}, comment={note}   ]{x}`);

    const trailing = String.raw`\added[id=a,  ]{x}`;
    const trailingEdit = setComment(trailing, parseChanges(trailing).changes[0], 'note');
    assert.equal(trailing.slice(0, trailingEdit.start) + trailingEdit.text + trailing.slice(trailingEdit.end), String.raw`\added[id=a, comment={note}  ]{x}`);
});

test('editing an unbraced comment groups commas and closing optional delimiters', () => {
    const source = String.raw`\added[id=a,comment=old]{text}`;
    const edit = setComment(source, parseChanges(source).changes[0], 'A, B]');
    const updated = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    assert.equal(updated, String.raw`\added[id=a,comment={A, B]}]{text}`);
    const parsed = parseChanges(updated);
    assert.equal(parsed.issues.length, 0);
    assert.equal(parsed.comments.length, 1);
    assert.equal(updated.slice(parsed.comments[0].contentRange.start, parsed.comments[0].contentRange.end), 'A, B]');
});
