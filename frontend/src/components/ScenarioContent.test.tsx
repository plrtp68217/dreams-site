import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { brief, visitorsHtml } from "../test/utils";
import { LightboxProvider } from "./Lightbox";
import { sanitize, ScenarioContent, type PlaceTasks } from "./ScenarioContent";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="diagram"></svg>' }),
  },
}));

function Where() {
  const loc = useLocation();
  return <output data-testid="location">{loc.pathname + loc.hash + loc.search}</output>;
}

function renderContent(html: string, places?: PlaceTasks) {
  return render(
    <MemoryRouter initialEntries={["/s/here"]}>
      <LightboxProvider>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <ScenarioContent html={html} places={places} />
                <Where />
              </>
            }
          />
        </Routes>
      </LightboxProvider>
    </MemoryRouter>,
  );
}

describe("ScenarioContent", () => {
  it("strips scripts and inline handlers", () => {
    const html = sanitize('<p onclick="x()">ok</p><script>alert(1)</script><img src=x onerror="y()">');
    expect(html).not.toMatch(/script|onclick|onerror/);
    expect(html).toContain("<p>ok</p>");
  });

  it("shows old embedded task placeholders (from past revisions) as a plain reference", () => {
    renderContent('<div data-task="FF-V09"></div>');
    expect(screen.getByText("Карточка FF-V09")).toBeInTheDocument();
  });

  it("marks places that have tasks and offers to create new ones", () => {
    const tasks = [brief({ id: 3, anchor: "FF-V01-01", status: "in_progress" }), brief({ id: 4, anchor: "p-note" })];
    renderContent(visitorsHtml, { section: "ff-visitors", tasks, canCreate: true });
    const line = document.querySelector('[data-id="FF-V01-01"]')!;
    expect(line.querySelector("a.place-task")).toHaveTextContent("#3");
    expect(line.querySelector("a.place-task")).toHaveAttribute("href", "/t/3");
    expect(line.querySelector("a.place-add")).toHaveAttribute("href", "/tasks?new=1&at=ff-visitors&anchor=FF-V01-01");
    expect(document.querySelector('[data-id="p-note"] a.place-task')).toHaveTextContent("#4");
    // the card itself is a place; the heading inside its header is not a separate one
    expect(document.getElementById("ff-v01")).toHaveClass("has-place");
    expect(document.querySelector('[data-id="p-h4"] .place-tools')).toBeNull();
    // the paragraph is not a place
    expect(screen.getByText("Порядок фиксированный.").querySelector(".place-tools")).toBeNull();
  });

  it("shows only existing tasks to viewers", () => {
    renderContent(visitorsHtml, { section: "ff-visitors", tasks: [brief({ id: 3 })], canCreate: false });
    expect(document.querySelectorAll("a.place-task")).toHaveLength(1);
    expect(document.querySelector("a.place-add")).toBeNull();
  });

  it("adds a copy button to dialogue lines that copies only the quote", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderContent('<div class="line" data-id="X-1"><span class="who">Клоун</span><q>Ты заказала это сама.</q></div>');
    await userEvent.click(screen.getByRole("button", { name: "Копировать" }));
    expect(writeText).toHaveBeenCalledWith("Ты заказала это сама.");
    expect(await screen.findByRole("button", { name: "Скопировано" })).toBeInTheDocument();
  });

  it("renders mermaid diagrams lazily", async () => {
    renderContent('<pre class="mermaid">flowchart TD\n A --&gt; B</pre>');
    expect(await screen.findByTestId("diagram")).toBeInTheDocument();
  });

  it("scrolls to anchors present on the page", async () => {
    renderContent('<a href="#ff-branch">к цели</a><h3 id="ff-branch">Цель</h3><a href="#L-1">к реплике</a><div class="line" data-id="L-1"><q>x</q></div>');
    await userEvent.click(screen.getByText("к цели"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    await userEvent.click(screen.getByText("к реплике"));
    expect(document.querySelector('[data-id="L-1"]')).toHaveClass("flash");
  });

  it("resolves anchors from other pages via the API", async () => {
    vi.spyOn(api, "resolveAnchor").mockResolvedValue({ page: "ff", anchor: "ff-v01" });
    renderContent('<a href="#ff-v01">Мужчина без лица</a>');
    await userEvent.click(screen.getByText("Мужчина без лица"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/s/ff#ff-v01"));
  });

  it("falls back to search for unknown anchors", async () => {
    vi.spyOn(api, "resolveAnchor").mockRejectedValue(new Error("404"));
    renderContent('<a href="#nowhere">куда-то</a>');
    await userEvent.click(screen.getByText("куда-то"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/search?q=nowhere"));
  });

  it("opens images in a lightbox and closes it with Escape", async () => {
    renderContent('<figure class="shots"><img src="/media/a.png" alt="Кухня"></figure>');
    await userEvent.click(screen.getByAltText("Кухня"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
