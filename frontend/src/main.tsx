import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { applySavedTheme } from "./lib/theme";
import "./styles/scenario.css";
import "./styles/app.css";
import "./styles/tokens.css";
import "./styles/workspace.css";

applySavedTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
