const test = require("node:test");
const assert = require("node:assert/strict");
const {
  registerWidgetV2Resources,
  WIDGET_V2_URIS
} = require("../dist/bridge-v2/widgets/resources");

test("serves six focused read-only v20 widget resources", async () => {
  const resources = new Map();
  const server = {
    registerResource(name, uri, options, handler) {
      resources.set(uri, { name, options, handler });
    }
  };

  registerWidgetV2Resources(server);
  assert.deepEqual([...resources.keys()].sort(), Object.values(WIDGET_V2_URIS).sort());
  assert.equal(Object.keys(WIDGET_V2_URIS).length, 6);
  assert.match(WIDGET_V2_URIS.nowPlaying, /\/v20\/now-playing\.html$/);
  assert.match(WIDGET_V2_URIS.media, /\/v20\/media\.html$/);
  assert.match(WIDGET_V2_URIS.playlist, /\/v20\/playlist\.html$/);
  assert.match(WIDGET_V2_URIS.playlistLibrary, /\/v20\/playlist-library\.html$/);
  assert.match(WIDGET_V2_URIS.queue, /\/v20\/queue\.html$/);
  assert.match(WIDGET_V2_URIS.zones, /\/v20\/zones\.html$/);

  for (const uri of Object.values(WIDGET_V2_URIS)) {
    const response = await resources.get(uri).handler();
    const resource = response.contents[0];
    assert.equal(resource.uri, uri);
    assert.equal(resource.mimeType, "text/html;profile=mcp-app");
    assert.match(resource.text, /window\.openai/);
    assert.match(resource.text, /openai:set_globals/);
    assert.match(resource.text, /ui\/notifications\/tool-result/);
    assert.match(resource.text, /aria-label="roonIA logo"/);
    assert.match(resource.text, /#678475/);
    assert.match(resource.text, /#c16048/i);
    assert.match(resource.text, /Canciones populares/);
    assert.match(resource.text, /section\("EPs",data\.eps/);
    assert.match(resource.text, /section\("Singles",data\.singles/);
    assert.match(resource.text, /function placeholder/);
    assert.match(resource.text, /output\.volume/);
    assert.match(resource.text, /loading="lazy"/);
    assert.match(resource.text, /function renderPlaylistLibrary/);
    assert.match(resource.text, /function renderQueue/);
    assert.match(resource.text, /function renderZones/);
    assert.match(resource.text, /function renderCatalog/);
    assert.match(resource.text, /Metadatos can.nicos/);
    assert.match(resource.text, /L.mite seguro/);

    assert.doesNotMatch(resource.text, /tools\/call/);
    assert.doesNotMatch(resource.text, /window\.openai\.callTool/);
    assert.doesNotMatch(resource.text, /roon_ui_/);
    assert.doesNotMatch(resource.text, /setWidgetState/);
    assert.doesNotMatch(resource.text, /setInterval|setTimeout/);
    assert.doesNotMatch(resource.text, /<button|<form|<input|<select/);
    assert.doesNotMatch(resource.text, /image_data_url/);
    assert.match(resource.text, /art-fallback/);
    assert.deepEqual(resource._meta.ui.csp.connectDomains, []);
    assert.deepEqual(resource._meta.ui.csp.resourceDomains, [
      "https://roonia.ipchome.com",
      "https://coverartarchive.org",
      "https://archive.org"
    ]);
    assert.equal(resource._meta["openai/widgetDomain"], "https://roonia.ipchome.com");
  }
});
