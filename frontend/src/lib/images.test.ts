import { describe, expect, it } from "vitest";
import { findImages, replaceImage } from "./images";

const source =
  'Текст\n\n![Клоун](/media/a.jpg "Клоун у кассы")\n![Касса](/media/b.png)\n\n' +
  "[ссылка](/media/a.jpg) не картинка\n![Ещё клоун](/media/a.jpg)\n";

describe("findImages", () => {
  it("finds images with alt, url and caption, but not links", () => {
    const images = findImages(source);
    expect(images.map((i) => [i.alt, i.url, i.caption])).toEqual([
      ["Клоун", "/media/a.jpg", "Клоун у кассы"],
      ["Касса", "/media/b.png", ""],
      ["Ещё клоун", "/media/a.jpg", ""],
    ]);
    expect(source.slice(images[1].start, images[1].end)).toBe("![Касса](/media/b.png)");
    expect(source.slice(images[0].urlStart, images[0].urlEnd)).toBe("/media/a.jpg");
  });

  it("handles urls in angle brackets", () => {
    expect(findImages("![x](</media/a b.jpg> \"c\")")[0]).toMatchObject({ url: "/media/a b.jpg", caption: "c" });
  });
});

describe("replaceImage", () => {
  it("swaps only that image's url, keeping alt and caption", () => {
    expect(replaceImage(source, 0, "/media/a.jpg", "/media/new.png")).toBe(
      source.replace('(/media/a.jpg "Клоун', '(/media/new.png "Клоун'),
    );
    const third = replaceImage(source, 2, "/media/a.jpg", "/media/new.png")!;
    expect(third.endsWith("![Ещё клоун](/media/new.png)\n")).toBe(true);
    expect(third).toContain('![Клоун](/media/a.jpg "Клоун у кассы")');
    expect(third).toContain("[ссылка](/media/a.jpg)");
  });

  it("finds the image again after the text changed, or gives up", () => {
    const edited = "Новое начало\n" + source.replace("![Касса](/media/b.png)\n", "");
    expect(replaceImage(edited, 1, "/media/b.png", "/media/new.png")).toBeNull();
    // the list shifted: index 2 is now another image, so the first one with the old url is taken
    expect(replaceImage(edited, 2, "/media/a.jpg", "/media/new.png")).toContain('![Клоун](/media/new.png "Клоун у кассы")');
  });
});
