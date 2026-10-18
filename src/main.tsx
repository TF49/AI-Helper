import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { clientTelemetry } from "./lib/clientTelemetry";
import "./index.css";

// 启动客户端全量遥测与故障自检上报 (自动动态读取当前安装包真实版本)
void clientTelemetry.init();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="ai-helper-theme">
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
