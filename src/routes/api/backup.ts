import { createFileRoute } from "@tanstack/react-router";

/** Download: ZIP met een pdf per recept + recipes.json. Alleen voor ingelogde gebruikers. */
export const Route = createFileRoute("/api/backup")({
  server: {
    handlers: {
      GET: async () => {
        const { isAuthed } = await import("@/lib/auth.server");
        if (!(await isAuthed())) return new Response("Niet ingelogd", { status: 401 });
        const { readRecipes } = await import("@/lib/store.server");
        const { buildBackupZip } = await import("@/lib/backup.server");
        const { zip, filename } = await buildBackupZip(await readRecipes());
        return new Response(zip as unknown as BodyInit, {
          headers: {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="${filename}"`,
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
