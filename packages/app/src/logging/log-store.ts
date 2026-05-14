import { defineStore } from 'pinia';
import { ref } from 'vue';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  at: number;
  level: LogLevel;
  category: string;
  message: string;
  data?: unknown;
}

const MAX_ENTRIES = 500;

let nextId = 0;
const buffer: LogEntry[] = [];
const subscribers = new Set<(entries: ReadonlyArray<LogEntry>) => void>();

// `log()` is callable before Pinia is installed (we use it inside bootstrap
// itself), so the buffer lives at module scope and the Pinia store
// subscribes to it on creation. This avoids a chicken-and-egg between
// "create logging store" and "log the first message from bootstrap".
export function log(
  level: LogLevel,
  category: string,
  message: string,
  data?: unknown,
): void {
  const entry: LogEntry = {
    id: nextId++,
    at: Date.now(),
    level,
    category,
    message,
    data,
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  for (const fn of subscribers) fn(buffer);
}

export const useLogStore = defineStore('log', () => {
  const entries = ref<LogEntry[]>([...buffer]);
  const visible = ref(false);

  const sub = (snapshot: ReadonlyArray<LogEntry>) => {
    entries.value = [...snapshot];
  };
  subscribers.add(sub);

  function clear(): void {
    buffer.length = 0;
    entries.value = [];
  }

  function toggle(): void {
    visible.value = !visible.value;
  }

  function show(): void {
    visible.value = true;
  }

  return { entries, visible, clear, toggle, show };
});

// Install global capture for uncaught errors + unhandled rejections, so they
// land in the log panel instead of being invisible to the user.
export function installGlobalErrorCapture(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (ev) => {
    const err = ev.error ?? ev.message;
    log('error', 'window', stringifyError(err), {
      filename: ev.filename,
      lineno: ev.lineno,
      colno: ev.colno,
    });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    log('error', 'promise', stringifyError(ev.reason), { reason: ev.reason });
  });
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
