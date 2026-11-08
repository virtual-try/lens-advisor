import { Prisma } from "@prisma/client";

type DmmfModel = (typeof Prisma.dmmf.datamodel.models)[number];

/**
 * Shop plus every model that stores a scalar `shopId`. Session is not in this
 * list: it keys rows by shop domain, and redaction deletes those separately.
 * The list is the Prisma DMMF at runtime (INV-10).
 */
export function shopOwnedModels(): DmmfModel[] {
  return Prisma.dmmf.datamodel.models.filter((model) => {
    if (model.name === "Session") return false;
    if (model.name === "Shop") return true;
    return model.fields.some((field) => field.name === "shopId" && field.kind === "scalar");
  });
}

/**
 * Child rows before the rows they reference, from DMMF `relationFromFields`.
 * Ties are alphabetical so the order is stable.
 */
export function shopOwnedModelDeleteOrder(): string[] {
  const models = shopOwnedModels();
  const names = new Set(models.map((model) => model.name));
  const after = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const name of names) {
    after.set(name, []);
    indegree.set(name, 0);
  }

  for (const model of models) {
    for (const field of model.fields) {
      if (field.kind !== "object") continue;
      if (!field.relationFromFields || field.relationFromFields.length === 0) continue;
      if (!names.has(field.type) || field.type === model.name) continue;
      after.get(model.name)?.push(field.type);
      indegree.set(field.type, (indegree.get(field.type) ?? 0) + 1);
    }
  }

  const ready = [...names].filter((name) => indegree.get(name) === 0).sort();
  const ordered: string[] = [];
  while (ready.length > 0) {
    const name = ready.shift();
    if (!name) break;
    ordered.push(name);
    for (const next of after.get(name) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) {
        ready.push(next);
        ready.sort();
      }
    }
  }

  if (ordered.length !== names.size) {
    throw new Error("Shop redaction order is incomplete");
  }
  return ordered;
}
