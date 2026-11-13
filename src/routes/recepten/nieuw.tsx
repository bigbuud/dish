import { createFileRoute } from "@tanstack/react-router";
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
      <RecipeForm allowScan />
    </main>
  ),
});
