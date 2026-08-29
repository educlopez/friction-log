import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAgentRequest,
  DEFAULT_MODEL,
  extractAgentUrl,
  parseArgs,
  resolveModel,
  resolveOwnerLogins,
  resolveRepo,
} from "./sweep.mjs";

describe("parseArgs", () => {
  it("defaults to a dry scan", () => {
    assert.deepEqual(parseArgs(["node", "sweep.mjs"]), {
      command: "scan",
      dryRun: true,
      force: false,
    });
  });

  it("sweep without flags is a live run", () => {
    assert.deepEqual(parseArgs(["node", "sweep.mjs", "sweep"]), {
      command: "sweep",
      dryRun: false,
      force: false,
    });
  });

  it("honors --dry-run and --force on sweep", () => {
    assert.deepEqual(
      parseArgs(["node", "sweep.mjs", "sweep", "--dry-run", "--force"]),
      { command: "sweep", dryRun: true, force: true }
    );
  });
});

describe("extractAgentUrl", () => {
  it("reads the v1 agent.url field", () => {
    assert.equal(
      extractAgentUrl({
        agent: {
          id: "bc-1",
          url: "https://cursor.com/agents/bc-1",
        },
      }),
      "https://cursor.com/agents/bc-1"
    );
  });
});

describe("resolveRepo", () => {
  it("prefers FRICTION_LOG_REPO over GITHUB_REPOSITORY", () => {
    assert.equal(
      resolveRepo({
        FRICTION_LOG_REPO: "educlopez/smoothui",
        GITHUB_REPOSITORY: "educlopez/other",
      }),
      "educlopez/smoothui"
    );
  });

  it("throws when no repo is configured", () => {
    assert.throws(() => resolveRepo({}), /FRICTION_LOG_REPO/);
  });
});

describe("resolveOwnerLogins", () => {
  it("uses the repo owner when FRICTION_LOG_OWNER is unset", () => {
    assert.deepEqual(resolveOwnerLogins({}, "acme/widgets"), ["acme"]);
  });

  it("splits a comma-separated owner list", () => {
    assert.deepEqual(
      resolveOwnerLogins({ FRICTION_LOG_OWNER: "educlopez, teammate" }, "x/y"),
      ["educlopez", "teammate"]
    );
  });
});

describe("resolveModel", () => {
  it("defaults to Composer so the Pro third-party pool stays untouched", () => {
    assert.equal(resolveModel({}), DEFAULT_MODEL);
    assert.equal(resolveModel({ FRICTION_LOG_MODEL: "  " }), DEFAULT_MODEL);
  });

  it("returns null for default/none so the field is omitted", () => {
    assert.equal(resolveModel({ FRICTION_LOG_MODEL: "default" }), null);
    assert.equal(resolveModel({ FRICTION_LOG_MODEL: "none" }), null);
  });

  it("passes an explicit model id through", () => {
    assert.equal(
      resolveModel({ FRICTION_LOG_MODEL: "claude-4-sonnet-thinking" }),
      "claude-4-sonnet-thinking"
    );
  });
});

describe("buildAgentRequest", () => {
  const base = { prompt: "hi", repo: "acme/widgets", startingRef: "main" };

  it("sets model.id when a model is resolved", () => {
    const request = buildAgentRequest({ ...base, model: "composer-latest" });
    assert.deepEqual(request.model, { id: "composer-latest" });
    assert.deepEqual(request.repos, [
      { startingRef: "main", url: "https://github.com/acme/widgets" },
    ]);
  });

  it("omits model entirely when null", () => {
    const request = buildAgentRequest({ ...base, model: null });
    assert.equal("model" in request, false);
  });
});
