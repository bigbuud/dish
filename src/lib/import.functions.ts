import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "./auth.functions";

/** Eén bestand uit de importwachtrij: leest alle recepten erin en bewaart ze als "Te controleren". */
export const importRecipeFile = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    z.object({
      name: z.string().max(300),
      kind: z.enum(["image", "pdf", "docx", "text"]),
      mime: z.string().max(100),
      data: z.string().max(9_000_000), // base64
    }),
  )
  .handler(async ({ data }) => {
    const { importFile } = await import("./import.server");
    return importFile(data);
  });
