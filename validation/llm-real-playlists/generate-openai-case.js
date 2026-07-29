const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { z } = require("zod");

const {
  BRIDGE_V2_INSTRUCTIONS
} = require("../../dist/bridge-v2/mcp/server");
const {
  registerBridgeV2Tools
} = require("../../dist/bridge-v2/mcp/tools");

const ROOT = __dirname;
const PROMPTS = JSON.parse(
  fs.readFileSync(path.join(ROOT, "prompts.json"), "utf8")
);

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function captureSavePlaylistTool() {
  let captured = null;
  const server = {
    registerTool(name, options) {
      if (name === "roon_save_playlist") captured = options;
    }
  };
  registerBridgeV2Tools(server, { manifestMode: true });
  if (!captured) throw new Error("roon_save_playlist tool definition was not captured");
  return {
    type: "function",
    name: "roon_save_playlist",
    description: captured.description,
    parameters: z.toJSONSchema(z.object(captured.inputSchema))
  };
}

function reserveMultiplier(complexity) {
  if (complexity === "exact_versions") return 2;
  if (complexity === "constrained") return 1.6;
  return 1.25;
}

function validateArguments(spec, args) {
  const errors = [];
  if (args.desired_count !== 100) {
    errors.push(`desired_count must be 100, received ${args.desired_count}`);
  }
  const tracks = Array.isArray(args.tracks) ? args.tracks : [];
  const multiplier = reserveMultiplier(args.selection_complexity);
  const minimum = Math.ceil(100 * multiplier);
  if (tracks.length < minimum) {
    errors.push(
      `${args.selection_complexity || "standard"} requires at least ${minimum} candidates, received ${tracks.length}`
    );
  }
  tracks.forEach((track, index) => {
    if (!track || typeof track.title !== "string" || !track.title.trim()) {
      errors.push(`tracks[${index}].title is required`);
    }
    if (typeof track?.artist_credit !== "string" || !track.artist_credit.trim()) {
      errors.push(`tracks[${index}].artist_credit is required`);
    }
  });
  const primary = tracks.filter((track) => (track.role || "primary") === "primary");
  if (primary.length < 100) {
    errors.push(`at least 100 primary candidates are required, received ${primary.length}`);
  }
  if (spec.legacy_prompt_id === "P04" && args.release_year_from !== 2006) {
    errors.push("the relative 20-year constraint must be converted to release_year_from=2006");
  }
  return errors;
}

async function main() {
  const caseId = argument("case");
  const outputSuffix = argument("output-suffix", "");
  if (!caseId) throw new Error("Use --case=R02 through --case=R10");
  const spec = PROMPTS.find((entry) => entry.case_id === caseId);
  if (!spec) throw new Error(`Unknown case ${caseId}`);
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const tool = captureSavePlaylistTool();
  const model = process.env.OPENAI_MODEL || "gpt-5.6-sol";
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT || "medium";
  const startedAt = new Date();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      instructions: BRIDGE_V2_INSTRUCTIONS,
      input: spec.prompt,
      tools: [tool],
      tool_choice: { type: "function", name: "roon_save_playlist" },
      parallel_tool_calls: false,
      reasoning: { effort: reasoningEffort },
      max_output_tokens: 80000
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `OpenAI returned HTTP ${response.status}: ${payload?.error?.message || "unknown error"}`
    );
  }
  const call = (payload.output || []).find((entry) =>
    entry.type === "function_call" && entry.name === "roon_save_playlist"
  );
  if (!call) throw new Error("The model did not call roon_save_playlist");
  const args = JSON.parse(call.arguments);
  const validationErrors = validateArguments(spec, args);
  const completedAt = new Date();
  const record = {
    case_id: outputSuffix ? `${spec.case_id}-${outputSuffix}` : spec.case_id,
    legacy_prompt_id: spec.legacy_prompt_id,
    human_prompt: spec.prompt,
    status: validationErrors.length
      ? "generation_rejected_before_execution"
      : "frozen_before_execution",
    methodology: {
      candidate_source: "openai_model_tool_call",
      musicbrainz_search_before_freeze: false,
      roon_search_before_freeze: false,
      manual_candidate_repair: false,
      retries: 0
    },
    generation: {
      model,
      reasoning_effort: reasoningEffort,
      response_id: payload.id,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      elapsed_ms: completedAt.getTime() - startedAt.getTime(),
      instructions_sha256: crypto
        .createHash("sha256")
        .update(BRIDGE_V2_INSTRUCTIONS)
        .digest("hex"),
      tool_description_sha256: crypto
        .createHash("sha256")
        .update(tool.description)
        .digest("hex"),
      tool_schema_sha256: crypto
        .createHash("sha256")
        .update(JSON.stringify(tool.parameters))
        .digest("hex"),
      usage: payload.usage || null,
      validation_errors: validationErrors
    },
    arguments: args
  };
  const outputName = `${spec.case_id}-${spec.legacy_prompt_id.toLowerCase()}-openai${
    outputSuffix ? `-${outputSuffix}` : ""
  }.json`;
  const outputPath = path.join(ROOT, "cases", outputName);
  fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    case_id: spec.case_id,
    status: record.status,
    model,
    elapsed_ms: record.generation.elapsed_ms,
    desired_count: args.desired_count,
    selection_complexity: args.selection_complexity,
    candidates: Array.isArray(args.tracks) ? args.tracks.length : 0,
    validation_errors: validationErrors,
    output: outputPath
  })}\n`);
  if (validationErrors.length) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
