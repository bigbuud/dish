import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { recipeInputSchema, type Recipe } from "./recipes";
import { requireAuth } from "./auth.functions";

const store = () => import("./store.server");

export const listRecipes = createServerFn({ method: "GET" }).middleware([requireAuth]).handler(async () => {
  const { readRecipes } = await store();
  return readRecipes();
});

export const getRecipe = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { readRecipes } = await store();
    return (await readRecipes()).find((r) => r.id === data.id) ?? null;
  });

export const saveRecipe = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(recipeInputSchema)
  .handler(async ({ data }) => {
    const { mutateRecipes } = await store();
    return mutateRecipes((all) => {
      const now = new Date().toISOString();
      const { id, ...fields } = data;
      const existing = id ? all.find((r) => r.id === id) : undefined;
      if (existing) {
        Object.assign(existing, fields, { updatedAt: now });
        return existing;
      }
      const created: Recipe = {
        ...fields, id: crypto.randomUUID(), rating: 0, favorite: false, createdAt: now, updatedAt: now,
      };
      all.push(created);
      return created;
    });
  });

export const updateRecipeMeta = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(z.object({ id: z.string(), favorite: z.boolean().optional(), rating: z.number().int().min(0).max(5).optional() }))
  .handler(async ({ data }) => {
    const { mutateRecipes } = await store();
    return mutateRecipes((all) => {
      const r = all.find((x) => x.id === data.id);
      if (!r) throw new Error("Recept niet gevonden");
      if (data.favorite !== undefined) r.favorite = data.favorite;
      if (data.rating !== undefined) r.rating = data.rating;
      return r;
    });
  });

export const deleteRecipe = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { mutateRecipes } = await store();
    await mutateRecipes((all) => {
      const i = all.findIndex((r) => r.id === data.id);
      if (i >= 0) all.splice(i, 1);
    });
    return { ok: true };
  });

export const recipesQuery = () => queryOptions({ queryKey: ["recipes"], queryFn: () => listRecipes() });
export const recipeQuery = (id: string) =>
  queryOptions({ queryKey: ["recipes", id], queryFn: () => getRecipe({ data: { id } }) });
