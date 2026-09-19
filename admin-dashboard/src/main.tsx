import React from "react";
import ReactDOM from "react-dom/client";
// Fonts are self-hosted (bundled from npm): no request to Google, and the strict
// Content-Security-Policy in nginx.conf needs no exception for them.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/theme.css";
import App from "./App";
import { initTheme } from "./theme";

initTheme(); // before the first render, so the first paint already has the right colours

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
