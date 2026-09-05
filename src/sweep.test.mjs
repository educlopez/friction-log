import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAgentRequest,
  COMMENTS_PAGE_SIZE,
  DEFAULT_MODEL,
  DEFAULT_OUTCOME_LOOKBACK_MS,
  extractAgentUrl,
  fetchAllPages,
  parseArgs,
  resolveModel,
  resolveOutcomeLookbackMs,
  resolveOwnerLogins,
  resolveRepo,
} from "./sweep.mjs";
import {
  AUTOMATION_LOGINS,
  claimMarkerForDate,
  hasTrustedOutcomeComment,
  isEligible,
} from "./lib.mjs";

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

describe("fetchAllPages", () => {
  it("concatenates every page until a short final page", async () => {
    const pages = [
      Array.from({ length: COMMENTS_PAGE_SIZE }, (_, i) => ({ id: i })),
      [{ id: COMMENTS_PAGE_SIZE }],
    ];
    let page = 0;

    const all = await fetchAllPages(async () => pages[page++]);

    assert.equal(all.length, COMMENTS_PAGE_SIZE + 1);
    assert.equal(/** @type {{ id: number }} */ (all.at(-1)).id, COMMENTS_PAGE_SIZE);
  });

  it("feeds paginated comments past the first page into eligibility checks", async () => {
    const today = new Date("2026-09-01T12:00:00Z");
    const pages = [
      Array.from({ length: COMMENTS_PAGE_SIZE }, (_, i) => ({
        body: `filler ${i}`,
        user: { login: "someone" },
      })),
      [
        {
          body: claimMarkerForDate(today),
          user: { login: AUTOMATION_LOGINS[0] },
        },
      ],
    ];
    let page = 0;
    const comments = await fetchAllPages(async () => pages[page++]);
    const firstPageOnly = pages[0];

    assert.deepEqual(
      isEligible(
        { labels: [{ name: "friction" }], state: "open" },
        firstPageOnly,
        { now: today }
      ),
      { eligible: true, reason: "open" }
    );
    assert.deepEqual(
      isEligible(
        { labels: [{ name: "friction" }], state: "open" },
        comments,
        { now: today }
      ),
      { eligible: false, reason: "claimed" }
    );
  });
});
describe("resolveOutcomeLookbackMs", () => {
  it("defaults to 48 hours", () => {
    assert.equal(resolveOutcomeLookbackMs({}), DEFAULT_OUTCOME_LOOKBACK_MS);
  });

  it("reads FRICTION_LOG_OUTCOME_LOOKBACK_HOURS", () => {
    assert.equal(
      resolveOutcomeLookbackMs({ FRICTION_LOG_OUTCOME_LOOKBACK_HOURS: "24" }),
      24 * 60 * 60 * 1000
    );
  });

  it("rejects invalid lookback values", () => {
    assert.throws(
      () => resolveOutcomeLookbackMs({ FRICTION_LOG_OUTCOME_LOOKBACK_HOURS: "x" }),
      /FRICTION_LOG_OUTCOME_LOOKBACK_HOURS/
    );
  });
});

describe("hasTrustedOutcomeComment integration", () => {
  it("matches the closed-issue fixture from issues #17 and #21", () => {
    const comments = [
      {
        body: "<!-- friction-log:claimed:2026-09-03 -->",
        user: { login: AUTOMATION_LOGINS[0] },
      },
    ];

    assert.equal(hasTrustedOutcomeComment(comments), false);
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
