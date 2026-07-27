import collections
import json
import tempfile
import unittest
from pathlib import Path

from run_conflict_validation import (
    album_artist_compatible,
    album_title_compatible,
    album_title_match_strength,
    artist_sets_compatible,
    case_intent,
    case_title_compatible,
    direct_match,
    named_variant_title_compatible,
    query_ladder,
    resolve_case,
    track_coordinate_matches,
    track_position_matches,
)
from build_binding_context import derive_context
from run_enhanced_validation import load_manual_expectations, summarize
from run_validation import (
    candidate_variant,
    explicit_intent,
    title_compatible,
    variant_compatible,
)
from run_validation import (
    MAX_ARTIST_CASES_3000,
    MAX_RELEASE_GROUP_CASES_3000,
    SOURCE_CATEGORY_TARGETS_1500,
    SOURCE_CATEGORY_TARGETS_3000,
)
from representative_specs import REPRESENTATIVE_SPECS
from representative_specs_3000 import REPRESENTATIVE_SPECS_3000


class BindingRuleTests(unittest.TestCase):
    def test_1500_source_category_quotas_are_complete(self) -> None:
        self.assertEqual(sum(SOURCE_CATEGORY_TARGETS_1500.values()), 1500)
        self.assertEqual(
            set(SOURCE_CATEGORY_TARGETS_1500),
            {"default", "live", "remix", "cover", "acoustic", "alternate"},
        )

    def test_3000_source_category_quotas_add_version_pressure(self) -> None:
        self.assertEqual(sum(SOURCE_CATEGORY_TARGETS_3000.values()), 3000)
        self.assertEqual(
            set(SOURCE_CATEGORY_TARGETS_3000),
            set(SOURCE_CATEGORY_TARGETS_1500),
        )
        self.assertLess(
            SOURCE_CATEGORY_TARGETS_3000["default"] / 3000,
            SOURCE_CATEGORY_TARGETS_1500["default"] / 1500,
        )
        self.assertLessEqual(MAX_RELEASE_GROUP_CASES_3000, 10)
        self.assertLessEqual(MAX_ARTIST_CASES_3000, 20)

    def test_representative_specs_cover_required_catalog_axes(self) -> None:
        cohorts = {item["cohort"] for item in REPRESENTATIVE_SPECS}
        languages = {item["language"] for item in REPRESENTATIVE_SPECS}
        eras = {item["era"] for item in REPRESENTATIVE_SPECS}
        self.assertGreaterEqual(len(REPRESENTATIVE_SPECS), 180)
        self.assertGreaterEqual(len(cohorts), 15)
        self.assertTrue({"en", "es", "pt", "fr", "ja", "ko", "instrumental"} <= languages)
        self.assertTrue({"1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"} <= eras)

    def test_incremental_3000_specs_add_distinct_catalog_breadth(self) -> None:
        releases = {
            (item["album"].casefold(), item["artist"].casefold())
            for item in REPRESENTATIVE_SPECS_3000
        }
        previous = {
            (item["album"].casefold(), item["artist"].casefold())
            for item in REPRESENTATIVE_SPECS
        }
        categories = collections.Counter(
            item["category"] for item in REPRESENTATIVE_SPECS_3000
        )
        languages = {item["language"] for item in REPRESENTATIVE_SPECS_3000}
        artists = {item["artist"] for item in REPRESENTATIVE_SPECS_3000}
        self.assertEqual(len(releases), len(REPRESENTATIVE_SPECS_3000))
        self.assertFalse(releases & previous)
        self.assertGreaterEqual(len(releases), 180)
        self.assertGreaterEqual(len(artists), 165)
        self.assertGreaterEqual(categories["live"], 20)
        self.assertGreaterEqual(categories["remix"], 20)
        self.assertGreaterEqual(categories["acoustic"], 20)
        self.assertGreaterEqual(categories["alternate"], 20)
        self.assertTrue(
            {"en", "es", "pt", "fr", "de", "ja", "ko", "instrumental"}
            <= languages
        )

    def test_acoustic_and_alternate_source_categories_are_explicit(self) -> None:
        self.assertEqual(explicit_intent("acoustic", "Black"), "acoustic")
        self.assertEqual(explicit_intent("alternate", "Strawberry Fields Forever"), "alternate")

    def test_named_mix_descriptor_supplies_remix_intent(self) -> None:
        self.assertEqual(
            explicit_intent("default", "XMAS_EVET10 (thanaton3 mix)"),
            "remix",
        )
        self.assertEqual(
            explicit_intent("default", "CIRCLONT6A [Syrobonkus Mix]"),
            "remix",
        )
        self.assertEqual(explicit_intent("default", "Mixed Emotions"), "default")

    def test_release_only_acoustic_track_requires_album_context(self) -> None:
        case = {
            "title": "Nutshell",
            "album": "Unplugged",
            "intent": "acoustic",
            "source_category": "acoustic",
        }
        candidate = {"title": "Nutshell", "version_hint": "studio"}
        self.assertFalse(variant_compatible(case, candidate))

    def test_release_only_alternate_track_requires_album_context(self) -> None:
        case = {
            "title": "Strawberry Fields Forever",
            "album": "Anthology 2",
            "intent": "alternate",
            "source_category": "alternate",
        }
        candidate = {
            "title": "Strawberry Fields Forever",
            "version_hint": "studio",
        }
        self.assertFalse(variant_compatible(case, candidate))

    def test_edit_takes_precedence_over_remix_release_category(self) -> None:
        self.assertEqual(
            explicit_intent(
                "remix",
                "Voyager (Dominique Torti’s Wild Style edit)",
            ),
            "edit",
        )

    def test_named_remixer_singular_plural_alias_is_compatible(self) -> None:
        self.assertTrue(
            named_variant_title_compatible(
                "Alejandro (Sounds of Arrow remix)",
                "Alejandro (The Sound of Arrows Remix)",
            )
        )

    def test_thin_white_duke_credit_variation_is_compatible(self) -> None:
        self.assertTrue(
            named_variant_title_compatible(
                "Breathe on Me (Jacques Lu Cont’s Thin White Duke mix)",
                "Breathe On Me (feat. Ying Yang Twins) "
                "(Jaques LuCont's Thin White Duke Mix)",
            )
        )

    def test_different_jacques_lu_cont_mix_is_rejected(self) -> None:
        self.assertFalse(
            named_variant_title_compatible(
                "Breathe on Me (Jacques Lu Cont’s Thin White Duke mix)",
                "Breathe On Me (Jacques Lu Cont Mix)",
            )
        )

    def test_dash_and_parentheses_variant_descriptors_are_equivalent(self) -> None:
        self.assertTrue(
            named_variant_title_compatible(
                "Someday (I Will Understand) "
                "(Hi‐Bias Signature radio remix)",
                "Someday (I Will Understand) - "
                "Hi Bias Signature Radio Remix",
            )
        )

    def test_extended_suffix_does_not_hide_named_mix_identity(self) -> None:
        self.assertTrue(
            named_variant_title_compatible(
                "Love Profusion (Ralphi Rosario house vocal mix)",
                "Love Profusion (Ralphi Rosario's House Vocal) (Extended)",
            )
        )

    def test_default_query_ladder_adds_generic_remaster_fallback(self) -> None:
        case = {
            "title": "Carry That Weight",
            "artist": "The Beatles",
            "album": "Abbey Road",
            "intent": "default",
        }
        self.assertEqual(
            query_ladder(case)[-1],
            "Carry That Weight The Beatles Remaster",
        )

    def test_remaster_is_compatible_with_original_recording_intent(self) -> None:
        case = {
            "title": "Carry That Weight",
            "album": "Abbey Road",
            "intent": "default",
        }
        candidate = {
            "title": "Carry That Weight (Remastered 2009)",
            "version_hint": "remaster",
        }
        self.assertTrue(variant_compatible(case, candidate))

    def test_remix_is_not_compatible_with_original_recording_intent(self) -> None:
        case = {
            "title": "Carry That Weight",
            "album": "Abbey Road",
            "intent": "default",
        }
        candidate = {
            "title": "Carry That Weight (2019 Mix)",
            "version_hint": "remix",
        }
        self.assertFalse(variant_compatible(case, candidate))

    def test_album_version_label_is_not_an_alternate_recording(self) -> None:
        self.assertEqual(
            candidate_variant(
                {
                    "title": "Total Trash (Album Version)",
                    "version_hint": "alternate",
                }
            ),
            "default",
        )

    def test_slash_separated_live_medley_prefix_is_a_title_alias(self) -> None:
        self.assertTrue(
            title_compatible(
                "Harlem / Cold Baloney",
                "Medley: Harlem / Cold Baloney "
                "(Live at Carnegie Hall, New York, NY - October 1972)",
            )
        )
        self.assertFalse(title_compatible("Harlem", "Medley: Harlem"))

    def test_self_repeating_article_title_is_a_safe_alias(self) -> None:
        self.assertTrue(title_compatible("The Carioca", "Carioca (The Carioca)"))
        self.assertFalse(title_compatible("The Carioca", "Carioca (Live)"))
        self.assertFalse(title_compatible("Home", "Song (Home)"))

    def test_f_x_roon_credit_alias_is_artist_specific(self) -> None:
        self.assertTrue(artist_sets_compatible({"f x"}, {"f"}))
        self.assertFalse(artist_sets_compatible({"artist x"}, {"artist"}))

    def test_artist_prefixed_album_title_requires_verified_artist(self) -> None:
        self.assertTrue(
            album_title_compatible(
                "MTV Unplugged",
                "Shakira MTV Unplugged",
                ["Shakira"],
            )
        )
        self.assertFalse(
            album_title_compatible(
                "MTV Unplugged",
                "Shakira MTV Unplugged",
                ["Nirvana"],
            )
        )

    def test_acoustic_album_alias_requires_release_shape(self) -> None:
        self.assertEqual(
            album_title_match_strength(
                "Acústico MTV",
                "Acústico (Ao Vivo)",
                ["Cássia Eller"],
            ),
            "release_shape_required",
        )
        self.assertEqual(
            album_title_match_strength(
                "Acústico MTV",
                "Acústico Capital Inicial",
                ["Capital Inicial"],
            ),
            "release_shape_required",
        )

        self.assertEqual(
            album_title_match_strength(
                "Hello! MTV Unplugged",
                "Unplugged",
                ["Charly García"],
            ),
            "release_shape_required",
        )

    def test_album_artist_is_separate_from_track_artist(self) -> None:
        case = {
            "artists": ["Sultan Khan"],
            "album_artists": ["Thievery Corporation"],
        }
        self.assertTrue(
            album_artist_compatible(
                case,
                {
                    "artist": "Thievery Corporation",
                    "artists": [{"title": "Thievery Corporation"}],
                },
            )
        )
        self.assertFalse(
            album_artist_compatible(
                case,
                {"artist": "Archive", "artists": [{"title": "Archive"}]},
            )
        )

    def test_album_context_accepts_musicbrainz_release_track_title(self) -> None:
        case = {
            "title": "Living Dub (Long Life Adrian Sherwood remix)",
            "recording_title": "Living Dub (Long Life Adrian Sherwood remix)",
            "title_variants": [
                "Living Dub",
                "Living Dub (Long Life Adrian Sherwood remix)",
            ],
            "intent": "remix",
        }
        self.assertTrue(
            case_title_compatible(case, "Living Dub", album_context=True)
        )
        self.assertFalse(case_title_compatible(case, "Living Dub"))

    def test_position_match_requires_same_release_shape_and_artist(self) -> None:
        case = {
            "artists": ["IU", "G-DRAGON"],
            "track_artists": ["IU", "G-DRAGON"],
            "disc_position": 1,
            "track_position": 2,
            "release_medium_count": 1,
            "release_track_count": 3,
        }
        tracks = [
            {"title": "dlwlrma", "artists": [{"title": "IU"}], "track_number": 1},
            {
                "title": "Palette (feat. G-DRAGON)",
                "artists": [{"title": "IU"}, {"title": "G-DRAGON"}],
                "track_number": 2,
            },
            {"title": "Ending Scene", "artists": [{"title": "IU"}], "track_number": 3},
        ]
        self.assertTrue(track_position_matches(case, tracks[1], 2, tracks))
        self.assertFalse(track_position_matches(case, tracks[0], 1, tracks))
        self.assertFalse(track_position_matches(case, tracks[1], 2, tracks[:2]))
        wrong_artist = {**tracks[1], "artists": [{"title": "Cover Band"}]}
        self.assertFalse(track_position_matches(case, wrong_artist, 2, tracks))
        self.assertTrue(track_coordinate_matches(case, tracks[1], 2))

    def test_musicbrainz_context_keeps_track_and_album_credits(self) -> None:
        case = {
            "case_id": "MBR-TEST",
            "release_id": "release",
            "recording_id": "recording",
            "title": "Tarana",
            "artist": "Sultan Khan",
            "artists": ["Sultan Khan"],
            "album": "Versions",
            "disc_position": 1,
            "track_position": 1,
            "duration_ms": 1000,
        }
        release = {
            "id": "release",
            "title": "Versions",
            "artist-credit": [
                {
                    "name": "Thievery Corporation",
                    "artist": {"name": "Thievery Corporation"},
                }
            ],
            "media": [
                {
                    "position": 1,
                    "format": "CD",
                    "tracks": [
                        {
                            "position": 1,
                            "number": "1",
                            "title": "Tarana (release title)",
                            "artist-credit": [
                                {
                                    "name": "Ustad Sultan Khan",
                                    "artist": {"name": "Ustad Sultan Khan"},
                                }
                            ],
                            "recording": {
                                "id": "recording",
                                "title": "Tarana",
                                "artist-credit": [
                                    {
                                        "name": "Ustad Sultan Khan",
                                        "artist": {"name": "Ustad Sultan Khan"},
                                    }
                                ],
                                "video": False,
                            },
                        }
                    ],
                }
            ],
        }
        context = derive_context(case, release)
        self.assertEqual(context["album_artists"], ["Thievery Corporation"])
        self.assertEqual(context["track_artists"], ["Ustad Sultan Khan"])
        self.assertEqual(
            context["title_variants"],
            ["Tarana (release title)", "Tarana"],
        )

        self.assertEqual(context["same_title_occurrence"], 1)
        self.assertEqual(context["same_title_total"], 1)

    def test_repeated_release_title_supplies_stable_occurrence(self) -> None:
        case = {
            "case_id": "MBR-RAP-2",
            "release_id": "release",
            "recording_id": "rap-2",
            "title": "Rap",
            "artist": "Curtis Mayfield",
            "artists": ["Curtis Mayfield"],
            "album": "Curtis/Live!",
            "disc_position": 1,
            "track_position": 3,
        }
        release = {
            "id": "release",
            "title": "Curtis/Live!",
            "artist-credit": [
                {
                    "name": "Curtis Mayfield",
                    "artist": {"name": "Curtis Mayfield"},
                }
            ],
            "media": [
                {
                    "position": 1,
                    "tracks": [
                        {
                            "position": 1,
                            "title": "Rap",
                            "recording": {"id": "rap-1", "title": "Rap"},
                        },
                        {
                            "position": 2,
                            "title": "Song",
                            "recording": {"id": "song", "title": "Song"},
                        },
                        {
                            "position": 3,
                            "title": "Rap",
                            "recording": {"id": "rap-2", "title": "Rap"},
                        },
                    ],
                }
            ],
        }
        context = derive_context(case, release)
        self.assertEqual(context["same_title_occurrence"], 2)
        self.assertEqual(context["same_title_total"], 2)
        binding_case = {
            **case,
            **context,
            "intent": "live",
            "source_category": "live",
        }
        self.assertEqual(query_ladder(binding_case)[0], "Rap #2 Curtis Mayfield")
        self.assertTrue(
            case_title_compatible(
                binding_case,
                "Rap (#2) (Live at The Bitter End, NYC)",
            )
        )
        self.assertFalse(
            case_title_compatible(
                binding_case,
                "Rap (#1) (Live at The Bitter End, NYC)",
            )
        )

    def test_localized_live_and_acoustic_labels_share_base_title(self) -> None:
        self.assertEqual(explicit_intent("default", "1967 (Ao vivo)"), "live")
        self.assertTrue(
            title_compatible("1967 (Ao vivo)", "1967 (Acustico)")
        )
        self.assertTrue(
            variant_compatible(
                {
                    "title": "1967 (Ao vivo)",
                    "album": "Acustico MTV",
                    "intent": "acoustic",
                    "source_category": "acoustic",
                },
                {
                    "title": "1967 (Acustico)",
                    "version_hint": "studio",
                },
            )
        )

    def test_musicbrainz_video_is_rejected_before_roon_lookup(self) -> None:
        result = resolve_case(
            "unused",
            {
                "case_id": "MBR-VIDEO",
                "title": "Take It All",
                "artist": "Adele",
                "artists": ["Adele"],
                "album": "Live at the Royal Albert Hall",
                "recording_id": "recording",
                "release_group_id": "group",
                "release_id": "release",
                "source_category": "live",
                "recording_video": True,
            },
        )
        self.assertFalse(result["eligible"])
        self.assertEqual(
            result["ineligible_reason"],
            "musicbrainz_video_recording",
        )

    def test_exact_named_archive_title_is_safe_without_album_label(self) -> None:
        case = {
            "title": "Da Da (Taped piano Strings)",
            "album": "The Smile Sessions",
            "intent": "alternate",
            "source_category": "alternate",
        }
        candidate = {
            "title": "Da Da (Taped Piano Strings)",
            "version_hint": "studio",
        }
        self.assertTrue(variant_compatible(case, candidate))

    def test_archival_session_date_is_a_title_alias(self) -> None:
        self.assertTrue(
            title_compatible(
                "Good Vibrations: Western, Pt. 2 (continued)",
                "Good Vibrations: Western 6/16/66 (Part 2 Continued)",
            )
        )

    def test_named_acoustic_bonus_take_is_safe(self) -> None:
        case = {
            "title": "My Father’s Eyes (take 2)",
            "album": "Unplugged",
            "intent": "acoustic",
            "source_category": "acoustic",
        }
        candidate = {
            "title": "My Father's Eyes (Take 2)",
            "version_hint": "studio",
        }
        self.assertTrue(variant_compatible(case, candidate))
        self.assertFalse(
            variant_compatible(
                {**case, "title": "Circus"},
                {"title": "Circus", "version_hint": "studio"},
            )
        )

    def test_explicit_unplugged_candidate_proves_acoustic_release_track(self) -> None:
        case = {
            "title": "Shake It Out",
            "album": "MTV Unplugged",
            "intent": "acoustic",
            "source_category": "acoustic",
        }
        self.assertTrue(
            variant_compatible(
                case,
                {
                    "title": "Shake It Out (MTV Unplugged, 2012 / Live)",
                    "version_hint": "live",
                },
            )
        )
        self.assertFalse(
            variant_compatible(
                case,
                {
                    "title": "Shake It Out (Live at Madison Square Garden)",
                    "version_hint": "live",
                },
            )
        )

    def test_named_remix_alias_can_correct_missing_roon_hint(self) -> None:
        case = {
            "title": "Love Profusion (Ralphi Rosario house vocal mix)",
            "recording_title": "Love Profusion (Ralphi Rosario house vocal mix)",
            "artist": "Madonna",
            "artists": ["Madonna"],
            "track_artists": ["Madonna"],
            "album": "American Life Mixshow Mix",
            "intent": "remix",
            "source_category": "remix",
        }
        candidate = {
            "title": "Love Profusion (Ralphi Rosario's House Vocal) (Extended)",
            "artists": [{"title": "Madonna"}],
            "version_hint": "studio",
        }
        self.assertTrue(direct_match(case, candidate))
        self.assertTrue(
            title_compatible(
                "Vegetables: Ballad Insert",
                "Vegetables (Ballad Insert 4/14/67)",
            )
        )

    def test_exact_named_cover_session_is_safe(self) -> None:
        case = {
            "title": "Mongoloid (KCRW session)",
            "album": "Nouvelle Vague",
            "intent": "cover",
            "source_category": "cover",
        }
        self.assertTrue(
            variant_compatible(
                case,
                {
                    "title": "Mongoloid (KCRW session)",
                    "version_hint": "studio",
                },
            )
        )
        self.assertFalse(
            variant_compatible(
                case,
                {
                    "title": "Mongoloid (BBC session)",
                    "version_hint": "studio",
                },
            )
        )

    def test_recording_disambiguation_supplies_hidden_live_intent(self) -> None:
        self.assertEqual(
            case_intent(
                {
                    "source_category": "default",
                    "title": "Isis and Osiris",
                    "recording_disambiguation": (
                        "live, 1970-07-04: The Village Gate, New York"
                    ),
                }
            ),
            "live",
        )

    def test_summary_counts_expected_manual_fallback_as_passed_not_resolved(
        self,
    ) -> None:
        corpus = [
            {
                "case_id": "MBR-000001",
                "release_group_id": "rg-1",
                "source_category": "default",
                "title": "Example",
                "cohort": "initial_500",
            }
        ]
        results = [
            {
                "case_id": "MBR-000001",
                "intent": "default",
                "expected": {},
                "eligible": True,
                "resolved": False,
                "manual_required": True,
                "manual_reason": "catalog_item_not_provable",
            }
        ]
        summary = summarize(corpus, results, "2026-01-01T00:00:00+00:00", 1.0)
        self.assertEqual(summary["overall"]["resolved"], 0)
        self.assertEqual(summary["overall"]["manual_required"], 1)
        self.assertEqual(summary["overall"]["unresolved"], 0)
        self.assertEqual(summary["overall"]["passed"], 1)
        self.assertEqual(
            summary["manual_required_cases"],
            [
                {
                    "case_id": "MBR-000001",
                    "intent": "default",
                    "reason": "catalog_item_not_provable",
                }
            ],
        )

    def test_grouped_manual_expectations_expand_to_case_specific_rows(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manual.json"
            path.write_text(
                json.dumps(
                    {
                        "cases": [
                            {"case_id": "MBR-1", "reason": "single_reason"}
                        ],
                        "groups": [
                            {
                                "evidence_group": "missing_release",
                                "reason": "group_reason",
                                "case_ids": ["MBR-2", "MBR-3"],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            expectations = load_manual_expectations(path)
        self.assertEqual(set(expectations), {"MBR-1", "MBR-2", "MBR-3"})
        self.assertEqual(expectations["MBR-2"]["reason"], "group_reason")
        self.assertEqual(
            expectations["MBR-2"]["evidence_group"],
            "missing_release",
        )


if __name__ == "__main__":
    unittest.main()
