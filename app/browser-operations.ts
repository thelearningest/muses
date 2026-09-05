/** Browser work has two clocks: rendering needs a visible document, uploads do not. */
export class BrowserOperationError extends Error {
  constructor(readonly phase: string) {
    super(`${phase} took too long. Resume preparation to continue from saved pages.`);
    this.name = "BrowserOperationError";
  }
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

export function waitUntilVisible(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (typeof document === "undefined" || !document.hidden) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { document.removeEventListener("visibilitychange", changed); signal.removeEventListener("abort", abort); };
    const changed = () => { if (!document.hidden) { cleanup(); resolve(); } };
    const abort = () => { cleanup(); reject(signal.reason); };
    document.addEventListener("visibilitychange", changed);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function browserOperation<T>(input: {
  signal: AbortSignal; phase: string; milliseconds: number; visibleOnly?: boolean;
  run(signal: AbortSignal): Promise<T>;
}): Promise<T> {
  input.signal.throwIfAborted();
  if (input.visibleOnly) await waitUntilVisible(input.signal);
  input.signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal.reason);
  input.signal.addEventListener("abort", abort, { once: true });
  let remaining = input.milliseconds;
  let started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  const visibility = input.visibleOnly && typeof document !== "undefined" ? document : undefined;
  const schedule = () => {
    if (running) remaining -= performance.now() - started;
    clearTimeout(timer);
    running = !visibility?.hidden;
    if (running) {
      started = performance.now();
      timer = setTimeout(() => controller.abort(new BrowserOperationError(input.phase)), Math.max(0, remaining));
    }
  };
  visibility?.addEventListener("visibilitychange", schedule);
  schedule();
  try {
    controller.signal.throwIfAborted();
    return await abortable(input.run(controller.signal), controller.signal);
  } finally {
    clearTimeout(timer);
    visibility?.removeEventListener("visibilitychange", schedule);
    input.signal.removeEventListener("abort", abort);
  }
}

/** Serializes PDF decoding only; callers release the slot before uploading. */
export function createRenderQueue(signal: AbortSignal) {
  let tail = Promise.resolve();
  return async <T>(run: () => Promise<T>): Promise<T> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    try {
      await abortable(previous, signal);
      await waitUntilVisible(signal);
      signal.throwIfAborted();
      return await run();
    } finally { release(); }
  };
}
