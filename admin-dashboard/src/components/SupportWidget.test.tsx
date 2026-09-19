// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let supportBot: string | null = "zehnbot-help-1a2b3c";
vi.mock("../api/client", () => ({
  api: { get: vi.fn(async (url: string) => (url === "/public/support-bot" ? { data: { client_id: supportBot } } : { data: {} })) },
}));

import SupportWidget from "./SupportWidget";
import { useAuthStore } from "../store/authStore";

const scripts = () => [...document.querySelectorAll<HTMLScriptElement>("script[data-zehnbot-support]")];
const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><SupportWidget /></MemoryRouter>);
const settle = () => new Promise((r) => setTimeout(r, 30));

afterEach(() => {
  cleanup();
  scripts().forEach((s) => s.remove());
  document.getElementById("cb-widget-root")?.remove();
  useAuthStore.setState({ me: null, kind: null, token: null });
  supportBot = "zehnbot-help-1a2b3c";
});

describe("the support chat on bot.zehnox.com", () => {
  it("loads the real widget with the bot the super admin picked, once", async () => {
    at("/");
    await waitFor(() => expect(scripts()).toHaveLength(1));
    expect(scripts()[0].getAttribute("src")).toBe("/static/widget.js?client_id=zehnbot-help-1a2b3c");
    at("/login");
    await settle();
    expect(scripts()).toHaveLength(1);
  });

  it("stays away when no bot is picked", async () => {
    supportBot = null;
    at("/");
    await settle();
    expect(scripts()).toHaveLength(0);
  });

  it("shows on the public pages even to a signed-in super admin, but not inside the console", async () => {
    useAuthStore.setState({ token: "t", kind: "operator" });
    at("/");
    await waitFor(() => expect(scripts()).toHaveLength(1));
    const host = document.createElement("div");
    host.id = "cb-widget-root";
    document.body.appendChild(host);                  // what the widget adds once it has loaded
    await settle();
    expect(host.style.display).toBe("");
    cleanup();
    at("/overview");
    await settle();
    expect(host.style.display).toBe("none");
  });

  it("shows in a customer's dashboard", async () => {
    useAuthStore.setState({ token: "t", kind: "tenant" });
    at("/overview");
    await waitFor(() => expect(scripts()).toHaveLength(1));
  });
});
