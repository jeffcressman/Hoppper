import { describe, it, expect } from 'vitest';
import { createEditHistory } from '../../src/hop-editor/history';

describe('createEditHistory — undo and redo', () => {
  it('starts at what it was given, with nothing to undo or redo', () => {
    const h = createEditHistory('a');
    expect(h.current).toBe('a');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it('undo walks back through edits, and redo forward again', () => {
    const h = createEditHistory('a');
    h.push('b');
    h.push('c');
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.canUndo).toBe(false);
    expect(h.redo()).toBe('b');
    expect(h.redo()).toBe('c');
    expect(h.canRedo).toBe(false);
  });

  it('a new edit after an undo drops what could have been redone', () => {
    const h = createEditHistory('a');
    h.push('b');
    h.undo();
    h.push('x');
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe('a');
  });

  it('undo with nothing to undo stays put', () => {
    const h = createEditHistory('a');
    expect(h.undo()).toBe('a');
    expect(h.redo()).toBe('a');
  });

  it('keeps a bounded number of steps', () => {
    const h = createEditHistory(0, 3);
    for (let i = 1; i <= 5; i++) h.push(i);
    expect([h.undo(), h.undo(), h.undo()]).toEqual([4, 3, 3]);
  });
});
