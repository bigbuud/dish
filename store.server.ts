import { promises as fs } from "node:fs";
import path from "node:path";
import type { Recipe } from "./recipes";

const dataDir = () => process.env.DATA_DIR || path.resolve("data");
const file = () => path.join(dataDir(), "recipes.json");

let queue: Promise<unknown> = Promise.resolve();

export async function readRecipes(): Promise<Recipe[]> {
  try {
    return JSON.parse(await fs.readFile(file(), "utf8")) as Recipe[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

/** Serialised read-modify-write so concurrent saves never clobber each other. */
export function mutateRecipes<T>(fn: (all: Recipe[]) => T): Promise<T> {
  const run = queue.then(async () => {
    const all = await readRecipes();
    const result = fn(all);
    await fs.mkdir(dataDir(), { recursive: true });
    const tmp = file() + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(all));
    await fs.rename(tmp, file());
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}
