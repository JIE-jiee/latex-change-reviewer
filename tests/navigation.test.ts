import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseChanges } from '../src/parser';
import { currentChange, adjacentChange, nextAfterEdit } from '../src/navigation';

test('cursor in arguments resolves outer change, with exclusive end', () => {
  const source = String.raw`\replaced{new \added{inner}}{old} \added{last}`;
  const changes = parseChanges(source).changes;
  assert.equal(currentChange(changes, source.indexOf('inner')), changes[0]);
  assert.equal(currentChange(changes, changes[0].end), undefined);
  assert.equal(adjacentChange(changes, source.indexOf('inner'), 1), changes[1]);
  assert.equal(adjacentChange(changes, changes[1].start, -1), changes[0]);
  assert.equal(adjacentChange(changes, changes[1].start, 1), undefined);
});

test('auto-next includes newly exposed nested changes at the edited start', () => {
  const changes = parseChanges(String.raw`\added{inner} next \deleted{old}`).changes;
  assert.equal(nextAfterEdit(changes, 0), changes[0]);
  assert.equal(nextAfterEdit(changes, 1), changes[1]);
  assert.equal(nextAfterEdit(changes, 1000), undefined);
});
