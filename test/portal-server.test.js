const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createPortalServer } = require("../dist/portal/server");
const { ApiKeyService } = require("../dist/services/apiKeyService");
const { ToolAccessService } = require("../dist/services/toolAccessService");
const { createDatabase } = require("../dist/db/database");
const { PortalAuthService } = require("../dist/services/portalAuthService");
const { OAuthService } = require("../dist/services/oauthService");

function createConfig(dataDir) {
  return {
    port: 3000,
    portalPort: 3001,
    enablePortal: true,
    nodeEnv: "test",
    logLevel: "error",
    roonExtensionName: "Test",
    roonExtensionId: "test",
    dataDir,
    enableBrowse: true,
    enableMcp: true,
    enableAuth: true,
    apiToken: "portal-test-token",
    portalAdminToken: "portal-test-token",
    publicBaseUrl: "https://example.test",
    oauthIssuer: "https://example.test",
    oauthApprovalPin: "pin",
    roonStreamingSource: "tidal",
    updateChannel: "stable",
    automaticUpdateChecks: true,
    debugMode: false
  };
}

test("serves portal assets publicly but protects every administration endpoint", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-portal-"));
  const config = createConfig(dataDir);
  const database = createDatabase(config);
  const apiKeyService = new ApiKeyService(config, database);
  const toolAccessService = new ToolAccessService(database);
  const portalAuthService = new PortalAuthService(config, database);
  const noop = () => {};
  let automaticUpdateChecks = true;
  let debugMode = false;
  let updateChannel = "stable";
  let temporaryPlaylistExpiryDays = 7;
  let playlistTrackPlaybackInput = null;
  const systemManagementService = {
    getSystemInfo: () => ({
      version: "0.17.2",
      update_channel: updateChannel,
      installed_channel: "stable",
      allow_beta_updates: updateChannel === "beta",
      beta_exit_policy: null,
      automatic_update_checks: automaticUpdateChecks,
      debug_mode: debugMode,
      temporary_playlist_expiry_days: temporaryPlaylistExpiryDays,
      version_status: {
        channel: "beta",
        update_available: true,
        latest_version: "0.17.3",
        latest_build: "abcdef123456"
      }
    }),
    saveUpdatePreferences: (input) => {
      automaticUpdateChecks = input.automatic_update_checks === true;
      return { automatic_update_checks: automaticUpdateChecks };
    },
    saveDebugPreferences: (input) => {
      debugMode = input.debug_mode === true;
      return { debug_mode: debugMode };
    },
    savePlaylistPreferences: (input) => {
      temporaryPlaylistExpiryDays = input.temporary_playlist_expiry_days;
      return { temporary_playlist_expiry_days: temporaryPlaylistExpiryDays };
    },
    changeUpdateChannel: (input) => {
      updateChannel = input.allow_beta_updates ? "beta" : "stable";
      return { ok: true, update_channel: updateChannel, allow_beta_updates: updateChannel === "beta" };
    }
  };
  const context = {
    config,
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    roonClient: {
      getZones: () => [],
      isCoreConnected: () => false,
      getCoreName: () => null,
      isTransportReady: () => false,
      isBrowseReady: () => false,
      isImageReady: () => false,
      getOutputs: () => []
    },
    playlistService: {
      listPlaylists: () => ({
        playlists: [],
        total: 0,
        limit: 100,
        offset: 0,
        include_tracks: false
      }),
      playPlaylistTrack: async (_roonClient, playlistId, trackId, input) => {
        playlistTrackPlaybackInput = { playlistId, trackId, input };
        return { ok: true, playlist_id: playlistId, track_id: trackId, mode: input.mode };
      }
    },
    oauthService: new OAuthService(config),
    mediaService: {},
    apiKeyService,
    portalAuthService,
    toolAccessService,
    systemManagementService,
    zonePresetService: {},
    outputVolumeSettingsService: {}
  };
  const server = createPortalServer(context).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.match(page.headers.get("content-security-policy"), /img-src 'self' data: blob:/);
    const portalPageText = await page.text();
    assert.match(portalPageText, /roonIA/);
    assert.match(portalPageText, /id="context-modal"/);
    assert.match(portalPageText, /id="confirm-dialog"/);
    assert.match(portalPageText, /id="beta-exit-dialog"/);
    assert.match(portalPageText, /src="\/roonia-logo\.svg"/);
    assert.match(portalPageText, /href="\/styles\.css\?v=20260728\.1"/);
    assert.match(portalPageText, /src="\/app\.js\?v=20260728\.1"/);
    assert.match(portalPageText, /id="playback-actions-popover"[^>]*popover="auto"[^>]*hidden/);
    assert.match(portalPageText, /id="mini-output-popover"[^>]*popover="manual"[^>]*hidden/);
    assert.doesNotMatch(portalPageText, /id="playback-actions-dialog"/);
    assert.match(portalPageText, /id="version-badge">v—<\/small>/);
    assert.doesNotMatch(portalPageText, /id="command-status"/);
    assert.match(portalPageText, /id="toast-region"[^>]*aria-atomic="true"/);
    assert.match(portalPageText, /id="refresh"[^>]*hidden/);
    assert.match(portalPageText, /id="save-ports"[^>]*hidden/);
    assert.match(portalPageText, /id="installed-version">v—<\/strong>/);
    assert.match(portalPageText, /id="installed-build">build —<\/code>/);
    assert.match(portalPageText, /id="available-update"[^>]*hidden/);
    assert.match(portalPageText, /id="request-update"[^>]*hidden>Actualizar<\/button>/);
    assert.match(portalPageText, /id="check-update">Comprobar actualizaciones<\/button>/);
    assert.match(portalPageText, /id="system-auto-update-checks"[^>]*type="checkbox"/);
    assert.match(portalPageText, /id="system-debug-mode"[^>]*type="checkbox"/);
    assert.match(portalPageText, /id="system-temporary-playlist-expiry-days"[^>]*type="number"[^>]*min="1"[^>]*max="365"/);
    assert.match(portalPageText, /id="temporary-playlists-section"[^>]*data-debug-only hidden/);
    assert.match(portalPageText, /id="temporary-playlist-grid"/);
    assert.match(portalPageText, /data-tab="operation" data-debug-only hidden>Registros/);
    assert.match(portalPageText, /id="admin-operation" data-debug-only hidden/);
    assert.match(portalPageText, /class="panel connection-advanced" data-debug-only hidden/);
    assert.match(portalPageText, /id="debug-system-details"[^>]*data-debug-only hidden/);
    assert.match(portalPageText, /id="beta-exit-status"[^>]*hidden/);
    assert.match(portalPageText, /Conservar esta beta hasta que estable la alcance/);
    assert.match(portalPageText, /id="header-update-notice"[^>]*hidden>Nueva actualización disponible<\/button>/);
    assert.match(portalPageText, /class="panel service-panel"/);
    assert.doesNotMatch(portalPageText, /La comprobación compara la build instalada/);
    assert.doesNotMatch(portalPageText, /id="admin-health-badge"/);
    assert.doesNotMatch(portalPageText, /id="update-state"|id="version-summary"|id="update-message"/);
    assert.match(portalPageText, />library_music<\/span><span>Música<\/span>/);
    assert.match(portalPageText, /data-tab="browse">Mi Música<\/button>/);
    assert.doesNotMatch(portalPageText, /id="browse-hierarchy"/);
    assert.match(portalPageText, /id="playlist-sort"/);
    assert.match(portalPageText, /id="home-recent-playlists"/);
    assert.match(portalPageText, /id="home-history"/);
    assert.match(portalPageText, /id="home-listening-history"/);
    assert.match(portalPageText, /id="home-search-history"/);
    assert.match(portalPageText, /data-history-more="play"/);
    assert.match(portalPageText, /data-history-more="search"/);
    assert.match(portalPageText, /Gestionar zonas/);

    const logo = await fetch(`${baseUrl}/roonia-logo.svg`);
    assert.equal(logo.status, 200);
    assert.match(logo.headers.get("content-type"), /image\/svg\+xml/);
    assert.match(await logo.text(), /aria-label="roonIA logo"/);

    const portalStyles = await fetch(`${baseUrl}/styles.css`);
    assert.equal(portalStyles.status, 200);
    assert.equal(portalStyles.headers.get("cache-control"), "no-store");
    const portalStylesText = await portalStyles.text();
    assert.match(portalStylesText, /\.playlist-collage \{[^}]*gap: 0;[^}]*padding: 0;[^}]*background: #000;/);
    assert.match(portalStylesText, /\.playlist-collage\.collage-2x2 \{[^}]*repeat\(2,/);
    assert.match(portalStylesText, /\.playlist-collage\.collage-3x3 \{[^}]*repeat\(3,/);
    assert.match(portalStylesText, /\.playlist-collage\.collage-4x4 \{[^}]*repeat\(4,/);
    assert.match(portalStylesText, /\.playlist-collage > img \{[^}]*min-width: 0;[^}]*object-fit: cover;[^}]*object-position: center;/);
    assert.doesNotMatch(portalStylesText, /collage-changing|\.playlist-collage > img \{[^}]*transition:/);
    assert.match(portalStylesText, /\.playlist-card p \{[^}]*margin:0;[^}]*-webkit-line-clamp:4;/);
    assert.doesNotMatch(portalStylesText, /\.playlist-card p \{[^}]*height:6em/);
    assert.match(portalStylesText, /\.library-destination-grid/);
    assert.match(portalStylesText, /\.best-search-result\{width:min\(100%,590px\)/);
    assert.match(portalStylesText, /\.search-section-spinner/);
    assert.doesNotMatch(portalStylesText, /\.search-result-skeleton/);
    assert.match(portalStylesText, /\.detail-trust/);
    assert.match(portalStylesText, /\.cover-fallback\.artist/);
    assert.match(portalStylesText, /\.toast\.warning/);
    assert.match(portalStylesText, /\.toast\.info/);
    assert.match(portalStylesText, /--range-progress: 0%/);
    assert.match(portalStylesText, /linear-gradient\(90deg,var\(--brand-orange-light\) 0 var\(--range-progress\)/);
    assert.match(portalStylesText, /::-webkit-slider-thumb/);
    assert.match(portalStylesText, /::-moz-range-thumb/);
    assert.match(portalStylesText, /border-radius: 0; background: transparent/);
    assert.match(portalStylesText, /\.home-playlist-grid/);
    assert.match(portalStylesText, /\.home-history-list/);
    assert.match(portalStylesText, /\.home-activity-grid/);
    assert.match(portalStylesText, /\.search-history-row strong[^}]*overflow-wrap: anywhere;[^}]*white-space: normal;/);
    assert.match(portalStylesText, /\.featured-zone-links button/);
    assert.match(portalStylesText, /\.home-playlist-card > div:first-child[^}]*position: relative/);
    assert.match(portalStylesText, /\.featured-title-slot/);
    assert.match(portalStylesText, /\.featured-track-copy \{[^}]*height: calc\(clamp\(104px, 10\.5vw, 151px\) \+ 72px\)/);
    assert.match(portalStylesText, /\.home-hero-transition-ghost\.is-leaving/);
    assert.match(portalStylesText, /\.home-idle-cloud/);
    assert.match(portalStylesText, /will-change: clip-path/);
    assert.match(portalStylesText, /\.home-idle-zone\[data-text-tone="dark"\] \.home-idle-track/);
    assert.match(portalStylesText, /\.home-idle-zone\.is-expanded \.home-idle-track/);
    assert.match(portalStylesText, /\.home-idle-art \.cover \{[^}]*position: absolute;[^}]*transform: translate\(-50%,-50%\);/);
    assert.doesNotMatch(portalStylesText, /\.home-idle-art \.cover img \{[^}]*transform:/);
    assert.doesNotMatch(portalStylesText, /@keyframes home-zone-float/);
    assert.doesNotMatch(portalStylesText, /view-transition/);
    assert.match(portalStylesText, /\.home-idle-zone-tag/);
    assert.match(portalStylesText, /\.home-idle-track/);
    assert.match(portalStylesText, /\.update-compact/);
    assert.match(portalStylesText, /\.available-update\[hidden\]/);
    assert.match(portalStylesText, /\.service-panel/);
    assert.match(portalStylesText, /\.header-update-notice/);
    assert.match(portalStylesText, /\.update-preferences/);
    assert.match(portalStylesText, /\.beta-exit-option/);
    assert.match(portalStylesText, /\[data-debug-only\]\[hidden\]/);
    assert.match(portalStylesText, /\.debug-panel/);
    assert.match(portalStylesText, /\.playlist-lifecycle-badge/);
    assert.match(portalStylesText, /\.playback-popover/);
    assert.match(portalStylesText, /\.mini-output-popover/);
    assert.match(portalStylesText, /\.mini-output-popover \{[^}]*border: 0;[^}]*border-radius: 0;/);
    assert.match(portalStylesText, /\.mini-output-range::-webkit-slider-thumb \{[^}]*opacity: 0;/);
    assert.match(portalStylesText, /\.playlist-track-row/);
    assert.match(portalStylesText, /\.track-technical/);
    assert.doesNotMatch(portalStylesText, /\.command-status/);

    const portalScript = await fetch(`${baseUrl}/app.js`);
    assert.equal(portalScript.status, 200);
    assert.equal(portalScript.headers.get("cache-control"), "no-store");
    const miniPlayerScript = await fetch(`${baseUrl}/features/mini-player.js`);
    assert.equal(miniPlayerScript.status, 200);
    assert.equal(miniPlayerScript.headers.get("cache-control"), "no-store");
    const portalScriptText = `${await portalScript.text()}\n${await miniPlayerScript.text()}`;
    assert.match(portalScriptText, /data-image-key/);
    assert.match(portalScriptText, /data-mini-select-zone/);
    assert.match(portalScriptText, /data-mini-quick-zone-step/);
    assert.match(portalScriptText, /aria-label="Volumen de la zona"/);
    assert.match(portalScriptText, /function miniZoneVolumeLabel/);
    assert.match(portalScriptText, /function setMiniOutputLocal/);
    assert.match(portalScriptText, /mini-volume-section/);
    assert.match(portalScriptText, /mini-zones-section/);
    assert.match(portalScriptText, /grouped\?`<div class="mini-group-volume"/);
    assert.doesNotMatch(portalScriptText, /<details class="mini-zone-switcher"/);
    assert.match(portalScriptText, /function openMiniOutputPopover\(\)\{if\(miniOutputPopoverOpen\(\)\)\{closeMiniOutputPopover\(\);return;/);
    assert.match(portalScriptText, /e\.composedPath\(\)/);
    assert.match(portalScriptText, /\["replace_queue","play_next","append"\]/);
    assert.match(portalScriptText, /artist:6, album:6, ep:6, single_ep:6, single:6, track:12/);
    assert.match(portalScriptText, /SEARCH_CATEGORIES = \[\{type:"artist",count:6\}/);
    assert.match(portalScriptText, /state\.searchController\?\.abort\(\)/);
    assert.match(portalScriptText, /new AbortController\(\)/);
    assert.match(portalScriptText, /Promise\.allSettled\(SEARCH_CATEGORIES/);
    assert.match(portalScriptText, /category_status/);
    assert.match(portalScriptText, /SEARCH_BACKGROUND_LIMIT = 100/);
    assert.match(portalScriptText, /available_counts/);
    assert.match(portalScriptText, /function finalizeSearchBestMatch/);
    assert.match(portalScriptText, /direct_match&&item\?\.roon_item_key/);
    assert.match(portalScriptText, /SEARCH_EXPAND_STEPS/);
    assert.match(portalScriptText, /HOME_HISTORY_PAGE_SIZE=10/);
    assert.match(portalScriptText, /\/api\/history\?type=\$\{encodeURIComponent\(type\)\}/);
    assert.doesNotMatch(portalScriptText, /recordPlayedMedia/);
    assert.match(portalScriptText, /search-section-spinner/);
    assert.match(portalScriptText, /Sin tracklist verificada/);
    assert.match(portalScriptText, /Resultados relacionados/);
    assert.match(portalScriptText, /data-more-results/);
    assert.match(portalScriptText, /playlist-search-form/);
    assert.match(portalScriptText, /source_preference:"streaming_first"/);
    assert.doesNotMatch(portalScriptText, /source_preference:"library_first"/);
    assert.match(portalScriptText, /artist-detail/);
    assert.match(portalScriptText, /detail\.release_sections/);
    assert.match(portalScriptText, /catalogSections\|\|fallbackSections/);
    assert.match(portalScriptText, /album-detail/);
    assert.match(portalScriptText, /entityByline\(np\.line2,np\.line3/);
    assert.match(portalScriptText, /entityByline\(item\.artist,null,item\.subtitle\|\|""\)/);
    assert.match(portalScriptText, /entityLink\("album",item\.album,item\.artist\|\|null/);
    assert.match(portalScriptText, /function splitArtistNames/);
    assert.match(portalScriptText, /function releaseSection/);
    assert.match(portalScriptText, /data-more-releases/);
    assert.match(portalScriptText, /data-release-overflow/);
    assert.match(portalScriptText, /data-entity-result-id/);
    assert.match(portalScriptText, /const selected=exact\|\|bestExact/);
    assert.doesNotMatch(portalScriptText, /exact\|\|bestExact\|\|candidates\[0\]/);
    assert.match(portalScriptText, /data-entity-link="\$\{esc\(type\)\}"/);
    assert.match(portalScriptText, /playlist-collage/);
    assert.match(portalScriptText, /playlistDurationLabel\(item\)/);
    assert.match(portalScriptText, /al menos /);
    assert.match(portalScriptText, /playlist\.tracks_count\} canciones\$\{duration/);
    assert.match(portalScriptText, /function playlistModalHead/);
    assert.match(portalScriptText, /data-playlist-actions/);
    assert.match(portalScriptText, /Añadir al principio de la cola/);
    assert.match(portalScriptText, /Añadir al final de la cola/);
    assert.match(portalScriptText, /function openPlaylistTrack/);
    assert.match(portalScriptText, /function playlistTrackDebug/);
    assert.match(portalScriptText, /if\(!state\.debugMode\)return ""/);
    assert.match(portalScriptText, /function playlistTrackMatches/);
    assert.match(portalScriptText, /playlistTrackMatches\(track,item\)/);
    assert.match(portalScriptText, /function playlistResolutionIssue/);
    assert.match(portalScriptText, /data-repair-playlist-track/);
    assert.match(portalScriptText, /data-select-playlist-match/);
    assert.match(portalScriptText, /data-rebuild-playlist/);
    assert.match(portalScriptText, /function waitForPlaylistRebuild/);
    assert.match(portalScriptText, /scope:"issues"/);
    assert.match(portalScriptText, /rebuild\/\$\{encodeURIComponent\(job\.job_id\)\}/);
    assert.doesNotMatch(portalScriptText, /data-refresh-playlist-metadata/);
    assert.doesNotMatch(portalScriptText, /function refreshPlaylistMetadata/);
    assert.match(portalScriptText, /function metadataRows/);
    assert.match(portalScriptText, /Ver JSON técnico completo/);
    assert.match(portalScriptText, /Reasignar canción/);
    assert.match(portalStylesText, /\.playlist-issue-button \{[^}]*border: 0;[^}]*background: transparent;/);
    assert.match(portalScriptText, /const restartProgressStages=\[\['restarting','Reiniciando'\],\['verifying','Verificando'\],\['completed','Completado'\]\]/);
    assert.match(portalScriptText, /false,restartProgressStages/);
    assert.match(portalScriptText, /progressModal\('Verificando el reinicio','verifying'/);
    assert.match(portalScriptText, /playlist-repair-search-form/);
    assert.match(portalScriptText, /data-toggle-reorder/);
    assert.match(portalScriptText, /tracks\/reorder/);
    assert.match(portalScriptText, /playlistForm\(state\.selectedPlaylist,\{context:true\}\)/);
    assert.doesNotMatch(portalScriptText, /esc\(track\.resolution\?\.status\|\|""\)/);
    assert.match(portalScriptText, /<h3>\$\{esc\(item\.name\)\}<\/h3><div class="playlist-meta">[\s\S]*<\/div><p title=/);
    assert.match(portalScriptText, /uniqueKeys\.length >= 16 \? 4 : uniqueKeys\.length >= 10 \? 3 : 2/);
    assert.match(portalScriptText, /capacity = columns \* columns/);
    assert.match(portalScriptText, /collage-\$\{columns\}x\$\{columns\}/);
    assert.doesNotMatch(portalScriptText, /style="--collage-columns/);
    assert.doesNotMatch(portalScriptText, /collage-tile/);
    assert.match(portalScriptText, /500,"fill"/);
    assert.match(portalScriptText, /new Set\(\(playlist\.tracks \|\| \[\]\)/);
    assert.match(portalScriptText, /collage\.classList\.contains\('collage-4x4'\) \? 2 : 1/);
    assert.match(portalScriptText, /data-collage-position-bag/);
    assert.match(portalScriptText, /setInterval\(animatePlaylistCollages,2000\)/);
    assert.doesNotMatch(portalScriptText, /collage-changing|setTimeout\(async/);
    assert.match(portalScriptText, /playlist-cover-file/);
    assert.match(portalScriptText, /function sortedPlaylists/);
    assert.match(portalScriptText, /last_played_at/);
    assert.match(portalScriptText, /function loadMyMusic/);
    assert.match(portalScriptText, /data-library-hierarchy/);
    assert.match(portalScriptText, /\['settings','setting','ajustes','configuracion'\]/);
    assert.match(portalScriptText, /event\.target!==dialog/);
    assert.match(portalScriptText, /zone\.now_playing\|\|\{\}/);
    assert.match(portalScriptText, /data-mini-seek/);
    assert.match(portalScriptText, /data-mini-volume/);
    assert.match(portalScriptText, /data-mini-zone-step/);
    assert.match(portalScriptText, /miniVolumeOutputs/);
    assert.match(portalScriptText, /Promise\.allSettled\(outputs\.map/);
    assert.match(portalScriptText, /miniOutputStepMode\(output\)/);
    assert.match(portalScriptText, /mode:'absolute',value/);
    assert.match(portalScriptText, /miniPlayerIsInteracting/);
    assert.match(portalScriptText, /playerPendingUpdates/);
    assert.match(portalScriptText, /if\(miniPlayerIsInteracting\(\)\)return/);
    assert.match(portalScriptText, /miniRenderSignature===signature/);
    assert.match(portalScriptText, /miniRenderSignature===signature\)\{setMiniPlayerSeekClock\(position,playing\);return;/);
    assert.doesNotMatch(portalScriptText, /JSON\.stringify\(\{playback:playbackSignature\(zone\),position,/);
    assert.match(portalScriptText, /playback:playbackSignature\(zone\),zones:/);
    assert.match(portalScriptText, /function setMiniPlayerSeekClock/);
    assert.match(portalScriptText, /function setRangeFill/);
    assert.match(portalScriptText, /input\.style\.setProperty\('--range-progress'/);
    assert.match(portalScriptText, /syncMiniRangeFills\(root\)/);
    assert.match(portalScriptText, /input\.dataset\.basePosition=String\(seconds\)/);
    assert.match(portalScriptText, /zone\.now_playing=\{\.\.\.\(zone\.now_playing\|\|\{\}\),seek_position:seconds\}/);
    assert.match(portalScriptText, /catch\(err=>\{state\.miniRenderSignature=null;notifyError/);
    assert.match(portalScriptText, /homePlaybackSignature===signature/);
    assert.match(portalScriptText, /featured-backdrop.*imageTag\(featured\.now_playing\?\.image_key,"",500\)/);
    assert.match(portalScriptText, /function fitFeaturedTitle/);
    assert.match(portalScriptText, /copy\.scrollHeight>copy\.clientHeight/);
    assert.match(portalScriptText, /HOME_IDLE_GRACE_MS=2600/);
    assert.match(portalScriptText, /root\.dataset\.mode==="playback"/);
    assert.match(portalScriptText, /function transitionHomeHero/);
    assert.match(portalScriptText, /class="featured-track-copy"/);
    assert.match(portalScriptText, /function beginHomeZonePreview/);
    assert.match(portalScriptText, /function homeIdleLayoutEdges/);
    assert.match(portalScriptText, /function homeIdleArtworkShare/);
    assert.match(portalScriptText, /function homeIdleImageRequestSize/);
    assert.match(portalScriptText, /const ambientTime=time\*1\.2/);
    assert.match(portalScriptText, /function initHomeIdleMosaic/);
    assert.match(portalScriptText, /style\.clipPath=`polygon/);
    assert.match(portalScriptText, /tag\.style\.left=/);
    assert.match(portalScriptText, /track\.style\.left=/);
    assert.match(portalScriptText, /applyHomeIdleArtworkContrast/);
    assert.match(portalScriptText, /imageTag\(np\.image_key,np\.line1,1024\)/);
    assert.doesNotMatch(portalScriptText, /imageTag\(np\.image_key,np\.line1,1400\)/);
    assert.match(portalScriptText, /data-preview-zone/);
    assert.match(portalScriptText, /home-idle-zone-tag/);
    assert.doesNotMatch(portalScriptText, /document\.startViewTransition|viewTransitionName/);
    assert.match(portalScriptText, /},5000\)/);
    assert.match(portalScriptText, /if\(state\.view==='home'\)renderHomePlayback\(\)/);
    assert.match(portalScriptText, /data-queue-setting="shuffle"/);
    assert.match(portalScriptText, /setInterval\(refreshMiniPlayerState,2000\)/);
    assert.match(portalScriptText, /const ACTION_MESSAGES/);
    assert.match(portalScriptText, /region\.replaceChildren\(\)/);
    assert.match(portalScriptText, /}, 3000\)/);
    assert.match(portalScriptText, /channel==='beta'\?' \(beta\)'/);
    assert.match(portalScriptText, /channel==='beta'\?' \(beta\)'/);
    assert.match(portalScriptText, /status\.update_available===true&&Boolean\(status\.latest_version\)/);
    assert.match(portalScriptText, /status\.image_available===false/);
    assert.match(portalScriptText, /Todavía no hay una versión estable publicada\. Se mantendrá instalada la versión beta/);
    assert.match(portalScriptText, /\$\("#available-update"\)\.hidden=!hasAvailable/);
    assert.match(portalScriptText, /\$\("#request-update"\)\.hidden=!hasAvailable/);
    assert.match(portalScriptText, /function renderAvailableUpdateNotice/);
    assert.match(portalScriptText, /\/api\/admin\/system\/update-preferences/);
    assert.match(portalScriptText, /\/api\/admin\/system\/debug-preferences/);
    assert.match(portalScriptText, /\/api\/admin\/system\/playlist-preferences/);
    assert.match(portalScriptText, /\/api\/playlists\?scope=temporary/);
    assert.match(portalScriptText, /data-promote-playlist/);
    assert.match(portalScriptText, /function applyDebugMode/);
    assert.match(portalScriptText, /function renderDebugSystemDetails/);
    assert.match(portalScriptText, /\/api\/admin\/system\/update-channel/);
    assert.match(portalScriptText, /function chooseBetaExitStrategy/);
    assert.match(portalScriptText, /state\.installedChannel!=='beta'/);
    assert.match(portalScriptText, /status\.channel==='beta'\?' \(beta\)'/);
    assert.match(portalScriptText, /setInterval\(refreshAvailableUpdateStatus,60000\)/);
    assert.doesNotMatch(portalScriptText, /#admin-health-badge|#version-summary|#update-message|#update-state/);
    assert.match(portalScriptText, /Volumen en \$\{zone\} ajustado al \$\{value\} %/);
    assert.match(portalScriptText, /Se han unido las zonas \$\{zones\}/);
    assert.doesNotMatch(portalScriptText, /commandStatus/);
    assert.match(portalPageText, /data-tab="users">Usuarios/);
    assert.match(portalPageText, /data-tab="connections">Conexiones/);
    assert.match(portalPageText, /id="system-bridge-url"/);
    assert.match(portalScriptText, /delete_forever/);
    assert.match(portalScriptText, /function confirmPortal/);
    assert.match(portalScriptText, /title:'Eliminar playlist'/);
    assert.doesNotMatch(portalScriptText, /confirm\('Esta acción eliminará la playlist/);

    const previewScriptText = fs.readFileSync(
      path.join(__dirname, "..", "scripts", "portal-ux-preview.js"),
      "utf8"
    );
    assert.match(previewScriptText, /function previewSearchPayload/);
    assert.match(previewScriptText, /best_match:/);
    assert.match(previewScriptText, /best_by_type/);
    assert.match(previewScriptText, /groups/);
    assert.match(previewScriptText, /release_type_source:"roon_metadata"/);
    assert.match(previewScriptText, /\/api\/admin\/system\/check-update/);
    assert.match(previewScriptText, /\/api\/admin\/system\/update-preferences/);
    assert.match(previewScriptText, /\/api\/admin\/system\/debug-preferences/);
    assert.match(previewScriptText, /\/api\/admin\/system\/update-channel/);
    assert.match(previewScriptText, /update_available:true/);
    assert.doesNotMatch(previewScriptText, /three_line/);

    const authStatus = await fetch(`${baseUrl}/api/auth/status`);
    assert.equal((await authStatus.json()).setup_required, true);

    const setup = await fetch(`${baseUrl}/api/auth/setup`, {
      method: "POST",
      headers: {
        Authorization: "Bearer portal-test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: "administrator",
        password: "long-test-password"
      })
    });
    assert.equal(setup.status, 201);
    const setupBody = await setup.json();
    assert.match(setupBody.token, /^rns_/);

    const denied = await fetch(`${baseUrl}/api/session`);
    assert.equal(denied.status, 401);

    const session = await fetch(`${baseUrl}/api/session`, {
      headers: { Authorization: "Bearer portal-test-token" }
    });
    assert.equal(session.status, 200);
    const sessionBody = await session.json();
    assert.equal(sessionBody.portal_port, 3001);
    assert.equal(sessionBody.update_channel, "stable");
    assert.equal(sessionBody.installed_channel, "stable");
    assert.equal(sessionBody.automatic_update_checks, true);
    assert.equal(sessionBody.debug_mode, false);
    assert.deepEqual(sessionBody.available_update, {
      version: "0.17.3",
      build: "abcdef123456",
      channel: "beta"
    });

    const updatePreferences = await fetch(`${baseUrl}/api/admin/system/update-preferences`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${setupBody.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ automatic_update_checks: false })
    });
    assert.equal(updatePreferences.status, 200);
    assert.equal((await updatePreferences.json()).automatic_update_checks, false);

    const debugPreferences = await fetch(`${baseUrl}/api/admin/system/debug-preferences`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${setupBody.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ debug_mode: true })
    });
    assert.equal(debugPreferences.status, 200);
    assert.equal((await debugPreferences.json()).debug_mode, true);

    const debugSession = await fetch(`${baseUrl}/api/session`, {
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.equal((await debugSession.json()).debug_mode, true);

    const playlistTrackPlayback = await fetch(`${baseUrl}/api/playlists/evening/tracks/song-1/play`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${setupBody.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ zone_id: "office", mode: "add_next" })
    });
    assert.equal(playlistTrackPlayback.status, 200);
    assert.deepEqual(playlistTrackPlaybackInput, {
      playlistId: "evening",
      trackId: "song-1",
      input: { zone_id: "office", mode: "add_next" }
    });

    const playlistPreferences = await fetch(`${baseUrl}/api/admin/system/playlist-preferences`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${setupBody.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ temporary_playlist_expiry_days: 14 })
    });
    assert.equal(playlistPreferences.status, 200);
    assert.equal((await playlistPreferences.json()).temporary_playlist_expiry_days, 14);

    const systemInfo = await fetch(`${baseUrl}/api/admin/system`, {
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.equal((await systemInfo.json()).temporary_playlist_expiry_days, 14);

    const updateChannelResponse = await fetch(`${baseUrl}/api/admin/system/update-channel`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${setupBody.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ allow_beta_updates: true })
    });
    assert.equal(updateChannelResponse.status, 200);
    assert.equal((await updateChannelResponse.json()).update_channel, "beta");

    const betaSession = await fetch(`${baseUrl}/api/session`, {
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.equal((await betaSession.json()).update_channel, "beta");
    const stableInstallBetaSession = await fetch(`${baseUrl}/api/session`, {
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.equal((await stableInstallBetaSession.json()).installed_channel, "stable");

    const userSession = await fetch(`${baseUrl}/api/session`, {
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.equal(userSession.status, 200);
    assert.equal((await userSession.json()).user.username, "administrator");

    for (const removedPath of [
      "/api/virtual-playlists/old/validate",
      "/api/playlists/old/resolve",
      "/api/playlists/old/metadata/refresh",
      "/api/media/images/old-image"
    ]) {
      const removed = await fetch(`${baseUrl}${removedPath}`, {
        method: removedPath.endsWith("resolve") || removedPath.endsWith("refresh") ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${setupBody.token}`,
          "Content-Type": "application/json"
        },
        body: removedPath.endsWith("resolve") || removedPath.endsWith("refresh") ? "{}" : undefined
      });
      assert.equal(removed.status, 501, `${removedPath} must not remain registered`);
      assert.equal((await removed.json()).error.code, "NOT_IMPLEMENTED");
    }

    const connectionsResponse = await fetch(`${baseUrl}/api/admin/connections`, {
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    const connections = await connectionsResponse.json();
    assert.equal(connections.chatgpt.mcp_url, "https://example.test/mcp");
    assert.equal(connections.mcp_clients.profiles.length, 3);

    const oauthClientResponse = await fetch(`${baseUrl}/api/admin/connections/oauth/clients`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${setupBody.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_name: "ChatGPT portal",
        redirect_uris: ["https://chatgpt.com/connector/oauth/portal"]
      })
    });
    assert.equal(oauthClientResponse.status, 201);
    assert.match((await oauthClientResponse.json()).client_id, /^roonia_/);

    const mcpCredentialResponse = await fetch(`${baseUrl}/api/admin/connections/mcp-credentials`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${setupBody.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ client_type: "generic", name: "Test host", role: "read" })
    });
    const mcpCredential = await mcpCredentialResponse.json();
    assert.equal(mcpCredentialResponse.status, 201);
    assert.match(mcpCredential.config_json, /Bearer rnb_/);

    const managed = apiKeyService.create({ name: "Scoped", role: "control" });
    const restricted = await fetch(`${baseUrl}/api/admin/api-keys/${managed.key_id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${setupBody.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ tool_permissions: ["roon_get_state"] })
    });
    assert.deepEqual((await restricted.json()).tool_permissions, ["roon_get_state"]);

    const revokedResponse = await fetch(`${baseUrl}/api/admin/api-keys/${managed.key_id}/revoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.ok((await revokedResponse.json()).revoked_at);
    const reactivatedResponse = await fetch(`${baseUrl}/api/admin/api-keys/${managed.key_id}/reactivate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.equal((await reactivatedResponse.json()).revoked_at, null);

    const usersResponse = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.equal((await usersResponse.json()).length, 1);
    const createdUserResponse = await fetch(`${baseUrl}/api/admin/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${setupBody.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username: "operator", password: "operator-password" })
    });
    assert.equal(createdUserResponse.status, 201);
    const createdUser = await createdUserResponse.json();
    const deletedUserResponse = await fetch(`${baseUrl}/api/admin/users/${createdUser.user_id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.equal(deletedUserResponse.status, 200);

    const deletedKeyResponse = await fetch(`${baseUrl}/api/admin/api-keys/${managed.key_id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    assert.equal(deletedKeyResponse.status, 200);

    const toolsResponse = await fetch(`${baseUrl}/api/admin/tools`, {
      headers: { Authorization: `Bearer ${setupBody.token}` }
    });
    const tools = await toolsResponse.json();
    assert.ok(tools.tools.some((tool) => tool.name === "roon_get_state"));
    assert.equal(tools.tools.some((tool) => tool.name === "roon_status"), false);
    const disabledToolResponse = await fetch(`${baseUrl}/api/admin/tools/roon_get_state`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${setupBody.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ enabled: false })
    });
    assert.equal((await disabledToolResponse.json()).enabled, false);

    const readKey = apiKeyService.create({ name: "Read only", role: "read" });
    const forbidden = await fetch(`${baseUrl}/api/session`, {
      headers: { Authorization: `Bearer ${readKey.token}` }
    });
    assert.equal(forbidden.status, 403);

    const adminKey = apiKeyService.create({ name: "Admin", role: "admin" });
    const allowed = await fetch(`${baseUrl}/api/session`, {
      headers: { Authorization: `Bearer ${adminKey.token}` }
    });
    assert.equal(allowed.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
