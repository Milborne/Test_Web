"use client";
import { useEffect, useRef, useState } from "react";

export default function PreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const playerOrigin = process.env.NEXT_PUBLIC_PLAYER_ORIGIN ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  useEffect(() => {
    void params.then(({ token: value }) => setToken(value));
  }, [params]);

  async function fullscreen() {
    if (frame.current && document.fullscreenElement !== frame.current) await frame.current.requestFullscreen();
    else if (document.fullscreenElement) await document.exitFullscreen();
  }

  return (
    <main id="main-content" className="player">
      <header><a href="/" className="back">GAME2WEB.</a><span>Temporary preview</span><button type="button" aria-label="Toggle fullscreen" onClick={fullscreen}>⛶</button></header>
      {token && <iframe ref={frame} title="Temporary game preview" className="game-frame" sandbox="allow-scripts allow-same-origin" src={`${playerOrigin}/api/preview/${encodeURIComponent(token)}/`} />}
    </main>
  );
}
