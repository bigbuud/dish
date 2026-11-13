import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { RecipeForm } from "@/components/RecipeForm";
import { recipeQuery } from "@/lib/recipes.functions";

export const Route = createFileRoute("/recepten/$id/edit")({
  loader: async ({ context, params }) => {
    const r = await context.queryClient.ensureQueryData(recipeQuery(params.id));
    if (!r) throw notFound();
    return { title: r.title };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.title ?? "Recept"} bewerken — Dish` },
    ],
  }),
  component: Edit,
});

function Edit() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(recipeQuery(id));
  return (
    <main className="page mx-auto max-w-4xl pb-20 pt-8">
      <h1 className="mb-8"><span className="scribble">Recept bewerken</span></h1>
      {data && <RecipeForm recipe={data} key={data.updatedAt} />}
    </main>
  );
}
