const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");

const { ApiKeyService, roleCanControl } = require("../dist/services/apiKeyService");
const { createDatabase } = require("../dist/db/database");
const { createAuthMiddleware } = require("../dist/api/middleware/auth");
const { ToolAccessService } = require("../dist/services/toolAccessService");

function config(dataDir) {
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
    apiToken: "bootstrap-secret",
    portalAdminToken: "bootstrap-secret",
    publicBaseUrl: "https://example.test",
    oauthIssuer: "https://example.test",
    oauthApprovalPin: "pin",
    roonStreamingSource: "tidal"
  };
}

test("creates hashed API keys, authenticates roles and permanently revokes keys", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-keys-"));
  const database = createDatabase(config(dataDir));
  const service = new ApiKeyService(config(dataDir), database);

  try {
    const created = service.create({ name: "Portal test", role: "admin" });
    assert.match(created.token, /^rnb_[A-Za-z0-9_-]+$/);
    assert.equal(created.role, "admin");

    const raw = database.db
      .prepare("SELECT key_hash FROM api_keys WHERE key_id = ?")
      .get(created.key_id);
    assert.notEqual(raw.key_hash, created.token);
    assert.equal(JSON.stringify(service.list()).includes(created.token), false);

    const authenticated = service.authenticate(created.token);
    assert.equal(authenticated.key_id, created.key_id);
    assert.ok(authenticated.last_used_at);
    assert.equal(roleCanControl(authenticated.role), true);
    assert.equal(roleCanControl("read"), false);

    const revoked = service.revoke(created.key_id);
    assert.ok(revoked.revoked_at);
    assert.equal(service.authenticate(created.token), null);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("enforces read and control roles on the main HTTP API", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-roles-"));
  const appConfig = config(dataDir);
  const database = createDatabase(appConfig);
  const service = new ApiKeyService(appConfig, database);
  const readKey = service.create({ name: "Reader", role: "read" });
  const controlKey = service.create({ name: "Controller", role: "control" });
  const context = {
    config: appConfig,
    apiKeyService: service,
    oauthService: {
      tokenIsValid: () => false,
      getExpectedResource: () => "https://example.test/mcp"
    }
  };
  const app = express();
  app.use(createAuthMiddleware(context));
  app.get("/resource", (_req, res) => res.json({ ok: true }));
  app.post("/resource", (_req, res) => res.json({ ok: true }));
  app.post("/mcp", (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ error: error.code || "INTERNAL_ERROR" });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const rootUrl = `http://127.0.0.1:${address.port}`;
  const baseUrl = `${rootUrl}/resource`;

  try {
    const readResponse = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${readKey.token}` }
    });
    assert.equal(readResponse.status, 200);

    const deniedWrite = await fetch(baseUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${readKey.token}` }
    });
    assert.equal(deniedWrite.status, 403);

    const allowedMcpTransport = await fetch(`${rootUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${readKey.token}` }
    });
    assert.equal(allowedMcpTransport.status, 200);

    const allowedWrite = await fetch(baseUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${controlKey.token}` }
    });
    assert.equal(allowedWrite.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("reactivates revoked keys and persists per-tool permissions", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-key-tools-"));
  const database = createDatabase(config(dataDir));
  const service = new ApiKeyService(config(dataDir), database);
  try {
    const created = service.create({
      name: "Restricted controller",
      role: "control",
      tool_permissions: ["roon_get_state", "roon_show_zones"]
    });
    assert.deepEqual(created.tool_permissions, ["roon_get_state", "roon_show_zones"]);
    service.revoke(created.key_id);
    assert.equal(service.authenticate(created.token), null);
    service.reactivate(created.key_id);
    assert.deepEqual(service.authenticate(created.token).tool_permissions, ["roon_get_state", "roon_show_zones"]);
    const updated = service.update(created.key_id, { tool_permissions: ["roon_get_state"] });
    assert.deepEqual(updated.tool_permissions, ["roon_get_state"]);
    assert.equal(service.delete(created.key_id).key_id, created.key_id);
    assert.equal(service.list().length, 0);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("global tool settings and key allowlists are both enforced", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-tool-access-"));
  const database = createDatabase(config(dataDir));
  const keyService = new ApiKeyService(config(dataDir), database);
  const access = new ToolAccessService(database);
  try {
    const key = keyService.create({ name: "One tool", role: "control", tool_permissions: ["roon_get_state"] });
    assert.equal(access.canUse("roon_get_state", key), true);
    assert.equal(access.canUse("roon_show_zones", key), false);
    access.setEnabled("roon_get_state", false);
    assert.equal(access.canUse("roon_get_state", key), false);
    assert.equal(access.list(["roon_get_state"])[0].enabled, false);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
