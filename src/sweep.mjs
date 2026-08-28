import { appendFile } from "node:fs/promises";
import {
  buildInvestigatorPrompt,
  DEFAULT_OWNER_LOGINS,
  FRICTION_LABEL,
  isEligible,
} from "./lib.mjs";

const GITHUB_API = "https://api.github.com";
const CURSOR_API = "https://api.cursor.com/v1/agents";

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const rest = argv.slice(2).filter((arg) => arg.length > 0);
  const command = rest[0] === "sweep" ? "sweep" : "scan";
  const dryRun = command === "scan" || rest.includes("--dry-run");
  const force = rest.includes("--force");

  return { command, dryRun, force };
}

/**
 * @param {string} repo
 * @param {string} token
 * @param {string} path
 */
async function githubJson(repo, token, path) {
  const url = `${GITHUB_API}/repos/${repo}${path}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub ${response.status} ${path}: ${body}`);
  }

  return await response.json();
}

/**
 * @param {string} repo
 * @param {string} token
 */
async function listOpenFrictionIssues(repo, token) {
  /** @type {unknown[]} */
  const issues = await githubJson(
    repo,
    token,
    `/issues?labels=${FRICTION_LABEL}&state=open&per_page=100`
  );

  if (!Array.isArray(issues)) {
    throw new Error("GitHub issues response was not an array");
  }

  return issues;
}

/**
 * @param {string} repo
 * @param {string} token
 * @param {number} issueNumber
 */
async function listComments(repo, token, issueNumber) {
  /** @type {unknown[]} */
  const comments = await githubJson(
    repo,
    token,
    `/issues/${issueNumber}/comments?per_page=100`
  );

  if (!Array.isArray(comments)) {
    throw new Error("GitHub comments response was not an array");
  }

  return comments;
}

/**
 * @param {string} prompt
 * @param {string} repo
 * @param {string} apiKey
 * @param {string} startingRef
 */
async function spawnCursorAgent(prompt, repo, apiKey, startingRef) {
  const response = await fetch(CURSOR_API, {
    body: JSON.stringify({
      autoCreatePR: false,
      name: "Friction log investigator",
      prompt: { text: prompt },
      repos: [
        {
          startingRef,
          url: `https://github.com/${repo}`,
        },
      ],
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Cursor ${response.status}: ${body}`);
  }

  return JSON.parse(body);
}

/**
 * @param {unknown} payload
 * @returns {string | null}
 */
export function extractAgentUrl(payload) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("agent" in payload)
  ) {
    return null;
  }

  const { agent } = payload;

  if (typeof agent !== "object" || agent === null) {
    return null;
  }

  if ("url" in agent && typeof agent.url === "string") {
    return agent.url;
  }

  if ("id" in agent && typeof agent.id === "string") {
    return `https://cursor.com/agents/${agent.id}`;
  }

  return null;
}

/**
 * @param {Record<string, string | boolean | number | null>} result
 */
async function writeGithubOutput(result) {
  const outputPath = process.env.GITHUB_OUTPUT;

  if (!outputPath) {
    return;
  }

  const lines = Object.entries(result).map(([key, value]) => `${key}=${value}`);
  await appendFile(outputPath, `${lines.join("\n")}\n`);
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function resolveRepo(env) {
  const repo = env.FRICTION_LOG_REPO ?? env.GITHUB_REPOSITORY;

  if (!repo) {
    throw new Error("FRICTION_LOG_REPO or GITHUB_REPOSITORY is required");
  }

  return repo;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} repo
 * @returns {string[]}
 */
export function resolveOwnerLogins(env, repo) {
  const fromEnv = env.FRICTION_LOG_OWNER;
  const source = fromEnv || repo.split("/")[0] || DEFAULT_OWNER_LOGINS[0];

  return source
    .split(",")
    .map((login) => login.trim())
    .filter(Boolean);
}

/**
 * @param {{ dryRun: boolean, force: boolean, env?: NodeJS.ProcessEnv }} options
 */
export async function runSweep(options) {
  const env = options.env ?? process.env;
  const repo = resolveRepo(env);
  const ownerLogins = resolveOwnerLogins(env, repo);
  const startingRef = env.FRICTION_LOG_REF || "main";
  const paused = env.FRICTION_LOG_PAUSED === "true";
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  const cursorKey = env.CURSOR_API_KEY;

  if (!token) {
    throw new Error("GH_TOKEN or GITHUB_TOKEN is required");
  }

  const openIssues = await listOpenFrictionIssues(repo, token);
  const numberedIssues = openIssues.filter(
    (issue) => typeof issue === "object" && issue !== null && "number" in issue
  );
  const withComments = await Promise.all(
    numberedIssues.map(async (issue) => ({
      comments: await listComments(repo, token, Number(issue.number)),
      issue,
    }))
  );

  /** @type {typeof openIssues} */
  const eligibleIssues = [];
  let skippedCount = 0;

  for (const { comments, issue } of withComments) {
    const verdict = isEligible(issue, comments, {
      force: options.force,
      ownerLogins,
    });

    if (verdict.eligible) {
      eligibleIssues.push(issue);
    } else if (verdict.reason === "skipped") {
      skippedCount += 1;
    }
  }

  const result = {
    agentUrl: null,
    dryRun: options.dryRun,
    eligibleCount: eligibleIssues.length,
    openCount: openIssues.length,
    paused,
    repo,
    skippedCount,
    spawned: false,
  };

  console.log(JSON.stringify(result, null, 2));

  if (eligibleIssues.length === 0) {
    await writeGithubOutput(result);
    return result;
  }

  if (paused) {
    console.log("Paused via FRICTION_LOG_PAUSED. Not spawning.");
    await writeGithubOutput(result);
    return result;
  }

  const prompt = buildInvestigatorPrompt(
    eligibleIssues.map((issue) => ({
      body: typeof issue.body === "string" ? issue.body : "",
      html_url: typeof issue.html_url === "string" ? issue.html_url : "",
      number: Number(issue.number),
      title: typeof issue.title === "string" ? issue.title : "",
    })),
    { repo }
  );

  if (options.dryRun) {
    console.log("Dry run. Prompt that would be sent:\n");
    console.log(prompt);
    await writeGithubOutput(result);
    return result;
  }

  if (!cursorKey) {
    console.log(
      "CURSOR_API_KEY is not set. Scan complete; not spawning an agent."
    );
    await writeGithubOutput(result);
    return result;
  }

  const spawned = await spawnCursorAgent(
    prompt,
    repo,
    cursorKey,
    startingRef
  );
  const agentUrl = extractAgentUrl(spawned);

  result.spawned = true;
  result.agentUrl = agentUrl;
  console.log(`Spawned investigator: ${agentUrl ?? JSON.stringify(spawned)}`);
  await writeGithubOutput(result);
  return result;
}
