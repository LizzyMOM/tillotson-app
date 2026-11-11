"use client";
import { useEffect } from "react";

/** Opens the calendar at today: scrolls to the next (or running) event, finished ones sit above it. */
export default function ScrollToNext() {
  useEffect(() => {
    if (location.hash) return; // a shared link to somewhere else wins
    document.getElementById("next")?.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
