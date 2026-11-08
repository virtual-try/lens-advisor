import { describe, expect, it } from "vitest";
import { ApiError, createApiClient } from "./api";

function mockResponse(
  body: unknown,
  init: { status?: number; statusText?: string; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  const isString = typeof body === "string";
  const textBody = isString ? body : JSON.stringify(body);
  return new Response(textBody, {
    status,
    statusText: init.statusText ?? "OK",
    headers: {
      "Content-Type": isString ? "text/plain" : "application/json",
      ...init.headers,
    },
  });
}

const validCatalogFixture = {
  lensGroups: [
    {
      id: "group-1",
      name: "Standard Clear",
      position: 0,
      lenses: [
        {
          id: "lens-1",
          groupId: "group-1",
          name: "Classic 1.50",
          price: { amountMinor: 4900, currency: "USD" },
          limits: {
            sphMin: -600,
            sphMax: 400,
            cylMin: -200,
            cylMax: 0,
            rxTypes: ["SINGLE_VISION"],
          },
          labCodeTemplate: "STD-150",
          shopifyVariantId: "var-lens-1",
          position: 0,
        },
      ],
    },
  ],
  optionGroups: [],
  addOns: [],
  settings: {
    manualRxEnabled: true,
    rxUploadEnabled: true,
    storeRxInOrder: false,
  },
};

describe("ApiClient", () => {
  it("fetches and validates catalog response", async () => {
    const fakeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("/apps/lens-advisor/catalog?product_id=prod-1");
      return mockResponse(validCatalogFixture);
    };

    const client = createApiClient({ fetchFn: fakeFetch });
    const catalog = await client.getCatalog("prod-1");
    expect(catalog.lensGroups).toHaveLength(1);
    expect(catalog.lensGroups[0].name).toBe("Standard Clear");
  });

  it("turns a response failing spec 03 schema into { code: 'BAD_RESPONSE' }, never a TypeError", async () => {
    const invalidCatalog = {
      lensGroups: [
        {
          id: "group-1",
          // Missing name, and float amountMinor violates INV-4
          lenses: [
            {
              id: "lens-1",
              price: { amountMinor: 49.5, currency: "USD" },
            },
          ],
        },
      ],
    };

    const fakeFetch = async () => mockResponse(invalidCatalog);
    const client = createApiClient({ fetchFn: fakeFetch });

    try {
      await client.getCatalog("prod-1");
      expect.fail("Should have thrown ApiError");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiError = err as ApiError;
      expect(apiError.code).toBe("BAD_RESPONSE");
      expect(apiError.name).toBe("ApiError");
    }
  });

  it("handles non-JSON response with BAD_RESPONSE", async () => {
    const fakeFetch = async () => mockResponse("<html>Not Found</html>", { status: 200 });
    const client = createApiClient({ fetchFn: fakeFetch });

    try {
      await client.getCatalog("prod-1");
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("BAD_RESPONSE");
    }
  });

  it("handles HTTP 500 error from server", async () => {
    const fakeFetch = async () =>
      mockResponse({ error: { code: "SERVER_ERROR", message: "Boom" } }, { status: 500 });
    const client = createApiClient({ fetchFn: fakeFetch });

    try {
      await client.getCatalog();
      expect.fail("Should have thrown");
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe("SERVER_ERROR");
      expect(error.status).toBe(500);
    }
  });

  it("handles 404 NOT_AVAILABLE error", async () => {
    const fakeFetch = async () => mockResponse({}, { status: 404 });
    const client = createApiClient({ fetchFn: fakeFetch });

    try {
      await client.getCatalog();
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("NOT_AVAILABLE");
    }
  });

  it("handles network failure with NETWORK_ERROR", async () => {
    const fakeFetch = async () => {
      throw new Error("Failed to fetch");
    };
    const client = createApiClient({ fetchFn: fakeFetch });

    try {
      await client.getCatalog();
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("NETWORK_ERROR");
    }
  });

  it("submits prescription and validates response", async () => {
    const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      return mockResponse({ rxRef: "rx-987" });
    };
    const client = createApiClient({ fetchFn: fakeFetch });
    const result = await client.submitPrescription({
      rxType: "NON_PRESCRIPTION",
    });
    expect(result.rxRef).toBe("rx-987");
  });

  it("maps bad prescription response to BAD_RESPONSE", async () => {
    const fakeFetch = async () => mockResponse({ badField: true });
    const client = createApiClient({ fetchFn: fakeFetch });
    try {
      await client.submitPrescription({ rxType: "NON_PRESCRIPTION" });
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("BAD_RESPONSE");
    }
  });

  it("fetches upload url and validates response", async () => {
    const fakeFetch = async () =>
      mockResponse({
        draftId: "draft-1",
        uploadUrl: "https://s3.example.com/upload",
        key: "shops/1/rx/draft-1/file.pdf",
      });
    const client = createApiClient({ fetchFn: fakeFetch });
    const result = await client.getUploadUrl({
      contentType: "application/pdf",
      size: 1024,
    });
    expect(result.draftId).toBe("draft-1");
    expect(result.uploadUrl).toBe("https://s3.example.com/upload");
  });

  it("uploads file to presigned URL", async () => {
    let putCalled = false;
    const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("PUT");
      putCalled = true;
      return mockResponse("", { status: 200 });
    };
    const client = createApiClient({ fetchFn: fakeFetch });
    await client.uploadFile("https://s3.example.com/upload", new Uint8Array([1, 2, 3]));
    expect(putCalled).toBe(true);
  });

  it("maps upload failure to UPLOAD_FAILED", async () => {
    const fakeFetch = async () => mockResponse("", { status: 403 });
    const client = createApiClient({ fetchFn: fakeFetch });
    try {
      await client.uploadFile("https://s3.example.com/upload", new Uint8Array([1]));
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("UPLOAD_FAILED");
    }
  });
});
