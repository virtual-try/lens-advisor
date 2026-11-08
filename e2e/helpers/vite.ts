import { createServer, type ViteDevServer } from "vite";

let viteServer: ViteDevServer | undefined;

export async function getViteServer(): Promise<ViteDevServer> {
  if (!viteServer) {
    viteServer = await createServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: "custom",
    });
  }
  return viteServer;
}

export async function loadServerModule<T = unknown>(specifier: string): Promise<T> {
  const vite = await getViteServer();
  return vite.ssrLoadModule(specifier) as Promise<T>;
}

export async function closeViteServer(): Promise<void> {
  if (viteServer) {
    await viteServer.close();
    viteServer = undefined;
  }
}
