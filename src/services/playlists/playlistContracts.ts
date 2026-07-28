import type { RoonMediaService, SourcePreference } from "../../roon/roonMediaService";
import type { Logger } from "../../utils/logger";

export type VirtualPlaylistTrackMetadata = Record<string, unknown>;
export type AudioMetadata = Record<string, unknown>;
export type ResolutionMetadata = Record<string, unknown>;
export type PlaylistRecordingMetadata = {
  musicbrainz_id: string;
  title: string;
  artist: string | null;
  disambiguation: string | null;
  duration_seconds: number | null;
  isrcs: string[];
  composers: string[];
  lyricists: string[];
  genres: string[];
  confidence: "high" | "medium";
};
export type PlaylistReleaseMetadata = {
  title: string;
  album_artist: string | null;
  image_key: string | null;
  source: string | null;
  source_confidence: string | null;
  release_year: number | null;
  original_release_year: number | null;
  track_number: number | null;
  disc_number: number | null;
  release_type: string | null;
  verified_by: string;
  confidence: "high" | "medium";
};
export type TrackIdentityMetadata = {
  version: 1;
  catalog_separated: true;
  fingerprint: string;
  recording_id: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  album_artist: string | null;
  duration_seconds: number | null;
  isrc: string | null;
  release_year: number | null;
  track_number: number | null;
  disc_number: number | null;
  version_hint: string | null;
  source: string | null;
  canonical_query: string;
};
export type RoonBinding = {
  state: "stale" | "missing";
  item_key: string | null;
  reusable: false;
  last_observed_at: string | null;
};

export type VirtualPlaylistTrack = {
  track_id: string;
  query: string;
  roon_item_key: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  image_key: string | null;
  cover: { image_key: string } | null;
  position: number;
  metadata: VirtualPlaylistTrackMetadata | null;
  audio_metadata: AudioMetadata | null;
  user_metadata: VirtualPlaylistTrackMetadata | null;
  identity: TrackIdentityMetadata;
  resolution: ResolutionMetadata | null;
  roon_binding: RoonBinding;
  created_at: string;
};

export type VirtualPlaylist = {
  playlist_id: string;
  name: string;
  description: string | null;
  cover_image_key: string | null;
  cover: { image_key: string } | null;
  tracks: VirtualPlaylistTrack[];
  track_count: number;
  tracks_count: number;
  total_duration_seconds: number | null;
  duration_known_track_count: number;
  last_played_at: string | null;
  created_at: string;
  updated_at: string;
  lifecycle: PlaylistLifecycle;
};

export type PlaylistLifecycle =
  | { type: "saved" }
  | {
      type: "temporary";
      intent: string | null;
      expires_at: string;
      created_at: string;
    };

export type PlaylistScope = "saved" | "temporary" | "all";

export type VirtualPlaylistListItem = Omit<VirtualPlaylist, "tracks"> & {
  tracks?: VirtualPlaylistTrack[];
  track_pagination?: {
    limit: number;
    offset: number;
    returned: number;
    total: number;
  };
};

export type VirtualPlaylistListOptions = {
  includeTracks?: boolean;
  limit?: number;
  offset?: number;
  trackLimit?: number;
  trackOffset?: number;
  scope?: PlaylistScope;
};

export type VirtualPlaylistListResult = {
  playlists: VirtualPlaylistListItem[];
  total: number;
  limit: number;
  offset: number;
  include_tracks: boolean;
  scope: PlaylistScope;
};

export type VirtualPlaylistDetailResult = Omit<VirtualPlaylist, "tracks"> & {
  tracks?: VirtualPlaylistTrack[];
  include_tracks: boolean;
  limit: number;
  offset: number;
  returned_count: number;
  has_more: boolean;
};

export type PlaylistPlayMode = "add_to_queue" | "add_next" | "play_now";

export type PlaylistPlaybackRuntime = {
  mediaService?: RoonMediaService;
  logger?: Logger;
  sourcePreference?: SourcePreference;
};

export type StoredPlaylistCover = {
  cover_image_key: string;
  content_type: string;
  bytes: Buffer;
};
