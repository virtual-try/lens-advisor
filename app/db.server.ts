import { getPrisma } from "./shared/container/prisma.server";

const db = new Proxy({} as ReturnType<typeof getPrisma>, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});

export default db;
