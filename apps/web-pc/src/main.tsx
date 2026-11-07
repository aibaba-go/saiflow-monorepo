import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@saiflow/ui/styles/fonts.css";
import "@saiflow/ui/styles/tokens.css";
import "./styles/app.css";

import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
