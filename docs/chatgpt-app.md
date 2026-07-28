# ChatGPT App

> Current status: MCP v2 and widget v19 are available for ChatGPT connection.
> Use `Settings -> Connections` in the portal as the authoritative setup and
> OAuth administration surface.

Roon AI Bridge exposes a private ChatGPT app with intent-oriented media tools,
OAuth, verified playback results and focused read-only widgets.

## Connection route

`roonia.ipchome.com` must resolve in **public DNS** for direct URL mode.
A LAN-only DNS record is not sufficient: ChatGPT performs OAuth discovery from
OpenAI infrastructure and will return a gateway error when it cannot reach the
hostname.

For a private home bridge, prefer OpenAI's Secure MCP Tunnel:

1. Open the organization tunnel settings linked from `Settings -> Connections`.
2. Create a tunnel and obtain its runtime command and short-lived API key.
3. Run the tunnel client in the bridge network with the private MCP target
   `http://127.0.0.1:3000/mcp`.
4. In ChatGPT, select **Tunnel** instead of **Server URL** and choose the tunnel.

The runtime API key must remain outside RoonIA configuration and logs.

## Public URLs

- MCP endpoint: `https://roonia.ipchome.com/mcp`
- Health check: `https://roonia.ipchome.com/health`
- Privacy notice: `https://roonia.ipchome.com/privacy`

`/health`, `/privacy`, `/.well-known/*` and `/oauth/*` are public. `/mcp` requires an OAuth access token or the admin API token:

```text
Authorization: Bearer <access_token>
```

## Architecture

The app path is:

```text
ChatGPT App -> HTTPS MCP endpoint -> Roon AI Bridge -> Roon Core
```

The MCP server exposes tools for:

- Roon status.
- Zone listing.
- Playback control.
- Volume control.
- Search and play by query.
- Queue snapshots and queue mutations.
- Local virtual playlists.

The server registers six focused MCP Apps widget resources under:

```text
ui://roon-ai-bridge/v19/
```

When tool schemas, descriptions or widget behavior change, refresh the ChatGPT
app configuration and start a new conversation. ChatGPT can keep older tool
metadata cached even after the backend deploy succeeds; the versioned v19
resource URIs invalidate the widget cache.

## ChatGPT Developer Setup (public URL mode)

Use the Apps SDK / MCP app flow, not Custom GPT Actions.

Application fields:

```text
Name: RoonIA
Description: Control privado de Roon desde ChatGPT: zonas, reproducción, volumen, búsqueda, cola y playlists virtuales.
Connection: URL del servidor
Server URL: https://roonia.ipchome.com/mcp
Authentication: OAuth
```

OAuth should be auto-detected from:

```text
https://roonia.ipchome.com/.well-known/oauth-protected-resource
https://roonia.ipchome.com/.well-known/oauth-authorization-server
```

Dynamic client registration endpoint:

```text
https://roonia.ipchome.com/oauth/register
```

Authorization endpoint:

```text
https://roonia.ipchome.com/oauth/authorize
```

Token endpoint:

```text
https://roonia.ipchome.com/oauth/token
```

If ChatGPT asks for scopes, use:

```text
roon:control
```

If the setup asks for a privacy URL:

```text
https://roonia.ipchome.com/privacy
```

During authorization, RoonIA asks for an approval PIN. It is:

- the portal-managed PIN after it has been rotated in Connections;
- `OAUTH_APPROVAL_PIN` if configured in `/opt/roon-ai-bridge/.env`;
- otherwise the existing `API_TOKEN`.

## First Prompts

```text
Comprueba el estado de Roon.
```

Expected tool: `roon_get_state`.

```text
Lista las zonas de Roon.
```

Expected tool: `roon_get_state`.

```text
Pausa la zona Despacho.
```

Expected tool: `roon_control_playback`.

For `play`, `pause`, `playpause` and `stop`, the tool returns the final zone
state and `state_verified: true`. ChatGPT must not claim success otherwise.

```text
Traslada lo que esta sonando en el Despacho a la Cocina.
```

Expected tool: `roon_transfer_playback`. Zone names are resolved inside the
intent, so no preliminary list call is needed. The app must not search for the
current music or rebuild the destination queue.

```text
Busca Bad Bunny en Roon.
```

Expected tool: `roon_search_media`.

Model-facing searches prefer TIDAL by default. Playlist creation and repair use
strict track identity resolution before source or quality is considered. After
`roon_save_playlist`, `roon_edit_playlist_tracks` or
`roon_rebuild_playlist`, ChatGPT must inspect `verified`,
`resolution_summary.unresolved` and the reconstruction report; it must not
describe the playlist as fully checked while unresolved entries remain.
`resolution.status: "manual"` means an explicit result was selected, while
`selection_origin` distinguishes model and portal-user choices.

```text
¿Qué está sonando?
```

Expected tool: `roon_show_now_playing`. It shows every active playing zone.
Adding `en Despacho` filters the same widget to that zone.

```text
Muéstrame el artista Radiohead.
```

Expected tool: `roon_show_media` with `types: ["artist"]`. A clear typed match
expands to the artist, album or track view in one call; generic and ambiguous
searches remain a compact categorized result grid.

```text
Muéstrame la playlist Focus.
```

Expected tool: `roon_show_playlist`.

```text
Muestra mi biblioteca de playlists.
```

Expected tool: `roon_show_playlist_library`. It shows saved RoonIA playlists
with artwork, description, track count, known duration and recent playback.

```text
Que viene a continuacion en Despacho?
```

Expected tool: `roon_show_queue` with `zone: { "name": "Despacho" }`. It
shows one bounded queue snapshot without changing playback.

```text
Muestra el panel de zonas.
```

Expected tool: `roon_show_zones`. It shows every zone, grouped output, current
media, volume, mute state, playback options and active safe-volume limit.

```text
Reproduce Bad Bunny en Despacho.
```

Expected flow: `roon_search_media` followed by `roon_play_media`.

For artist requests:

- `roon_play_media` plays only the selected artist catalog using Roon Shuffle.
- `roon_start_radio` starts Roon Radio and intentionally includes similar artists.

## Safety Notes

- Keep `ENABLE_AUTH=true` before exposing `/mcp`.
- Use HTTPS through Nginx Proxy Manager.
- Keep the API token and OAuth approval PIN private.
- For volume, queue and playback changes, the app should confirm the zone when the target is ambiguous.
- v0.8.1 uses a private OAuth flow with one local approval PIN. Per-user authorization and refresh tokens are left for a later phase.
