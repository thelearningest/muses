export const REPLAY_SAVE_KEY = "playable-books:demo-replay:v1";
export const FIXTURE_DIGEST = "dfc59b9cf2965cbda28409206a2128e643fe530c65804150a3b78c2b97907d4b";
export const REPLAY_DURATION_MS = 12_000;
export const REPLAY_STAGES = ["Reading the design book", "Finding the four core principles", "Turning ideas into print orders", "Preparing the interactive workshop", "Checking the learning journey"];
export type Replay = { version: 1; fixture: typeof FIXTURE_DIGEST; startedAt: number };
export function newReplay(now: number): Replay { return { version: 1, fixture: FIXTURE_DIGEST, startedAt: now }; }
export function restoreReplay(raw: string | null, now: number): Replay | null {
  try {
    const replay: Replay = JSON.parse(raw ?? "null");
    return replay?.version === 1 && replay.fixture === FIXTURE_DIGEST && Number.isFinite(replay.startedAt) && replay.startedAt >= 0 && replay.startedAt <= now ? replay : null;
  } catch { return null; }
}
export function replayProgress(replay: Replay | null, now: number) {
  const progress = replay ? Math.max(0, Math.min(1, (now - replay.startedAt) / REPLAY_DURATION_MS)) : 0;
  return { progress, percent: Math.floor(progress * 100), complete: !!replay && progress === 1, stage: Math.min(REPLAY_STAGES.length - 1, Math.floor(progress * REPLAY_STAGES.length)) };
}
export async function matchesFixture(file: Pick<File, "size" | "arrayBuffer">, digest = (bytes: ArrayBuffer) => crypto.subtle.digest("SHA-256", bytes)): Promise<boolean> {
  if (file.size <= 0 || file.size > 50 * 1024 * 1024) return false;
  const bytes = await digest(await file.arrayBuffer());
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("") === FIXTURE_DIGEST;
}
