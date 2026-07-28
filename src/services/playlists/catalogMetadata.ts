import type { TrackCatalogProfile } from "../trackCatalogService";
import type { AudioMetadata } from "./playlistContracts";
import { metadataCompleteness } from "./playlistMetadataPolicy";

export function catalogArtistCredit(profile: TrackCatalogProfile | null | undefined): string | null {
  const credits = profile?.recording?.artist_credit || [];
  const value = credits.map((credit) => `${credit.name}${credit.join_phrase}`).join("").trim();
  return value || null;
}

export function catalogProfileFromAudio(audio: AudioMetadata | null | undefined): TrackCatalogProfile | null {
  const value = audio?.catalog;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as TrackCatalogProfile
    : null;
}

export function catalogRecordingMetadata(profile: TrackCatalogProfile): Record<string, unknown> | null {
  if (!profile.recording) return null;
  const artist = catalogArtistCredit(profile);
  return {
    musicbrainz_id: profile.recording.musicbrainz_id,
    title: profile.recording.title,
    artist,
    artist_credit: profile.recording.artist_credit,
    disambiguation: profile.recording.disambiguation,
    duration_seconds: profile.recording.duration_seconds,
    duration_source: profile.recording.duration_source,
    isrcs: profile.recording.isrcs,
    composers: profile.composers,
    lyricists: profile.lyricists,
    genres: profile.genres.map((genre) => genre.name),
    confidence: "high"
  };
}

export function applyCatalogMetadata(
  observed: AudioMetadata | null | undefined,
  profile: TrackCatalogProfile
): AudioMetadata {
  const audio: AudioMetadata = { ...(observed || {}) };
  const recording = profile.recording;
  if (!recording) return audio;
  const artist = catalogArtistCredit(profile);
  const releaseGroup = profile.release_group;
  const release = profile.release;

  audio.title = recording.title;
  if (artist) {
    audio.artist = artist;
    audio.album_artist = artist;
  }
  if (releaseGroup?.title) audio.album = releaseGroup.title;
  if (recording.duration_seconds) audio.duration_seconds = recording.duration_seconds;
  if (release?.release_year || releaseGroup?.release_year) {
    audio.release_year = release?.release_year || releaseGroup?.release_year;
  }
  if (releaseGroup?.release_year) audio.original_release_year = releaseGroup.release_year;
  if (release?.track_number || release?.track_position) {
    audio.track_number = release.track_number || release.track_position;
  }
  if (release?.medium_position) audio.disc_number = release.medium_position;
  audio.isrcs = recording.isrcs;
  if (recording.isrcs[0]) audio.isrc = recording.isrcs[0];
  audio.composers = profile.composers;
  audio.composer = profile.composers.join(", ");
  audio.lyricists = profile.lyricists;
  audio.genres = profile.genres.map((genre) => genre.name);
  audio.genre = profile.genres.map((genre) => genre.name).join(", ");
  audio.recording = catalogRecordingMetadata(profile);
  audio.catalog = profile;
  audio.field_provenance = {
    ...(audio.field_provenance as Record<string, unknown> || {}),
    title: { source: "musicbrainz", confidence: "high" },
    artist: { source: "musicbrainz", confidence: "high" },
    ...(releaseGroup?.title ? { album: { source: "musicbrainz", confidence: "high" } } : {}),
    ...(recording.duration_seconds
      ? { duration_seconds: { source: "musicbrainz", confidence: "high" } }
      : {})
  };
  audio.metadata_status = metadataCompleteness(audio).complete ? "exact" : "partial";
  return audio;
}
