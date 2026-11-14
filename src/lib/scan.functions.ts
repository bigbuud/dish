import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "./auth.functions";

/** Slimme scan (handschrift, kookboeken) via Google Gemini. Geeft `ok: false` terug als er geen sleutel is of de API faalt, zodat de browser kan terugvallen op lokale OCR. */
export const scanRecipeImage = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(z.object({ image: z.string().max(7_000_000) }))
  .handler(async ({ data }) => {
    const { scanWithGemini } = await import("./scan.server");
    return scanWithGemini(data.image);
  });
