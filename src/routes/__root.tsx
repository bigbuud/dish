import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  redirect,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { Toaster } from "sonner";
import { LogOut, Plus } from "lucide-react";
import appCss from "../styles.css?url";
import { Logo } from "../components/Logo";
import { getAuthStatus, logout } from "../lib/auth.functions";

function NotFoundComponent() {
  return (
    <main className="mx-auto max-w-md px-5 py-24 text-center">
      <h1>404</h1>
      <h2 className="mt-2">Deze bladzijde is leeg</h2>
      <p className="mt-3 text-muted-foreground">Die pagina bestaat niet (meer).</p>
      <Link to="/" className="btn-primary mt-6">Terug naar het begin</Link>
    </main>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const loggedOut = error instanceof Error && error.message.includes("Niet ingelogd");
  useEffect(() => {
    if (loggedOut) window.location.assign("/login");
  }, [loggedOut]);
  if (loggedOut) return null;
  console.error(error);
  return (
    <main className="mx-auto max-w-md px-5 py-24 text-center">
      <h1>Oeps!</h1>
      <p className="mt-3 text-muted-foreground">Er ging iets mis. Probeer het opnieuw of ga terug naar het begin.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button onClick={() => { router.invalidate(); reset(); }} className="btn-primary">Opnieuw proberen</button>
        <a href="/" className="btn-outline">Naar het begin</a>
      </div>
    </main>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Elke pagina behalve /login en /setup vereist een geldige sessie.
  // (De echte beveiliging zit in de server functions; dit zorgt voor de doorverwijzing.)
  beforeLoad: async ({ location }) => {
    const path = location.pathname;
    let status: { hasUser: boolean; authed: boolean };
    try {
      status = await getAuthStatus();
    } catch (e) {
      // Offline in de geïnstalleerde app: laat de pagina proberen uit de cache te laden.
      if (typeof window !== "undefined") return { authed: true };
      throw e;
    }
    if (!status.hasUser) {
      if (path !== "/setup") throw redirect({ to: "/setup" });
      return { authed: false };
    }
    if (!status.authed) {
      if (path !== "/login") throw redirect({ to: "/login" });
      return { authed: false };
    }
    if (path === "/login" || path === "/setup") throw redirect({ to: "/" });
    return { authed: true };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Dish" },
      { name: "description", content: "Dish: mijn receptenboek om te bewaren, scannen en opzoeken." },
      { name: "theme-color", content: "#fbf6e6" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Dish" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="nl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient, authed } = Route.useRouteContext();

  async function doLogout() {
    try {
      await logout();
      // geen gegevens van deze gebruiker achterlaten in de offline-cache
      if ("caches" in window) (await caches.keys()).forEach((k) => caches.delete(k));
    } finally {
      window.location.assign("/login");
    }
  }

  // Maakt Dish installeerbaar en laat eerder bekeken recepten offline openen.
  useEffect(() => {
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <header className="print:hidden sticky top-0 z-40 border-b-2 border-foreground bg-background pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between py-2 pl-[calc(var(--margin-x)+0.9rem)] pr-4 sm:pr-5">
          <Link to="/" className="flex items-center gap-3 font-display text-4xl font-bold leading-none text-foreground">
            <Logo className="h-9 w-11" />
            <span className="scribble">Dish</span>
          </Link>
          {authed && (
            <div className="flex items-center gap-2">
              <Link to="/recepten/nieuw" className="btn-primary">
                <Plus className="h-5 w-5" />
                <span className="hidden sm:inline">Nieuw recept</span>
                <span className="sm:hidden">Nieuw</span>
              </Link>
              <button onClick={doLogout} className="btn-ghost px-2" title="Uitloggen" aria-label="Uitloggen">
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      </header>
      <Outlet />
      <Toaster position="bottom-center" richColors />
    </QueryClientProvider>
  );
}
