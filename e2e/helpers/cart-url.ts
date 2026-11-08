/**
 * Resolves an absolute cart URL (e.g. /cart.js) from the current page URL or base URL.
 * Ensures Playwright page.request calls construct valid absolute URLs even when
 * project baseURL is unset or when running across different origin paths.
 */
export function buildCartUrl(pageUrlOrOrigin: string, path = "/cart.js"): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(cleanPath, pageUrlOrOrigin);
  return url.toString();
}
