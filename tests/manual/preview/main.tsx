import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Game } from "../../../app/Game";
import { isGamePackage, type GamePackage } from "../../../app/game-package";
import "../../../app/globals.css";

function Preview() {
  const [game, setGame] = useState<GamePackage | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/__test_game.json").then((response) => response.json()).then((value) => {
    if (!isGamePackage(value)) throw new Error("Fixture fails the game-package schema"); setGame(value);
  }).catch(() => setError("The verified local test game is not ready. Complete the integration test first.")); }, []);
  return <><aside style={{ padding: "8px 16px", background: "#164c35", color: "#fff", fontSize: "14px" }}>{game ? "VERIFIED SAMPLE GAME" : "LOCAL TEST"} · six-page source sample · no uploads or API calls on this page</aside>{game ? <Game game={game} /> : <p role="status">{error || "Loading verified game…"}</p>}</>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
