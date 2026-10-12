import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { LightboxProvider } from "./Lightbox";
import { embeddedTaskCodes, sanitize, ScenarioContent } from "./ScenarioContent";

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

function renderContent(html: string, renderTask?: (code: string) => React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/s/here"]}>
      <LightboxProvider>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <ScenarioContent html={html} renderTask={renderTask} />
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

  it("lists embedded task codes", () => {
    expect(embeddedTaskCodes('<div data-task="A-1"></div><p></p><div data-task="B-2"></div>')).toEqual(["A-1", "B-2"]);
  });

  it("replaces task placeholders using renderTask", () => {
    renderContent('<p>до</p><div data-task="FF-V01"></div>', (code) => <b>карточка {code}</b>);
    expect(screen.getByText("карточка FF-V01")).toBeInTheDocument();
  });

  it("falls back to a plain reference when tasks are not rendered", () => {
    renderContent('<div data-task="FF-V09"></div>');
    expect(screen.getByText("Задача FF-V09")).toBeInTheDocument();
  });

  it("adds a copy button to dialogue lines that copies only the quote", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderContent('<div class="line" data-id="X-1"><span class="who">Клоун<span class="lid">X-1</span></span><q>Ты заказала это сама.</q></div>');
    await userEvent.click(screen.getByRole("button", { name: "Копировать" }));
    expect(writeText).toHaveBeenCalledWith("Ты заказала это сама.");
    expect(await screen.findByRole("button", { name: "Скопировано" })).toBeInTheDocument();
  });

  it("renders mermaid diagrams lazily", async () => {
    renderContent('<pre class="mermaid">flowchart TD\n A --&gt; B</pre>');
    expect(await screen.findByTestId("diagram")).toBeInTheDocument();
  });

  it("scrolls to anchors present on the page", async () => {
    renderContent('<a href="#ff-branch">к цели</a><h3 id="ff-branch">Цель</h3>');
    await userEvent.click(screen.getByText("к цели"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("resolves anchors from other pages via the API", async () => {
    vi.spyOn(api, "resolveAnchor").mockResolvedValue({ page: "ff", anchor: "ff-v01" });
    renderContent('<a href="#ff-v01">FF-V01</a>');
    await userEvent.click(screen.getByText("FF-V01"));
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
