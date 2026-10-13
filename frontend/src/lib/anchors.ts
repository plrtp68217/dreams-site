import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

/** Element with this id, or a place with this data-id (dialogue lines, headings… — see lib/places). */
export function findAnchor(anchor: string): HTMLElement | null {
  const byId = document.getElementById(anchor);
  if (byId) return byId;
  for (const el of document.querySelectorAll<HTMLElement>("[data-id]")) {
    if (el.dataset.id === anchor) return el;
  }
  return null;
}

export function scrollToAnchor(anchor: string, smooth = true): boolean {
  const el = findAnchor(anchor);
  if (!el) return false;
  // sections are long: show their start; smaller targets (cards, lines, headings…) are centred and highlighted
  const isSection = el.tagName === "SECTION";
  el.scrollIntoView?.({ behavior: smooth ? "smooth" : "instant", block: isSection ? "start" : "center" });
  if (!isSection) {
    el.classList.remove("flash");
    void el.offsetWidth; // restart the highlight animation
    el.classList.add("flash");
  }
  return true;
}

/**
 * Scenario texts keep in-page links (#ff-v01, #loc-ff-05, #ff-final…) and tasks point at places by anchor.
 * Scroll if the target is on the current page, otherwise ask the server where it lives.
 */
export function useAnchorNavigation() {
  const navigate = useNavigate();
  return useCallback(
    async (anchor: string) => {
      if (scrollToAnchor(anchor)) {
        window.history.replaceState(null, "", `#${anchor}`);
        return;
      }
      try {
        const target = await api.resolveAnchor(anchor);
        navigate(`/s/${target.page}#${target.anchor}`);
      } catch {
        navigate(`/search?q=${encodeURIComponent(anchor)}`);
      }
    },
    [navigate],
  );
}
