const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadConfig } = require("../dist/config/env");

const DIRECT_ENV_KEYS = [
  "DATA_DIR",
  "ROON_CORE_HOST",
  "ROON_CORE_PORT"
];

function withEnvironment(values, callback) {
  const previous = new Map(
    DIRECT_ENV_KEYS.map((key) => [key, process.env[key]])
  );
  try {
    for (const key of DIRECT_ENV_KEYS) delete process.env[key];
    Object.assign(process.env, values);
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("loads an optional direct Roon Core endpoint", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-config-"));
  try {
    const config = withEnvironment({
      DATA_DIR: dataDir,
      ROON_CORE_HOST: "10.0.60.39",
      ROON_CORE_PORT: "9332"
    }, () => loadConfig());

    assert.equal(config.roonCoreHost, "10.0.60.39");
    assert.equal(config.roonCorePort, 9332);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("requires direct Roon Core host and port together", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-config-"));
  try {
    assert.throws(
      () => withEnvironment({
        DATA_DIR: dataDir,
        ROON_CORE_HOST: "10.0.60.39"
      }, () => loadConfig()),
      /ROON_CORE_HOST and ROON_CORE_PORT must be configured together/
    );
    assert.throws(
      () => withEnvironment({
        DATA_DIR: dataDir,
        ROON_CORE_PORT: "9332"
      }, () => loadConfig()),
      /ROON_CORE_HOST and ROON_CORE_PORT must be configured together/
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
