import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub, type LoaderFunctionArgs } from "react-router";
import Index, { ErrorBoundary, loader } from "./app._index";
import * as homeServer from "../features/home/home.server";

describe("app._index.tsx route", () => {
  it("loader delegates to loadHomeData", async () => {
    const spy = vi.spyOn(homeServer, "loadHomeData").mockResolvedValueOnce({
      hasLens: true,
      hasLabEmail: true,
      apiKey: "mock-key",
      themeDeepLink: "mock-link",
    });

    const req = new Request("https://shop.myshopify.com/app");
    const result = await loader({
      request: req,
      params: {},
      context: {},
    } as unknown as LoaderFunctionArgs);

    expect(spy).toHaveBeenCalledWith(req);
    expect(result).toEqual({
      hasLens: true,
      hasLabEmail: true,
      apiKey: "mock-key",
      themeDeepLink: "mock-link",
    });
    spy.mockRestore();
  });

  it("renders ErrorBoundary when loader throws a Response (R1-F1)", async () => {
    const Stub = createRoutesStub([
      {
        path: "/app",
        Component: Index,
        ErrorBoundary: ErrorBoundary,
        loader: () => {
          throw new Response("Failed to load home data", {
            status: 500,
            statusText: "Internal Server Error",
          });
        },
      },
    ]);

    const { container } = render(<Stub initialEntries={["/app"]} />);

    // Error state rendered via route ErrorBoundary
    const errorEl = await screen.findByText("Failed to load home data");
    expect(errorEl).toBeTruthy();
    expect(container.innerHTML).toContain("Failed to load home data");
  });

  it("renders ErrorBoundary with default fallback when loader throws an empty Response (R1-F1)", async () => {
    const Stub = createRoutesStub([
      {
        path: "/app",
        Component: Index,
        ErrorBoundary: ErrorBoundary,
        loader: () => {
          throw new Response(null, { status: 500 });
        },
      },
    ]);

    const { container } = render(<Stub initialEntries={["/app"]} />);

    // boundary.error falls back to 'Handling response' when response body is empty
    const fallbackEl = await screen.findByText("Handling response");
    expect(fallbackEl).toBeTruthy();
    expect(container.innerHTML).toContain("Handling response");
  });

  it("renders Index component when loader succeeds", async () => {
    const fixtureData = {
      hasLens: false,
      hasLabEmail: false,
      apiKey: "test-api-key",
      themeDeepLink: "/admin/themes/current/editor?template=product&addAppBlockId=test-api-key/select-lenses",
    };

    const Stub = createRoutesStub([
      {
        path: "/app",
        Component: Index,
        ErrorBoundary: ErrorBoundary,
        loader: () => fixtureData,
      },
    ]);

    render(<Stub initialEntries={["/app"]} />);

    const linkEl = await screen.findByText("Add your first lens");
    expect(linkEl).toBeTruthy();
    expect(screen.getByText("Add a lab email")).toBeTruthy();
  });
});
