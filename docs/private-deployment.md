# Private two-service deployment

Reviewed 2026-09-28. This definition builds the approved public-release reader.
It needs no database, credentials, data restore, or persistent mounts.

## Build and check locally

```sh
uv run --frozen python scripts/check_public_tree.py
uv run --frozen python -m unittest discover -s tests
docker compose -p openvalley-preview -f compose.yaml up -d --build --wait
curl --fail http://127.0.0.1:3100/healthz
```

Open `http://127.0.0.1:3100`. Check the map, address search, summary, trends,
provider information, and coverage notices. Stop the preview with:

```sh
docker compose -p openvalley-preview -f compose.yaml down
```

Use another project name or host port if an existing preview occupies them.
Do not run these Compose commands on a controller-managed deployment.

## OpenShip 0.8.0 configuration

Use one application project with both services on its selected Linux server.
The Dockerized controller's own host can only belong to its original workspace.

1. Create a source archive from a reviewed Git commit. Run the public-release
   preflight first. Record the commit and archive SHA-256.
2. Open a folder-upload session, upload the archive, and scan it.
3. Explicitly select root `compose.yaml`. Automatic root detection can choose
   the nested web application and classify this repository as a monorepo.
4. Use the supported prepare endpoint with the staged source path and
   `composePath: "compose.yaml"` if the folder scan selects the wrong root.
5. Persist both scanned services through project ensure. Supply the complete
   service array. Keep `Dockerfile.api`, `Dockerfile.web`, and root build contexts.
6. Set `exposed: false` and `publicEndpoints: []` on both services.
   Retain web's `127.0.0.1:3100:3000` binding. Keep API `ports: []`.
7. Set API runtime `OPENVALLEY_RUNTIME=public`. Set web runtime and build argument
   `INTERNAL_BASELINE_API_URL=http://api:8998`. These values are not secrets.
8. Set project `composePath` explicitly and `rootDirectory` to an empty string.
   Set project public endpoints to an empty array.
9. On Linux, use project `routeStrategy: "container-ip"` for this no-domain
   trial. This avoids OpenShip's loopback route-inventory edge-reconciliation path.
10. PATCH project readiness explicitly: enabled, path `/healthz`, timeout 90
    seconds, failure mode `fail`. Verify the saved value through GET.
11. Start build/access with the upload session, selected server, Docker runtime,
    server-side build, services mode, and empty public endpoints.
12. Check final deployment state and effective container settings. A successful
    start request is not a successful deployment.

Preserve the archive outside temporary upload staging. Repeat uploads from the
same reviewed source after an interrupted or expired session. Reconcile deployment
state before retrying a start request.

## Runtime checks and limits

- Both images select non-root users. The API release files belong to root.
- The API has no host port. Only the web service publishes a loopback port.
- Both services require health checks and restart after an ordinary process exit.
- Web readiness depends on API release readiness. An API failure must fail web
  health, even while the static page still loads.
- Check all public routes through the web service, including the 15 MB map file.
- Check both `/maplibre/maplibre-gl-worker.mjs` and its shared module in a browser.
  MapLibre v6 requires WebGL2. Next.js builds must copy both worker modules.
- Next.js bakes rewrites at build time. Changing only the runtime URL cannot
  repoint the API proxy. Rebuild when that internal target changes.
- OpenShip 0.8.0 does not import `read_only`, `cap_drop`, `security_opt`, or
  `tmpfs`. This Compose file does not claim those controls.
- A project bridge without host ports is not an egress firewall. Verify the
  private-database network boundary separately before accepting a deployment.

Keep the public hostname on its existing approved release until the Homey trial
passes its release, rollback, restart, access, and recovery checks.

## Version-review sources

- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [Node.js release support](https://nodejs.org/en/about/previous-releases)
- [FastAPI container guidance](https://fastapi.tiangolo.com/deployment/docker/)
- [FastAPI release notes](https://fastapi.tiangolo.com/release-notes/)
- [uv Docker guidance](https://docs.astral.sh/uv/guides/integration/docker/)
- [MapLibre v6 migration](https://github.com/maplibre/maplibre-gl-js/blob/v6.11.2/docs/guides/v5-to-v6-migration-guide.md)
- [MapLibre Next.js worker setup](https://github.com/maplibre/maplibre-gl-js/blob/v6.11.2/docs/index.md#esm)
- [OpenShip Compose deployment](https://openship.io/docs/guides/compose-multi-service)
