import DOMPurify from "dompurify";
import parse, { domToReact, Element, Text, type DOMNode, type HTMLReactParserOptions } from "html-react-parser";
import { useMemo, type MouseEvent, type ReactNode } from "react";
import { useAnchorNavigation } from "../lib/anchors";
import { CopyButton } from "./CopyButton";
import { useLightbox } from "./Lightbox";
import { Mermaid } from "./Mermaid";

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target", "loading"], FORBID_TAGS: ["style", "form", "input"] });
}

export function textOf(nodes: DOMNode[]): string {
  return nodes
    .map((n) => (n instanceof Text ? n.data : n instanceof Element ? textOf(n.children as DOMNode[]) : ""))
    .join("");
}

function hasClass(el: Element, cls: string) {
  return (el.attribs.class ?? "").split(/\s+/).includes(cls);
}

/** Codes of all tasks embedded via <div data-task="CODE"> placeholders. */
export function embeddedTaskCodes(html: string): string[] {
  return Array.from(html.matchAll(/data-task="([^"]+)"/g), (m) => m[1]);
}

interface Props {
  html: string;
  /** Renders an embedded task placeholder. Omit to show a plain reference. */
  renderTask?: (code: string) => ReactNode;
  className?: string;
}

export function ScenarioContent({ html, renderTask, className = "content" }: Props) {
  const openImage = useLightbox();
  const goToAnchor = useAnchorNavigation();

  const tree = useMemo(() => {
    const options: HTMLReactParserOptions = {
      replace(node) {
        if (!(node instanceof Element)) return undefined;
        const code = node.attribs["data-task"];
        if (code) {
          return renderTask ? <>{renderTask(code)}</> : <span className="task-missing">Задача {code}</span>;
        }
        if (node.name === "pre" && hasClass(node, "mermaid")) {
          return <Mermaid code={textOf(node.children as DOMNode[]).trim()} />;
        }
        if (node.name === "div" && hasClass(node, "line")) {
          const quote = (node.children as DOMNode[]).find((c) => c instanceof Element && c.name === "q") as Element | undefined;
          const text = quote ? textOf(quote.children as DOMNode[]) : textOf(node.children as DOMNode[]);
          return (
            <div className={node.attribs.class} data-id={node.attribs["data-id"]}>
              {domToReact(node.children as DOMNode[], options)}
              <CopyButton text={text} />
            </div>
          );
        }
        return undefined;
      },
    };
    return parse(sanitize(html), options);
  }, [html, renderTask]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const link = target.closest("a");
    if (link) {
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#") && href.length > 1) {
        e.preventDefault();
        void goToAnchor(href.slice(1));
      }
      return;
    }
    if (target instanceof HTMLImageElement) openImage(target.currentSrc || target.src, target.alt);
  };

  return (
    <div className={className} onClick={onClick}>
      {tree}
    </div>
  );
}
