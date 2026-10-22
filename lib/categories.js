/**
 * dsh-preset-categorizer — the category model.
 *
 * A "category" is a named bucket of capabilities. The categorizer turns each
 * category into a DSH **agent preset** — a first-class entry in the GUI's
 * preset picker, exactly like the built-in Creative / Office / Web presets.
 *
 * Three kinds of capability are recognised, because all three can be scoped:
 *
 *   PLUGIN — a loader entry backed by a package (dsh-ffmpeg, dsh-image-gen).
 *   MCP    — a loader entry backed by the MCP client (mcp-playwright, ...).
 *   SKILL  — a filesystem skill (genoffice, mineru, typst, ...).
 *
 * ## How a category becomes a preset
 *
 * A preset is a list of LOADER ROWS. Three kinds of row exist, and a
 * category may use any of them:
 *
 *   1. A plugin row    — { id, name, config? } mounting a package.
 *   2. An MCP row      — { id, name: '@deepseek-ai/dsh-mcp-client', config }
 *                        mounting an MCP server inside the preset.
 *   3. A skill row     — { id, name: '@deepseek-ai/dsh-skill-filesystem',
 *                        config } mounting a skill provider scoped to the
 *                        preset's own directories.
 *
 * The important consequence: **skills cannot be picked one by one.** A skill
 * provider mounts a DIRECTORY, and the skills on this machine live in shared
 * root folders (~/.agents/skills, ~/.agents/skills-creative, ...). So a
 * skill category can only be expressed as "mount this root", not "mount
 * genoffice but not mineru".
 *
 * A skill category therefore declares a skill ROOT, and the preset mounts
 * that root. When several skill categories want the same root, the first
 * one wins and the others are reported — rather than silently mounting the
 * same provider twice, which the loader would reject as a duplicate.
 *
 * This module is deliberately pure: no Cordis/DSH dependency, so the rules
 * can be unit-tested with plain node and cannot drift from the host.
 */

/** Capability kinds a category can hold. */
export const KINDS = ['plugin', 'mcp', 'skill'];

/** The loader row name that mounts an MCP server. */
export const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client';

/** The loader row name that mounts a skill provider. */
export const SKILL_PROVIDER = '@deepseek-ai/dsh-skill-filesystem';

/**
 * The built-in categories.
 *
 * `include` patterns are matched against a capability's id, name and package,
 * with `*` as a wildcard. A capability joins a category when it matches any
 * pattern of the SAME kind. `exclude` wins over `include`.
 *
 * `preset.mcpRows` are literal loader rows for MCP servers. They are needed
 * because an MCP server is mounted by CONFIG (serverName, transport,
 * command/url), which cannot be derived from a package name.
 *
 * `preset.skillRoot` is an absolute path to a skill directory to mount.
 */
export const DEFAULT_CATEGORIES = [
  {
    id: 'cat-media',
    kind: 'plugin',
    label: 'Media',
    description: 'ffmpeg and Remotion: video encode, cut, generated video.',
    preset: {
      id: 'cat-media',
      name: 'Media (video / audio)',
      description: 'dsh-ffmpeg and dsh-remotion, plus the media skills.',
      order: 45,
      // Inherit the built-in media preset's rows rather than repeating them:
      // the same row id in two presets starts that plugin twice.
      base: 'media',
      pluginRows: [],
      mcpRows: [],
      skillRoot: null,
    },
    include: ['dsh-ffmpeg', 'dsh-remotion', 'ffmpeg', 'remotion-skills'],
    exclude: [],
  },
  {
    id: 'cat-audio',
    kind: 'skill',
    label: 'Audio',
    description: 'Editable audio edits: cut, normalise, transcribe, stems.',
    preset: {
      id: 'cat-audio',
      name: 'Audio (editable edits)',
      description: 'audio-edit: an edit-list plus sox, whisper and demucs.',
      order: 47,
      // The Media preset already carries ~/.agents/skills-media (audio-edit)
      // through its own skill provider. Re-mounting that root here would
      // create a second provider for the same directory.
      base: 'media',
      pluginRows: [],
      mcpRows: [],
      skillRoot: null,
    },
    include: ['audio-edit'],
    exclude: [],
  },
  {
    id: 'cat-docs',
    kind: 'skill',
    label: 'Documents',
    description: 'Office documents, PDF reading, typesetting.',
    preset: {
      id: 'cat-docs',
      name: 'Documents (office / pdf)',
      description: 'The document skills: genoffice, mineru and typst.',
      order: 40,
      base: null,
      pluginRows: [],
      mcpRows: [],
      // The document skills live in ~/.agents/skills, which the BASE skill
      // provider already supplies to every preset. Mounting it again would
      // add nothing, so this category carries no skill root of its own.
      skillRoot: null,
    },
    include: ['genoffice', 'mineru', 'typst', 'browser-cdp', 'codebase-memory'],
    exclude: [],
  },
  {
    id: 'cat-image',
    kind: 'plugin',
    label: 'Image generation',
    description: 'Text-to-image, image editing, and the image workbench canvas.',
    preset: {
      id: 'cat-image',
      name: 'Image generation',
      description: 'dsh-image-gen: generate_image, edit_image and the canvas.',
      order: 46,
      base: null,
      pluginRows: [{ id: 'image-gen', name: 'dsh-image-gen', config: { provider: 'google' } }],
      mcpRows: [],
      skillRoot: null,
    },
    include: ['dsh-image-gen', 'image-gen'],
    exclude: [],
  },
];

/**
 * Turn a glob-ish pattern into a regular expression.
 * `*` matches any run of characters, `?` one character. Everything else is
 * literal. The match is case-insensitive and anchored on the whole string.
 */
export function patternToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`, 'i');
}

/** The strings a pattern is tested against. */
function identifiersOf(capability) {
  return [capability.id, capability.name, capability.package]
    .filter((v) => typeof v === 'string' && v.length > 0);
}

/** Does a capability match a category's include list? */
export function matchesCategory(capability, category) {
  if (capability.kind !== category.kind) return false;
  const haystacks = identifiersOf(capability);
  for (const pattern of category.include ?? []) {
    const re = patternToRegExp(pattern);
    if (haystacks.some((h) => re.test(h))) return true;
  }
  return false;
}

/** Does a category's exclude list claim this capability? */
export function excludedBy(capability, category) {
  const haystacks = identifiersOf(capability);
  for (const pattern of category.exclude ?? []) {
    const re = patternToRegExp(pattern);
    if (haystacks.some((h) => re.test(h))) return true;
  }
  return false;
}

/**
 * Assign every capability to at most one category.
 *
 * The FIRST matching category wins, which makes the order of the category
 * list meaningful and keeps the assignment deterministic. Excludes are
 * checked before includes, so a category can veto a capability another
 * category would otherwise claim.
 *
 * @param capabilities - the full capability list
 * @param categories  - category definitions (default: DEFAULT_CATEGORIES)
 * @returns Map<categoryId, capability[]> plus a list of unassigned ones.
 */
export function assignCapabilities(capabilities, categories = DEFAULT_CATEGORIES) {
  const assigned = new Map();
  for (const category of categories) assigned.set(category.id, []);
  const unassigned = [];
  for (const capability of capabilities) {
    let placed = false;
    for (const category of categories) {
      if (!matchesCategory(capability, category)) continue;
      if (excludedBy(capability, category)) continue;
      assigned.get(category.id).push(capability);
      placed = true;
      break; // first match wins
    }
    if (!placed) unassigned.push(capability);
  }
  return { assigned, unassigned };
}

/**
 * Build the loader rows for a category's preset.
 *
 * Rows come from four sources, in order:
 *   1. the base preset's rows (when `preset.base` is set),
 *   2. `preset.pluginRows`  — packages,
 *   3. `preset.mcpRows`     — MCP servers,
 *   4. `preset.skillRoot`   — a skill provider for one skill directory.
 *
 * A row id is used once: a duplicate id would make the loader reject the
 * whole preset, so the later source is skipped and reported.
 *
 * @param category - the category definition
 * @param baseRows - plugin rows of the base preset, when `base` is set
 * @param usedSkillRoots - skill roots already claimed by an earlier preset
 * @returns { rows, notes }
 */
export function buildPresetRows(category, baseRows = [], usedSkillRoots = new Set()) {
  const rows = [];
  const seen = new Set();
  const notes = [];

  // A skill root already present in the inherited rows must not be mounted a
  // second time: the ids would differ (the base uses
  // "skill-filesystem-optional", a category uses "skill-filesystem-<name>"),
  // so an id-only check would not catch it, and two providers over one
  // directory is a duplicate mount.
  const baseSkillRoots = new Set();
  for (const row of baseRows) {
    const dirs = row?.config?.customSkillDirs;
    if (Array.isArray(dirs)) for (const d of dirs) baseSkillRoots.add(d);
  }

  const push = (row) => {
    if (!row || typeof row.id !== 'string' || row.id.length === 0) return;
    if (seen.has(row.id)) {
      notes.push(`row "${row.id}" already present; skipped the duplicate`);
      return;
    }
    seen.add(row.id);
    // Copy the row WHOLE. Copying only id/name/config loses `isolate` (which
    // compaction and planMode require: "Preset services require isolate
    // realms"), `group`, and any nested config children. That is not a
    // cosmetic loss — it makes the copied preset fail to mount, which is
    // exactly how cat-audio came to be BROKEN on 2026-10-22.
    rows.push(structuredClone(row));
  };

  for (const row of baseRows) push(row);
  for (const row of category.preset.pluginRows ?? []) push(row);
  for (const row of category.preset.mcpRows ?? []) push(row);

  const root = category.preset.skillRoot;
  if (root) {
    if (usedSkillRoots.has(root) || baseSkillRoots.has(root)) {
      notes.push(
        `skill root ${root} is already mounted by this preset or another category; ` +
        'a skill provider can only be mounted once per preset set',
      );
    } else {
      usedSkillRoots.add(root);
      push({
        id: `skill-filesystem-${category.id.replace(/^cat-/, '')}`,
        name: SKILL_PROVIDER,
        config: {
          providerName: `filesystem-${category.id.replace(/^cat-/, '')}`,
          includeDefaultRoots: false,
          customSkillDirs: [root],
        },
      });
    }
  }

  return { rows, notes };
}

/**
 * Turn a category into a DSH agent-preset definition.
 *
 * @param category - the category definition
 * @param baseRows - plugin rows inherited from the base preset
 * @param usedSkillRoots - skill roots already claimed by an earlier preset
 */
export function buildPresetDefinition(category, baseRows = [], usedSkillRoots = new Set()) {
  const { rows, notes } = buildPresetRows(category, baseRows, usedSkillRoots);
  return {
    definition: {
      id: category.preset.id,
      name: category.preset.name,
      description: category.preset.description,
      order: category.preset.order,
      plugins: rows,
    },
    notes,
  };
}

/**
 * A fingerprint of what a preset actually offers.
 *
 * Two presets that carry the SAME capabilities are the same thing twice in the
 * picker. Measured 2026-10-22: the categorizer's `cat-creative` listed
 * "drawio, blender and figcraft MCP servers, plus the creative skills" beside
 * the built-in `Creative (CAD / 3D / diagrams)`, which offers exactly the
 * same. The picker showed both, and a user could not tell which was the real
 * one.
 *
 * The fingerprint is the set of *capability-bearing* row ids: MCP servers,
 * skill providers and plugin rows — but NOT the harness's own scaffolding
 * (persona, tool-bash, compaction and friends), which every preset shares and
 * which therefore carries no information about what the preset is FOR.
 *
 * @param rows - a preset's loader rows
 * @returns a sorted string, or '' when the preset carries nothing distinctive
 */
export function capabilityFingerprint(rows) {
  const interesting = rows
    .map((row) => row?.id)
    .filter((id) => typeof id === 'string' && id.length > 0)
    .filter((id) => id.startsWith('mcp-') || id.startsWith('skill-filesystem') || id.startsWith('ffmpeg') || id.startsWith('remotion') || id.startsWith('image-gen'))
    .sort();
  return interesting.join('|');
}

/**
 * The capability ids a fingerprint names, as a set.
 *
 * @param fingerprint - a fingerprint string
 * @returns a Set of capability ids
 */
export function fingerprintIds(fingerprint) {
  return new Set(String(fingerprint).split('|').filter((id) => id.length > 0));
}

/**
 * Is this fingerprint a SUBSET of an existing preset's?
 *
 * An exact match is the obvious duplicate. A subset is just as much of a
 * problem: a category offering only "image-gen" is offering something the
 * Creative preset already carries, and registering it would show the same
 * capability twice in the picker.
 *
 * @param fingerprint - the candidate's fingerprint
 * @param existing - a Map of fingerprint -> preset id
 * @returns the id of the preset that already covers it, or undefined
 */
export function coveringPreset(fingerprint, existing) {
  if (!fingerprint) return undefined;
  const ids = fingerprintIds(fingerprint);
  if (ids.size === 0) return undefined;
  for (const [other, presetId] of existing) {
    const otherIds = fingerprintIds(other);
    if (otherIds.size === 0) continue;
    let covered = true;
    for (const id of ids) if (!otherIds.has(id)) { covered = false; break; }
    if (covered) return presetId;
  }
  return undefined;
}
