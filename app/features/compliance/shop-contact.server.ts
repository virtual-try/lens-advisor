import { unauthenticated } from "../../shopify.server";
import { readShopContactEmail } from "./schema";

const SHOP_CONTACT_QUERY = `#graphql
  query ShopContactEmail {
    shop {
      contactEmail
      email
    }
  }
`;

/**
 * Merchant mailbox from the Admin API. A missing offline session returns null.
 * The thrown session error names the shop domain, so it is not rethrown or logged.
 */
export async function shopContactEmailFromAdmin(shopDomain: string): Promise<string | null> {
  try {
    const { admin } = await unauthenticated.admin(shopDomain);
    const response = await admin.graphql(SHOP_CONTACT_QUERY);
    const body: unknown = await response.json();
    return readShopContactEmail(body);
  } catch {
    return null;
  }
}
