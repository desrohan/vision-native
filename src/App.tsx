import { useState, useEffect } from "react";
import CameraPreview from "./components/CameraPreview";
import Settings from "./components/Settings";
import OverlayHUD from "./components/OverlayHUD";

function App() {
  // Overlay window loads with ?page=overlay
  const params = new URLSearchParams(window.location.search);
  if (params.get("page") === "overlay") return <OverlayHUD />;

  const [route, setRoute] = useState(window.location.hash || "#/");

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (route === "#/settings") return <Settings />;
  return <CameraPreview />;
}

export default App;
