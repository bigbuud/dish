import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const auth = () => import("./auth.server");

/** Zet dit op elke server function die data leest of wijzigt. */
export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { assertAuthed } = await auth();
  await assertAuthed();
  return next();
});

/** Publiek: vertelt alleen of er al een account is en of deze browser ingelogd is. */
export const getAuthStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { hasUser, isAuthed } = await auth();
  const has = await hasUser();
  return { hasUser: has, authed: has ? await isAuthed() : false };
});

const username = z.string().trim().min(3, "Minstens 3 tekens").max(40, "Maximaal 40 tekens");
const password = z.string().min(10, "Minstens 10 tekens").max(200);

export const beginSetup = createServerFn({ method: "POST" })
  .inputValidator(z.object({ username }))
  .handler(async ({ data }) => (await auth()).beginSetup(data.username));

export const completeSetup = createServerFn({ method: "POST" })
  .inputValidator(z.object({ username, password, secret: z.string(), code: z.string() }))
  .handler(async ({ data }) => (await auth()).completeSetup(data));

export const login = createServerFn({ method: "POST" })
  .inputValidator(z.object({ username: z.string().max(100), password: z.string().max(200), code: z.string().max(40) }))
  .handler(async ({ data }) => (await auth()).login(data));

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  await (await auth()).logout();
  return { ok: true };
});

export const logoutEverywhere = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async () => {
    await (await auth()).logoutEverywhere();
    return { ok: true };
  });
