import { PhotoFlow } from "@/components/photo-flow";

export default function Home() {
  return (
    <main className="app-shell">
      <header className="brand" aria-label="monRayon">
        <span className="brand-mark" aria-hidden="true">
          m
        </span>
        <span>monRayon</span>
      </header>

      <PhotoFlow />

      <footer className="footer">
        <span aria-hidden="true">🇫🇷</span> Prototype conçu pour les rayons français
      </footer>
    </main>
  );
}
