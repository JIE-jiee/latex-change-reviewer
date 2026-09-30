import { LatexChange } from './changeTypes';

export function currentChange(changes: LatexChange[], offset: number): LatexChange | undefined {
  return changes.find(change => change.start <= offset && offset < change.end);
}

export function adjacentChange(changes: LatexChange[], offset: number, direction: 1 | -1): LatexChange | undefined {
  const current = currentChange(changes, offset);
  const anchor = current?.start ?? offset;
  if (direction === 1) return changes.find(change => change.start > anchor);
  return [...changes].reverse().find(change => change.start < anchor);
}

export function nextAfterEdit(changes: LatexChange[], start: number): LatexChange | undefined {
  return changes.find(change => change.start >= start);
}
