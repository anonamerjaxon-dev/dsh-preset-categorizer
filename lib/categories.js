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
    id: 'cat-creative',
    kind: 'mcp',
    label: 'Creative 3D and diagrams',
    description: 'draw.io, Blender and FigCraft MCP servers.',
    preset: {
      id: 'cat-creative',
      name: 'Creative (3D / diagrams)',
      description: 'drawio, blender and figcraft MCP servers, plus the creative skills.',
      order: 43,
      base: null,
      pluginRows: [],
      mcpRows: [
        {
          id: 'mcp-drawio',
          name: MCP_CLIENT,
          config: {
            serverName: 'drawio',
            transport: 'streamable-http',
            url: 'https://mcp.draw.io/mcp',
            toolCallTimeoutMs: 120000,
            maxInstructionBytes: 4096,
          },
        },
        {
          id: 'mcp-blender',
          name: MCP_CLIENT,
          config: {
            serverName: 'blender',
            transport: 'stdio',
            command: '/Users/jackson/.local/bin/blender-mcp',
            args: [],
            env: { BLENDER_HOST: '127.0.0.1', BLENDER_PORT: '9876' },
            toolCallTimeoutMs: 180000,
            failOnStartupError: false,
            maxInstructionBytes: 4096,
          },
        },
        {
          id: 'mcp-figcraft',
          name: MCP_CLIENT,
          config: {
            serverName: 'figcraft',
            transport: 'stdio',
            command: '/Users/jackson/.local/bin/figcraft-cli',
            args: ['mcp'],
            toolCallTimeoutMs: 180000,
            failOnStartupError: false,
            maxInstructionBytes: 4096,
          },
        },
      ],
      skillRoot: '/Users/jackson/.agents/skills-creative',
    },
    include: ['mcp-drawio', 'mcp-blender', 'mcp-figcraft'],
    exclude: [],
  },
  {
    id: 'cat-office',
    kind: 'mcp',
    label: 'Office',
    description: 'GenOffice MCP for docx/xlsx/pptx/pdf.',
    preset: {
      id: 'cat-office',
      name: 'Office (docx / xlsx / pptx)',
      description: 'The genoffice MCP server.',
      order: 44,
      base: null,
      pluginRows: [],
      mcpRows: [
        {
          id: 'mcp-genoffice',
          name: MCP_CLIENT,
          config: {
            serverName: 'genoffice',
            transport: 'stdio',
            command: '/Users/jackson/.local/bin/genoffice',
            args: ['mcp'],
            toolCallTimeoutMs: 180000,
            failOnStartupError: false,
            maxInstructionBytes: 4096,
          },
        },
      ],
      skillRoot: null,
    },
    include: ['mcp-genoffice'],
    exclude: [],
  },
  {
    id: 'cat-web',
    kind: 'mcp',
    label: 'Browser',
    description: 'Playwright browser automation.',
    preset: {
      id: 'cat-web',
      name: 'Browser (playwright)',
      description: 'The playwright MCP: navigate, click, fill, screenshot.',
      order: 42,
      base: null,
      pluginRows: [],
      mcpRows: [
        {
          id: 'mcp-playwright',
          name: MCP_CLIENT,
          config: {
            serverName: 'playwright',
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@playwright/mcp'],
            toolCallTimeoutMs: 180000,
            failOnStartupError: false,
            maxInstructionBytes: 4096,
          },
        },
      ],
      skillRoot: null,
    },
    include: ['mcp-playwright'],
    exclude: [],
  },
  {
    id: 'cat-media',
    kind: 'plugin',
    label: 'Media',
    description: 'ffmpeg and Remotion: video encode, cut, generated video.',
    preset: {
      id: 'cat-media',
      name: 'Media (video / audio)',
      description: 'dsh-ffmpeg and dsh-remotion, plus the remotion skills.',
      order: 45,
      base: null,
      pluginRows: [
        { id: 'ffmpeg', name: 'dsh-ffmpeg' },
        { id: 'remotion-skills', name: 'dsh-remotion' },
      ],
      mcpRows: [],
      skillRoot: '/Users/jackson/.agents/skills-media',
    },
    include: ['dsh-ffmpeg', 'dsh-remotion', 'ffmpeg', 'remotion-skills'],
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
      skillRoot: '/Users/jackson/.agents/skills',
    },
    include: ['genoffice', 'mineru', 'typst', 'browser-cdp', 'codebase-memory'],
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
      base: null,
      pluginRows: [],
      mcpRows: [],
      skillRoot: null,
    },
    include: ['audio-edit'],
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

  const push = (row) => {
    if (!row || typeof row.id !== 'string' || row.id.length === 0) return;
    if (seen.has(row.id)) {
      notes.push(`row "${row.id}" already present; skipped the duplicate`);
      return;
    }
    seen.add(row.id);
    rows.push({
      id: row.id,
      name: row.name,
      ...(row.config ? { config: row.config } : {}),
    });
  };

  for (const row of baseRows) push(row);
  for (const row of category.preset.pluginRows ?? []) push(row);
  for (const row of category.preset.mcpRows ?? []) push(row);

  const root = category.preset.skillRoot;
  if (root) {
    if (usedSkillRoots.has(root)) {
      notes.push(
        `skill root ${root} is already mounted by another category; ` +
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
