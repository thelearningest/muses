import { BrowserOperationError, createRenderQueue } from "./browser-operations";

/** Owns one PDF document and drains its render slot before replacing it. */
export function createRecoverableRenderer<T extends { destroy(): Promise<void> }>(input: {
  signal: AbortSignal;
  open(): Promise<T>;
  onRestart?(): void;
}) {
  const exclusive = createRenderQueue(input.signal);
  let document: Promise<T> | undefined;
  const discard = async () => {
    const previous = document;
    document = undefined;
    const renderer = await previous?.catch(() => undefined);
    await renderer?.destroy();
  };
  return {
    async run<R>(operation: (renderer: T) => Promise<R>): Promise<R> {
      return exclusive(async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            const renderer = await (document ??= input.open());
            input.signal.throwIfAborted();
            return await operation(renderer);
          } catch (error) {
            await discard();
            if (!(error instanceof BrowserOperationError) || input.signal.aborted || attempt === 1) throw error;
            input.onRestart?.();
          }
        }
      });
    },
    destroy: discard,
  };
}
