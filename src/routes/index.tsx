import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { BookOpen, ClipboardCheck, Clock, Heart, Search, Users, WheatOff } from "lucide-react";
import { CATEGORIES, categoryLabel } from "@/lib/recipes";
import { recipesQuery } from "@/lib/recipes.functions";
import { Stars } from "@/components/Stars";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dish — mijn recepten" },
      { name: "description", content: "Zoek in je recepten op naam, ingrediënt of soort: soep, hoofdgerecht, dessert, gebak & brood." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(recipesQuery()),
  component: Index,
});

type Sort = "nieuw" | "az" | "rating";

function Index() {
  const { data: recipes } = useSuspenseQuery(recipesQuery());
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("alle");
  const [favOnly, setFavOnly] = useState(false);
  const [gfOnly, setGfOnly] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("nieuw");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return recipes
      .filter((r) => cat === "alle" || r.category === cat)
      .filter((r) => !favOnly || r.favorite)
      .filter((r) => !gfOnly || r.glutenFree)
      .filter((r) => !reviewOnly || r.needsReview)
      .filter((r) => !term || r.title.toLowerCase().includes(term) || r.ingredients.some((i) => i.toLowerCase().includes(term)) || r.notes.toLowerCase().includes(term))
      .sort((a, b) =>
        sort === "az" ? a.title.localeCompare(b.title, "nl") : sort === "rating" ? b.rating - a.rating : b.createdAt.localeCompare(a.createdAt),
      );
  }, [recipes, q, cat, favOnly, gfOnly, reviewOnly, sort]);

  const reviewCount = recipes.filter((r) => r.needsReview).length;
  const count = (id: string) => recipes.filter((r) => r.category === id).length;

  return (
    <main className="page mx-auto max-w-6xl pb-20 pt-8">
      <h1><span className="scribble">Wat koken we vandaag?</span></h1>
      <p className="mt-2 text-muted-foreground">{recipes.length} {recipes.length === 1 ? "recept" : "recepten"} in je schrift</p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-foreground/60" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek op naam of ingrediënt…" className="field py-2 pl-12" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="field sm:w-56" aria-label="Sorteren">
          <option value="nieuw">Nieuwste eerst</option>
          <option value="az">Alfabetisch</option>
          <option value="rating">Beste beoordeling</option>
        </select>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className={`chip ${cat === "alle" ? "chip-active" : ""}`} onClick={() => setCat("alle")}>Alle ({recipes.length})</button>
        {CATEGORIES.map((c) => (
          <button key={c.id} className={`chip ${cat === c.id ? "chip-active" : ""}`} onClick={() => setCat(c.id)}>{c.label} ({count(c.id)})</button>
        ))}
        <button className={`chip flex items-center gap-1.5 ${favOnly ? "chip-active" : ""}`} onClick={() => setFavOnly(!favOnly)}>
          <Heart className={`h-4 w-4 ${favOnly ? "fill-current" : ""}`} /> Favorieten
        </button>
        <button className={`chip flex items-center gap-1.5 ${gfOnly ? "chip-active" : ""}`} onClick={() => setGfOnly(!gfOnly)}>
          <WheatOff className="h-4 w-4" /> Glutenvrij ({recipes.filter((r) => r.glutenFree).length})
        </button>
        {reviewCount > 0 && (
          <button className={`chip flex items-center gap-1.5 ${reviewOnly ? "chip-active" : ""}`} onClick={() => setReviewOnly(!reviewOnly)}>
            <ClipboardCheck className="h-4 w-4" /> Te controleren ({reviewCount})
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card mt-10 flex flex-col items-center gap-3 px-6 py-16 text-center">
          <BookOpen className="h-10 w-10 text-primary" />
          <h2>{recipes.length ? "Niets gevonden" : "Je schrift is nog leeg"}</h2>
          <p className="max-w-sm text-muted-foreground">{recipes.length ? "Probeer een ander zoekwoord of soort." : "Scan een recept met je camera of typ er zelf een in."}</p>
          {!recipes.length && <Link to="/recepten/nieuw" className="btn-primary mt-2">Eerste recept toevoegen</Link>}
        </div>
      ) : (
        <div className="mt-8 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => (
            <Link key={r.id} to="/recepten/$id" params={{ id: r.id }} className="note group overflow-hidden">
              <div className="relative aspect-[4/3] border-b-2 border-foreground bg-muted">
                {r.image ? (
                  <img src={r.image} alt={r.title} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center bg-secondary font-display text-8xl text-foreground/70">{r.title.charAt(0).toUpperCase()}</div>
                )}
                <span className="absolute left-3 top-3 wobbly-sm border-2 border-foreground bg-accent px-2.5 py-0.5 font-display text-lg font-bold leading-tight">{categoryLabel(r.category)}</span>
                {r.glutenFree && <span className="absolute bottom-3 left-3 wobbly-sm flex items-center gap-1 border-2 border-foreground bg-card px-2 py-0.5 font-display text-lg font-bold leading-tight"><WheatOff className="h-4 w-4" /> Glutenvrij</span>}
                {r.needsReview && <span className="absolute bottom-3 right-3 wobbly-sm flex items-center gap-1 border-2 border-foreground bg-destructive px-2 py-0.5 font-display text-lg font-bold leading-tight text-destructive-foreground"><ClipboardCheck className="h-4 w-4" /> Te controleren</span>}
                {r.favorite && <Heart className="absolute right-3 top-3 h-7 w-7 fill-destructive text-destructive drop-shadow" />}
              </div>
              <div className="p-4">
                <h3 className="group-hover:text-destructive">{r.title}</h3>
                <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
                  <span className="flex items-center gap-3">
                    <span className="flex items-center gap-1"><Users className="h-4 w-4" />{r.servings}</span>
                    {r.prepMinutes ? <span className="flex items-center gap-1"><Clock className="h-4 w-4" />{r.prepMinutes} min</span> : null}
                  </span>
                  {r.rating > 0 && <Stars value={r.rating} size={14} />}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
