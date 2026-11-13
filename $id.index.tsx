import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, ChefHat, Clock, Heart, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { categoryLabel, scaleIngredient } from "@/lib/recipes";
import { deleteRecipe, recipeQuery, updateRecipeMeta } from "@/lib/recipes.functions";
import { Stars } from "@/components/Stars";
import { CookMode } from "@/components/CookMode";

export const Route = createFileRoute("/recepten/$id/")({
  loader: async ({ context, params }) => {
    const r = await context.queryClient.ensureQueryData(recipeQuery(params.id));
    if (!r) throw notFound();
    return { title: r.title, category: r.category };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.title ?? "Recept"} — Dish` },
      { name: "description", content: `${loaderData?.title ?? "Recept"}: ingrediënten en bereiding.` },
    ],
  }),
  notFoundComponent: () => (
    <main className="page mx-auto max-w-xl py-20 text-center">
      <h1>Recept niet gevonden</h1>
      <Link to="/" className="btn-primary mt-6">Terug naar overzicht</Link>
    </main>
  ),
  component: Detail,
});

function Detail() {
  const { id } = Route.useParams();
  const { data: r } = useSuspenseQuery(recipeQuery(id));
  const [servings, setServings] = useState(r?.servings ?? 1);
  const [cooking, setCooking] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const meta = useServerFn(updateRecipeMeta);
  const del = useServerFn(deleteRecipe);

  const metaMut = useMutation({
    mutationFn: (d: { favorite?: boolean; rating?: number }) => meta({ data: { id, ...d } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recipes"] }),
  });
  const delMut = useMutation({
    mutationFn: () => del({ data: { id } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["recipes"] });
      toast.success("Recept verwijderd");
      navigate({ to: "/" });
    },
  });

  if (!r) return null;
  const factor = servings / r.servings;
  const scaled = r.ingredients.map((i) => scaleIngredient(i, factor));

  return (
    <main className="page mx-auto max-w-5xl pb-20 pt-6">
      <Link to="/" className="btn-ghost -ml-3 mb-4"><ArrowLeft className="h-4 w-4" /> Alle recepten</Link>
      <div className="grid gap-8 md:grid-cols-[1.1fr_1fr]">
        <div>
          <span className="wobbly-sm inline-block border-2 border-foreground bg-accent px-3 font-display text-xl font-bold">{categoryLabel(r.category)}</span>
          <h1 className="mt-3">{r.title}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-muted-foreground">
            {r.prepMinutes ? <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" />{r.prepMinutes} min</span> : null}
            <Stars value={r.rating} onChange={(rating) => metaMut.mutate({ rating })} />
            <button className="btn-outline" onClick={() => metaMut.mutate({ favorite: !r.favorite })}>
              <Heart className={`h-5 w-5 ${r.favorite ? "fill-destructive text-destructive" : ""}`} /> {r.favorite ? "Favoriet" : "Als favoriet"}
            </button>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {r.steps.length > 0 && <button className="btn-primary px-5 py-2.5" onClick={() => setCooking(true)}><ChefHat className="h-4 w-4" /> Start kookmodus</button>}
            <Link to="/recepten/$id/edit" params={{ id }} className="btn-outline"><Pencil className="h-4 w-4" /> Bewerken</Link>
            <button className="btn-danger" onClick={() => confirm("Dit recept verwijderen?") && delMut.mutate()}><Trash2 className="h-4 w-4" /> Verwijderen</button>
          </div>
        </div>
        {r.image && <div className="tape rotate-1"><img src={r.image} alt={r.title} className="card aspect-[4/3] w-full object-cover" /></div>}
      </div>

      <div className="mt-12 grid gap-10 md:grid-cols-[1fr_1.6fr]">
        <section className="card ruled h-fit p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="leading-none">Ingrediënten</h2>
            <div className="wobbly-sm flex items-center gap-1 border-2 border-foreground bg-card p-0.5">
              <button className="btn-ghost h-8 w-8 p-0" aria-label="Minder personen" onClick={() => setServings(Math.max(1, servings - 1))}><Minus className="h-4 w-4" /></button>
              <span className="min-w-16 text-center font-display text-xl font-bold">{servings} pers.</span>
              <button className="btn-ghost h-8 w-8 p-0" aria-label="Meer personen" onClick={() => setServings(servings + 1)}><Plus className="h-4 w-4" /></button>
            </div>
          </div>
          <ul>
            {scaled.map((i, n) => <li key={n} className="leading-[var(--line)]">{i}</li>)}
          </ul>
        </section>
        <section>
          <h2 className="mb-4"><span className="scribble">Bereiding</span></h2>
          <ol className="space-y-5">
            {r.steps.map((s, n) => (
              <li key={n} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-foreground bg-secondary font-display text-2xl font-bold leading-none">{n + 1}</span>
                <p className="pt-1 text-xl leading-relaxed">{s}</p>
              </li>
            ))}
          </ol>
          {r.notes && (
            <div className="wobbly-sm mt-8 -rotate-1 border-2 border-foreground bg-accent/60 p-5">
              <h3 className="mb-1">Notities</h3>
              <p className="whitespace-pre-wrap">{r.notes}</p>
            </div>
          )}
        </section>
      </div>
      {cooking && <CookMode recipe={r} ingredients={scaled} onClose={() => setCooking(false)} />}
    </main>
  );
}
