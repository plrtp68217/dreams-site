import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

export function scrollToAnchor(anchor: string, smooth = true): boolean {
  const el = document.getElementById(anchor);
  if (!el) return false;
  el.scrollIntoView?.({ behavior: smooth ? "smooth" : "instant", block: "start" });
  if (el.classList.contains("quest")) {
    el.classList.remove("flash");
    void el.offsetWidth; // restart the highlight animation
    el.classList.add("flash");
  }
  return true;
}

/**
 * Scenario texts keep the legacy in-page links (#ff-v01, #loc-ff-05, #ff-final…).
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
