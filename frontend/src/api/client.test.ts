import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, onUnauthorized, request, tokenStore } from "./client";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: () => (body === undefined ? Promise.reject(new Error("no body")) : Promise.resolve(body)),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  onUnauthorized(null);
});

describe("request", () => {
  it("sends bearer token, JSON body and query params", async () => {
    tokenStore.set("abc");
    const fetch = mockFetch(200, { ok: true });
    await request("/api/x", { method: "POST", body: { a: 1 }, query: { q: "клоун", empty: "", skip: undefined, n: 0 } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/x?q=%D0%BA%D0%BB%D0%BE%D1%83%D0%BD&n=0");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer abc");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"a":1}');
  });

  it("omits the auth header without a token", async () => {
    const fetch = mockFetch(200, {});
    await request("/api/site");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("returns undefined for 204", async () => {
    mockFetch(204, undefined);
    await expect(request("/api/x", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it.each([
    [{ detail: "Недостаточно прав" }, 403, "Недостаточно прав"],
    [{ detail: { message: "Конфликт версий", current_version: 4 } }, 409, "Конфликт версий"],
    [{ detail: [{ msg: "too short" }, { msg: "bad" }] }, 422, "too short; bad"],
    [null, 500, "Ошибка сервера, попробуйте позже"],
    [{}, 404, "Ошибка запроса (404)"],
  ])("maps error body %j (%i) to a readable message", async (body, status, message) => {
    mockFetch(status, body);
    const err = (await request("/api/x").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(status);
    expect(err.message).toBe(message);
  });

  it("keeps structured detail for conflicts", async () => {
    mockFetch(409, { detail: { message: "x", current_version: 7 } });
    const err = (await request("/api/x").catch((e) => e)) as ApiError;
    expect(err.detail).toEqual({ message: "x", current_version: 7 });
  });

  it("calls the unauthorized handler only when a token was sent", async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    mockFetch(401, { detail: "Требуется вход" });
    await request("/api/x").catch(() => {});
    expect(handler).not.toHaveBeenCalled();
    tokenStore.set("expired");
    await request("/api/x").catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reports network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(request("/api/x")).rejects.toMatchObject({ status: 0, message: "Нет связи с сервером" });
  });
});

describe("api helpers", () => {
  it("encodes codes and uses the right verbs", async () => {
    const fetch = mockFetch(200, {});
    await api.setTaskStatus("FF-V01", "done");
    expect(fetch.mock.calls[0][0]).toBe("/api/tasks/FF-V01/status");
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "PUT", body: '{"status":"done"}' });
    await api.users(true);
    expect(fetch.mock.calls[1][0]).toBe("/api/users?team_only=true");
    await api.users();
    expect(fetch.mock.calls[2][0]).toBe("/api/users");
  });

  it("uploads files as multipart form data", async () => {
    const fetch = mockFetch(201, { url: "/media/x.png" });
    const file = new File(["png"], "x.png", { type: "image/png" });
    await expect(api.upload(file)).resolves.toEqual({ url: "/media/x.png" });
    const init = fetch.mock.calls[0][1];
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers["Content-Type"]).toBeUndefined();
  });
});
