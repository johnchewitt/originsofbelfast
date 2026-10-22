import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import esriConfig from "@arcgis/core/config.js";

import "@arcgis/map-components/components/arcgis-scene";
import "@esri/calcite-components/components/calcite-switch";

import "@arcgis/core/assets/esri/themes/dark/main.css";
import "@esri/calcite-components/main.css";
import "@arcgis/map-components/main.css";
import "./styles/global.css";

import App from "./App";
import { CONFIG } from "./config";

esriConfig.portalUrl = CONFIG.portalUrl;
if (CONFIG.apiKey) esriConfig.apiKey = CONFIG.apiKey;
if (CONFIG.localAssets) esriConfig.assetsPath = `${CONFIG.assetBase}arcgis-assets`;
esriConfig.log.level = import.meta.env.DEV ? "warn" : "error";

document.body.classList.add("calcite-mode-dark");

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
