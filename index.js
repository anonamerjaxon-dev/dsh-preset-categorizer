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
  capabilityFingerprint,
  coveringPreset,
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
  '@deepseek-ai/dsh-persona',
  '@deepseek-ai/dsh-agent-instructions',
  '@deepseek-ai/dsh-time-context',
  '@deepseek-ai/dsh-tool-bash',
  '@deepseek-ai/dsh-tool-pwsh',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-tool-jobs',
  '@deepseek-ai/dsh-tool-schedule',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-command-goal',
  '@deepseek-ai/dsh-tool-goal',
  '@deepseek-ai/dsh-tool-ask-user',
  '@deepseek-ai/dsh-tool-todo',
  '@deepseek-ai/dsh-tool-web',
  '@deepseek-ai/dsh-tool-present',
  '@deepseek-ai/dsh-tool-presentation',
  '@deepseek-ai/dsh-tool-workflow',
  '@deepseek-ai/dsh-workflow-ptc',
  '@deepseek-ai/dsh-tool-subagent',
  '@deepseek-ai/dsh-tool-subagent-fork',
  '@deepseek-ai/dsh-tool-subagent-control',
  '@deepseek-ai/dsh-tool-subagent-list-agents',
  '@deepseek-ai/dsh-tool-result-pruner',
  '@deepseek-ai/dsh-compaction',
  '@deepseek-ai/dsh-tool-plugin-manager',
  '@deepseek-ai/dsh-tool-plugin-market',
  '@deepseek-ai/dsh-tool-ralph',
  '@deepseek-ai/dsh-tool-subagent-claude-code',
  'cordis:group',
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
  // Bundle-level rows: the loader sees them live, whatever the preset
  // registration order is.
  try {
    for (const entry of ctx.loader?.entries?.() ?? []) {
      const id = typeof entry?.id === 'string' ? entry.id : '';
      if (id.startsWith('mcp-')) owned.add(id);
    }
  } catch { /* the loader is not readable in every scope */ }
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
 * The plugin row ids that other presets already own.
 *
 * A plugin that registers a web route (dsh-image-gen registers
 * /plugins/dsh-image-gen/subscription-login) cannot be mounted in two
 * presets: the second mount fails with "duplicate exact route" and the
 * preset shows BROKEN in the picker.
 *
 * @param ctx - the host context
 * @returns a Set of plugin row ids owned by other presets
 */
function pluginRowsOwnedElsewhere(ctx) {
  const owned = new Set();
  // Bundle-level entries come first: they are live no matter how the presets
  // are ordered. Without this, a preset that mounts a plugin already in
  // `bundles` (dsh-image-gen, after the GUI re-added it) would register it a
  // second time and both mounts would fail with "duplicate exact route".
  try {
    for (const entry of ctx.loader?.entries?.() ?? []) {
      const id = typeof entry?.id === 'string' ? entry.id : '';
      if (!id) continue;
      if (id.startsWith('mcp-')) continue;
      if (id.startsWith('tool-')) continue;
      if (id.startsWith('command-')) continue;
      if (id.startsWith('skill-filesystem')) continue;
      owned.add(id);
    }
  } catch { /* the loader is not readable in every scope */ }
  const definitions = ctx.agentPresets?.definitions;
  if (!definitions || typeof definitions.entries !== 'function') return owned;
  for (const [id, record] of definitions) {
    if (typeof id === 'string' && id.startsWith(OWNED_PREFIX)) continue; // our own
    for (const row of record?.config?.plugins ?? []) {
      if (typeof row?.id !== 'string') continue;
      if (row.id.startsWith('mcp-')) continue;      // handled separately
      if (row.id.startsWith('tool-')) continue;      // a schema, safe to repeat
      if (row.id.startsWith('command-')) continue;   // a schema, safe to repeat
      if (row.id.startsWith('skill-filesystem')) continue;
      owned.add(row.id);
    }
  }
  return owned;
}

/**
 * The capability fingerprints of the presets that already exist.
 *
 * @param ctx - the host context
 * @returns a Map<fingerprint, presetId>
 */
function fingerprintsOfExisting(ctx) {
  const map = new Map();
  const definitions = ctx.agentPresets?.definitions;
  if (!definitions || typeof definitions.entries !== 'function') return map;
  for (const [id, record] of definitions) {
    if (typeof id === 'string' && id.startsWith(OWNED_PREFIX)) continue; // our own
    const fingerprint = capabilityFingerprint(record?.config?.plugins ?? []);
    if (fingerprint && !map.has(fingerprint)) map.set(fingerprint, id);
  }
  return map;
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
  // Plugin rows another preset already carries. A plugin that registers a web
  // route cannot be mounted twice.
  const ownedPluginRows = pluginRowsOwnedElsewhere(ctx);
  // The capabilities existing presets already offer. A category that offers
  // exactly the same thing is the same entry twice in the picker.
  const existingFingerprints = fingerprintsOfExisting(ctx);
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

    // If what this preset WOULD offer is exactly what an existing preset
    // already offers, do not register a second copy. Two entries offering the
    // same capabilities are indistinguishable in the picker, and the user
    // cannot tell which is the real one. Measured 2026-10-22: the picker
    // showed "Creative (CAD / 3D / diagrams)" and "Creative (3D / diagrams)"
    // side by side.
    //
    // The fingerprint is taken BEFORE the rows are filtered below: it must
    // describe what the category is FOR, not what survived the filter.
    const fingerprint = capabilityFingerprint(rows);
    const cover = coveringPreset(fingerprint, existingFingerprints);
    if (cover) {
      report.notes.push(
        `skipped "${presetId}": the existing "${cover}" preset already covers its capabilities — ` +
        'registering it would show the same entry twice in the picker',
      );
      skipped += 1;
      continue;
    }

    // Drop rows that must not be mounted twice.
    //
    //  - an MCP row: the server would start a second time (8 MCP processes
    //    instead of 4, measured 2026-10-22);
    //  - a plugin row that another preset already carries AND that registers
    //    a web route: mounting it twice makes the second mount fail with
    //    "duplicate exact route" and the preset shows BROKEN in the picker
    //    (dsh-image-gen did exactly this on 2026-10-22).
    //
    // A tool row may repeat — each preset is its own mount scope, and a tool
    // is a schema, not a process.
    const duplicateRows = rows.filter((row) => {
      if (row.id.startsWith('mcp-')) return ownedMcpRows.has(row.id);
      if (row.id.startsWith('tool-') || row.id.startsWith('command-')) return false;
      if (row.id.startsWith('skill-filesystem')) return false;
      return ownedPluginRows.has(row.id);
    });
    if (duplicateRows.length > 0) {
      for (const row of duplicateRows) {
        report.notes.push(
          `${presetId}: dropped "${row.id}" — another preset already carries it, and mounting ` +
          'the same plugin in two presets registers its web route twice',
        );
      }
      rows = rows.filter((row) => !duplicateRows.includes(row));
    }

    // A preset that carries no DISTINCTIVE capability is noise in the picker.
    // "Distinctive" means a capability of its own — an MCP server, a skill
    // provider, or a plugin. The harness scaffolding every preset shares
    // (persona, tool-bash, compaction) does not make a preset worth offering.
    // Measured 2026-10-22: the document-skills category would have been
    // registered as an empty entry, because those skills live in the
    // always-on root every preset already carries.
    if (!fingerprint) {
      report.notes.push(
        `skipped "${presetId}": it carries no capability of its own — the skills it names are ` +
        'already supplied to every preset',
      );
      skipped += 1;
      continue;
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
/**
 * Write the categorisation report.
 *
 * This is the plugin's own state, not host state: it records what was
 * categorised, what each category would carry, and the host's preset roster
 * when it could be read. It is written whether or not presets are registered,
 * so the report always says what WOULD have been created.
 *
 * @param ctx - the host context (for the logger)
 * @param report - the categorisation report
 * @param roster - the host's preset roster, or null
 */
function writeReport(ctx, report, roster) {
  const target = join(homedir(), '.dsh', 'preset-categorizer-report.json');
  try {
    writeFileSync(
      target,
      JSON.stringify({ at: new Date().toISOString(), registered: false, report, roster }, null, 2) + '\n',
    );
  } catch (e) {
    try {
      ctx.logger.warn(`preset-categorizer: could not write ${target}: ${String(e && e.message || e)}`);
    } catch { /* nothing else to do */ }
  }
}

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

  // Registering presets at runtime is OPT-IN, and off by default.
  //
  // It was on by default once, and it broke the host twice in one day:
  //   - a copied preset lost its `isolate` fields, so `compaction` failed
  //     with "Preset services require isolate realms";
  //   - a preset mounting a plugin that `bundles` already mounts started the
  //     plugin twice, so its web route collided ("duplicate exact route") and
  //     BOTH the built-in preset and the new one showed BROKEN in the picker.
  //
  // A preset's plugin list is registered while its own preset is still being
  // mounted, so a categorizer that runs inside a preset cannot reliably see
  // the full preset set either — the duplicate check races the registration.
  //
  // So the safe default is: CATEGORISE and REPORT. Creating a preset is a
  // deliberate act, enabled with `registerPresets: true` in the plugin
  // config, and it should be applied to cordis.patch.yml rather than at
  // runtime. The report always says what would have been created.
  if (config.registerPresets !== true) {
    report.notes.push(
      'preset registration is disabled (registerPresets is not true) — ' +
      'the categories are reported, not registered. See TOOL-COHESION §2.17.',
    );
    // Still record the host's roster, so the report proves the picker is clean.
    void (async () => {
      let roster = null;
      try { roster = await ctx.agentPresets.list(); } catch { /* optional */ }
      writeReport(ctx, report, roster);
      ctx.logger.info(
        `preset-categorizer: categorised ${report.capabilities} capabilities ` +
        `(${report.plugins} plugins, ${report.mcps} MCPs, ${report.skills} skills) ` +
        `${report.unassigned.length} unassigned; registration disabled`,
      );
    })();
    return;
  }

  // Wait for the loader to settle FIRST, so the ownership checks see every
  // preset and every bundle-level entry.
  void (async () => {
    try {
      await ctx.loader?.await?.();
    } catch { /* the loader may already be settled */ }
    return registerCategoryPresets(ctx, categories, report);
  })()
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

      let roster = null;
      try {
        roster = await ctx.agentPresets.list();
      } catch { /* the roster is a nicety, not the report */ }
      writeReport(ctx, report, roster);

    })
    .catch((error) => {
      ctx.logger.warn(`preset-categorizer: registration failed: ${String(error)}`);
    });

  // The report is carried in the log lines above. It is not published on the
  // context: a bundle plugin is not a Cordis provider, so `ctx.set` and plain
  // property assignment are both rejected by the proxy.
}

export default apply;

