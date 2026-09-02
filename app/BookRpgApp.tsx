"use client";

import { useEffect, useRef, useState } from "react";
import { Game } from "./Game";
import { isGamePackage, type GamePackage } from "./game-package";

const LIBRARY_KEY = "design-book-rpg-library:v1";

const GENERATION_STAGES = [
  { after: 0, label: "Upload received. Preparing your book." },
  { after: 5, label: "Finding chapters and core design ideas." },
  { after: 20, label: "Choosing the lessons worth practicing." },
  { after: 45, label: "Turning each lesson into a design decision." },
  { after: 90, label: "Checking the game and its source references." },
];

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function GenerationProgress({ elapsed, filename }: { elapsed: number; filename: string }) {
  const progress = Math.min(92, Math.round(8 + 84 * (1 - Math.exp(-elapsed / 70))));
  const visibleStages = GENERATION_STAGES.filter((stage) => elapsed >= stage.after);
  const currentStage = visibleStages.at(-1) ?? GENERATION_STAGES[0];

  return (
    <section className="generation-progress" aria-live="polite" aria-labelledby="generation-title">
      <div className="generation-progress-heading">
        <div>
          <span className="eyebrow">Creating your game</span>
          <h3 id="generation-title">Turning the book into practice</h3>
        </div>
        <span className="generation-timer">{formatElapsed(elapsed)}</span>
      </div>
      <p className="generation-filename" title={filename}>{filename}</p>
      <div
        className="generation-meter"
        role="progressbar"
        aria-label="Estimated generation progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="generation-current">
        <span className="generation-pulse" aria-hidden="true" />
        <strong>{currentStage.label}</strong>
        <span>{progress}% estimated</span>
      </div>
      <ol className="generation-log" aria-label="Generation activity">
        {visibleStages.map((stage, index) => (
          <li key={stage.label} className={index === visibleStages.length - 1 ? "is-current" : "is-complete"}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            {stage.label}
          </li>
        ))}
      </ol>
      <p className="generation-wait-note">Longer books can take a few minutes. Keep this tab open; your game will appear automatically.</p>
    </section>
  );
}

function loadGames(): GamePackage[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LIBRARY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isGamePackage) : [];
  } catch {
    return [];
  }
}

export function BookRpgApp() {
  const [games, setGames] = useState<GamePackage[]>([]);
  const [selected, setSelected] = useState<GamePackage | "example" | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationElapsed, setGenerationElapsed] = useState(0);
  const [generationFilename, setGenerationFilename] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setGames(loadGames());
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!generating) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setGenerationElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [generating]);

  const saveGames = (next: GamePackage[]) => {
    setGames(next);
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
  };

  const generateGame = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a PDF book to continue.");
      return;
    }

    setGenerationFilename(file.name);
    setGenerationElapsed(0);
    setGenerating(true);
    setError("");
    try {
      const form = new FormData();
      form.set("book", file);
      form.set("rightsConfirmed", String(rightsConfirmed));
      const response = await fetch("/api/generate-game", { method: "POST", body: form });
      const payload = (await response.json()) as { game?: unknown; error?: string; requestId?: string };
      if (!response.ok || !isGamePackage(payload.game)) {
        throw new Error(
          `${payload.error ?? "The generated game was invalid."}${payload.requestId ? ` Reference: ${payload.requestId}` : ""}`,
        );
      }
      const generatedGame = payload.game;
      const next = [generatedGame, ...games.filter((game) => game.id !== generatedGame.id)];
      saveGames(next);
      setSelected(generatedGame);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "The book could not be transformed. Please retry.");
    } finally {
      setGenerating(false);
    }
  };

  if (selected === "example") {
    return <Game key="example" onExit={() => setSelected(null)} />;
  }
  if (selected) {
    return <Game key={selected.id} game={selected} onExit={() => setSelected(null)} />;
  }

  return (
    <main className="library-shell" aria-busy={!hydrated || generating}>
      <header className="library-header">
        <div className="brand-mark">
          <span>Design learning lab</span>
          <strong>Playable Books</strong>
        </div>
        <span className="intro-edition">Book → decisions → practice</span>
      </header>

      <section className="library-hero">
        <div>
          <span className="eyebrow">For designers who learn by doing</span>
          <h1>Turn what you read into design decisions.</h1>
          <p>
            Upload a design book you have permission to use. We’ll turn its most useful ideas into
            practical choices and feedback, with page references that lead you back to the source.
          </p>
        </div>
        <div className="library-process" aria-label="Generation process">
          <span><strong>01</strong> Upload</span>
          <span><strong>02</strong> Build</span>
          <span><strong>03</strong> Practice</span>
        </div>
      </section>

      <div className="library-grid">
        <section className="upload-panel" aria-labelledby="upload-title">
          <span className="eyebrow">Start here</span>
          <h2 id="upload-title">Create a game from your book</h2>
          {generating ? (
            <GenerationProgress elapsed={generationElapsed} filename={generationFilename} />
          ) : (
            <>
              <form onSubmit={generateGame}>
                <label className="file-field">
                  <span>PDF book</span>
                  <input ref={fileRef} type="file" accept="application/pdf,.pdf" required />
                  <small>Text-based PDF · maximum 50 MB</small>
                </label>
                <label className="rights-field">
                  <input
                    type="checkbox"
                    checked={rightsConfirmed}
                    onChange={(event) => setRightsConfirmed(event.target.checked)}
                    required
                  />
                  <span>I own this book or have permission to use it.</span>
                </label>
                <button className="button button-primary" type="submit" disabled={!hydrated || !rightsConfirmed}>
                  Create my learning game
                  <span aria-hidden="true">→</span>
                </button>
              </form>
              <p className="generation-note">
                The PDF is sent to OpenAI for this generation and is not retained by this application.
              </p>
              <p className="form-error" role="alert" aria-live="assertive">{error}</p>
            </>
          )}
        </section>

        <section className="game-library" aria-labelledby="library-title">
          <div className="library-section-heading">
            <div>
              <span className="eyebrow">Pick up where you left off</span>
              <h2 id="library-title">Your learning games</h2>
            </div>
            <span>{games.length + 1} available</span>
          </div>
          <article className="game-card game-card-featured">
            <div>
              <span className="game-card-kicker">Ready-to-play example · 6 quests</span>
              <h3>The City of Misfit Things</h3>
              <p>Repair a museum of misleading objects and learn the principles of human-centered design.</p>
            </div>
            <button className="button button-yellow" type="button" onClick={() => setSelected("example")}>Play example <span>→</span></button>
          </article>
          {games.map((game) => (
            <article className="game-card" key={game.id}>
              <div>
                <span className="game-card-kicker">Made from your book · {game.quests.length} quests</span>
                <h3>{game.title}</h3>
                <p>{game.subtitle}</p>
                <small>From {game.sourceTitle}</small>
              </div>
              <div className="game-card-actions">
                <button className="button button-yellow" type="button" onClick={() => setSelected(game)}>Play <span>→</span></button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Remove “${game.title}” from this device?`)) {
                      saveGames(games.filter((item) => item.id !== game.id));
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
