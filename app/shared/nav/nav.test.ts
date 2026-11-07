import { describe, expect, it } from "vitest";
import { parseNavModules, sortNavItems } from "./index";

describe("nav parser", () => {
  it("sorts nav items ascending by order", () => {
    const sorted = sortNavItems([
      { label: "Settings", href: "/app/settings", order: 50 },
      { label: "Home", href: "/app", order: 1 },
      { label: "Lenses", href: "/app/lenses", order: 10 },
    ]);

    expect(sorted.map((s) => s.label)).toEqual(["Home", "Lenses", "Settings"]);
  });

  it("handles empty modules gracefully", () => {
    expect(parseNavModules({})).toEqual([]);
  });

  it("extracts nav from both default and named exports", () => {
    const modules = {
      "/features/a/nav.ts": {
        default: { label: "Alpha", href: "/app/alpha", order: 20 },
      },
      "/features/b/nav.ts": {
        nav: { label: "Beta", href: "/app/beta", order: 10 },
      },
    };

    const parsed = parseNavModules(modules);
    expect(parsed).toEqual([
      { label: "Beta", href: "/app/beta", order: 10 },
      { label: "Alpha", href: "/app/alpha", order: 20 },
    ]);
  });
});
