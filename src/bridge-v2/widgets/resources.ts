import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const WIDGET_V2_VERSION = "v20";
export const WIDGET_V2_URIS = {
  nowPlaying: `ui://roon-ai-bridge/${WIDGET_V2_VERSION}/now-playing.html`,
  media: `ui://roon-ai-bridge/${WIDGET_V2_VERSION}/media.html`,
  playlist: `ui://roon-ai-bridge/${WIDGET_V2_VERSION}/playlist.html`,
  playlistLibrary: `ui://roon-ai-bridge/${WIDGET_V2_VERSION}/playlist-library.html`,
  queue: `ui://roon-ai-bridge/${WIDGET_V2_VERSION}/queue.html`,
  zones: `ui://roon-ai-bridge/${WIDGET_V2_VERSION}/zones.html`
} as const;

export const widgetV2Html = `
<main id="app" class="shell" aria-live="polite">
  <header class="header">
    <svg class="logo" viewBox="0 0 1983 793" role="img" aria-label="roonIA logo">
      <g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="28">
        <path d="M166 542 L166 354 C166 297 211 254 266 254 L294 254" stroke="#678475"/>
        <circle cx="468" cy="397" r="145" stroke="#678475"/>
        <circle cx="832" cy="397" r="145" stroke="#678475"/>
        <path d="M1046 542 L1046 361 C1046 300 1096 254 1167 254 C1238 254 1285 300 1285 361 L1285 542" stroke="#678475"/>
        <path d="M1410 254 L1410 542" stroke="#C16048"/>
        <path d="M1494 542 L1615 258 C1622 242 1646 242 1653 258 L1772 542" stroke="#C16048"/>
        <path d="M1548 424 L1718 424" stroke="#C16048"/>
      </g>
    </svg>
    <span id="view-label" class="view-label">RoonIA</span>
  </header>
  <section id="content" class="content"><p class="empty">Preparando información…</p></section>
</main>
<style>
  :root{color-scheme:dark;--bg:#090b0a;--bg-soft:#0f1211;--surface:#151917;--line:rgba(235,239,236,.11);--line-strong:rgba(235,239,236,.22);--text:#f2f3f1;--text-soft:#b2b8b4;--text-dim:#737b76;--green:#678475;--green-light:#92ab9e;--orange:#c16048;--orange-light:#e07a5e;font-family:"DM Sans",Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  *{box-sizing:border-box}html,body{margin:0;min-width:260px;background:transparent;color:var(--text)}
  .shell{width:100%;max-width:900px;margin:0 auto;padding:16px 18px 20px;background:var(--bg);border:1px solid var(--line);overflow:hidden}
  .header{height:40px;display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:13px;border-bottom:1px solid var(--line)}
  .logo{display:block;width:94px;height:auto}.view-label{color:var(--text-dim);font-size:10px;letter-spacing:.12em;text-transform:uppercase}
  .content{padding-top:16px}.overline{margin:0 0 5px;color:var(--orange-light);font-size:9px;font-weight:700;letter-spacing:.17em;text-transform:uppercase}
  h1,h2,h3,p{margin-top:0}h1{margin-bottom:6px;font-size:clamp(24px,5vw,38px);font-weight:600;line-height:1;letter-spacing:-.045em}h2{margin-bottom:4px;font-size:18px;letter-spacing:-.035em}h3{margin-bottom:3px;font-size:13px;letter-spacing:-.02em}
  .muted{color:var(--text-dim)}.subtitle{margin:0;color:var(--text-soft);font-size:12px;line-height:1.45}.description{max-width:660px;margin:9px 0 0;color:var(--text-dim);font-size:11px;line-height:1.55}
  .art{position:relative;overflow:hidden;aspect-ratio:1;background:linear-gradient(145deg,#202824,#101311);border:1px solid var(--line)}.art img{position:relative;z-index:1;display:block;width:100%;height:100%;object-fit:cover}.art-fallback{position:absolute;inset:0;display:grid;place-items:center;color:var(--green-light);background:radial-gradient(circle at 50% 35%,rgba(146,171,158,.18),transparent 34%),linear-gradient(145deg,#202824,#101311)}.art-fallback svg{width:42%;height:42%;fill:none;stroke:currentColor;stroke-width:1.7}
  .now-list{display:grid;gap:1px;background:var(--line)}.now-card{display:grid;grid-template-columns:112px minmax(0,1fr);gap:18px;padding:16px;background:var(--bg-soft)}.now-copy{min-width:0;align-self:center}.now-copy h2{font-size:22px}.song{margin:8px 0 3px;font-size:16px;font-weight:650;line-height:1.2}.album{margin:2px 0 0;color:var(--text-dim);font-size:11px}
  .outputs{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}.output{display:flex;align-items:center;gap:7px;min-height:27px;padding:0 8px;border:1px solid var(--line);font-size:10px}.output span{color:var(--text-dim)}.output strong{font-weight:650}.output .muted-state{color:var(--orange-light)}
  .hero{display:grid;grid-template-columns:120px minmax(0,1fr);gap:20px;align-items:center;padding:4px 0 18px}.hero-copy{min-width:0}.hero .art{width:120px}.quality{display:inline-block;margin-top:9px;padding:4px 6px;border:1px solid var(--line);color:var(--text-dim);font-size:9px}
  .catalog{margin-top:8px;padding-top:18px;border-top:1px solid var(--line)}.catalog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:12px}.catalog-head h2{margin:0}.catalog-state{padding:4px 6px;border:1px solid var(--green);color:var(--green-light);font-size:8px;letter-spacing:.08em;text-transform:uppercase}.catalog-state.partial{border-color:var(--line);color:var(--text-dim)}.catalog-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line)}.fact{min-width:0;padding:10px 11px;background:var(--bg-soft)}.fact-label{display:block;margin-bottom:4px;color:var(--text-dim);font-size:8px;letter-spacing:.09em;text-transform:uppercase}.fact-value{display:block;overflow-wrap:anywhere;font-size:11px;line-height:1.4}.catalog-group{margin-top:14px}.catalog-group h3{margin-bottom:7px;color:var(--text-soft);font-size:10px;letter-spacing:.08em;text-transform:uppercase}.tags{display:flex;flex-wrap:wrap;gap:5px}.tag{padding:4px 6px;border:1px solid var(--line);color:var(--text-soft);font-size:9px}.catalog-cover{display:grid;grid-template-columns:72px minmax(0,1fr);gap:11px;align-items:center;margin-top:14px;padding:10px;border:1px solid var(--line);background:var(--bg-soft)}.catalog-cover img{display:block;width:72px;height:72px;object-fit:cover}.catalog-cover p{margin:0;color:var(--text-dim);font-size:9px;line-height:1.45}
  .section{margin-top:22px}.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:8px;padding-bottom:7px;border-bottom:1px solid var(--line)}.section-head h2{margin:0;font-size:16px}.count{color:var(--text-dim);font-size:9px}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:1px;background:var(--line)}.card{min-width:0;padding:9px;background:var(--bg-soft)}.card h3{margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.card p{margin:0;overflow:hidden;color:var(--text-dim);font-size:9px;text-overflow:ellipsis;white-space:nowrap}
  .rows{display:grid}.row{display:grid;grid-template-columns:26px 42px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:56px;padding:7px 3px;border-bottom:1px solid var(--line)}.index{color:var(--text-dim);font-size:9px;text-align:center}.cover{width:42px;height:42px}.row-copy{min-width:0}.row-copy strong,.row-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row-copy strong{font-size:11px}.row-copy small{margin-top:3px;color:var(--text-dim);font-size:9px}.duration{color:var(--text-dim);font-size:9px}
  .search-title{margin-bottom:13px}.best-match{max-width:560px;display:grid;grid-template-columns:72px minmax(0,1fr);gap:13px;align-items:center;margin:0 0 20px;padding:11px 13px;border:1px solid var(--green);border-left:3px solid var(--green-light);background:linear-gradient(135deg,rgba(103,132,117,.18),var(--bg-soft))}.best-match .art{width:72px}.best-match h2{font-size:18px}.best-match p:last-child{margin:0;color:var(--text-soft);font-size:11px}.empty{margin:0;padding:26px 8px;color:var(--text-dim);font-size:12px;text-align:center}.warning{margin:16px 0 0;padding-top:10px;border-top:1px solid var(--line);color:var(--text-dim);font-size:9px}
  .summary{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:16px}.summary h1{margin:0}.summary-meta{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.metric{padding:5px 7px;border:1px solid var(--line);color:var(--text-dim);font-size:9px}.metric strong{color:var(--text);font-weight:650}
  .playlist-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(164px,1fr));gap:1px;background:var(--line)}.playlist-tile{min-width:0;padding:12px;background:var(--bg-soft)}.playlist-tile h2{margin:10px 0 4px;overflow:hidden;font-size:15px;text-overflow:ellipsis;white-space:nowrap}.playlist-tile .description{display:-webkit-box;min-height:34px;margin:8px 0 0;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2}.tile-meta{display:flex;flex-wrap:wrap;gap:5px 9px;margin-top:8px;color:var(--text-dim);font-size:9px}
  .queue-context{display:grid;grid-template-columns:76px minmax(0,1fr);gap:14px;align-items:center;margin-bottom:18px;padding:12px;border:1px solid var(--line);background:var(--bg-soft)}.queue-context .art{width:76px}.queue-context h1{font-size:24px}.queue-context .song{margin:7px 0 2px;font-size:13px}
  .zone-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1px;background:var(--line)}.zone-card{min-width:0;padding:14px;background:var(--bg-soft)}.zone-head{display:grid;grid-template-columns:64px minmax(0,1fr) auto;gap:12px;align-items:center}.zone-head .art{width:64px}.zone-head h2{margin:0}.state{padding:4px 6px;border:1px solid var(--line);color:var(--text-dim);font-size:8px;letter-spacing:.08em;text-transform:uppercase}.state.playing{border-color:var(--green);color:var(--green-light)}.zone-media{margin:11px 0 0}.zone-media strong,.zone-media span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.zone-media strong{font-size:12px}.zone-media span{margin-top:3px;color:var(--text-dim);font-size:9px}.zone-outputs{display:grid;gap:5px;margin-top:12px}.zone-output{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:7px 8px;border:1px solid var(--line);font-size:9px}.zone-output small{display:block;margin-top:2px;color:var(--text-dim)}.zone-output strong{font-size:10px}.settings{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px}.setting{padding:3px 5px;border:1px solid var(--line);color:var(--text-dim);font-size:8px}
  @media(max-width:520px){.shell{padding:13px}.header{height:35px}.logo{width:82px}.now-card{grid-template-columns:78px 1fr;gap:12px;padding:12px}.now-copy h2{font-size:17px}.song{font-size:13px}.hero{grid-template-columns:82px 1fr;gap:13px}.hero .art{width:82px}.cards,.playlist-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.row{grid-template-columns:20px 36px minmax(0,1fr)}.cover{width:36px;height:36px}.duration{display:none}.summary{align-items:flex-start;flex-direction:column}.summary-meta{justify-content:flex-start}.queue-context{grid-template-columns:62px 1fr}.queue-context .art{width:62px}.zone-grid{grid-template-columns:1fr}.catalog-grid{grid-template-columns:1fr}}
</style>
<script type="module">
  const content=document.getElementById("content"),label=document.getElementById("view-label");
  function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,function(ch){if(ch==="&")return "&amp;";if(ch==="<")return "&lt;";if(ch===">")return "&gt;";if(ch.charCodeAt(0)===34)return "&quot;";return "&#39;";})}
  function attr(value){return esc(value)}
  function placeholder(type){if(type==="artist")return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4.5 21c.7-4.4 3.2-6.6 7.5-6.6s6.8 2.2 7.5 6.6"></path></svg>';if(type==="album")return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="2.2"></circle><path d="M12 3v3M21 12h-3"></path></svg>';return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"></path><circle cx="6" cy="18" r="3"></circle><circle cx="16" cy="16" r="3"></circle></svg>'}
  function art(url,kind,type){return '<div class="'+(kind||"art")+'"><span class="art-fallback">'+placeholder(type)+'</span>'+(url?'<img src="'+attr(url)+'" alt="" loading="lazy">':'')+'</div>'}
  function time(value){const n=Number(value);if(!Number.isFinite(n)||n<=0)return "";return Math.floor(n/60)+":"+String(Math.floor(n%60)).padStart(2,"0")}
  function longTime(value){const n=Number(value);if(!Number.isFinite(n)||n<=0)return "";const hours=Math.floor(n/3600),minutes=Math.round((n%3600)/60);return hours?hours+" h "+minutes+" min":minutes+" min"}
  function date(value){if(!value)return "";const parsed=new Date(value);return Number.isNaN(parsed.getTime())?"":parsed.toLocaleDateString("es-ES",{day:"numeric",month:"short"})}
  function stateText(value){return ({playing:"Reproduciendo",paused:"En pausa",loading:"Cargando",stopped:"Detenida"})[value]||value||"Desconocido"}
  function loopText(value){return ({disabled:"desactivado",loop:"todo",loop_one:"una canción"})[value]||value||"—"}
  function section(title,items,renderer){if(!items||!items.length)return "";return '<section class="section"><div class="section-head"><h2>'+esc(title)+'</h2><span class="count">'+items.length+'</span></div>'+renderer(items)+'</section>'}
  function card(item){const subtitle=[item.artist||item.album_artist||item.subtitle,item.release_year].filter(Boolean).join(" · ");return '<article class="card">'+art(item.image_url,"art",item.media_type)+'<h3>'+esc(item.title)+'</h3><p>'+esc(subtitle)+'</p></article>'}
  function cards(items){return '<div class="cards">'+items.map(card).join("")+'</div>'}
  function row(item,index){const detail=[item.artist,item.album].filter(Boolean).join(" · ");return '<div class="row"><span class="index">'+esc(item.position||item.track_number||index+1)+'</span>'+art(item.image_url,"art cover","track")+'<span class="row-copy"><strong>'+esc(item.title)+'</strong><small>'+esc(detail)+'</small></span><span class="duration">'+time(item.duration_seconds)+'</span></div>'}
  function rows(items){return '<div class="rows">'+items.map(row).join("")+'</div>'}
  function warning(data){return data.warnings&&data.warnings.length?'<p class="warning">'+esc(data.warnings.join(" · "))+'</p>':""}
  function hero(item,kicker,description){const quality=item.quality&&item.quality.label?'<span class="quality">'+esc(item.quality.label)+'</span>':"";return '<section class="hero">'+art(item.image_url,"art",item.media_type)+'<div class="hero-copy"><p class="overline">'+esc(kicker)+'</p><h1>'+esc(item.title)+'</h1><p class="subtitle">'+esc([item.artist||item.album_artist,item.album,item.release_year].filter(Boolean).join(" · "))+'</p>'+(description?'<p class="description">'+esc(description)+'</p>':"")+quality+'</div></section>'}
  function renderNow(data){const zones=data.zones||[];label.textContent="En reproducción";if(!zones.length){const name=data.requested_zone&&data.requested_zone.name;return '<p class="empty">'+esc(name?"No hay nada reproduciéndose en "+name+".":"No hay ninguna zona reproduciendo en este momento.")+'</p>'}return '<div class="now-list">'+zones.map(function(zone){const media=zone.media||{};const outputs=(zone.outputs||[]).map(function(output){const volume=output.volume;const value=!volume?"—":volume.muted?"Silenciado":volume.value==null?"—":String(volume.value);return '<span class="output"><span>'+esc(output.name)+'</span><strong class="'+(volume&&volume.muted?"muted-state":"")+'">'+esc(value)+'</strong></span>'}).join("");return '<article class="now-card">'+art(media.image_url)+'<div class="now-copy"><p class="overline">'+esc(zone.name)+'</p><p class="song">'+esc(media.title||"Sin título")+'</p><p class="subtitle">'+esc(media.artist||"")+'</p><p class="album">'+esc(media.album||"")+'</p><div class="outputs">'+outputs+'</div></div></article>'}).join("")+'</div>'}
  function renderSearch(data){label.textContent="Resultados";const groups=data.groups||{},best=data.best_match;const bestHtml=best?'<section class="best-match">'+art(best.image_url,"art",best.media_type)+'<div><p class="overline">Mejor resultado · '+esc(best.release_type&&best.release_type!=="unknown"?best.release_type:best.media_type)+'</p><h2>'+esc(best.title)+'</h2><p>'+esc(best.artist||best.album_artist||best.subtitle||"")+'</p></div></section>':"";const grouped=section("Artistas",groups.artist,cards)+section("Álbumes",groups.album,cards)+section("EPs",groups.ep,cards)+section("Singles / EPs",groups.single_ep,cards)+section("Singles",groups.single,cards)+section("Canciones",groups.track,rows)+section("Playlists",groups.playlist,cards);return '<div class="search-title"><p class="overline">Búsqueda</p><h2>'+esc(data.title)+'</h2></div>'+bestHtml+(grouped||'<p class="empty">No se encontraron resultados.</p>')+warning(data)}
  function renderArtist(data){label.textContent="Artista";return hero(data.artist||{},"Artista",null)+section("Canciones populares",data.popular_tracks,rows)+section("Álbumes",data.albums,cards)+section("EPs",data.eps,cards)+section("Singles",data.singles,cards)+section("Singles / EPs",data.mixed_releases,cards)+warning(data)}
  function renderAlbum(data){label.textContent="Álbum";return hero(data.album||{},"Álbum",data.description)+section("Canciones",data.tracks,rows)+warning(data)}
  function fact(name,value){if(value==null||value===""||(Array.isArray(value)&&!value.length))return "";const display=Array.isArray(value)?value.join(", "):value;return '<div class="fact"><span class="fact-label">'+esc(name)+'</span><span class="fact-value">'+esc(display)+'</span></div>'}
  function creditLine(values){return (values||[]).map(function(credit){return String(credit.name||"")+String(credit.join_phrase||"")}).join("")}
  function tags(values){return values&&values.length?'<div class="tags">'+values.map(function(value){return '<span class="tag">'+esc(value)+'</span>'}).join("")+'</div>':""}
  function renderCatalog(catalog){if(!catalog)return "";if(!catalog.recording){const reason=catalog.status==="ambiguous"?"MusicBrainz ha encontrado varias grabaciones compatibles y no se ha elegido una automáticamente.":catalog.status==="provider_error"?"MusicBrainz no está disponible temporalmente.":"No se ha encontrado una identidad canónica segura en MusicBrainz.";return '<section class="catalog"><div class="catalog-head"><h2>Metadatos canónicos</h2><span class="catalog-state partial">'+esc(catalog.status||"pendiente")+'</span></div><p class="description">'+esc(reason)+'</p></section>'}const recording=catalog.recording||{},work=catalog.work||{},group=catalog.release_group||{},release=catalog.release||{},binding=catalog.roon_binding||{},artist=creditLine(recording.artist_credit),duration=time(release.duration_seconds||recording.duration_seconds),releaseType=[group.primary_type].concat(group.secondary_types||[]).filter(Boolean).join(" · "),edition=[release.country,release.release_year,release.media_format].filter(Boolean).join(" · "),position=[release.medium_position?"Disco "+release.medium_position:null,release.track_number||release.track_position?"Pista "+(release.track_number||release.track_position):null].filter(Boolean).join(" · "),facts=fact("Artista acreditado",artist)+fact("Versión",recording.disambiguation)+fact("Duración",duration)+fact("ISRC",recording.isrcs)+fact("Álbum canónico",group.title)+fact("Primera publicación",group.first_release_date||group.release_year)+fact("Tipo",releaseType)+fact("Edición verificada",edition)+fact("Posición",position)+fact("Obra",work.title)+fact("ISWC",work.iswcs)+fact("Compositores",catalog.composers)+fact("Letristas",catalog.lyricists)+fact("Fuente reproducible",binding.source)+fact("Binding de Roon",binding.status==="observed"?"Verificado ahora":binding.status);const genreNames=(catalog.genres||[]).map(function(item){return item.name}).filter(Boolean),cover=catalog.cover_art||{},coverUrl=cover.thumbnail_500_url||cover.thumbnail_250_url||cover.original_url;return '<section class="catalog"><div class="catalog-head"><div><p class="overline">Fuente de verdad · MusicBrainz</p><h2>Metadatos canónicos</h2></div><span class="catalog-state '+(catalog.status==="exact"?"":"partial")+'">'+esc(catalog.status==="exact"?"Identidad verificada":catalog.status)+'</span></div><div class="catalog-grid">'+facts+'</div>'+(genreNames.length?'<div class="catalog-group"><h3>Géneros</h3>'+tags(genreNames)+'</div>':"")+(coverUrl?'<div class="catalog-cover"><img src="'+attr(coverUrl)+'" alt=""><p>Carátula canónica de Cover Art Archive. La imagen de Roon se conserva como respaldo para la edición reproducible.</p></div>':"")+'<p class="warning">MusicBrainz Recording ID · '+esc(recording.musicbrainz_id)+'</p></section>'}
  function renderTrack(data){label.textContent="Canción";return hero(data.track||{},"Canción",null)+renderCatalog(data.catalog)+warning(data)}
  function renderPlaylist(data){const list=data.playlist||{};label.textContent="Playlist";return hero({title:list.name,image_url:list.image_url,artist:list.track_count+" canciones"},"Playlist",list.description)+section("Canciones",data.tracks,rows)+(data.pagination&&data.pagination.has_more?'<p class="warning">Mostrando '+esc(data.pagination.returned)+' de '+esc(data.pagination.total)+' canciones.</p>':"")}
  function renderPlaylistLibrary(data){const lists=data.playlists||[],page=data.pagination||{};label.textContent="Biblioteca";const head='<div class="summary"><div><p class="overline">Mi música</p><h1>Biblioteca de playlists</h1></div><div class="summary-meta"><span class="metric"><strong>'+esc(page.total||lists.length)+'</strong> playlists</span></div></div>';if(!lists.length)return head+'<p class="empty">No hay playlists guardadas.</p>';const tiles='<div class="playlist-grid">'+lists.map(function(list){const duration=longTime(list.total_duration_seconds),played=date(list.last_played_at);return '<article class="playlist-tile">'+art(list.image_url,"art","playlist")+'<h2>'+esc(list.name)+'</h2><div class="tile-meta"><span>'+esc(list.track_count)+' canciones</span>'+(duration?'<span>'+esc(duration)+'</span>':'')+(played?'<span>Escuchada '+esc(played)+'</span>':'')+'</div>'+(list.description?'<p class="description">'+esc(list.description)+'</p>':'')+'</article>'}).join("")+'</div>';return head+tiles+(page.has_more?'<p class="warning">Mostrando '+esc(page.returned)+' de '+esc(page.total)+' playlists.</p>':"")}
  function renderQueue(data){const zone=data.zone||{},now=zone.now_playing||{},items=data.items||[];label.textContent="A continuación";const context='<section class="queue-context">'+art(now.image_url,"art","track")+'<div><p class="overline">'+esc(zone.name||"Zona")+' · '+esc(stateText(zone.state))+'</p><h1>A continuación</h1>'+(now.title?'<p class="song">'+esc(now.title)+'</p><p class="subtitle">'+esc([now.artist,now.album].filter(Boolean).join(" · "))+'</p>':'')+'</div></section>';const meta='<div class="summary-meta"><span class="metric"><strong>'+items.length+'</strong> elementos</span>'+(data.total_duration_seconds?'<span class="metric">'+esc(longTime(data.total_duration_seconds))+'</span>':'')+'</div>';return context+(items.length?'<div class="summary"><h2>Cola</h2>'+meta+'</div>'+rows(items):'<p class="empty">La cola está vacía.</p>')+(data.truncated?'<p class="warning">La cola puede contener más elementos de los mostrados.</p>':"")}
  function renderZones(data){const zones=data.zones||[],states=data.states||{};label.textContent="Zonas";const metrics=['playing','paused','stopped'].filter(function(key){return states[key]}).map(function(key){return '<span class="metric"><strong>'+esc(states[key])+'</strong> '+esc(stateText(key))+'</span>'}).join("");const head='<div class="summary"><div><p class="overline">'+esc(data.core&&data.core.name||"Roon")+'</p><h1>Panel de zonas</h1></div><div class="summary-meta"><span class="metric"><strong>'+zones.length+'</strong> zonas</span>'+metrics+'</div></div>';if(!zones.length)return head+'<p class="empty">No hay zonas disponibles.</p>';return head+'<div class="zone-grid">'+zones.map(function(zone){const media=zone.media||{},settings=zone.playback_settings||{};const outputs=(zone.outputs||[]).map(function(output){const volume=output.volume,value=!volume?"—":volume.muted?"Silenciado":volume.value==null?"—":String(volume.value);const limit=output.safe_limit;return '<div class="zone-output"><span>'+esc(output.name)+(limit?'<small>Límite seguro '+esc(limit.safe_max)+'</small>':'')+'</span><strong>'+esc(value)+'</strong></div>'}).join("");const outputCount=(zone.outputs||[]).length;const flags='<div class="settings"><span class="setting">Aleatorio '+(settings.shuffle?"sí":"no")+'</span><span class="setting">Radio '+(settings.auto_radio?"sí":"no")+'</span><span class="setting">Repetición '+esc(loopText(settings.loop))+'</span></div>';return '<article class="zone-card"><div class="zone-head">'+art(media.image_url,"art","track")+'<div><h2>'+esc(zone.name)+'</h2><p class="subtitle">'+esc(outputCount+' '+(outputCount===1?'salida':'salidas'))+'</p></div><span class="state '+esc(zone.state)+'">'+esc(stateText(zone.state))+'</span></div>'+(media.title?'<div class="zone-media"><strong>'+esc(media.title)+'</strong><span>'+esc([media.artist,media.album].filter(Boolean).join(" · "))+'</span></div>':'<p class="zone-media muted">Sin contenido activo</p>')+(outputs?'<div class="zone-outputs">'+outputs+'</div>':'')+flags+'</article>'}).join("")+'</div>'}
  function render(data){if(!data)return;let html;if(data.view==="now_playing")html=renderNow(data);else if(data.view==="search_results")html=renderSearch(data);else if(data.view==="artist")html=renderArtist(data);else if(data.view==="album")html=renderAlbum(data);else if(data.view==="track")html=renderTrack(data);else if(data.view==="playlist")html=renderPlaylist(data);else if(data.view==="playlist_library")html=renderPlaylistLibrary(data);else if(data.view==="queue")html=renderQueue(data);else if(data.view==="zones")html=renderZones(data);else html='<p class="empty">Vista no disponible.</p>';content.innerHTML=html;content.querySelectorAll(".art img").forEach(function(img){img.addEventListener("error",function(){img.remove()},{once:true})})}
  function widgetFrom(result){if(!result)return null;const candidates=[result,result._meta,result.structuredContent,result.mcp_tool_result,result.call_tool_result,result._meta&&result._meta.mcp_tool_result,result._meta&&result._meta.call_tool_result,result.mcp_tool_result&&result.mcp_tool_result._meta,result.call_tool_result&&result.call_tool_result._meta];for(const item of candidates){if(item&&item.widget)return item.widget;if(item&&item.structuredContent&&item.structuredContent.widget)return item.structuredContent.widget;if(item&&item._meta&&item._meta.widget)return item._meta.widget}return null}
  function applyGlobals(globals){render(widgetFrom(globals&&globals.toolResponseMetadata)||widgetFrom(globals&&globals.toolOutput))}
  applyGlobals(window.openai||{});
  window.addEventListener("openai:set_globals",function(event){applyGlobals(event.detail&&event.detail.globals)},{passive:true});
  window.addEventListener("message",function(event){if(event.source!==window.parent)return;const message=event.data;if(!message||message.jsonrpc!=="2.0"||message.method!=="ui/notifications/tool-result")return;render(widgetFrom(message.params))},{passive:true});
</script>
`.trim();

export function registerWidgetV2Resources(server: McpServer): void {
  const titles: Record<keyof typeof WIDGET_V2_URIS, string> = {
    nowPlaying: "RoonIA Now Playing",
    media: "RoonIA Music Information",
    playlist: "RoonIA Playlist",
    playlistLibrary: "RoonIA Playlist Library",
    queue: "RoonIA Queue",
    zones: "RoonIA Zones"
  };
  for (const [surface, uri] of Object.entries(WIDGET_V2_URIS) as Array<[keyof typeof WIDGET_V2_URIS, string]>) {
    server.registerResource(
      `roonia-${surface}-widget-v3`,
      uri,
      {
        title: titles[surface],
        description: `${titles[surface]} compact read-only widget.`
      },
      async () => ({
        contents: [{
          uri,
          mimeType: "text/html;profile=mcp-app",
          text: widgetV2Html,
          _meta: {
            ui: {
              prefersBorder: true,
              domain: "https://roonia.ipchome.com",
              csp: {
                connectDomains: [],
                resourceDomains: [
                  "https://roonia.ipchome.com",
                  "https://coverartarchive.org",
                  "https://archive.org"
                ]
              }
            },
            "openai/widgetDescription": "Vista compacta y de solo lectura de RoonIA con carátulas y metadatos musicales.",
            "openai/widgetPrefersBorder": true,
            "openai/widgetDomain": "https://roonia.ipchome.com",
            "openai/widgetCSP": {
              connect_domains: [],
              resource_domains: [
                "https://roonia.ipchome.com",
                "https://coverartarchive.org",
                "https://archive.org"
              ]
            }
          }
        }]
      })
    );
  }
}
