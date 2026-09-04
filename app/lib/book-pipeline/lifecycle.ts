/** Cancellation/expiry is not a recoverable provider failure. */
export class InactiveBookJobError extends Error {
  constructor() { super("The book job is no longer active"); this.name = "InactiveBookJobError"; }
}

export async function requireActiveJob(isActive?: () => Promise<boolean>): Promise<void> {
  if (isActive && !await isActive()) throw new InactiveBookJobError();
}
