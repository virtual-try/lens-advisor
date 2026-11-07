import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./repo-root";

const root = repoRoot();
const extensionRoot = join(root, "extensions/lens-configurator");
const liquid = readFileSync(join(extensionRoot, "blocks/select-lenses.liquid"), "utf8");

interface BlockSchema {
  name: string;
  target: string;
  javascript: string;
  stylesheet: string;
  enabled_on: { templates: string[] };
  settings: Array<{ id: string; type: string; default?: string | number; label: string }>;
}

function schemaFrom(source: string): BlockSchema {
  const match = source.match(/\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/);
  if (!match?.[1]) throw new Error("block schema missing");
  return JSON.parse(match[1]) as BlockSchema;
}

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...filesUnder(path));
      continue;
    }
    found.push(path);
  }
  return found;
}

describe("select lenses block", () => {
  const storefront = JSON.parse(
    readFileSync(join(extensionRoot, "locales/en.default.json"), "utf8"),
  ) as { select_lenses: { button_label: string } };
  const schemaLocale = JSON.parse(
    readFileSync(join(extensionRoot, "locales/en.default.schema.json"), "utf8"),
  ) as {
    select_lenses: {
      settings: { button_label: { default: string } };
    };
  };
  const label = storefront.select_lenses.button_label;

  it("takes the button label from the block setting, with the storefront locale as the empty fallback", () => {
    expect(label.length).toBeGreaterThan(0);
    expect(schemaLocale.select_lenses.settings.button_label.default).toBe(label);
    expect(liquid).toContain("block.settings.button_label");
    expect(liquid).toContain("select_lenses.button_label");
    expect(liquid.includes(label)).toBe(false);
    const packageSrc = join(root, "packages/configurator/src");
    const leaks = filesUnder(packageSrc).filter((path) => readFileSync(path, "utf8").includes(label));
    expect(leaks).toEqual([]);
  });

  it("ships product money as integer minor units and points the loader at one deferred asset", () => {
    const schema = schemaFrom(liquid);
    expect(schema.target).toBe("content");
    expect(schema.enabled_on.templates).toEqual(["product"]);
    expect(schema.javascript).toBe("loader.js");
    expect(schema.stylesheet).toBe("loader.css");
    expect(schema.settings.map((setting) => setting.id)).toEqual([
      "button_label",
      "accent_color",
      "corner_radius",
    ]);
    const buttonSetting = schema.settings.find((setting) => setting.id === "button_label");
    expect(buttonSetting?.default).toBe("t:select_lenses.settings.button_label.default");
    expect(liquid).toContain('data-proxy="/apps/lens-advisor"');
    expect(liquid).toContain("data-product-json");
    expect(liquid).toContain("data-configurator-src");
    expect(liquid).toContain("'configurator.js' | asset_url");
    expect(liquid).toContain('"productId"');
    expect(liquid).toContain('"variantIds"');
    expect(liquid).toContain('"priceMinor"');
    expect(liquid).toContain('"currency"');
    expect(liquid).toContain("variant.price");
    expect(liquid).not.toContain("divided_by");
    expect(liquid).not.toContain("<script");
    expect(liquid).toContain("product != blank");
  });
});
