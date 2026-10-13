import DOMPurify from "dompurify";
import parse, {
  attributesToProps,
  domToReact,
  Element,
  Text,
  type DOMNode,
  type HTMLReactParserOptions,
} from "html-react-parser";
import { createElement, useMemo, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { TaskBrief } from "../api/types";
import { useAnchorNavigation } from "../lib/anchors";
import { taskRef, TASK_STATUS_LABEL } from "../lib/labels";
import { isPlace } from "../lib/places";
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

function insideCardHeader(el: Element): boolean {
  let header = false;
  for (let p = el.parent; p instanceof Element; p = p.parent) {
    if (p.name === "header") header = true;
    if (p.name === "article") return header;
  }
  return false;
}

/** Tasks attached to places in this text, and whether new ones can be created from it. */
export interface PlaceTasks {
  section: string;
  tasks: TaskBrief[];
  canCreate: boolean;
}

function PlaceTools({ places, anchor, inline }: { places: PlaceTasks; anchor: string; inline: boolean }) {
  const tasks = places.tasks.filter((t) => t.anchor === anchor);
  if (!tasks.length && !places.canCreate) return null;
  const query = new URLSearchParams({ new: "1", at: places.section, anchor });
  return (
    <span className={`place-tools${inline ? " inline" : ""}`}>
      {tasks.map((t) => (
        <Link
          key={t.id}
          className={`place-task ts-${t.status}`}
          to={`/t/${t.id}`}
          title={`${t.title} — ${TASK_STATUS_LABEL[t.status]}`}
        >
          {taskRef(t.id)}
        </Link>
      ))}
      {places.canCreate && (
        <Link className="place-add" to={`/tasks?${query}`} title="Создать задачу к этому месту сценария">
          + задача
        </Link>
      )}
    </span>
  );
}

interface Props {
  html: string;
  className?: string;
  /** Show task markers on places and «+ задача» links for the team. */
  places?: PlaceTasks;
}

export function ScenarioContent({ html, className = "content", places }: Props) {
  const openImage = useLightbox();
  const goToAnchor = useAnchorNavigation();

  const tree = useMemo(() => {
    const options: HTMLReactParserOptions = {
      replace(node) {
        if (!(node instanceof Element)) return undefined;
        // embedded task cards existed before the task board was separated from the text (old revisions)
        const code = node.attribs["data-task"];
        if (code) return <span className="task-missing">Карточка {code}</span>;
        if (node.name === "pre" && hasClass(node, "mermaid")) {
          return <Mermaid code={textOf(node.children as DOMNode[]).trim()} />;
        }

        const anchor = node.attribs.id || node.attribs["data-id"];
        const tools =
          places && anchor && isPlace(node.name, node.attribs.class, insideCardHeader(node)) ? (
            <PlaceTools places={places} anchor={anchor} inline={node.name === "h3" || node.name === "h4"} />
          ) : null;
        const children = domToReact(node.children as DOMNode[], options);

        if (node.name === "div" && hasClass(node, "line")) {
          const quote = (node.children as DOMNode[]).find((c) => c instanceof Element && c.name === "q") as Element | undefined;
          const text = quote ? textOf(quote.children as DOMNode[]) : textOf(node.children as DOMNode[]);
          return (
            <div className={node.attribs.class} id={node.attribs.id} data-id={node.attribs["data-id"]}>
              {children}
              <CopyButton text={text} />
              {tools}
            </div>
          );
        }
        if (tools) {
          const props = attributesToProps(node.attribs) as Record<string, unknown>;
          props.className = `${(props.className as string | undefined) ?? ""} has-place`.trim();
          return createElement(node.name, props, children as ReactNode, tools);
        }
        return undefined;
      },
    };
    return parse(sanitize(html), options);
  }, [html, places]);

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
