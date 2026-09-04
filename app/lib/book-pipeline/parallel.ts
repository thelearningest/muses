/** Keep the request alive until every dispatched call has persisted its result.
 * Promise.all's early rejection would abandon sibling paid calls on Workers. */
export async function settleAll<T>(tasks: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(tasks);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
}

export async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, map: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error("Invalid concurrency");
  const output: R[] = new Array(items.length);
  let next = 0, failed = false;
  await settleAll(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { output[index] = await map(items[index], index); }
      catch (error) { failed = true; throw error; }
    }
  }));
  return output;
}
