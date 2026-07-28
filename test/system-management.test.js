const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadRuntimePortOverrides } = require("../dist/config/env");
const {
  SystemManagementService
} = require("../dist/services/systemManagementService");

function publishedImageResponse(build) {
  return new Response(JSON.stringify({
    workflow_runs: [{ head_sha: build, conclusion: "success" }]
  }), { status: 200 });
}

test("persists safe runtime ports and emits a fixed update request", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-system-"));
  const config = {
    port: 3000,
    portalPort: 3001,
    dataDir,
    updateChannel: "stable",
    automaticUpdateChecks: true,
    debugMode: false
  };
  const noop = () => {};
  const service = new SystemManagementService(config, {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop
  });
  try {
    const saved = service.saveRuntimeConfig({
      api_port: 4100,
      portal_port: 4101,
      allow_beta_updates: false
    });
    assert.equal(saved.restart_required, true);
    assert.deepEqual(loadRuntimePortOverrides(dataDir), {
      port: 4100,
      portalPort: 4101,
      updateChannel: "stable",
      automaticUpdateChecks: true,
      debugMode: false,
      publicBaseUrl: "http://localhost:4100",
      portalPublicUrl: "http://localhost:4101"
    });
    assert.throws(
      () => service.savePorts({ api_port: 4100, portal_port: 4100 }),
      /must be different/
    );

    const preferences = service.saveUpdatePreferences({
      automatic_update_checks: false
    });
    assert.equal(preferences.automatic_update_checks, false);
    assert.deepEqual(loadRuntimePortOverrides(dataDir), {
      port: 4100,
      portalPort: 4101,
      updateChannel: "stable",
      automaticUpdateChecks: false,
      debugMode: false,
      publicBaseUrl: "http://localhost:4100",
      portalPublicUrl: "http://localhost:4101"
    });
    assert.equal(service.getSystemInfo().automatic_update_checks, false);
    assert.throws(
      () => service.saveUpdatePreferences({ automatic_update_checks: "true" }),
      /must be a boolean/
    );

    const debugPreferences = service.saveDebugPreferences({ debug_mode: true });
    assert.equal(debugPreferences.debug_mode, true);
    assert.equal(service.getSystemInfo().debug_mode, true);
    assert.equal(loadRuntimePortOverrides(dataDir).debugMode, true);
    assert.throws(
      () => service.saveDebugPreferences({ debug_mode: "true" }),
      /must be a boolean/
    );

    assert.equal(service.getSystemInfo().temporary_playlist_expiry_days, 7);
    const playlistPreferences = service.savePlaylistPreferences({
      temporary_playlist_expiry_days: 21
    });
    assert.equal(playlistPreferences.temporary_playlist_expiry_days, 21);
    assert.equal(service.getTemporaryPlaylistExpiryDays(), 21);
    assert.equal(service.getSystemInfo().temporary_playlist_expiry_days, 21);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(dataDir, "runtime-config.json"), "utf8"))
        .temporary_playlist_expiry_days,
      21
    );
    assert.throws(
      () => service.savePlaylistPreferences({ temporary_playlist_expiry_days: 0 }),
      /integer from 1 to 365/
    );
    assert.throws(
      () => service.savePlaylistPreferences({ temporary_playlist_expiry_days: 366 }),
      /integer from 1 to 365/
    );

    const requested = service.requestUpdate();
    const file = JSON.parse(
      fs.readFileSync(path.join(dataDir, "update-request.json"), "utf8")
    );
    assert.equal(requested.action, "update");
    assert.equal(requested.channel, "stable");
    assert.equal(file.target, "main");
    assert.equal(file.image_tag, "stable");
    assert.equal(Object.prototype.hasOwnProperty.call(file, "command"), false);

    const betaService = new SystemManagementService({
      ...config,
      updateChannel: "beta",
      automaticUpdateChecks: false
    }, {
      info: noop,
      warn: noop,
      error: noop,
      debug: noop
    });
    assert.equal(betaService.getSystemInfo().debug_mode, true);
    betaService.changeUpdateChannel({ allow_beta_updates: true });
    const betaRequested = betaService.requestUpdate();
    const betaFile = JSON.parse(
      fs.readFileSync(path.join(dataDir, "update-request.json"), "utf8")
    );
    assert.equal(betaRequested.channel, "beta");
    assert.equal(betaRequested.target, "beta");
    assert.equal(betaFile.target, "beta");
    assert.equal(betaFile.image_tag, "beta");
    assert.equal(betaService.requestUpdate({ allow_beta_updates: false }).target, "main");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("compares update builds even when the semantic version is unchanged", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-build-check-"));
  const previousFetch = global.fetch;
  const previousCommit = process.env.GIT_COMMIT;
  process.env.GIT_COMMIT = "111111111111aaaaaaaa";
  global.fetch = async (url) => String(url).includes("package.json")
    ? new Response(JSON.stringify({ version: "0.20.0-beta.13" }), { status: 200 })
    : publishedImageResponse("222222222222bbbbbbbb");
  const noop = () => {};
  const service = new SystemManagementService({
    port: 3000,
    portalPort: 3001,
    dataDir,
    updateChannel: "stable",
    automaticUpdateChecks: true
  }, { info: noop, warn: noop, error: noop, debug: noop });
  try {
    const status = await service.checkForUpdates({ allow_beta_updates: false });
    assert.equal(status.current_version, "0.20.0-beta.13");
    assert.equal(status.current_build, "111111111111");
    assert.equal(status.latest_build, "222222222222");
    assert.equal(status.update_available, true);
  } finally {
    global.fetch = previousFetch;
    if (previousCommit === undefined) delete process.env.GIT_COMMIT;
    else process.env.GIT_COMMIT = previousCommit;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("runs automatic update checks once per day and restores their persisted result", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-auto-check-"));
  const previousFetch = global.fetch;
  const previousCommit = process.env.GIT_COMMIT;
  process.env.GIT_COMMIT = "aaaaaaaaaaaa11111111";
  let fetchCount = 0;
  global.fetch = async (url) => {
    fetchCount += 1;
    return String(url).includes("package.json")
      ? new Response(JSON.stringify({ version: "0.19.1" }), { status: 200 })
      : publishedImageResponse("bbbbbbbbbbbb22222222");
  };
  const noop = () => {};
  const config = {
    port: 3000,
    portalPort: 3001,
    dataDir,
    updateChannel: "beta",
    automaticUpdateChecks: true
  };
  const service = new SystemManagementService(config, {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop
  });
  try {
    service.startAutomaticChecks();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (service.getSystemInfo().version_status.checked_at) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    service.stopAutomaticChecks();
    const status = service.getSystemInfo().version_status;
    assert.equal(fetchCount, 2);
    assert.equal(status.channel, "beta");
    assert.equal(status.latest_version, "0.19.1");
    assert.equal(status.update_available, true);
    assert.equal(fs.existsSync(path.join(dataDir, "version-status.json")), true);

    const restoredService = new SystemManagementService(config, {
      info: noop,
      warn: noop,
      error: noop,
      debug: noop
    });
    const restored = restoredService.getSystemInfo().version_status;
    assert.equal(restored.latest_build, "bbbbbbbbbbbb");
    assert.equal(restored.update_available, true);
    restoredService.startAutomaticChecks();
    await new Promise((resolve) => setTimeout(resolve, 20));
    restoredService.stopAutomaticChecks();
    assert.equal(fetchCount, 2);
    restoredService.saveUpdatePreferences({ automatic_update_checks: false });
    restoredService.startAutomaticChecks();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(fetchCount, 2);
  } finally {
    service.stopAutomaticChecks();
    global.fetch = previousFetch;
    if (previousCommit === undefined) delete process.env.GIT_COMMIT;
    else process.env.GIT_COMMIT = previousCommit;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("switches immediately from beta to the stable update target", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-stable-now-"));
  const previousInstalledChannel = process.env.INSTALLED_CHANNEL;
  process.env.INSTALLED_CHANNEL = "beta";
  const noop = () => {};
  const service = new SystemManagementService({
    port: 3000,
    portalPort: 3001,
    dataDir,
    updateChannel: "beta",
    automaticUpdateChecks: false
  }, { info: noop, warn: noop, error: noop, debug: noop });
  try {
    const result = service.changeUpdateChannel({
      allow_beta_updates: false,
      strategy: "install_stable"
    });
    assert.equal(result.update_channel, "stable");
    assert.equal(result.allow_beta_updates, false);
    assert.equal(result.beta_exit_policy, null);
    assert.equal(result.update_request.target, "main");
    assert.equal(result.update_request.channel, "stable");
    assert.equal(service.getSystemInfo().update_channel, "stable");
    const request = JSON.parse(
      fs.readFileSync(path.join(dataDir, "update-request.json"), "utf8")
    );
    const runtime = JSON.parse(
      fs.readFileSync(path.join(dataDir, "runtime-config.json"), "utf8")
    );
    assert.equal(request.target, "main");
    assert.equal(runtime.update_channel, "stable");
    assert.equal(runtime.beta_exit_policy, null);
  } finally {
    service.stopAutomaticChecks();
    if (previousInstalledChannel === undefined) delete process.env.INSTALLED_CHANNEL;
    else process.env.INSTALLED_CHANNEL = previousInstalledChannel;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("keeps the installed beta until main catches up, then requests stable automatically", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-stable-wait-"));
  const previousFetch = global.fetch;
  const previousCommit = process.env.GIT_COMMIT;
  const previousInstalledChannel = process.env.INSTALLED_CHANNEL;
  process.env.GIT_COMMIT = "aaaaaaaaaaaa11111111";
  process.env.INSTALLED_CHANNEL = "beta";
  let stableVersion = "0.17.1";
  let stableBuild = "bbbbbbbbbbbb22222222";
  let fetchCount = 0;
  global.fetch = async (url) => {
    fetchCount += 1;
    return String(url).includes("package.json")
      ? new Response(JSON.stringify({ version: stableVersion }), { status: 200 })
      : publishedImageResponse(stableBuild);
  };
  const noop = () => {};
  const service = new SystemManagementService({
    port: 3000,
    portalPort: 3001,
    dataDir,
    updateChannel: "beta",
    automaticUpdateChecks: false
  }, { info: noop, warn: noop, error: noop, debug: noop });
  try {
    const deferred = service.changeUpdateChannel({
      allow_beta_updates: false,
      strategy: "wait_for_stable"
    });
    assert.equal(deferred.update_channel, "beta");
    assert.equal(deferred.allow_beta_updates, false);
    assert.equal(deferred.beta_exit_policy.mode, "wait_for_stable");
    assert.equal(service.getSystemInfo().automatic_update_checks, false);

    for (let attempt = 0; attempt < 50 && fetchCount < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    service.stopAutomaticChecks();
    const behind = service.getSystemInfo();
    assert.equal(fetchCount, 2);
    assert.equal(behind.version_status.channel, "stable");
    assert.equal(behind.version_status.update_available, false);
    assert.equal(behind.update_channel, "beta");
    assert.equal(behind.allow_beta_updates, false);
    assert.equal(fs.existsSync(path.join(dataDir, "update-request.json")), false);
    assert.throws(
      () => service.requestUpdate({ allow_beta_updates: true }),
      /has not caught up/
    );

    const restoredService = new SystemManagementService({
      port: 3000,
      portalPort: 3001,
      dataDir,
      updateChannel: "beta",
      automaticUpdateChecks: false
    }, { info: noop, warn: noop, error: noop, debug: noop });
    const restored = restoredService.getSystemInfo();
    assert.equal(restored.update_channel, "beta");
    assert.equal(restored.allow_beta_updates, false);
    assert.equal(restored.beta_exit_policy.mode, "wait_for_stable");
    restoredService.stopAutomaticChecks();

    stableVersion = "0.20.0";
    stableBuild = "aaaaaaaaaaaa11111111";
    const caughtUp = await service.checkForUpdates();
    assert.equal(caughtUp.current_build, caughtUp.latest_build);
    assert.equal(caughtUp.update_available, true);
    const switched = service.getSystemInfo();
    assert.equal(switched.update_channel, "stable");
    assert.equal(switched.beta_exit_policy, null);
    const request = JSON.parse(
      fs.readFileSync(path.join(dataDir, "update-request.json"), "utf8")
    );
    const runtime = JSON.parse(
      fs.readFileSync(path.join(dataDir, "runtime-config.json"), "utf8")
    );
    assert.equal(request.target, "main");
    assert.equal(runtime.update_channel, "stable");
    assert.equal(runtime.beta_exit_policy, null);

    assert.throws(
      () => service.changeUpdateChannel({ allow_beta_updates: false, strategy: "wait_for_stable" }),
      /not currently enabled/
    );
  } finally {
    service.stopAutomaticChecks();
    global.fetch = previousFetch;
    if (previousCommit === undefined) delete process.env.GIT_COMMIT;
    else process.env.GIT_COMMIT = previousCommit;
    if (previousInstalledChannel === undefined) delete process.env.INSTALLED_CHANNEL;
    else process.env.INSTALLED_CHANNEL = previousInstalledChannel;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("enables and disables beta updates without treating the installed stable build as beta", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-stable-beta-preference-"));
  const previousInstalledChannel = process.env.INSTALLED_CHANNEL;
  process.env.INSTALLED_CHANNEL = "stable";
  const noop = () => {};
  const service = new SystemManagementService({
    port: 3000,
    portalPort: 3001,
    dataDir,
    updateChannel: "stable",
    automaticUpdateChecks: false
  }, { info: noop, warn: noop, error: noop, debug: noop });
  try {
    const enabled = service.changeUpdateChannel({ allow_beta_updates: true });
    assert.equal(enabled.update_channel, "beta");
    assert.equal(enabled.installed_channel, "stable");
    assert.equal(service.getSystemInfo().installed_channel, "stable");

    const disabled = service.changeUpdateChannel({ allow_beta_updates: false });
    assert.equal(disabled.update_channel, "stable");
    assert.equal(disabled.installed_channel, "stable");
    assert.equal(disabled.beta_exit_policy, null);
    assert.equal(fs.existsSync(path.join(dataDir, "update-request.json")), false);
  } finally {
    service.stopAutomaticChecks();
    if (previousInstalledChannel === undefined) delete process.env.INSTALLED_CHANNEL;
    else process.env.INSTALLED_CHANNEL = previousInstalledChannel;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("restores the installed channel from a matching completed legacy update", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-installed-channel-"));
  const previousCommit = process.env.GIT_COMMIT;
  const previousInstalledChannel = process.env.INSTALLED_CHANNEL;
  process.env.GIT_COMMIT = "abcdef1234567890";
  delete process.env.INSTALLED_CHANNEL;
  fs.writeFileSync(path.join(dataDir, "update-status.json"), JSON.stringify({
    state: "completed",
    target: "beta",
    build: "abcdef123456"
  }));
  const noop = () => {};
  const service = new SystemManagementService({
    port: 3000,
    portalPort: 3001,
    dataDir,
    updateChannel: "beta",
    automaticUpdateChecks: false
  }, { info: noop, warn: noop, error: noop, debug: noop });
  try {
    assert.equal(service.getSystemInfo().installed_channel, "beta");
  } finally {
    service.stopAutomaticChecks();
    if (previousCommit === undefined) delete process.env.GIT_COMMIT;
    else process.env.GIT_COMMIT = previousCommit;
    if (previousInstalledChannel === undefined) delete process.env.INSTALLED_CHANNEL;
    else process.env.INSTALLED_CHANNEL = previousInstalledChannel;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("host update watcher is standalone and always publishes terminal failures", () => {
  const watcher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "lxc-apply-update.sh"),
    "utf8"
  );
  const installer = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "lxc-update-app.sh"),
    "utf8"
  );
  const imageUpdater = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "lxc-image-update.sh"),
    "utf8"
  );
  assert.doesNotMatch(watcher, /node\s+-p/);
  assert.match(watcher, /"state":"failed"/);
  assert.match(watcher, /La actualización no se pudo completar/);
  assert.match(watcher, /installed-release\.json/);
  assert.match(watcher, /"image_tag"/);
  assert.match(installer, /install -m 0755 "\$\{APP_DIR\}\/scripts\/lxc-apply-update\.sh"/);
  assert.match(installer, /install -m 0755 "\$\{APP_DIR\}\/scripts\/lxc-image-update\.sh"/);
  assert.match(installer, /roon-ai-bridge-image-update/);
  assert.doesNotMatch(installer, /cat >\/usr\/local\/sbin\/roon-ai-bridge-apply-update/);
  assert.match(imageUpdater, /docker compose pull/);
  assert.match(imageUpdater, /docker compose up -d --no-build/);
  assert.match(imageUpdater, /pre-update-/);
  assert.match(imageUpdater, /restore_previous_release/);
  assert.match(imageUpdater, /container_ready/);
  assert.doesNotMatch(imageUpdater, /docker compose up -d --build/);
});

test("reports an unpublished stable image as an expected unavailable state", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-no-stable-image-"));
  const previousFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
  const noop = () => {};
  const service = new SystemManagementService({
    port: 3000,
    portalPort: 3001,
    dataDir,
    updateChannel: "stable",
    automaticUpdateChecks: false
  }, { info: noop, warn: noop, error: noop, debug: noop });
  try {
    const status = await service.checkForUpdates();
    assert.equal(status.image_available, false);
    assert.equal(status.update_available, false);
    assert.equal(status.latest_version, null);
    assert.equal(status.error, null);
  } finally {
    service.stopAutomaticChecks();
    global.fetch = previousFetch;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
