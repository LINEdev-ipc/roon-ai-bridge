const path = require("node:path");
const express = require("express");

const app = express();
const root = path.resolve(__dirname, "..");
const previewVersion = "0.20.0-beta.8";
const previewBuild = "local-preview";
let previewVersionStatus = {current_version:previewVersion,current_build:previewBuild,channel:"beta",latest_version:previewVersion,latest_build:previewBuild,update_available:false,checked_at:"2026-07-13T10:00:00Z",error:null};
let previewAutomaticUpdateChecks = true;
let previewDebugMode = false;
let previewUpdateChannel = "beta";
let previewAllowBeta = true;
let previewBetaExitPolicy = null;
let previewUpdateStatus = null;
app.use(express.json());
app.use((_req,res,next)=>{
  res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  next();
});

const albums = {
  moon: ["#dba766", "#37261e", "Moon Safari", "AIR"],
  radio: ["#6c8095", "#191e24", "In Rainbows", "Radiohead"],
  cave: ["#9d322d", "#140d0c", "Push the Sky Away", "Nick Cave"],
  cooper: ["#6b796b", "#111811", "Unspoken Words", "Max Cooper"],
  massive: ["#a46e5c", "#241915", "Mezzanine", "Massive Attack"],
  kraft: ["#c63b30", "#f0e0cb", "The Man-Machine", "Kraftwerk"],
  eno: ["#667c8a", "#d1d0c4", "Ambient 1", "Brian Eno"],
  moderat: ["#35393c", "#a7b4b5", "II", "Moderat"]
};
const zones = [
  { zone_id:"salon", display_name:"Salón", state:"playing", now_playing:{ image_key:"moon", line1:"La femme d'argent", line2:"AIR", line3:"Moon Safari", seek_position:91, length:443 }, outputs:[{ output_id:"salon-out", display_name:"Naim Uniti Atom", volume:{ value:38,min:0,max:100,step:1 } }] },
  { zone_id:"despacho", display_name:"Despacho", state:"paused", now_playing:{ image_key:"radio", line1:"Weird Fishes / Arpeggi", line2:"Radiohead", line3:"In Rainbows", seek_position:132, length:318 }, outputs:[{ output_id:"desk-out", display_name:"RME ADI-2 DAC", volume:{ value:24,min:0,max:100,step:1 } }] },
  { zone_id:"cocina", display_name:"Cocina", state:"stopped", now_playing:null, outputs:[{ output_id:"kitchen-out", display_name:"Bluesound Pulse", volume:{ value:31,min:0,max:100,step:1 } }] }
];
const media = [
  { result_id:"artist-air",media_type:"artist",title:"AIR",subtitle:"French electronic duo",artist:"AIR",image_key:"moon",source:"library",is_library:true },
  { result_id:"artist-radiohead",media_type:"artist",title:"Radiohead",subtitle:"Oxford, England",artist:"Radiohead",image_key:"radio",source:"library",is_library:true },
  { result_id:"album-moon",media_type:"album",title:"Moon Safari",subtitle:"AIR · 1998",artist:"AIR",image_key:"moon",source:"qobuz",release_type:"album",release_type_source:"roon_metadata",quality:{label:"24-bit / 96 kHz"} },
  { result_id:"album-rainbows",media_type:"album",title:"In Rainbows",subtitle:"Radiohead · 2007",artist:"Radiohead",image_key:"radio",source:"library",release_type:"album",release_type_source:"roon_metadata",is_library:true },
  { result_id:"track-femme",media_type:"track",title:"La femme d'argent",artist:"AIR",album:"Moon Safari",image_key:"moon",source:"qobuz",duration_seconds:443,release_year:1998,genre:"Electronic",is_best_match:true,quality:{label:"24-bit / 96 kHz"} },
  { result_id:"track-weird",media_type:"track",title:"Weird Fishes / Arpeggi",artist:"Radiohead",album:"In Rainbows",image_key:"radio",source:"library",duration_seconds:318,release_year:2007,is_library:true },
  { result_id:"track-hand",media_type:"track",title:"Red Right Hand",artist:"Nick Cave & The Bad Seeds",album:"Let Love In",image_key:"cave",source:"tidal",duration_seconds:368,release_year:1994 },
  { result_id:"track-repetition",media_type:"track",title:"Repetition",artist:"Max Cooper, Tom Hodge",artists:[{type:"artist",title:"Max Cooper",artist:null,result_id:"artist-cooper"},{type:"artist",title:"Tom Hodge",artist:null,result_id:null}],album:"Yearning for the Infinite",image_key:"cooper",source:"qobuz",duration_seconds:354,release_year:2019,quality:{label:"24-bit / 96 kHz"} },
  { result_id:"playlist-roon",media_type:"playlist",title:"Late Night Focus",subtitle:"Roon playlist · 42 tracks",image_key:"eno",source:"playlist" }
];
const listeningHistory = [
  ["La femme d'argent","AIR","moon","Salón"],
  ["Weird Fishes / Arpeggi","Radiohead","radio","Despacho"],
  ["Red Right Hand","Nick Cave & The Bad Seeds","cave","Cocina"],
  ["Repetition","Max Cooper, Tom Hodge","cooper","Despacho"],
  ["Teardrop","Massive Attack","massive","Salón"],
  ["The Robots","Kraftwerk","kraft","Cocina"],
  ["An Ending (Ascent)","Brian Eno","eno","Despacho"]
].map(([title,subtitle,image_key,zone_name],index)=>({history_id:`play-${index}`,event_type:"play",media_type:"track",title,subtitle,image_key,zone_name,created_at:new Date(Date.parse("2026-07-17T09:30:00Z")-index*540000).toISOString()}));
const searchHistory = [
  "discografía completa de Nick Cave & The Bad Seeds en orden cronológico",
  "álbumes de Radiohead en alta resolución disponibles en mi biblioteca",
  "AIR Moon Safari",
  "música ambient para trabajar sin voces",
  "Max Cooper Repetition",
  "Massive Attack Mezzanine",
  "electrónica francesa de los años noventa"
].map((query,index)=>({history_id:`search-${index}`,event_type:"search",title:query,query,created_at:new Date(Date.parse("2026-07-17T09:26:00Z")-index*480000).toISOString()}));
media.push(
  ...[["artist-cave","Nick Cave & The Bad Seeds","cave"],["artist-cooper","Max Cooper","cooper"],["artist-massive","Massive Attack","massive"],["artist-kraft","Kraftwerk","kraft"],["artist-eno","Brian Eno","eno"],["artist-moderat","Moderat",null]].map(([result_id,title,image_key])=>({result_id,media_type:"artist",title,subtitle:"Artista",artist:title,image_key,source:"qobuz"})),
  ...[["album-cave","Push the Sky Away","Nick Cave & The Bad Seeds","cave","album"],["album-cooper","Unspoken Words","Max Cooper","cooper","album"],["album-massive","Mezzanine","Massive Attack","massive","album"],["album-kraft","The Man-Machine","Kraftwerk","kraft","album"],["album-eno","Ambient 1","Brian Eno","eno","ep"],["album-moderat","II","Moderat","moderat","single"]].map(([result_id,title,artist,image_key,release_type])=>({result_id,media_type:"album",title,subtitle:`${artist} · ${release_type==="ep"?"EP":release_type==="single"?"Single":"Álbum"}`,artist,image_key,source:"qobuz",release_type,release_type_source:"roon_metadata"})),
  ...Array.from({length:12},(_,index)=>({result_id:`track-preview-${index}`,media_type:"track",title:`Pista destacada ${index+1}`,artist:index%2?"Radiohead":"AIR",album:index%2?"In Rainbows":"Moon Safari",image_key:index%2?"radio":"moon",source:"library",duration_seconds:210+index*7}))
);
function previewGroupKey(item) { return item.media_type==="album"&&["ep","single_ep","single"].includes(item.release_type)?item.release_type:item.media_type; }
function previewSearchPayload(query, requestedTypes = null) {
  const normalized=String(query||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  const priority={artist:0,album:1,ep:2,single_ep:3,single:4,track:5,playlist:6};
  const allowed=requestedTypes?.length?new Set(requestedTypes):null;
  const visibleMedia=allowed?media.filter((item)=>allowed.has(item.media_type)):media;
  const exact=visibleMedia.filter((item)=>String(item.title||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()===normalized)
    .sort((left,right)=>priority[previewGroupKey(left)]-priority[previewGroupKey(right)]);
  const best=exact[0]||visibleMedia.find((item)=>item.media_type==="artist"&&String(item.artist||"").toLowerCase()===normalized)||visibleMedia.find((item)=>item.is_best_match)||visibleMedia[0];
  const results=visibleMedia.map((item)=>({...item,is_best_match:item.result_id===best?.result_id,direct_match:item.result_id===best?.result_id,direct_match_score:item.result_id===best?.result_id?100:0,data_origin:"roon_search_session",completeness:"unknown",ordered:null,identity_verified:true}));
  const groups={artist:[],album:[],ep:[],single_ep:[],single:[],track:[],playlist:[]};
  results.forEach((item)=>groups[previewGroupKey(item)].push(item));
  const best_by_type=Object.fromEntries(Object.entries(groups).filter(([,items])=>items.length).map(([key,items])=>[key,items[0]]));
  return {query:query||"radiohead",source_preference:"highest_quality",results,groups,best_match:results.find((item)=>item.result_id===best?.result_id)||null,best_by_type,ambiguous:false,ambiguity_reason:null,recommended_result_id:best?.result_id||null,selection_required:false,warnings:[]};
}
const playlists = [
  { playlist_id:"night",name:"After dark",description:"Electronic, ambient and slow-burning records for late sessions, dim lights and long transitions that keep unfolding without breaking the mood.",cover_image_key:"cooper",tracks_count:28,track_count:28,total_duration_seconds:7040,duration_known_track_count:28,last_played_at:"2026-07-13T19:40:00Z",tracks:[] },
  { playlist_id:"sunday",name:"Sunday morning",description:"Quiet records for a slow start.",cover_image_key:"eno",tracks_count:19,track_count:19,total_duration_seconds:4750,duration_known_track_count:19,last_played_at:"2026-07-12T09:15:00Z",tracks:[] },
  { playlist_id:"essentials",name:"All-time essentials",description:"Records that never leave the rotation.",cover_image_key:"massive",tracks_count:64,track_count:64,total_duration_seconds:15980,duration_known_track_count:64,last_played_at:null,tracks:[] },
  { playlist_id:"machines",name:"Machines & humans",description:"Krautrock, electro and modern minimalism.",cover_image_key:"kraft",tracks_count:35,track_count:35,total_duration_seconds:8860,duration_known_track_count:35,last_played_at:"2026-07-10T17:30:00Z",tracks:[] }
];
const customCovers = new Map();
const rebuildJobs = new Map();
const keys = [
  { key_id:"chatgpt",name:"ChatGPT · Casa",key_prefix:"rnb_9L2kP…",role:"control",created_at:"2026-07-01T11:00:00Z",last_used_at:"2026-07-10T08:21:00Z",revoked_at:null,tool_permissions:null },
  { key_id:"tablet",name:"Tablet del salón",key_prefix:"rnb_a8N1s…",role:"read",created_at:"2026-06-21T17:00:00Z",last_used_at:"2026-07-09T22:10:00Z",revoked_at:null,tool_permissions:["roon_get_state","roon_show_zones","roon_show_now_playing"] },
  { key_id:"old",name:"Integración antigua",key_prefix:"rnb_v2Old…",role:"control",created_at:"2026-04-02T09:00:00Z",last_used_at:"2026-05-11T15:00:00Z",revoked_at:"2026-06-01T10:00:00Z",tool_permissions:null }
];
const users = [{user_id:"iago",username:"iago",created_at:"2026-06-01T10:00:00Z"},{user_id:"guest",username:"invitado",created_at:"2026-07-05T12:00:00Z"}];
const toolNames = [
  "roon_get_state","roon_search_media","roon_get_media_entity","roon_get_queue",
  "roon_list_playlists","roon_list_temporary_playlists","roon_get_playlist",
  "roon_prepare_playlist_cover","roon_analyze_playlist","roon_export_playlist",
  "roon_get_configuration","roon_run_diagnostics","roon_show_now_playing",
  "roon_show_zones","roon_show_queue","roon_show_media","roon_show_playlist",
  "roon_show_playlist_library","roon_control_playback","roon_set_volume",
  "roon_control_output","roon_set_playback_options","roon_set_grouping",
  "roon_transfer_playback","roon_play_media","roon_enqueue_media","roon_start_radio",
  "roon_play_queue_item","roon_save_playlist","roon_create_temporary_playlist",
  "roon_promote_temporary_playlist","roon_set_playlist_cover","roon_play_playlist",
  "roon_play_playlist_track","roon_rebuild_playlist","roon_save_configuration",
  "roon_apply_zone_preset","roon_edit_playlist_tracks","roon_delete_playlist",
  "roon_import_playlist","roon_delete_configuration"
];
const tools = toolNames.map((name,index)=>({ name,title:name.replace("roon_","").replaceAll("_"," "),description:index<4?"Consulta el estado y la biblioteca de Roon sin modificar la reproducción.":"Ejecuta una acción verificada sobre reproducción, zonas o colecciones.",enabled:index!==13,classification:{read_only:index<4,mutation:index>=4,destructive:false} }));

app.get("/assets/brand/:file", (req,res) => res.sendFile(path.join(root,"logos",req.params.file)));
app.get("/api/roon/images/:key", (req,res) => {
  const [a,b,title,artist] = albums[req.params.key] || ["#66776e","#202520","roonIA","Music"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><defs><filter id="n"><feTurbulence baseFrequency=".75" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 .12"/></feComponentTransfer></filter><linearGradient id="g" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="800" height="800" fill="url(#g)"/><rect width="800" height="800" filter="url(#n)"/><circle cx="620" cy="160" r="210" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="4"/><circle cx="620" cy="160" r="120" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/><text x="55" y="620" fill="white" font-family="Arial" font-size="52" font-weight="700">${title}</text><text x="58" y="675" fill="rgba(255,255,255,.72)" font-family="Arial" font-size="25" letter-spacing="6">${artist.toUpperCase()}</text></svg>`;
  res.type("image/svg+xml").send(svg);
});
app.get("/api/auth/status", (_req,res)=>res.json({setup_required:false}));
app.post("/api/auth/login", (_req,res)=>res.json({token:"preview"}));
app.post("/api/auth/logout", (_req,res)=>res.json({ok:true}));
app.use("/api", (req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
app.get("/api/session", (_req,res)=>res.json({ok:true,version:previewVersion,build:previewBuild,update_channel:previewUpdateChannel,automatic_update_checks:previewAutomaticUpdateChecks,debug_mode:previewDebugMode,available_update:previewVersionStatus.update_available?{version:previewVersionStatus.latest_version,build:previewVersionStatus.latest_build}:null,user:{user_id:"iago",username:"iago"}}));
app.get("/api/dashboard", (_req,res)=>res.json({version:previewVersion,status:{core_connected:true,core_name:"Roon Server · Nucleus",transport_ready:true,browse_ready:true},counts:{zones:3,playing_zones:1,playlists:4,playlist_tracks:146,active_api_keys:2,mcp_tools:14,recent_errors:0},recent_actions:[{tool_or_endpoint:"roon_play_media",source:"mcp",timestamp:"2026-07-10T08:19:00Z"},{tool_or_endpoint:"/zones/salon/volume",source:"portal",timestamp:"2026-07-10T08:16:00Z"}],recent_playlists:playlists.filter(item=>item.last_played_at),recent_listening_history:listeningHistory.slice(0,5),recent_search_history:searchHistory.slice(0,5),history_totals:{play:listeningHistory.length,search:searchHistory.length},now_playing:[]}));
app.get("/api/history", (req,res)=>{const entries=req.query.type==="play"?listeningHistory:searchHistory;const offset=Number(req.query.offset)||0;const limit=Number(req.query.limit)||10;res.json({ok:true,entries:entries.slice(offset,offset+limit),total:entries.length,limit,offset,event_type:req.query.type});});
app.get("/api/roon/zones",(_req,res)=>res.json(zones));
app.get("/api/roon/outputs",(_req,res)=>res.json(zones.flatMap(z=>z.outputs)));
app.get("/api/roon/media/search",(req,res)=>{const types=String(req.query.types||"").split(",").filter(Boolean);const delay={artist:80,album:180,track:320,playlist:480}[types[0]]||80;setTimeout(()=>res.json(previewSearchPayload(req.query.q,types)),delay);});
app.get("/api/roon/media/:id/releases",(_req,res)=>res.json({releases:media.filter(x=>x.media_type==="album")}));
app.get("/api/roon/media/:id/artist-detail",(req,res)=>{const artist=media.find(x=>x.result_id===req.params.id)||media.find(x=>x.media_type==="artist");res.json({artist:{...artist,data_origin:"roon_library",completeness:"complete",identity_verified:true},bio:"Una breve biografía editorial proporcionada por Roon para contextualizar la trayectoria, el sonido y la discografía esencial del artista.",popular_tracks:media.filter(x=>x.media_type==="track").slice(0,12),albums:media.filter(x=>x.media_type==="album").slice(0,6).map(x=>({...x,source:"library"})),singles_eps:media.filter(x=>x.media_type==="album").slice(6,8),data_origin:"roon_library",completeness:"complete",identity_verified:true,warnings:[]});});
app.get("/api/roon/media/:id/album-detail",(req,res)=>{const album=media.find(x=>x.result_id===req.params.id)||media.find(x=>x.media_type==="album");const tracks=media.filter(x=>x.media_type==="track").slice(0,12).map((x,index)=>({...x,track_number:index+1,duration_seconds:210+index*7,source:"library"}));res.json({album:{...album,source:"library",is_library:true,data_origin:"roon_library",completeness:"complete",identity_verified:true},description:"Edición disponible en la biblioteca y los servicios conectados a Roon.",tracks,related_tracks:[],data_origin:"roon_library",completeness:"complete",ordered:true,identity_verified:true,warnings:[]});});
app.get("/api/roon/media/:id",(req,res)=>res.json(media.find(x=>x.result_id===req.params.id)||media[0]));
app.post("/api/roon/media/:id/:action",(_req,res)=>res.json({ok:true,state_verified:true}));
app.get("/api/playlists",(_req,res)=>res.json({playlists,total:playlists.length}));
app.post("/api/playlists",(req,res)=>{const playlist={playlist_id:`preview-${Date.now()}`,name:req.body.name,description:req.body.description||null,cover_image_key:null,tracks_count:0,tracks:[]};playlists.unshift(playlist);res.status(201).json(playlist);});
app.patch("/api/playlists/:id",(req,res)=>{const p=playlists.find(x=>x.playlist_id===req.params.id)||playlists[0];Object.assign(p,{name:req.body.name??p.name,description:req.body.description??p.description});res.json(p);});
app.post("/api/playlists/:id/cover",(req,res)=>{const p=playlists.find(x=>x.playlist_id===req.params.id)||playlists[0];const match=String(req.body.data_url||"").match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);if(match){const id=`preview-${Date.now()}.${match[1].split('/')[1]}`;customCovers.set(id,{type:match[1],bytes:Buffer.from(match[2],"base64")});p.cover_image_key=`custom:${id}`;}res.json(p);});
app.delete("/api/playlists/:id/cover",(req,res)=>{const p=playlists.find(x=>x.playlist_id===req.params.id)||playlists[0];p.cover_image_key=null;res.json(p);});
app.get("/api/playlists/covers/:id",(req,res)=>{const image=customCovers.get(req.params.id);if(!image)return res.sendStatus(404);res.type(image.type).send(image.bytes);});
function previewPlaylistDetail(p){const tracks=media.filter(x=>x.media_type==="track").map((x,i)=>({track_id:`t${i}`,title:x.title,artist:x.artist,album:x.album,image_key:x.image_key,query:`${x.title} ${x.artist}`,audio_metadata:{...x},identity:{duration_seconds:x.duration_seconds||null,release_year:x.release_year||null,source:x.source||null},resolution:{status:"resolved",selected_result_id:x.result_id},roon_binding:{state:"stale",item_key:null,reusable:false,last_observed_at:null}}));const ordered=p.preview_track_order?.map((id)=>tracks.find((track)=>track.track_id===id)).filter(Boolean)||tracks;return {...p,tracks:ordered};}
app.get("/api/playlists/:id",(req,res)=>{const p=playlists.find(x=>x.playlist_id===req.params.id)||playlists[0];res.json(previewPlaylistDetail(p));});
app.post("/api/playlists/:id/rebuild",(req,res)=>{
  const p=playlists.find(x=>x.playlist_id===req.params.id)||playlists[0];
  const job_id=`rebuild-${Date.now()}`;
  rebuildJobs.set(job_id,{job_id,playlist_id:p.playlist_id,status:"running",phase:"musicbrainz_identity",progress:{processed:0,total:4,message:"Verificando identidades en MusicBrainz"},polls:0});
  res.status(202).json(rebuildJobs.get(job_id));
});
app.get("/api/playlists/:id/rebuild/:jobId",(req,res)=>{
  const job=rebuildJobs.get(req.params.jobId);
  if(!job||job.playlist_id!==req.params.id)return res.sendStatus(404);
  job.polls+=1;
  if(job.polls===2)Object.assign(job,{phase:"roon_binding",progress:{processed:2,total:4,message:"Actualizando asociaciones de Roon"}});
  if(job.polls>=3)Object.assign(job,{status:"completed",phase:"completed",progress:{processed:4,total:4,message:"Reconstrucción completada"},result:{playlist:previewPlaylistDetail(playlists.find(x=>x.playlist_id===req.params.id)||playlists[0]),report:{scope:"issues",processed:4,repaired:4,failed:0}}});
  res.json(job);
});
app.post("/api/playlists/:id/tracks/reorder",(req,res)=>{const p=playlists.find(x=>x.playlist_id===req.params.id)||playlists[0];p.preview_track_order=Array.isArray(req.body.track_ids)?req.body.track_ids:null;res.json(previewPlaylistDetail(p));});
app.post("/api/playlists/:id/tracks/:trackId/play",(_req,res)=>res.json({ok:true}));
app.post("/api/playlists/:id/play",(_req,res)=>res.json({ok:true}));
app.get("/api/roon/library",(_req,res)=>res.json({list:{title:"Recently added",count:8},items:Object.entries(albums).map(([key,v])=>({item_key:key,title:v[2],subtitle:v[3],image_key:key,hint:"list"}))}));
app.get("/api/roon/queue/:id",(_req,res)=>res.json({items:media.filter(x=>x.media_type==="track")}));
app.get("/api/zone-presets",(_req,res)=>res.json([{preset_id:"whole-house",name:"Toda la casa",description:"Salón y cocina sincronizados",grouping:{members:[1,2]},volumes:[1,2]},{preset_id:"work",name:"Concentración",description:"Despacho a volumen bajo",grouping:{members:[1]},volumes:[1]}]));
app.get("/api/volume-limits",(_req,res)=>res.json([{limit_id:"night",name:"Noche",target_ref:{type:"global",value:"global"},safe_max:42,schedule:{}}]));
app.get("/api/admin/output-volumes",(_req,res)=>res.json(zones.flatMap(z=>z.outputs).map(o=>({output_id:o.output_id,display_name:o.display_name,current_volume:o.volume,settings:{preferred_value:o.volume.value,minimum_value:0,maximum_value:70}}))));
app.get("/api/admin/api-keys",(_req,res)=>res.json(keys));
app.get("/api/admin/users",(_req,res)=>res.json(users));
app.get("/api/admin/tools",(_req,res)=>res.json({tools,tools_count:tools.length,enabled_tools_count:tools.filter(x=>x.enabled).length}));
app.get("/api/observability/actions",(_req,res)=>res.json({actions:[{tool_or_endpoint:"roon_play_media",source:"mcp",timestamp:"2026-07-10T08:19:00Z"},{tool_or_endpoint:"roon_set_volume",source:"portal",timestamp:"2026-07-10T08:16:00Z"},{tool_or_endpoint:"roon_search_media",source:"mcp",timestamp:"2026-07-10T08:14:00Z"}]}));
app.get("/api/logs/recent",(_req,res)=>res.json({events:[{message:"Roon Core discovery ready",component:"roon",level:"info",timestamp:"2026-07-10T08:00:00Z"}]}));
app.get("/api/diagnostics/bundle",(_req,res)=>res.json({http:{ready:true},roon:{core_connected:true,zones_count:3},mcp:{tools_count:14},recent_errors:[]}));
app.get("/api/admin/settings",(_req,res)=>res.json({version:previewVersion,build:previewBuild,api_port:3000,portal_port:3001,node_environment:"development",browse_enabled:true,mcp_enabled:true,api_auth_enabled:true,public_base_url:"https://bridge.example.test",portal_base_url:"https://portal.example.test",update_channel:previewUpdateChannel,allow_beta_updates:previewAllowBeta,automatic_update_checks:previewAutomaticUpdateChecks,debug_mode:previewDebugMode}));
app.get("/api/admin/system",(_req,res)=>res.json({version:previewVersion,build:previewBuild,update_channel:previewUpdateChannel,allow_beta_updates:previewAllowBeta,beta_exit_policy:previewBetaExitPolicy,automatic_update_checks:previewAutomaticUpdateChecks,debug_mode:previewDebugMode,addresses:[{address:"10.0.60.38",portal_url:"http://10.0.60.38:3001"}],version_status:previewVersionStatus,update_status:previewUpdateStatus}));
app.patch("/api/admin/system/update-preferences",(req,res)=>{previewAutomaticUpdateChecks=req.body.automatic_update_checks===true;res.json({automatic_update_checks:previewAutomaticUpdateChecks});});
app.patch("/api/admin/system/debug-preferences",(req,res)=>{previewDebugMode=req.body.debug_mode===true;res.json({debug_mode:previewDebugMode});});
app.post("/api/admin/system/update-channel",(req,res)=>{if(req.body.allow_beta_updates===true){previewUpdateChannel="beta";previewAllowBeta=true;previewBetaExitPolicy=null;return res.json({ok:true,update_channel:"beta",allow_beta_updates:true,beta_exit_policy:null});}if(req.body.strategy==="wait_for_stable"){previewUpdateChannel="beta";previewAllowBeta=false;previewBetaExitPolicy={mode:"wait_for_stable",requested_at:new Date().toISOString(),installed_version:previewVersion,installed_build:previewBuild};return res.json({ok:true,update_channel:"beta",allow_beta_updates:false,beta_exit_policy:previewBetaExitPolicy});}const requestedAt=new Date().toISOString();previewUpdateChannel="stable";previewAllowBeta=false;previewBetaExitPolicy=null;previewUpdateStatus={state:"queued",message:"Preparando la actualización",requested_at:requestedAt};setTimeout(()=>{previewUpdateStatus={state:"completed",message:"Actualización completada",completed_at:new Date().toISOString(),version:previewVersion};},700);res.status(202).json({ok:true,update_channel:"stable",allow_beta_updates:false,beta_exit_policy:null,update_request:{requested_at:requestedAt,target:"main",channel:"stable"}});});
app.post("/api/admin/system/check-update",(_req,res)=>{previewVersionStatus={...previewVersionStatus,latest_version:"0.17.3",latest_build:"preview-update",update_available:true,checked_at:new Date().toISOString()};res.json(previewVersionStatus);});
app.all("/api/*",(_req,res)=>res.json({ok:true}));
app.use(express.static(path.join(root,"portal")));
app.get("*",(_req,res)=>res.sendFile(path.join(root,"portal","index.html")));
app.listen(3101,"127.0.0.1",()=>console.log("Portal UX preview http://localhost:3101"));
