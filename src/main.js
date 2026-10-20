// Giramundo entry. Wireframe mode (docs/WIREFRAME.md) loads a bare stylesheet
// and no web fonts: the same logic with none of the looks.
const wire = import.meta.env.VITE_WIREFRAME === '1' || /[?&]wireframe\b/.test(location.search);

async function start() {
  if (wire) {
    await import('./styles/wireframe.css');
  } else {
    await Promise.all([
      import('@fontsource/fraunces/latin-600.css'),
      import('@fontsource/fraunces/latin-ext-600.css'),
      import('@fontsource/fraunces/latin-700.css'),
      import('@fontsource/fraunces/latin-ext-700.css'),
      import('@fontsource/fraunces/latin-700-italic.css'),
      import('@fontsource/outfit/latin-400.css'),
      import('@fontsource/outfit/latin-ext-400.css'),
      import('@fontsource/outfit/latin-500.css'),
      import('@fontsource/outfit/latin-ext-500.css'),
      import('@fontsource/outfit/latin-700.css'),
      import('@fontsource/outfit/latin-ext-700.css'),
      import('./styles/app.css'),
    ]);
  }
  const { boot } = await import('./app/app.js');
  boot({ wire });
}

start();
