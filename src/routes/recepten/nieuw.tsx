import { createFileRoute, Link } from "@tanstack/react-router";
import { RecipeForm } from "@/components/RecipeForm";

export const Route = createFileRoute("/recepten/nieuw")({
  head: () => ({
    meta: [
      { title: "Nieuw recept — Dish" },
      { name: "description", content: "Scan een recept met je camera of typ het zelf in." },
    ],
  }),
  component: () => (
    <main className="page mx-auto max-w-4xl pb-20 pt-8">
      <h1 className="mb-8"><span className="scribble">Nieuw recept</span></h1>
      <p className="mb-6 text-muted-foreground">Staat het recept op een website? <Link to="/delen" className="underline">Plak de link</Link> en Dish haalt het op.</p>
      <RecipeForm allowScan />
    </main>
  ),
});
