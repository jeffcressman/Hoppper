/** Undo/redo over whole states — each hop edit produces a new take. */
export interface EditHistory<T> {
  readonly current: T;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  push(next: T): void;
  undo(): T;
  redo(): T;
}

/** Keeps at most `limit` states; the oldest drop off. */
export function createEditHistory<T>(initial: T, limit = 200): EditHistory<T> {
  let states: T[] = [initial];
  let at = 0;
  return {
    get current() {
      return states[at]!;
    },
    get canUndo() {
      return at > 0;
    },
    get canRedo() {
      return at < states.length - 1;
    },
    push(next) {
      states = [...states.slice(0, at + 1), next].slice(-limit);
      at = states.length - 1;
    },
    undo() {
      if (at > 0) at -= 1;
      return states[at]!;
    },
    redo() {
      if (at < states.length - 1) at += 1;
      return states[at]!;
    },
  };
}
