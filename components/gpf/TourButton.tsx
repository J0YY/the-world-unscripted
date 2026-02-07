"use client";

import { CircleHelp } from "lucide-react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useEffect, useCallback } from "react";

export default function TourButton() {
  const startTour = useCallback(() => {
    const driverObj = driver({
      showProgress: true,
      animate: true,
      steps: [
        {
          element: "header h1",
          popover: {
            title: "Control Room",
            description: "Your command center. Monitor global stability, review your country dossier (via the 'i' icon), and direct covert operations.",
          },
        },
        {
          element: "#gpf-pressure",
          popover: {
            title: "Global Pressure Index",
            description: "The aggregate stress on the international system. If this spikes too high, the world enters a chaotic cascade state.",
          },
        },
        {
          element: "#gpf-turn-deltas",
          popover: {
            title: "Turn Shifts",
            description: "Track exactly how your last decision impacted global metrics and stability scores turn-over-turn.",
          },
        },
        {
          element: "#gpf-intel",
          popover: {
            title: "Intel & Diplomacy",
            description: "Toggle between the **Intel Assistant** (for deep analysis) and **Diplomatic Channels** (to chat directly with foreign leaders).",
          },
        },
        {
          element: "#gpf-hotspots",
          popover: {
            title: "Active Hotspots",
            description: "Geopolitical flashpoints. Resolving these drives the narrative. Ignore them at your peril.",
          },
        },
        {
          element: "#gpf-map",
          popover: {
            title: "Perception Map",
            description: "Visualizes pressure intensity and intel coverage. Use the toggles to filter layers (e.g. Political Fog vs. Raw Pressure).",
          },
        },
        {
          element: "#gpf-feed",
          popover: {
            title: "The Wire",
            description: "Real-time headlines and intelligence cables. Watch this for the public reaction to your private moves.",
          },
        },
        {
          element: ".prompt-console",
          popover: {
            title: "Command Deck",
            description: "Type your orders here in natural language. 'Stabilize the border', 'Bribe the general', or 'Leak the documents'.",
          },
        },
      ],
      onDestroyStarted: () => {
          if(!driverObj.hasNextStep() || confirm("Are you sure you want to exit the tour?")) {
              driverObj.destroy();
          }
      },
    });

    driverObj.drive();
  }, []);

  useEffect(() => {
    const hasSeenTour = localStorage.getItem("world-unscripted-tour-seen-v2");
    if (!hasSeenTour) {
      // Wait for the game fade-in (approx 2.6s) to finish before starting tour
      const timer = setTimeout(() => {
        startTour();
        localStorage.setItem("world-unscripted-tour-seen-v2", "true");
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [startTour]);

  return (
    <button
      onClick={startTour}
      className="p-1.5 hover:bg-[var(--ds-gray-alpha-200)] rounded-md text-[var(--ds-gray-900)] transition-colors"
      title="Start Tour"
      aria-label="Start Tour"
    >
      <CircleHelp size={16} />
    </button>
  );
}
