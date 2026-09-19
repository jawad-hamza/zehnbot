// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import HomeRoute from "./HomeRoute";
import { api } from "../api/client";
import { useAuthStore } from "../store/authStore";

// The API as production answers it: MARKETING_URL is set (the landing page used to redirect there)
vi.mock("../api/client", () => ({
  api: {
    get: vi.fn((url: string) => Promise.resolve({
      data: url === "/auth/config"
        ? { allow_signup: true, google_enabled: false, google_signup: false, email_verification: true, demo_client_id: null, marketing_url: "https://zehnox.com/zehnbot" }
        : [],
    })),
  },
  errorDetail: (_err: unknown, fallback: string) => fallback,
}));

function Where() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderRoot() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<><HomeRoute /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // jsdom has neither of these; the landing page's scroll effects use them
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
  // jsdom reports any attempt to leave the page (location.replace/assign to another site) as an error here
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  useAuthStore.setState({ token: null, me: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  consoleError.mockRestore();
});

const navigationAttempts = () => consoleError.mock.calls.filter((call: unknown[]) => String(call[0]).includes("navigation"));

// the landing page is loaded lazily, as in production; the first import compiles it, which takes a moment
describe("GET / on bot.zehnox.com", { timeout: 60000 }, () => {
  it("serves the ZehnBot landing page to a signed-out visitor, and never redirects to MARKETING_URL", async () => {
    const before = window.location.href;
    renderRoot();

    expect(await screen.findByRole("heading", { level: 1, name: "Turn questions into leads." }, { timeout: 30000 })).toBeTruthy();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/auth/config"));    // it did see marketing_url...
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByTestId("path").textContent).toBe("/");                     // ...and stayed on /
    expect(window.location.href).toBe(before);
    expect(navigationAttempts()).toEqual([]);

    // the page's own calls to action lead into this app
    const startFree = screen.getAllByRole("link", { name: /Start free/ });
    expect(startFree.length).toBeGreaterThan(0);
    for (const link of startFree) expect(link.getAttribute("href")).toBe("/signup");
    const logIn = screen.getAllByRole("link", { name: "Log in" });           // navigation bar and footer
    expect(logIn.length).toBeGreaterThan(0);
    for (const link of logIn) expect(link.getAttribute("href")).toBe("/login");
  });

  it("shows the same page to a signed-in user, with Open dashboard leading to the dashboard", async () => {
    useAuthStore.setState({ token: "a-session" });
    renderRoot();

    expect(await screen.findByRole("heading", { level: 1, name: "Turn questions into leads." }, { timeout: 30000 })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("path").textContent).toBe("/");                     // not sent anywhere by itself
    expect(navigationAttempts()).toEqual([]);
    const open = screen.getAllByRole("link", { name: /Open dashboard/ });
    expect(open.length).toBeGreaterThan(0);
    for (const link of open) expect(link.getAttribute("href")).toBe("/overview");
  });
});
