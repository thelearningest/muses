import { isGamePackage, type GamePackage } from "./game-package";

const LEGACY_KEY = "design-book-rpg-library:v1";

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("design-book-rpg-library", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("games", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("This browser could not open your saved games. Allow site storage and try again."));
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("games", mode);
    const request = run(tx.objectStore("games"));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error("Could not save the game on this device. Free some browser storage and try again; your unfinished upload is still recoverable.")); };
  });
}

function legacyGames(): GamePackage[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(isGamePackage) : [];
  } catch { return []; }
}

export async function loadGameLibrary(): Promise<GamePackage[]> {
  const saved = (await transaction("readonly", (store) => store.getAll())).filter(isGamePackage);
  const games = new Map(legacyGames().map((game) => [game.id, game]));
  saved.forEach((game) => games.set(game.id, game));
  return [...games.values()].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

// Await the committed transaction BEFORE acknowledging/deleting server recovery.
export async function saveLibraryGame(game: GamePackage): Promise<void> {
  await transaction("readwrite", (store) => store.put(game));
}

export async function removeLibraryGame(id: string): Promise<void> {
  await transaction("readwrite", (store) => store.delete(id));
  localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyGames().filter((game) => game.id !== id)));
}
