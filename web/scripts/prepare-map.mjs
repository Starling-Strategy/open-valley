import { copyFile, mkdir } from 'node:fs/promises';

// MapLibre 6's module worker imports a sibling module. Serve the matching pair
// together rather than letting Turbopack rewrite the worker's module URL.
const destination = new URL('../public/maplibre/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const name of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  await copyFile(new URL(`../node_modules/maplibre-gl/dist/${name}`, import.meta.url), new URL(name, destination));
}
