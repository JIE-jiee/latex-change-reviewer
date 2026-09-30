import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseChanges, replacementText } from '../src/parser';

function only(source: string) {
    const result = parseChanges(source);
    assert.equal(result.issues.length, 0, result.issues.map(x => x.message).join('; '));
    assert.equal(result.changes.length, 1);
    return result.changes[0];
}

test('replaced uses standard new-first argument order', () => {
    const source = String.raw`\replaced{new}{old}`;
    const change = only(source);
    assert.equal(replacementText(source, change, 'accept'), 'new');
    assert.equal(replacementText(source, change, 'reject'), 'old');
});

test('added and deleted acceptance rules', () => {
    const added = String.raw`\added{new text}`;
    assert.equal(replacementText(added, only(added), 'accept'), 'new text');
    assert.equal(replacementText(added, only(added), 'reject'), '');
    const deleted = String.raw`\deleted{old text}`;
    assert.equal(replacementText(deleted, only(deleted), 'accept'), '');
    assert.equal(replacementText(deleted, only(deleted), 'reject'), 'old text');
});

test('brace aware parsing preserves multiline text and nested TeX groups', () => {
    const source = String.raw`\replaced{
$R=\frac{\Delta_{\mathrm{top}}}{H}$
}{
$R=\frac{\Delta}{H}$
}`;
    const change = only(source);
    assert.equal(replacementText(source, change, 'accept'), String.raw`
$R=\frac{\Delta_{\mathrm{top}}}{H}$
`);
});

test('references and escaped braces do not break argument boundaries', () => {
    const source = String.raw`\replaced{See Eq.~\eqref{eq:new} and \{literal\}.}{See Eq.~\eqref{eq:old}.}`;
    const change = only(source);
    assert.equal(replacementText(source, change, 'accept'), String.raw`See Eq.~\eqref{eq:new} and \{literal\}.`);
});

test('comments and escaped percent are handled', () => {
    const source = String.raw`% \added{ignored}
50\%, \added{kept}`;
    const result = parseChanges(source);
    assert.equal(result.issues.length, 0);
    assert.equal(result.changes.length, 1);
    assert.equal(replacementText(source, result.changes[0], 'accept'), 'kept');
});

test('whitespace, comments between arguments and optional metadata are accepted', () => {
    const source = String.raw`\replaced[id=Alice, comment={word change}]
{new} % separator
{old}`;
    const change = only(source);
    assert.equal(replacementText(source, change, 'accept'), 'new');
    assert.equal(replacementText(source, change, 'reject'), 'old');
});

test('same-line changes remain separate and nested changes are children', () => {
    const source = String.raw`\added{one} \replaced{new \added{inner}}{old}`;
    const result = parseChanges(source);
    assert.equal(result.issues.length, 0);
    assert.equal(result.changes.length, 2);
    assert.equal(result.changes[1].children.length, 1);
    assert.equal(result.changes[1].children[0].type, 'added');
    assert.equal(replacementText(source, result.changes[1], 'accept'), String.raw`new \added{inner}`);
});

test('commented review commands, verb, and verbatim-like environments are ignored', () => {
    const source = String.raw`% \added{comment}
\verb|\deleted{x}|
\begin{lstlisting}
\replaced{a}{b}
\end{lstlisting}
\added{real}`;
    const result = parseChanges(source);
    assert.equal(result.issues.length, 0);
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0].type, 'added');
});

test('verbatim environments treat comments and apparent nested starts as raw content', () => {
    const source = String.raw`\begin{verbatim}
% \end{verbatim}
\begin{verbatim}
\added{not a change}
\end{verbatim}
\added{real}`;
    const result = parseChanges(source);
    assert.equal(result.issues.length, 0);
    assert.equal(result.changes.length, 1);
    assert.equal(replacementText(source, result.changes[0], 'accept'), 'real');
});

test('common command definitions are skipped', () => {
    const source = String.raw`\newcommand{\demo}[1]{\added{#1}}
\renewcommand{\x}{\deleted{definition}}
\added{real}`;
    const result = parseChanges(source);
    assert.equal(result.issues.length, 0);
    assert.equal(result.changes.length, 1);
    assert.equal(replacementText(source, result.changes[0], 'accept'), 'real');
});

test('unclosed arguments produce diagnostics and stop uncertain scanning', () => {
    const source = String.raw`\replaced{old}{unfinished \added{x}`;
    const result = parseChanges(source);
    assert.equal(result.changes.length, 0);
    assert.equal(result.issues.length, 1);
});

test('unclosed verb commands produce diagnostics instead of a clean parse', () => {
    const result = parseChanges(String.raw`\added{ok} \verb|unterminated`);
    assert.equal(result.changes.length, 1);
    assert.equal(result.issues.length, 1);
    assert.match(result.issues[0].message, /verb/);
});

test('nested parsing cannot borrow an outer argument and blocks unsafe parent review', () => {
    const result = parseChanges(String.raw`\replaced{\replaced{inner}}{old}`);
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0].blocked, true);
    assert.equal(result.issues.length, 1);
});

test('CRLF and multilingual text are preserved exactly', () => {
    const source = '\\added{中文\r\n日本語 English}';
    const change = only(source);
    assert.equal(replacementText(source, change, 'accept'), '中文\r\n日本語 English');
});

test('command names are matched exactly', () => {
    const source = String.raw`\replacedExtra{a}{b} \added{x}`;
    const result = parseChanges(source);
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0].type, 'added');
});
