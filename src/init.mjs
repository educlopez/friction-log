import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

    try {
      await readFile(dest);
      if (!options.force) {
        console.log(`skip existing ${file.to} (pass --force to overwrite)`);
        continue;
      }
    } catch {
      // destination does not exist
    }

    const template = await readFile(source, "utf8");
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, renderTemplate(template, values));
    written.push(file.to);
    console.log(`wrote ${file.to}`);
  }

  return { owner, repo, written };
}
