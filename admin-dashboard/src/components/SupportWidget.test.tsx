// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

let supportBot: string | null = "zehnbot-help-1a2b3c";
vi.mock("../api/client", () => ({
  api: { get: vi.fn(async (url: string) => (url === "/public/support-bot" ? { data: { client_id: supportBot } } : { data: {} })) },
}));

import SupportWidget from "./SupportWidget";
import { useAuthStore } from "../store/authStore";

const scripts = () => [...document.querySelectorAll<HTMLScriptElement>("script[data-zehnbot-support]")];

afterEach(() => {
  cleanup();
  scripts().forEach((s) => s.remove());
  useAuthStore.setState({ me: null });
});

describe("the support chat on bot.zehnox.com", () => {
  it("loads the real widget with the bot the super admin picked", async () => {
    render(<SupportWidget />);
    await waitFor(() => expect(scripts()).toHaveLength(1));
    expect(scripts()[0].getAttribute("src")).toBe("/static/widget.js?client_id=zehnbot-help-1a2b3c");
    render(<SupportWidget />);                       // mounted again: still one widget
    await new Promise((r) => setTimeout(r, 20));
    expect(scripts()).toHaveLength(1);
  });

  it("stays away when no bot is picked, and from the super admin", async () => {
    supportBot = null;
    render(<SupportWidget />);
    await new Promise((r) => setTimeout(r, 20));
    expect(scripts()).toHaveLength(0);
    supportBot = "zehnbot-help-1a2b3c";
    useAuthStore.setState({ me: { role: "superadmin" } as never });
    render(<SupportWidget />);
    await new Promise((r) => setTimeout(r, 20));
    expect(scripts()).toHaveLength(0);
  });
});
