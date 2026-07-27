# Architecture

The HTTP API, administration portal and active MCP v2 facade share one
application context, one Roon client and the same persisted services. The
composition root constructs those dependencies once and passes typed context
objects to each delivery layer.

```text
src/
  index.ts                         process startup only
  app/
    context.ts                     shared application contract
    createApplication.ts           dependency composition root
  config/                          environment and runtime settings
  api/
    server.ts                      HTTP API composition
    routes/                        focused HTTP route modules
  portal/
    server.ts                      portal middleware and route composition
    routes/                        auth, dashboard, connections, system,
                                   access and audio-administration routes
  roon/
    roonClient.ts                  Roon extension lifecycle
    roonSdk.ts                     typed callback/reliability boundary
    roonStateCache.ts              live subscription reducer
    roon*Service.ts                transport, browse and playback adapters
    roonMediaService.ts            stable media facade
    media/
      mediaContracts.ts            public media contracts
      mediaSearchPolicy.ts         pure relevance/version/source policy
  services/
    playlistService.ts             stable playlist facade
    trackCatalogService.ts          canonical MusicBrainz catalog and Roon bindings
    playlists/
      playlistContracts.ts         public playlist contracts
      playlistCoverPolicy.ts       cover validation and normalization
    ...                            other application services
  db/                              SQLite adapter and versioned migrations
  bridge-v2/
    context.ts                     MCP application boundary
    intentGateway.ts               stable intent facade
    intents/
      transportIntentHandler.ts    state and transport intentions
    mcp/
      index.ts                     active stdio entry point
      server.ts                    MCP server construction
      tools.ts                     canonical tool catalog
    widgets/                       read-only MCP Apps views/resources
  utils/                           logging, errors and validation

portal/
  index.html
  app.js                           portal shell and remaining features
  features/
    mini-player.js                 extracted player feature
```

Static portal assets live in `portal/` and are copied into the Docker image.
The main API listens on `3000`; the portal listens on `3001`. Both servers run
inside the same Node.js process so they observe the same Roon subscription,
playlists and database without registering a second extension.

## Dependency Direction

```text
process startup
  -> application composition
    -> Roon adapters, database and application services
      -> HTTP API, portal and MCP v2 delivery layers
```

Delivery layers may orchestrate application services but do not construct a
second copy of them. Widely imported media, playlist and MCP classes remain
stable facades while pure contracts and policies move into focused modules.

## Current Runtime Flow

1. `src/index.ts` loads configuration and asks `createApplication` to compose
   the logger, database, Roon adapters and application services.
2. If `ENABLE_AUTH=true`, `API_TOKEN` is required before startup continues.
3. The shared Roon client starts discovery and subscriptions.
4. Express starts the HTTP API on `PORT`; the portal is mounted separately on
   its configured port using the same `ApplicationContext`.
5. Public health, privacy and OAuth discovery routes remain outside Bearer
   authentication. Protected routes use the existing token/OAuth policy.
6. API and portal routes call the shared services for state, media, queues,
   playlists, configuration and administration.
7. `src/bridge-v2/mcp/index.ts` launches the same MCP v2 server used by the HTTP
   transport when `pnpm run mcp` is invoked.
8. `POST /mcp` and `GET /mcp` expose the 36 canonical intents and six focused
   widget entry points over Streamable HTTP.
9. New playlist candidates resolve a canonical MusicBrainz recording before a
   strict Roon search. Catalog metadata and the observed playable Roon binding
   remain separate.
10. Typed media search creates short-lived references and re-resolves selected
   media in a fresh Roon Browse session before acting.
11. On SIGTERM or SIGINT, both HTTP listeners stop accepting work before Roon
    discovery, scheduled checks, logs and SQLite are closed in order.

## Persistence

`src/db/database.ts` is the single source of truth for the SQLite model and its
ordered migration IDs. Every migration runs transactionally and is recorded in
`schema_migrations`, so an existing database is upgraded once without deleting
playlists or settings. The model includes application settings, cores, cached
zones, playlists and tracks, history, preferences and search data. RoonIA
persists Roon authorization state in
`data/roonstate.json`, SQLite application state in `data/roonia.sqlite`, and
private OAuth clients/codes/tokens in `data/oauth-store.json`. The normalized
music catalog stores MusicBrainz recordings, artists, works, credits, genres,
release groups and verified releases. Cover Art Archive references and
non-reusable Roon recording bindings are persisted separately so descriptive
identity never depends on a temporary Roon browse object.

On first launch with an empty SQLite store, legacy playlists from
`data/virtual-playlists.json` are imported automatically. Playlist rows created
before the current identity model are enriched on service start without
changing their stable IDs or reusing stale Roon Browse references.

Runtime port, update-channel and public bridge/portal URL overrides live in
`data/runtime-config.json`. Update requests and staged results use
`data/update-request.json` and `data/update-status.json` as a narrow handoff
between the app container and the LXC systemd watcher.

## Build And Installation Flow

Pushes and pull requests are validated by GitHub Actions. Successful pushes to
`main` and `beta` publish multi-architecture images to GHCR with `stable` and
`beta` tags. The portal only offers a commit after its image workflow succeeded.

The LXC keeps a sparse Git checkout containing Compose and host scripts, not a
Node.js build environment. During an update, it pulls the selected image, makes
a pre-update data backup, stops the current container gracefully and verifies
the replacement health. A failed replacement restores the previous image,
environment and data.
