import { describe, expect, it } from "vitest";
import { visitorsHtml } from "../test/utils";
import { placeHref, placesIn } from "./places";

describe("placesIn", () => {
  it("lists cards, lines, notes, callouts and headings with readable labels", () => {
    const html =
      '<h3 data-id="p-h3">Цикл заказа</h3><p id="ignored">абзац</p>' +
      '<div class="callout" data-id="p-c"><b class="tag">Общее по арту</b><p>…</p></div>' +
      '<div class="line ann" data-id="FF-PA-03"><span class="who">Громкая связь</span><q>Касса номер четыре закрыта навсегда, пожалуйста, пройдите к кассе номер пять</q></div>' +
      visitorsHtml;
    expect(placesIn(html)).toEqual([
      { anchor: "p-h3", label: "«Цикл заказа»", depth: 0 },
      { anchor: "p-c", label: "Заметка «Общее по арту»", depth: 0 },
      {
        anchor: "FF-PA-03",
        label: "Громкая связь: «Касса номер четыре закрыта навсегда, пожалуйста,…»",
        depth: 0,
      },
      { anchor: "ff-v01", label: "Карточка «Мужчина без лица»", depth: 0 },
      { anchor: "FF-V01-01", label: "Мужчина: «Комбо без прошлого.»", depth: 1 },
      { anchor: "p-note", label: "Записка: «Ты уже была здесь»", depth: 0 },
    ]);
  });

  it("ignores visible line ids left in old texts and handles empty input", () => {
    const html = '<div class="line" data-id="A-1"><span class="who">Ева<span class="lid">A-1</span></span><q>Я сама?</q></div>';
    expect(placesIn(html)[0].label).toBe("Ева: «Я сама?»");
    expect(placesIn("")).toEqual([]);
  });
});

describe("placeHref", () => {
  it("links to the place on its page", () => {
    expect(placeHref("ff", "ff-visitors", "FF-V01-01")).toBe("/s/ff#FF-V01-01");
    expect(placeHref("ff", "ff-visitors", null)).toBe("/s/ff#ff-visitors");
    expect(placeHref("ff", "ff", null)).toBe("/s/ff");
    expect(placeHref(null, null, null)).toBeNull();
  });
});
