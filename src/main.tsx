import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./fonts.ts";
import "./styles/themes.css";
import "./styles/app.css";
import { AppProvider, applyEarlyTheme } from "./state/store.tsx";
import { App } from "./App.tsx";

applyEarlyTheme();

// The desktop app has no reason to show the browser's own context menu.
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest("input, textarea")) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
