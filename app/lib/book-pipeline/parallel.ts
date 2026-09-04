/** Keep the request alive until every dispatched call has persisted its result.
 * Promise.all's early rejection would abandon sibling paid calls on Workers. */
export async function settleAll<T>(tasks: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(tasks);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
}
