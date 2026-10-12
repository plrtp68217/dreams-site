import { useEffect, useId, useState } from "react";
import { currentTheme } from "../lib/theme";

/** Renders a mermaid diagram; the library is loaded lazily since it is large. */
export function Mermaid({ code }: { code: string }) {
  const id = "mmd-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: currentTheme() === "dark" ? "dark" : "neutral" });
        const { svg } = await mermaid.render(id, code);
        if (alive) setSvg(svg);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [code, id]);

  if (svg && !failed) return <div className="mermaid-box" dangerouslySetInnerHTML={{ __html: svg }} />;
  return <pre className="mermaid">{code}</pre>;
}
