export interface NavItem {
  label: string;
  href: string;
  order: number;
}

export type NavModule = {
  nav?: NavItem;
  default?: NavItem;
};

export function sortNavItems(items: NavItem[]): NavItem[] {
  return [...items].sort((a, b) => a.order - b.order);
}

export function parseNavModules(modules: Record<string, NavModule>): NavItem[] {
  const items: NavItem[] = [];
  for (const path of Object.keys(modules)) {
    const mod = modules[path];
    const item = mod?.nav ?? mod?.default;
    if (item && typeof item.label === "string" && typeof item.href === "string") {
      items.push({
        label: item.label,
        href: item.href,
        order: typeof item.order === "number" ? item.order : 100,
      });
    }
  }
  return sortNavItems(items);
}

export function discoverNavItems(): NavItem[] {
  const modules = import.meta.glob<NavModule>("../../features/*/nav.ts", {
    eager: true,
  });
  return parseNavModules(modules);
}

export const getNavItems = discoverNavItems;
