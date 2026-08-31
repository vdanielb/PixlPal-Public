import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PrivacyPage } from "./pages/PrivacyPage";
import { TermsPage } from "./pages/TermsPage";
import { routeFromPath, type AppRoute } from "./lib/routing";
import "./styles.css";

function Root() {
  const [route, setRoute] = useState<AppRoute>(() => routeFromPath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (route === "privacy") return <PrivacyPage />;
  if (route === "terms") return <TermsPage />;
  return <App />;
}

async function prepare(): Promise<void> {
  // Dev-only WebMCP stub: `pnpm dev:web` + `?webmcp-stub` exercises the tool
  // bridge without a WebMCP-enabled browser. Installed before React mounts so
  // registration finds it. Tree-shaken out of production builds.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("webmcp-stub")) {
    const { installWebMcpStub } = await import("./lib/webmcp/devStub");
    installWebMcpStub();
  }
}

void prepare().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
});
