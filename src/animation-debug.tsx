import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AnimationOverlay } from "./AnimationOverlay";
import "./animation-debug.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AnimationOverlay />
  </StrictMode>,
);
