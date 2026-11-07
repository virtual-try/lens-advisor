import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

vi.mock("@shopify/shopify-app-session-storage-prisma", () => ({
  PrismaSessionStorage: vi.fn(),
}));

vi.mock("../shared/container/prisma.server", () => ({
  getPrisma: vi.fn(),
}));

import { AppNav, NavBuilder } from "./app";

describe("app.tsx nav builder", () => {
  it("renders two fixture nav.ts entries and asserts both labels in order", () => {
    const fixtureModules = {
      "/app/features/settings/nav.ts": {
        nav: { label: "Settings", href: "/app/settings", order: 20 },
      },
      "/app/features/lenses/nav.ts": {
        nav: { label: "Lenses", href: "/app/lenses", order: 10 },
      },
    };

    const { container } = render(<NavBuilder modules={fixtureModules} />);
    const links = container.querySelectorAll("s-link");

    expect(links.length).toBe(2);
    expect(links[0].textContent).toBe("Lenses");
    expect(links[0].getAttribute("href")).toBe("/app/lenses");
    expect(links[1].textContent).toBe("Settings");
    expect(links[1].getAttribute("href")).toBe("/app/settings");
  });

  it("renders no <s-link> when no nav entries exist", () => {
    const { container } = render(<NavBuilder modules={{}} />);
    const links = container.querySelectorAll("s-link");
    expect(links.length).toBe(0);
  });

  it("also supports passing items directly to AppNav", () => {
    const fixtureItems = [
      { label: "Lab Orders", href: "/app/lab-orders", order: 30 },
      { label: "Catalog", href: "/app/catalog", order: 5 },
    ];

    const { container } = render(<AppNav items={fixtureItems} />);
    const links = container.querySelectorAll("s-link");

    expect(links.length).toBe(2);
    expect(links[0].textContent).toBe("Lab Orders");
    expect(links[1].textContent).toBe("Catalog");
  });
});
