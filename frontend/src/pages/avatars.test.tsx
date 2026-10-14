import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { initials } from "../components/Avatar";
import { renderApp, users } from "../test/utils";

const file = () => new File([new Uint8Array([137, 80, 78, 71])], "me.png", { type: "image/png" });

describe("initials", () => {
  it("takes two letters", () => {
    expect(initials("Анна Кот")).toBe("АК");
    expect(initials("editor")).toBe("ED");
    expect(initials("  ")).toBe("?");
  });
});

describe("avatars", () => {
  it("shows initials until a picture is uploaded on the profile page, then everywhere", async () => {
    const set = vi.spyOn(api, "setAvatar").mockResolvedValue({ ...users.editor, avatar: "/media/avatar-2-a.png" });
    const { container } = await renderApp("/account", users.editor);
    const box = container.querySelector(".userbox") as HTMLElement;
    expect(box.querySelector(".avatar")).toHaveAttribute("data-initials", "РЕ");

    await userEvent.upload(screen.getByLabelText("Аватарка editor"), file());
    expect(set).toHaveBeenCalledWith(2, expect.any(File));
    await waitFor(() => expect(box.querySelector("img.avatar")).toHaveAttribute("src", "/media/avatar-2-a.png"));
    expect(screen.getByRole("button", { name: "Сменить аватарку" })).toBeInTheDocument();
  });

  it("removes the picture", async () => {
    const me = { ...users.editor, avatar: "/media/avatar-2-a.png" };
    const remove = vi.spyOn(api, "removeAvatar").mockResolvedValue({ ...me, avatar: null });
    await renderApp("/account", me);
    await userEvent.click(screen.getByRole("button", { name: "Убрать" }));
    expect(remove).toHaveBeenCalledWith(2);
    expect(await screen.findByRole("button", { name: "Загрузить аватарку" })).toBeInTheDocument();
  });

  it("lets an admin set anyone's picture and shows upload errors", async () => {
    vi.spyOn(api, "setAvatar").mockRejectedValue(new Error("Аватарка больше 2 МБ"));
    await renderApp("/admin/users", users.admin);
    const row = await screen.findByTestId("user-editor");
    await userEvent.upload(within(row).getByLabelText("Аватарка editor"), file());
    expect(api.setAvatar).toHaveBeenCalledWith(2, expect.any(File));
    expect(await within(row).findByRole("alert")).toHaveTextContent("Аватарка больше 2 МБ");
  });
});
