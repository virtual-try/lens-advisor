let isMockActive = false;
let mockPlanActive = true;
let createdProductCounter = 1000;
let createdVariantCounter = 2000;
const mockOrders = new Map<string, unknown>();

export function setMockOrder(orderId: string, orderData: unknown): void {
  mockOrders.set(orderId, orderData);
  if (!orderId.startsWith("gid://")) {
    mockOrders.set(`gid://shopify/Order/${orderId}`, orderData);
  }
}

export function clearMockOrders(): void {
  mockOrders.clear();
}

const originalFetch = globalThis.fetch;

export function setMockPlanActive(active: boolean): void {
  mockPlanActive = active;
}

export function setupShopifyMock(): void {
  if (isMockActive) return;
  isMockActive = true;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

    if (
      (urlStr.includes("/admin/api/") || urlStr.includes("partners.shopify.com")) &&
      urlStr.includes("/graphql.json")
    ) {
      let bodyText = "";
      if (init?.body) {
        bodyText =
          typeof init.body === "string"
            ? init.body
            : Buffer.isBuffer(init.body)
            ? init.body.toString("utf8")
            : "";
      } else if (input instanceof Request) {
        try {
          bodyText = await input.clone().text();
        } catch {
          bodyText = "";
        }
      }

      let parsed: { query?: string; variables?: Record<string, unknown> } = {};
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        parsed = {};
      }
      const query = parsed.query ?? "";
      const variables = parsed.variables ?? {};

      // 1. Shop currency
      if (query.includes("ShopCurrency")) {
        return new Response(
          JSON.stringify({
            data: {
              shop: {
                currencyCode: "USD",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 2. Shop ID query
      if (query.includes("AppPlanShopId") || query.includes("query AppPlanShopId")) {
        return new Response(
          JSON.stringify({
            data: {
              shop: {
                id: "gid://shopify/Shop/12345",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 3. Partner active subscription
      if (query.includes("ActiveSubscription") || query.includes("query ActiveSubscription")) {
        return new Response(
          JSON.stringify({
            data: {
              activeSubscription: mockPlanActive
                ? { items: [{ handle: "pro", description: "Pro Plan" }] }
                : null,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 4. Admin legacy plan status
      if (query.includes("AppPlanStatus") || query.includes("query AppPlanStatus")) {
        return new Response(
          JSON.stringify({
            data: {
              currentAppInstallation: {
                activeSubscriptions: mockPlanActive
                  ? [
                      {
                        id: "gid://shopify/AppSubscription/1",
                        name: "Pro Plan",
                        status: "ACTIVE",
                        test: true,
                      },
                    ]
                  : [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 5. Get publications
      if (query.includes("GetPublications")) {
        return new Response(
          JSON.stringify({
            data: {
              publications: {
                nodes: [
                  {
                    id: "gid://shopify/Publication/999",
                    name: "Online Store",
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 6. Product create
      if (query.includes("ProductCreate")) {
        const pId = `gid://shopify/Product/${createdProductCounter++}`;
        const vId = `gid://shopify/ProductVariant/${createdVariantCounter++}`;
        const prod = (variables.product as { title?: string }) || {};

        return new Response(
          JSON.stringify({
            data: {
              productCreate: {
                product: {
                  id: pId,
                  title: prod.title || "Catalog Product",
                  status: "ACTIVE",
                  variants: {
                    nodes: [{ id: vId, price: "0.00" }],
                  },
                },
                userErrors: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 7. Product variants bulk update
      if (query.includes("ProductVariantsBulkUpdate")) {
        const variants = (variables.variants as Array<{ id?: string }>) || [];
        const updatedVariants = variants.map((v) => ({
          id: v.id || `gid://shopify/ProductVariant/${createdVariantCounter++}`,
        }));
        return new Response(
          JSON.stringify({
            data: {
              productVariantsBulkUpdate: {
                productVariants: updatedVariants,
                userErrors: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 8. Publishable publish
      if (query.includes("PublishablePublish")) {
        return new Response(
          JSON.stringify({
            data: {
              publishablePublish: {
                publishable: { publishedOnCurrentPublication: true },
                userErrors: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 9. Product update
      if (query.includes("ProductUpdate")) {
        const prod = (variables.product as { id?: string; status?: string }) || {};
        return new Response(
          JSON.stringify({
            data: {
              productUpdate: {
                product: {
                  id: prod.id || "gid://shopify/Product/1000",
                  status: prod.status || "ACTIVE",
                },
                userErrors: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 10. Product delete
      if (query.includes("ProductDelete")) {
        const inp = (variables.input as { id?: string }) || {};
        return new Response(
          JSON.stringify({
            data: {
              productDelete: {
                deletedProductId: inp.id || "gid://shopify/Product/1000",
                userErrors: [],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 11. Variant product lookup
      if (query.includes("GetVariantProduct")) {
        const vId = (variables.id as string) || "gid://shopify/ProductVariant/2000";
        return new Response(
          JSON.stringify({
            data: {
              productVariant: {
                id: vId,
                product: {
                  id: "gid://shopify/Product/1000",
                },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 12. Order intake query
      if (query.includes("getOrderForIntake")) {
        const orderId = (variables.id as string) || "";
        const numericId = orderId.replace(/^gid:\/\/shopify\/Order\//, "");
        const matched = mockOrders.get(orderId) || mockOrders.get(numericId);
        if (matched) {
          return new Response(
            JSON.stringify({
              data: {
                order: matched,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      // Fallback: throw on unmatched queries per R1-F8 so unexpected Shopify calls fail fast
      throw new Error(
        `Unmatched Shopify GraphQL query in test mock:\n${query}\nVariables: ${JSON.stringify(variables)}`
      );
    }

    return originalFetch(input, init);
  };
}

export function teardownShopifyMock(): void {
  clearMockOrders();
  mockPlanActive = true;
}

// Automatically setup mock on module import so globalThis.fetch is intercepted before any Shopify client initializes
setupShopifyMock();

