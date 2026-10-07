import "./styles.css";
import type { ReactNode } from "react";
export const metadata = {
  title: "Game2Web",
  description: "Turn compatible games into playable web experiences.",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to content</a>{children}</body></html>;
}
