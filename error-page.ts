export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <title>Oeps — Dish</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 20px/1.6 "Comic Sans MS", "Segoe Print", cursive; background: #fbf6e6; color: #1f2f6b; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; border: 2px solid #1f2f6b; border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px; background: #fffdf5; box-shadow: 4px 4px 0 #1f2f6b; }
      h1 { font-size: 1.8rem; margin: 0 0 .5rem; }
      p { margin: 0 0 1.5rem; }
      a, button { padding: .5rem 1.2rem; font: inherit; cursor: pointer; text-decoration: none; border: 2px solid #1f2f6b; border-radius: 999px; background: #fff; color: #1f2f6b; }
      .primary { background: #1f2f6b; color: #fffdf5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Oeps, de pot is aangebrand</h1>
      <p>Er ging iets mis op de server. Probeer het opnieuw of ga terug naar het begin.</p>
      <button class="primary" onclick="location.reload()">Opnieuw proberen</button>
      <a href="/">Naar het begin</a>
    </div>
  </body>
</html>`;
}
