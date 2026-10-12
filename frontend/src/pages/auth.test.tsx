import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, ApiError, tokenStore } from "../api/client";
import { renderApp, users } from "../test/utils";

describe("authentication", () => {
  it("redirects anonymous visitors to the login page", async () => {
    await renderApp("/s/ff", null);
    expect(await screen.findByRole("heading", { name: "Вход" })).toBeInTheDocument();
  });

  it("logs in, stores the token and opens the app", async () => {
    await renderApp("/login", null);
    const login = vi.spyOn(api, "login").mockResolvedValue({ access_token: "tok", token_type: "bearer", user: users.viewer });
    vi.spyOn(api, "section").mockResolvedValue(undefined as never);
    await userEvent.type(screen.getByLabelText("Логин"), " viewer ");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret1");
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(login).toHaveBeenCalledWith("viewer", "secret1");
    expect(await screen.findByText("Зритель", { selector: ".userbox b" })).toBeInTheDocument();
    expect(tokenStore.get()).toBe("tok");
  });

  it("shows login errors", async () => {
    await renderApp("/login", null);
    vi.spyOn(api, "login").mockRejectedValue(new ApiError(401, "Неверный логин или пароль"));
    await userEvent.type(screen.getByLabelText("Логин"), "x");
    await userEvent.type(screen.getByLabelText("Пароль"), "y");
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Неверный логин или пароль");
  });

  it("registers a new account after checking the password confirmation", async () => {
    await renderApp("/register", null);
    const register = vi.spyOn(api, "register").mockResolvedValue({ access_token: "t", token_type: "bearer", user: users.viewer });
    await userEvent.type(screen.getByLabelText(/^Логин/), "newbie");
    await userEvent.type(screen.getByLabelText("Имя в команде"), "Новичок");
    await userEvent.type(screen.getByLabelText(/^Пароль \(от/), "secret1");
    await userEvent.type(screen.getByLabelText("Пароль ещё раз"), "secret2");
    await userEvent.click(screen.getByRole("button", { name: "Зарегистрироваться" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Пароли не совпадают");
    expect(register).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText("Пароль ещё раз"));
    await userEvent.type(screen.getByLabelText("Пароль ещё раз"), "secret1");
    await userEvent.click(screen.getByRole("button", { name: "Зарегистрироваться" }));
    expect(register).toHaveBeenCalledWith("newbie", "secret1", "Новичок");
    expect(await screen.findByText("Зритель", { selector: ".userbox b" })).toBeInTheDocument();
  });

  it("restores the session from a stored token and logs out", async () => {
    await renderApp("/", users.editor);
    expect(api.me).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Выйти" }));
    expect(await screen.findByRole("heading", { name: "Вход" })).toBeInTheDocument();
    expect(tokenStore.get()).toBeNull();
  });

  it("drops an invalid stored token", async () => {
    tokenStore.set("stale");
    await renderApp("/", null, () => vi.mocked(api.me).mockRejectedValue(new ApiError(401, "Требуется вход")));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Вход" })).toBeInTheDocument());
    expect(tokenStore.get()).toBeNull();
  });
});

describe("role-based navigation", () => {
  it("hides admin and team links from viewers", async () => {
    await renderApp("/", users.viewer);
    expect(screen.queryByRole("link", { name: "Пользователи и роли" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "+ Раздел" })).not.toBeInTheDocument();
    expect(screen.getByText(/доступ на чтение/)).toBeInTheDocument();
  });

  it("shows team actions to editors but not admin pages", async () => {
    await renderApp("/admin/users", users.editor);
    expect(screen.getByRole("link", { name: "+ Раздел" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Пользователи и роли" })).not.toBeInTheDocument();
    expect(screen.getByText("Раздел доступен только администраторам.")).toBeInTheDocument();
  });

  it("blocks viewers from editor routes", async () => {
    await renderApp("/s/ff/edit", users.viewer);
    expect(screen.getByText("Редактировать сценарий могут только участники команды.")).toBeInTheDocument();
  });

  it("renders the navigation tree with progress", async () => {
    await renderApp("/", users.admin);
    expect(screen.getByRole("link", { name: "Пользователи и роли" })).toBeInTheDocument();
    expect(await screen.findByTestId("progress-text")).toHaveTextContent("Готово: 1 из 4 задач");
    expect(screen.getByText("Уровни")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Семь посетителей" })).toHaveAttribute("href", "/s/ff#ff-visitors");
  });

  it("submits the sidebar search", async () => {
    await renderApp("/", users.viewer);
    const search = vi.spyOn(api, "search").mockResolvedValue([
      { type: "task", key: "FF-V07", title: "FF-V07 · Клоун", page: "ff", anchor: "ff-v07", snippet: "…клоун…" },
    ]);
    await userEvent.type(screen.getByRole("searchbox"), "клоун{Enter}");
    expect(await screen.findByRole("link", { name: "FF-V07 · Клоун" })).toHaveAttribute("href", "/s/ff#ff-v07");
    expect(search).toHaveBeenCalledWith("клоун");
  });
});
