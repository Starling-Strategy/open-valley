# Open Valley Kamal trial (Tank #47)

Status: proposed configuration for review. Not yet deployed to a public route.
Owner: Macon Phillips.
Parent work: [Tank #47](https://github.com/Starling-Strategy/tank/issues/47).

## What this is

A trial deployment path for the Open Valley public service using Kamal.
The public service keeps its safety rules: it reads only approved release
artifacts, and it does not connect to the protected ledger.

## One combined image

Kamal deploys one image per service. The public release previously built two
images, `Dockerfile.api` and `Dockerfile.web`. This trial builds one image,
`Dockerfile.release`, that runs both:

- `api` — the read-only public API, bound to `127.0.0.1:8998` only.
- `web` — the Next.js server, bound to `0.0.0.0:3000`, the sole exposed port.

`ops/supervisord.conf` runs both processes. The web server proxies
`/api/baseline` requests to the loopback API, so browser requests stay
same-origin and the public API base stays unset.

## Private trial listeners

`config/deploy.yml` binds the Kamal proxy to loopback ports `18081` and `18444`.
It does not use ports 80 or 443, which belong to the existing Coolify Traefik.
The public hostname stays with the current deployment until a reviewed cutover.

## No registry password

The configuration uses a local registry (`localhost:5555`). Kamal starts a small
registry on the build machine and forwards its port over SSH, so the server can
pull the image. It skips `docker login` entirely. No registry password exists.

## Known limits

- `proxy: false` would remove the health gate. This config keeps the proxy on.
- The combined image is larger and couples the web and API releases.
- A live deployment still needs: a reviewed source revision, the public-release
  preflight, and host/network checks from Tank #47.
