import {
  buildSharedShow,
  buildStationPayload,
  defaultGuidedPlacement,
  errorMessage,
  getFlowType,
  makeDefaultFlowItem,
  normalizeSectionDraft,
  normalizeStationDraft,
  parseOptionalCapInput,
  parseOptionalNumber,
  parseOptionalPositiveInt,
  parseSharedShow,
  playlistSelectValue,
  relativeTimeFromIso,
  safeInteger,
  safeNumber,
  sharedShowFileName,
  sharedShowToDraft,
  sharedShowToJson,
  type ShowDraft,
  slugify,
  splitPlaylistSelectValue,
  validateStationDraftLocal,
} from "@/helpers/ai_radio";
import type { AIRadioSection, AIRadioStation } from "@/plugins/api/interfaces";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/plugins/i18n", () => ({
  $t: (key: string) => key,
  i18n: {
    global: {
      locale: { value: "en" },
    },
  },
}));

const makeSection = (
  overrides: Partial<AIRadioSection> = {},
): AIRadioSection => ({
  id: "intro",
  name: "Intro",
  type: "ai_text",
  prompt: "Say hello",
  ...overrides,
});

const makeStation = (
  overrides: Partial<AIRadioStation> = {},
): AIRadioStation => ({
  id: "my_station",
  name: "My Station",
  source_playlist_id: "42",
  source_playlist_provider: "library",
  section_ids: ["intro"],
  section_order: [{ when: "between_songs", flow: [{ MUST: "intro" }] }],
  ...overrides,
});

describe("slugify", () => {
  it("normalizes names to snake_case ids", () => {
    expect(slugify("My Cool Station!")).toBe("my_cool_station");
    expect(slugify("  Frühstücks-Radio  ")).toBe("fr_hst_cks_radio");
  });

  it("falls back to a placeholder for empty input", () => {
    expect(slugify("!!!")).toBe("item");
  });
});

describe("number parsing", () => {
  it("clamps and falls back safely", () => {
    expect(safeNumber("5", 0, 1)).toBe(5);
    expect(safeNumber("-3", 0, 1)).toBe(0);
    expect(safeNumber("abc", 0, 1)).toBe(1);
    expect(safeInteger("7.9", 1, 1)).toBe(7);
    expect(safeInteger("abc", 1, 3)).toBe(3);
  });

  it("treats empty optional inputs as unset", () => {
    expect(parseOptionalNumber("")).toBe(0);
    expect(parseOptionalCapInput("")).toBeUndefined();
    expect(parseOptionalCapInput("-1")).toBeUndefined();
    expect(parseOptionalCapInput("90")).toBe(90);
    expect(parseOptionalPositiveInt("0")).toBeUndefined();
    expect(parseOptionalPositiveInt("4")).toBe(4);
  });
});

describe("errorMessage", () => {
  it("extracts messages from various error shapes", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage({ detail: "not found" })).toBe("not found");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage({ code: 42 })).toBe('{"code":42}');
  });
});

describe("playlist select values", () => {
  it("round-trips provider and item id", () => {
    const value = playlistSelectValue("spotify", "abc:123");
    expect(splitPlaylistSelectValue(value)).toEqual({
      provider: "spotify",
      itemId: "abc:123",
    });
  });

  it("defaults to library provider for malformed values", () => {
    expect(splitPlaylistSelectValue("")).toEqual({
      provider: "library",
      itemId: "",
    });
  });
});

describe("normalizeSectionDraft", () => {
  it("applies defaults and coerces the type", () => {
    const draft = normalizeSectionDraft({
      id: " intro ",
      name: " Intro ",
      type: "bogus" as AIRadioSection["type"],
      prompt: "",
    } as AIRadioSection);
    expect(draft.id).toBe("intro");
    expect(draft.name).toBe("Intro");
    expect(draft.type).toBe("ai_text");
    expect(draft.web_search).toBe("disabled");
    expect(draft.constraints).toEqual({ max_chars: 0 });
  });
});

describe("normalizeStationDraft", () => {
  it("fills defaults for missing fields", () => {
    const draft = normalizeStationDraft({} as AIRadioStation);
    expect(draft.source_playlist_provider).toBe("library");
    expect(draft.target_playlist_provider).toBe("builtin");
    expect(draft.dynamic_batch_size).toBe(3);
    expect(draft.clear_queue_on_start).toBe(true);
    expect(draft.general.weather_provider).toBe("open_meteo");
    expect(draft.section_ids).toEqual([]);
  });

  it("keeps explicit values", () => {
    const draft = normalizeStationDraft(
      makeStation({ clear_queue_on_start: false, dynamic_batch_size: 5 }),
    );
    expect(draft.clear_queue_on_start).toBe(false);
    expect(draft.dynamic_batch_size).toBe(5);
  });
});

describe("buildStationPayload", () => {
  it("derives the id from the name and strips embedded sections", () => {
    const draft = normalizeStationDraft(
      makeStation({ id: "", name: "Morning Show" }),
    );
    draft.sections = [makeSection()];
    const payload = buildStationPayload(draft);
    expect(payload.id).toBe("morning_show");
    expect("sections" in payload).toBe(false);
  });
});

describe("validateStationDraftLocal", () => {
  it("accepts a complete station", () => {
    expect(validateStationDraftLocal(makeStation())).toBeNull();
  });

  it("rejects missing required fields", () => {
    expect(validateStationDraftLocal(makeStation({ name: " " }))).toContain(
      "station_name_required",
    );
    expect(
      validateStationDraftLocal(makeStation({ source_playlist_id: "" })),
    ).toContain("station_source_playlist_required");
    expect(
      validateStationDraftLocal(makeStation({ section_ids: [] })),
    ).toContain("select_section");
    expect(
      validateStationDraftLocal(makeStation({ section_order: [] })),
    ).toContain("section_order_required");
  });

  it("rejects incomplete flow items", () => {
    expect(
      validateStationDraftLocal(
        makeStation({
          section_order: [{ when: "between_songs", flow: [{ MUST: "" }] }],
        }),
      ),
    ).toContain("must_needs_section");
    expect(
      validateStationDraftLocal(
        makeStation({
          section_order: [
            {
              when: "between_songs",
              flow: [
                { ALTERNATIVE: { choices: [{ section: "", weight: 1 }] } },
              ],
            },
          ],
        }),
      ),
    ).toContain("alternative_needs_choice");
    expect(
      validateStationDraftLocal(
        makeStation({
          section_order: [
            { when: "between_songs", flow: [{ OPTIONAL: { section: "" } }] },
          ],
        }),
      ),
    ).toContain("optional_needs_section");
  });
});

describe("flow item helpers", () => {
  it("detects the flow type and creates matching defaults", () => {
    expect(getFlowType({ MUST: "x" })).toBe("MUST");
    expect(getFlowType(makeDefaultFlowItem("ALTERNATIVE"))).toBe("ALTERNATIVE");
    expect(getFlowType(makeDefaultFlowItem("OPTIONAL"))).toBe("OPTIONAL");
  });
});

describe("defaultGuidedPlacement", () => {
  const placementFor = (id: string, name: string) =>
    defaultGuidedPlacement(makeSection({ id, name }));

  it("maps common English markers", () => {
    expect(placementFor("intro", "Show Intro")).toBe("start_of_playlist");
    expect(placementFor("outro", "Show Outro")).toBe("end_of_playlist");
    expect(placementFor("news", "News Flash")).toBe("between_songs");
  });

  it("prefers end markers over a loose intro match", () => {
    // Regression: previously matched "intro" inside "Introduction" first.
    expect(placementFor("song_introduction_end", "Song Introduction End")).toBe(
      "end_of_playlist",
    );
  });

  it("maps German markers", () => {
    expect(placementFor("begruessung", "Begrüßung")).toBe("start_of_playlist");
    expect(placementFor("verabschiedung", "Verabschiedung")).toBe(
      "end_of_playlist",
    );
  });

  it("does not treat words containing 'ende' as end markers", () => {
    expect(placementFor("sendung", "Sendung Spezial")).toBe("between_songs");
  });
});

describe("relativeTimeFromIso", () => {
  const NOW = Date.parse("2026-07-16T12:00:00Z");
  const at = (iso: string) => relativeTimeFromIso(iso, NOW);

  it("returns empty for missing or invalid input", () => {
    expect(relativeTimeFromIso(undefined, NOW)).toBe("");
    expect(relativeTimeFromIso("not-a-date", NOW)).toBe("");
  });

  it("formats sub-minute differences as now", () => {
    expect(at("2026-07-16T11:59:30Z")).toBe("now");
  });

  it("formats minutes, hours and days ago", () => {
    expect(at("2026-07-16T11:45:00Z")).toBe("15m ago");
    expect(at("2026-07-16T10:00:00Z")).toBe("2h ago");
    expect(at("2026-07-13T12:00:00Z")).toBe("3d ago");
  });
});

describe("share/import", () => {
  const makeDraft = (): ShowDraft => ({
    basics: {
      id: "late_night",
      name: "Late Night",
      sourcePlaylistId: "42",
      sourcePlaylistProvider: "library",
      targetPlaylistProvider: "builtin",
      defaultPlayerId: "player_1",
      maxDurationMinutes: 90,
      dynamicBatchSize: 4,
      dynamicPollSeconds: 7,
      dynamicPrefetchRemainingTracks: 3,
      clearQueueOnStart: false,
      general: {
        instructions: "Host personality: calm.",
        weather_provider: "open_meteo",
        weather_timeout_seconds: 8,
      },
    },
    segments: [
      {
        id: "intro",
        name: "Intro",
        prompt: "Open the show with <next_songinfo>.",
        webSearch: "disabled",
        maxChars: 650,
        plays: { kind: "start" },
      },
      {
        id: "fact",
        name: "Artist fact",
        prompt: "Share one fact.",
        webSearch: "allow",
        maxChars: 500,
        plays: { kind: "every_n_songs", n: 2 },
      },
      {
        id: "weather",
        name: "Weather",
        prompt: "Use <weather_hourly>.",
        webSearch: "force",
        maxChars: 400,
        plays: { kind: "every_n_min", n: 60 },
      },
      {
        id: "sign_off",
        name: "Sign-off",
        prompt: "Say goodbye.",
        webSearch: "disabled",
        maxChars: 300,
        plays: { kind: "occasionally", percent: 25 },
      },
    ],
  });

  const roundTrip = (draft: ShowDraft) =>
    parseSharedShow(sharedShowToJson(buildSharedShow(draft)));

  it("round-trips persona and every segment field", () => {
    const draft = makeDraft();
    const imported = sharedShowToDraft(roundTrip(draft), {
      itemId: "99",
      provider: "spotify",
    });

    expect(imported.basics.general.instructions).toBe(
      "Host personality: calm.",
    );
    expect(imported.segments.map((s) => s.name)).toEqual([
      "Intro",
      "Artist fact",
      "Weather",
      "Sign-off",
    ]);
    expect(imported.segments.map((s) => s.webSearch)).toEqual([
      "disabled",
      "allow",
      "force",
      "disabled",
    ]);
    expect(imported.segments.map((s) => s.maxChars)).toEqual([
      650, 500, 400, 300,
    ]);
    expect(imported.segments.map((s) => s.plays)).toEqual(
      draft.segments.map((s) => s.plays),
    );
  });

  it("leaves the playlist, player and station id behind", () => {
    const shared = buildSharedShow(makeDraft());
    expect(JSON.stringify(shared)).not.toContain("player_1");
    expect(Object.keys(shared)).toEqual([
      "kind",
      "version",
      "name",
      "instructions",
      "segments",
    ]);

    const imported = sharedShowToDraft(shared);
    expect(imported.basics.sourcePlaylistId).toBe("");
    expect(imported.basics.sourcePlaylistProvider).toBe("library");
    expect(imported.basics.defaultPlayerId).toBe("");
    expect(imported.basics.id).toBeUndefined();
  });

  it("takes the importer's playlist choice", () => {
    const imported = sharedShowToDraft(roundTrip(makeDraft()), {
      itemId: "99",
      provider: "spotify",
    });
    expect(imported.basics.sourcePlaylistId).toBe("99");
    expect(imported.basics.sourcePlaylistProvider).toBe("spotify");
  });

  it("drops unknown keys instead of carrying them into the draft", () => {
    // written as raw JSON so "__proto__" survives as a real key — an object
    // literal would set the prototype and JSON.stringify would drop it
    const shared = parseSharedShow(`{
      "kind": "ai_radio_show",
      "version": 1,
      "name": "Sneaky",
      "instructions": "",
      "malicious": "payload",
      "__proto__": { "polluted": true },
      "segments": [
        { "name": "Intro", "prompt": "Hi", "plays": { "kind": "start" },
          "extra": "nope" }
      ]
    }`);

    expect(shared).not.toHaveProperty("malicious");
    expect(shared.segments[0]).not.toHaveProperty("extra");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    const imported = sharedShowToDraft(shared);
    expect(Object.keys(imported.segments[0]).sort()).toEqual([
      "id",
      "maxChars",
      "name",
      "plays",
      "prompt",
      "webSearch",
    ]);
  });

  it("gives colliding segment names unique ids", () => {
    const shared = parseSharedShow(
      JSON.stringify({
        kind: "ai_radio_show",
        version: 1,
        name: "Twins",
        segments: [
          { name: "Break", prompt: "One", plays: { kind: "start" } },
          { name: "Break", prompt: "Two", plays: { kind: "end" } },
        ],
      }),
    );
    const ids = sharedShowToDraft(shared).segments.map((s) => s.id);
    expect(ids).toEqual(["break", "break_2"]);
  });

  it("falls back to disabled for an unknown web search mode", () => {
    const shared = parseSharedShow(
      JSON.stringify({
        kind: "ai_radio_show",
        version: 1,
        name: "Odd",
        segments: [
          {
            name: "Intro",
            prompt: "Hi",
            webSearch: "always",
            plays: { kind: "start" },
          },
        ],
      }),
    );
    expect(shared.segments[0].webSearch).toBe("disabled");
  });

  it("rejects documents that are not a valid shared show", () => {
    const invalid = "providers.ai_radio.validation.invalid_import_file";
    const base = {
      kind: "ai_radio_show",
      version: 1,
      name: "Show",
      segments: [{ name: "Intro", prompt: "Hi", plays: { kind: "start" } }],
    };
    const rejects = [
      "not json at all",
      "[]",
      JSON.stringify({ ...base, kind: "something_else" }),
      JSON.stringify({ ...base, version: 2 }),
      JSON.stringify({ ...base, name: "   " }),
      JSON.stringify({ ...base, segments: [] }),
      JSON.stringify({
        ...base,
        segments: [{ name: "Intro", prompt: "", plays: { kind: "start" } }],
      }),
      JSON.stringify({
        ...base,
        segments: [
          { name: "Intro", prompt: { evil: true }, plays: { kind: "start" } },
        ],
      }),
      JSON.stringify({
        ...base,
        segments: [{ name: "Intro", prompt: "Hi", plays: { kind: "never" } }],
      }),
      JSON.stringify({
        ...base,
        segments: [{ name: "Intro", prompt: "x".repeat(8001) }],
      }),
      JSON.stringify({
        ...base,
        segments: Array.from({ length: 51 }, () => ({
          name: "Intro",
          prompt: "Hi",
          plays: { kind: "start" },
        })),
      }),
    ];
    for (const payload of rejects) {
      expect(() => parseSharedShow(payload)).toThrowError(invalid);
    }
  });
});

describe("sharedShowFileName", () => {
  it("slugifies the show name", () => {
    expect(sharedShowFileName("Late Night Deep Cuts")).toBe(
      "late_night_deep_cuts.ai-radio-show.json",
    );
  });
});
