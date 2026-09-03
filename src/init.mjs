import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const AGENTS_MARKER = "<!-- friction-log:agents -->";
export const FRICTION_LOG_HEADING = /^## Friction log\s*$/m;

/**
 * @param {string} url
 * @returns {string | null}
 */
export function parseRepoFromRemote(url) {
  const cleaned = url.trim().replace(/\.git$/, "");
  const match = cleaned.match(/github\.com[:/]([^/]+\/[^/]+)$/i);

  return match ? match[1] : null;
}

/**
 * @param {string} template
 * @param {{ repo: string, owner: string }} values
 * @returns {string}
 */
export function renderTemplate(template, values) {
  return template
    .replaceAll("{{REPO}}", values.repo)
    .replaceAll("{{OWNER}}", values.owner);
}


/**
 * Paths a repo's gitignore would swallow. `init` writing a file that `git add`
 * then drops is a silent failure with a loud consequence: the sweep spawns an
 * agent whose prompt points at a skill the repo does not contain.
 *
 * @param {string[]} paths
 * @param {string} cwd
 * @returns {string[]}
 */
export function ignoredPaths(paths, cwd) {
  if (paths.length === 0) {
    return [];
  }

  try {
    const out = execFileSync("git", ["check-ignore", "--", ...paths], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return out.split("\n").filter(Boolean);
  } catch (error) {
    // exit 1 means nothing matched; anything else means git could not answer
    const status = /** @type {{ status?: number }} */ (error).status;
    return status === 1 ? [] : [];
  }
}

/**
 * `init` writes into a checkout it did not create. A symlinked destination
 * would let that tree redirect the write outside itself, so refuse to follow
 * one rather than resolving it.
 *
 * @param {string} path
 * @returns {Promise<string | null>} Contents, or null when the path is absent.
 */
export async function readRegularFile(path) {
  let stats;

  try {
    stats = await lstat(path);
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error).code === "ENOENT") {
      return null;
    }

    throw error;
  }

  if (stats.isSymbolicLink()) {
    throw new Error(
      `${path} is a symbolic link. Refusing to write through it — replace it with a regular file and re-run.`
    );
  }

  return await readFile(path, "utf8");
}

/**
 * `AGENTS.md` is the cross-harness convention: a single root file, read by
 * agents that do not load per-directory skills. It is the target repository's
 * own file, so this appends a marked section instead of overwriting, and does
 * nothing when the marker is already there.
 *
 * @param {string | null} existing Current AGENTS.md content, or null when absent.
 * @param {string} section Rendered section to merge in.
 * @returns {{ action: "created" | "appended" | "present" | "duplicate-heading", text: string }}
 */
export function mergeAgentsSection(existing, section) {
  const body = `${section.trimEnd()}\n`;

  if (existing === null || existing.trim() === "") {
    return { action: "created", text: body };
  }

  if (existing.includes(AGENTS_MARKER)) {
    return { action: "present", text: existing };
  }

  if (FRICTION_LOG_HEADING.test(existing)) {
    return { action: "duplicate-heading", text: existing };
  }

  return { action: "appended", text: `${existing.trimEnd()}\n\n${body}` };
}

/**
 * @param {string} repo
 * @param {string} destRoot
 * @param {{ force?: boolean }} [options]
 */
export async function initRepo(repo, destRoot, options = {}) {
  const owner = repo.split("/")[0];
  const values = { owner, repo };
  const files = [
    {
      from: "templates/friction.yml",
      to: ".github/ISSUE_TEMPLATE/friction.yml",
    },
    // One rendered copy per harness skill convention. Cursor loads the
    // investigator; Claude Code loads the same policy when you hit friction
    // locally. `init --force` re-syncs both from the template.
    {
      from: "templates/SKILL.md",
      to: ".claude/skills/friction-log/SKILL.md",
    },
    {
      from: "templates/SKILL.md",
      to: ".cursor/skills/friction-log/SKILL.md",
    },
    {
      from: "templates/friction-log.md",
      to: "docs/contributing/friction-log.md",
    },
    {
      from: "templates/workflow.yml",
      to: ".github/workflows/friction-log.yml",
    },
  ];

  /** @type {string[]} */
  const written = [];

  for (const file of files) {
    const dest = join(destRoot, file.to);
    const source = join(PACKAGE_ROOT, file.from);

    const current = await readRegularFile(dest);

    if (current !== null && !options.force) {
      console.log(`skip existing ${file.to} (pass --force to overwrite)`);
      continue;
    }

    const template = await readFile(source, "utf8");
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, renderTemplate(template, values));
    written.push(file.to);
    console.log(`wrote ${file.to}`);
  }

  const agentsPath = join(destRoot, "AGENTS.md");
  const agentsTemplate = renderTemplate(
    await readFile(join(PACKAGE_ROOT, "templates/agents.md"), "utf8"),
    values
  );
  const agents = mergeAgentsSection(
    await readRegularFile(agentsPath),
    agentsTemplate
  );

  if (agents.action === "present") {
    console.log("skip AGENTS.md (friction log section already present)");
  } else if (agents.action === "duplicate-heading") {
    console.log(
      "WARNING AGENTS.md already has a `## Friction log` section that this tool did not write. Appending would duplicate the heading. Remove or replace it, then re-run."
    );
  } else {
    await writeFile(agentsPath, agents.text);
    written.push("AGENTS.md");
    console.log(`${agents.action} AGENTS.md`);
  }

  const ignored = ignoredPaths(written, destRoot);

  for (const path of ignored) {
    console.log(
      `WARNING ${path} is gitignored here. \`git add\` will drop it, and the sweep spawns an agent whose prompt points at the skill. Narrow the ignore rule, then commit it.`
    );
  }

  return { ignored, owner, repo, written };
}
