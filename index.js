/**
 * dsh-preset-categorizer — host half.
 *
 * It answers one question: **which capabilities belong together, and which
 * agent preset should carry them?**
 *
 * It works on three kinds of capability, not just skills:
 *
 *   1. PLUGINS — loader entries in the host composition (dsh-ffmpeg,
 *      dsh-image-gen, dsh-remotion, ...).
 *   2. MCPs    — loader entries backed by the MCP client (mcp-playwright,
 *      mcp-drawio, mcp-blender, mcp-figcraft, mcp-genoffice).
 *   3. SKILLS  — filesystem skill providers (genoffice, mineru, typst,
 *      codebase-memory, audio-edit, browser-cdp, ...).
 *
 * The result is a set of DSH **agent presets**, one per category, registered
 * with the host's own `ctx.agentPresets` registry. A category therefore
 * becomes a first-class preset in the GUI picker, exactly like the built-in
 * Creative / Office / Web / Media presets.
 *
 * Design rules, in the order they matter:
 *
 *   - NEVER change an existing preset. This plugin only ADDS presets whose
 *     ids it owns (prefixed `cat-`). It never edits, replaces or removes a
 *     built-in preset, and never touches the profile's package.json. That
 *     keeps it safe to install and remove.
 *   - NEVER move a capability. The plugin REPORTS what belongs where; it
 *     does not unmount anything from the host composition. Moving a
 *     capability is a decision with a cost (a plugin that lives in bundles
 *     is also the one whose web UI loads), so it stays with the human.
 *   - NEVER add tools by default. A categorization plugin that carries its
 *     own tool schemas would spend the very budget it is meant to protect.
 *     The tools are registered only when the host opts in.
 *
 * The plugin is mounted in the Creative preset (not in bundles), so its
 * tools and its work only appear in sessions that asked for them.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CATEGORIES,
  assignCapabilities,
  buildPresetDefinition,
} from './lib/categories.js';

export const name = 'preset-categorizer';

/**
 * Services this plugin needs. `loader` enumerates the composed entries and
 * `agentPresets` is the registry the new presets are registered with.
 */
export const inject = ['loader', 'agentPresets'];

/** Prefix for every preset id this plugin owns. */
const OWNED_PREFIX = 'cat-';

/** The MCP client plugin name; entries backed by it are MCP servers. */
const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client';

/**
 * Read the skill directories the host actually has.
 *
 * The skill roots are the same ones the host mounts: ~/.agents/skills* .
 * A skill is identified by its directory name, which is also its catalog
 * name.
 */
function discoverSkills() {
  const agents = join(homedir(), '.agents');
  const found = [];
  let roots = [];
  try {
    roots = readdirSync(agents, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('skills'))
      .map((d) => d.name);
  } catch {
    roots = ['skills'];
  }
  for (const root of roots) {
    let entries = [];
    try {
      entries = readdirSync(join(agents, root), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(agents, root, entry.name);
      if (!existsSync(join(skillDir, 'SKILL.md'))) continue;
      found.push({
        kind: 'skill',
        id: entry.name,
        name: entry.name,
        package: entry.name,
        description: readDescription(join(skillDir, 'SKILL.md')),
        source: join(agents, root, entry.name),
        root,
      });
    }
  }
  return found;
}

/** Pull the `description:` line out of a SKILL.md, if it has one. */
function readDescription(path) {
  try {
    const text = readFileSync(path, 'utf8');
    const match = /^description:\s*(.+)$/m.exec(text);
    return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

/**
 * Read the host's loader entries and split them into plugins and MCPs.
 *
 * The loader is the host's own view of the composed tree, so this sees
 * exactly what is mounted — including entries that came from the profile
 * package.json and entries added at runtime.
 */
function discoverLoaderEntries(ctx) {
  const plugins = [];
  const mcps = [];
  let entries = [];
  try {
    entries = [...ctx.loader.entries()];
  } catch {
    return { plugins, mcps };
  }
  for (const entry of entries) {
    const id = typeof entry.id === 'string' ? entry.id : '';
    const pkg = typeof entry.name === 'string' ? entry.name : '';
    if (!id && !pkg) continue;
    // Skip the harness's own machinery: it is not a user capability.
    if (id.startsWith('preset-') || id === 'skill-filesystem' || id === 'tool-skill') continue;
    const record = {
      kind: pkg === MCP_CLIENT ? 'mcp' : 'plugin',
      id,
      name: pkg,
      package: pkg,
      description: '',
      source: 'loader',
    };
    if (record.kind === 'mcp') mcps.push(record);
    else plugins.push(record);
  }
  return { plugins, mcps };
}

/**
 * Read the plugin rows of an existing preset, so a category can inherit it.
 *
 * The registry keeps the definition it was given, so this is a plain read of
 * the registered config — no host internals beyond the public registry.
 */
async function baseRowsOf(ctx, presetId) {
  try {
    const record = ctx.agentPresets.definitions?.get(presetId);
    const rows = record?.config?.plugins;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * Packages the HARNESS provides, so they are not in the profile's
 * dependencies and must not be treated as missing.
 */
const HOST_PROVIDED = new Set([
  '@deepseek-ai/dsh-mcp-client',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-agent-preset',
  '@deepseek-ai/dsh-client-runtime',
]);

/** Is this row's package provided by the harness rather than the profile? */
function isHostProvided(name) {
  return HOST_PROVIDED.has(name);
}

/**
 * The packages a profile actually has installed.
 *
 * A preset may only reference a package that is installed in the profile
 * that mounts it. The `cad` profile has no `dsh-ffmpeg`, so a preset that
 * named it would mount BROKEN ("never started") and show up broken in the
 * GUI picker. Reading the profile's package.json is the honest source: the
 * loader resolves packages from there.
 */
function installedPackages(ctx) {
  const dir = ctx.get?.('profileContext')?.dir ?? ctx.profileContext?.dir;
  if (!dir) return null;
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return new Set(Object.keys(manifest.dependencies ?? {}));
  } catch {
    return null;
  }
}

/**
 * The MCP row ids that other presets already own.
 *
 * **This is the rule that makes the categorizer safe.** An MCP server is
 * materialised as a PROCESS when its preset mounts — and every preset's rows
 * mount at profile boot, not per session. So an MCP row id that appears in
 * two presets starts that server TWICE. Measured 2026-10-22: with
 * `cat-creative` inheriting the built-in `creative`, drawio, blender and
 * figcraft each ran twice, and genoffice and playwright did too — 8 MCP
 * processes instead of 4, and the 4-server budget blown.
 *
 * The built-in presets use DISJOINT MCP row ids, which is why they do not
 * collide with each other. The categorizer must respect the same rule: it may
 * add a preset that carries a capability, but it may not carry an MCP server
 * that another preset already carries.
 *
 * @param ctx - the host context
 * @returns a Set of MCP row ids owned by other presets
 */
async function mcpRowsOwnedElsewhere(ctx) {
  const owned = new Set();
  const definitions = ctx.agentPresets?.definitions;
  if (!definitions || typeof definitions.entries !== 'function') return owned;
  for (const [id, record] of definitions) {
    if (typeof id === 'string' && id.startsWith(OWNED_PREFIX)) continue; // our own
    for (const row of record?.config?.plugins ?? []) {
      if (typeof row?.id === 'string' && row.id.startsWith('mcp-')) owned.add(row.id);
    }
  }
  return owned;
}

/**
 * Register one preset per category.
 *
 * A category that would produce an empty preset is skipped: a preset with
 * no rows is just noise in the picker.
 *
 * A row naming a package the profile does not have is DROPPED, and the
 * category is only registered if something is left. A preset that references
 * a missing package mounts broken and shows up broken in the picker.
 *
 * The skill roots are tracked across the whole run, because a skill provider
 * row can only be mounted once — two categories claiming the same root
 * would produce two providers with the same content.
 */
async function registerCategoryPresets(ctx, categories, report) {
  let registered = 0;
  let skipped = 0;
  const usedSkillRoots = new Set();
  const installed = installedPackages(ctx);
  // MCP rows another preset already owns. Carrying one again would start that
  // server a second time (see mcpRowsOwnedElsewhere).
  const ownedMcpRows = await mcpRowsOwnedElsewhere(ctx);
  for (const category of categories) {
    const presetId = category.preset.id;
    if (!presetId.startsWith(OWNED_PREFIX)) {
      report.notes.push(`skipped "${category.id}": preset id must start with "${OWNED_PREFIX}"`);
      skipped += 1;
      continue;
    }
    // Never fight an existing preset, ours or the host's.
    if (ctx.agentPresets.definitions?.has(presetId)) {
      report.notes.push(`skipped "${presetId}": a preset with that id already exists`);
      skipped += 1;
      continue;
    }
    const baseRows = category.preset.base
      ? await baseRowsOf(ctx, category.preset.base)
      : [];
    const { definition, notes } = buildPresetDefinition(category, baseRows, usedSkillRoots);
    for (const note of notes) report.notes.push(`${presetId}: ${note}`);

    // Drop rows naming a package this profile does not have. A preset that
    // references a missing package mounts broken and shows up broken in the
    // GUI picker, which is worse than not offering the preset at all.
    let rows = definition.plugins;
    if (installed) {
      const missing = rows.filter((row) => !isHostProvided(row.name) && !installed.has(row.name));
      if (missing.length > 0) {
        for (const row of missing) {
          report.notes.push(`${presetId}: dropped "${row.id}" — ${row.name} is not installed in this profile`);
        }
        rows = rows.filter((row) => !missing.includes(row));
      }
    }

    // Drop MCP rows another preset already carries. The server would start a
    // second time — 8 MCP processes instead of 4, measured 2026-10-22.
    const duplicateMcp = rows.filter((row) => row.id.startsWith('mcp-') && ownedMcpRows.has(row.id));
    if (duplicateMcp.length > 0) {
      for (const row of duplicateMcp) {
        report.notes.push(
          `${presetId}: dropped "${row.id}" — another preset already carries that MCP server, ` +
          'and an MCP row in two presets starts the server twice',
        );
      }
      rows = rows.filter((row) => !duplicateMcp.includes(row));
    }

    if (rows.length === 0) {
      report.notes.push(`skipped "${presetId}": no loader rows`);
      skipped += 1;
      continue;
    }
    try {
      await ctx.agentPresets.register({ ...definition, plugins: rows });
      report.presets.push({
        id: presetId,
        name: definition.name,
        rows: rows.length,
        rowIds: rows.map((r) => r.id),
        members: (report.assigned[category.id] ?? []).map((c) => c.id),
      });
      registered += 1;
    } catch (error) {
      report.notes.push(`failed "${presetId}": ${error.message}`);
      skipped += 1;
    }
  }
  return { registered, skipped };
}

/**
 * The plugin entry point.
 *
 * The host calls this with its context. It is deliberately a plain function
 * (not a Service class) because that is the shape the cordis loader expects
 * for a bundle plugin, and because the plugin does one job: read the
 * composition, categorize it, register the resulting presets.
 *
 * @param ctx - the host context
 * @param config - plugin config (currently unused; kept for future options)
 */
export function apply(ctx, config = {}) {
  const categories = config.categories ?? DEFAULT_CATEGORIES;

  // 1. Discover everything: plugins, MCP servers and skills.
  const { plugins, mcps } = discoverLoaderEntries(ctx);
  const skills = discoverSkills();
  const capabilities = [...plugins, ...mcps, ...skills];

  // 2. Assign each capability to at most one category.
  const { assigned, unassigned } = assignCapabilities(capabilities, categories);

  // 3. Turn each category into a real agent preset.
  //
  // The report is written to disk, so it carries only what a reader needs:
  // names and counts. Capability records carry a `source` path for skills,
  // and those paths are not published.
  const report = {
    capabilities: capabilities.length,
    plugins: plugins.length,
    mcps: mcps.length,
    skills: skills.length,
    assigned: Object.fromEntries(
      [...assigned].map(([id, members]) => [
        id,
        members.map((c) => ({ kind: c.kind, id: c.id, package: c.package })),
      ]),
    ),
    unassigned: unassigned.map((c) => ({ kind: c.kind, id: c.id, package: c.package })),
    presets: [],
    notes: [],
  };

  // Registration is async but must not block the boot: a failure here is
  // contained, and the plugin still mounts cleanly.
  void registerCategoryPresets(ctx, categories, report)
    .then(async (outcome) => {
      report.registered = outcome.registered;
      report.skipped = outcome.skipped;
      ctx.logger.warn(
        `preset-categorizer: ${report.registered} preset(s) registered from ` +
        `${capabilities.length} capabilities (${report.plugins} plugins, ${report.mcps} MCPs, ` +
        `${report.skills} skills); ${report.unassigned.length} unassigned`,
      );
      for (const preset of report.presets) {
        ctx.logger.warn(
          `preset-categorizer: preset "${preset.id}" carries ${preset.rows} row(s) ` +
          `[${preset.rowIds.join(', ')}] for members: ${preset.members.join(', ') || '(none)'}`,
        );
      }
      for (const note of report.notes) ctx.logger.warn(`preset-categorizer: ${note}`);

      // Write the roster to a file so the outcome is verifiable without a
      // logger. This is the plugin's own state, not host state.
      try {
        const roster = await ctx.agentPresets.list();
        writeFileSync(
          join(homedir(), '.dsh', 'preset-categorizer-report.json'),
          JSON.stringify({ at: new Date().toISOString(), report, roster }, null, 2) + '\n',
        );
      } catch (e) {
        try {
          writeFileSync(
            join(homedir(), '.dsh', 'preset-categorizer-report.json'),
            JSON.stringify({ at: new Date().toISOString(), error: String((e && e.message) || e) }, null, 2) + '\n',
          );
        } catch {}
      }

    })
    .catch((error) => {
      ctx.logger.warn(`preset-categorizer: registration failed: ${String(error)}`);
    });

  // The report is carried in the log lines above. It is not published on the
  // context: a bundle plugin is not a Cordis provider, so `ctx.set` and plain
  // property assignment are both rejected by the proxy.
}

export default apply;

