import { useEffect } from "react";
import { mountStrikerLegacyApp } from "@/lib/strikerLegacyEngine";

export default function StrikerLegacyApp() {
  useEffect(() => {
    const dispose = mountStrikerLegacyApp();
    return () => {
      dispose();
    };
  }, []);

  return (
    <div
      id="striker-root"
      className="app-base text-gray-900 dark:text-gray-100 min-h-screen transition-colors duration-300"
    />
  );
}
