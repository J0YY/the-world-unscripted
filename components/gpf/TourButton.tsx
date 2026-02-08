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
            description: "Your command center. Monitor global stability, review your country dossier (via the <b>i</b> icon), and direct covert operations.",
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
            description: "Two tabs here. The <b>Intel Assistant</b> answers your questions with deep analysis of the situation. <b>Diplomatic Channels</b> lets you open direct conversations with foreign leaders — threaten, negotiate, or bluff.",
          },
        },
        {
          element: "#gpf-intel",
          popover: {
            title: "Interrogation",
            description: "Your intelligence services may capture spies and operatives from rival nations. When a captive is available, an <b>INTERROGATE</b> button appears. Crack them successfully and you earn <b>Clarity points</b> — these sharpen your intelligence estimates and reveal hidden information on the map. Fail, and the opportunity is lost.",
          },
        },
        {
          element: "#gpf-map",
          popover: {
            title: "Perception Map",
            description: "This is <b>not</b> ground truth — it shows <i>perceived</i> pressure based on your intel quality. Every number is an estimate with a confidence level. The <b>Signals Strip</b> below shows raw intelligence intercepts. Better clarity means better data.",
          },
        },
        {
          element: "#gpf-feed",
          popover: {
            title: "The Wire",
            description: "Real-time headlines and intelligence cables. The <b>scrolling ticker</b> below highlights breaking developments. The <b>globe</b> shows a live world overview.",
          },
        },
        {
          element: ".prompt-console",
          popover: {
            title: "Command Deck",
            description: "Type your orders in natural language. <i>Stabilize the border</i>, <i>Bribe the general</i>, or <i>Leak the documents</i>. Hit the green <b>End turn</b> button when ready. A cinematic transition plays between turns.",
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
    const hasSeenTour = localStorage.getItem("world-unscripted-tour-seen-v5");
    if (!hasSeenTour) {
      // Wait for the game fade-in (approx 2.6s) to finish before starting tour
      const timer = setTimeout(() => {
        startTour();
        localStorage.setItem("world-unscripted-tour-seen-v5", "true");
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
