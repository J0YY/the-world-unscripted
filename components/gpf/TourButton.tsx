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
            description: "Welcome to your command center. From here, you monitor global stability and direct your nation's covert response.",
          },
        },
        {
          element: "#gpf-pressure",
          popover: {
            title: "Global Pressure Index",
            description: "This gauge tracks the aggregate stress on the international system. If it spikes too high, the system enters a chaotic cascade state.",
          },
        },
        {
          element: "#gpf-hotspots",
          popover: {
            title: "Active Hotspots",
            description: "Geopolitical flashpoints requiring decision. These drive the narrative and contribute to global pressure.",
          },
        },
        {
          element: "#gpf-map",
          popover: {
            title: "World Map Projection",
            description: "A visualization of pressure intensity and intelligence coverage. Toggle layers to see different data dimensions.",
          },
        },
        {
          element: "#gpf-feed",
          popover: {
            title: "Intelligence Feed",
            description: "Inbound cables and news tickers. This provides context for the quantitative data on the map.",
          },
        },
        {
          element: ".prompt-console",
          popover: {
            title: "Command Deck",
            description: "Prompt-first interface. Type a directive; the system translates it into operations (when AI is online).",
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
    const hasSeenTour = localStorage.getItem("world-unscripted-tour-seen-v1");
    if (!hasSeenTour) {
      // Wait for the game fade-in (approx 2.6s) to finish before starting tour
      const timer = setTimeout(() => {
        startTour();
        localStorage.setItem("world-unscripted-tour-seen-v1", "true");
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
