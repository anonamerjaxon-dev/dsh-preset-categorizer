/**
 * Unit tests for the pure category model. Run with: node test.mjs
 *
 * These cover the rules that decide what lands in which preset, because a
 * mistake here silently puts a capability in the wrong bucket.
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_CATEGORIES,
  assignCapabilities,
  buildPresetDefinition,
  buildPresetRows,
  matchesCategory,
  patternToRegExp,
} from './lib/categories.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${error.message}`);
  }
}

console.log('dsh-preset-categorizer — category model');

// --- pattern matching -------------------------------------------------------

test('wildcard patterns match the whole string', () => {
  assert.equal(patternToRegExp('mcp-*').test('mcp-playwright'), true);
  assert.equal(patternToRegExp('mcp-*').test('mcp-playwright-extra'), true);
  assert.equal(patternToRegExp('mcp-*').test('xmcp-playwright'), false);
  assert.equal(patternToRegExp('mcp-*').test('mcp-'), true);
});

test('patterns are case-insensitive', () => {
  assert.equal(patternToRegExp('dsh-ffmpeg').test('DSH-FFmpeg'), true);
});

test('regex metacharacters in a pattern are literal', () => {
  // A package name with a dot must not match any character.
  assert.equal(patternToRegExp('a.b').test('axb'), false);
  assert.equal(patternToRegExp('a.b').test('a.b'), true);
});

test('? matches exactly one character', () => {
  assert.equal(patternToRegExp('dsh-?fmpeg').test('dsh-ffmpeg'), true);
  assert.equal(patternToRegExp('dsh-?fmpeg').test('dsh-ffmpegg'), false);
});

// --- kind matching ----------------------------------------------------------

test('a category only claims capabilities of its own kind', () => {
  const category = DEFAULT_CATEGORIES.find((c) => c.id === 'cat-web');
  const skill = { kind: 'skill', id: 'playwright', name: 'playwright' };
  const mcp = { kind: 'mcp', id: 'mcp-playwright', name: '@playwright/mcp' };
  assert.equal(matchesCategory(skill, category), false);
  assert.equal(matchesCategory(mcp, category), true);
});

test('a capability matches on any of its identifiers', () => {
  const category = DEFAULT_CATEGORIES.find((c) => c.id === 'cat-media');
  assert.equal(
    matchesCategory({ kind: 'plugin', id: 'x', name: 'dsh-ffmpeg' }, category),
    true,
  );
  assert.equal(
    matchesCategory({ kind: 'plugin', id: 'dsh-ffmpeg', name: 'x' }, category),
    true,
  );
});

// --- assignment -------------------------------------------------------------

test('each capability lands in exactly one category', () => {
  const capabilities = [
    { kind: 'mcp', id: 'mcp-playwright', name: '@playwright/mcp' },
    { kind: 'mcp', id: 'mcp-drawio', name: '@deepseek-ai/dsh-mcp-client' },
    { kind: 'plugin', id: 'dsh-ffmpeg', name: 'dsh-ffmpeg' },
    { kind: 'skill', id: 'genoffice', name: 'genoffice' },
    { kind: 'skill', id: 'totally-unknown', name: 'totally-unknown' },
  ];
  const { assigned, unassigned } = assignCapabilities(capabilities);
  const all = [...assigned.values()].flat();
  assert.equal(all.length, capabilities.length - unassigned.length);
  // No capability appears twice.
  const ids = all.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  // The unknown one is unassigned.
  assert.equal(unassigned.length, 1);
  assert.equal(unassigned[0].id, 'totally-unknown');
});

test('the first matching category wins, in list order', () => {
  const categories = [
    { id: 'first', kind: 'plugin', include: ['dsh-*'], exclude: [], preset: { id: 'cat-first', extras: [] } },
    { id: 'second', kind: 'plugin', include: ['dsh-ffmpeg'], exclude: [], preset: { id: 'cat-second', extras: [] } },
  ];
  const { assigned } = assignCapabilities(
    [{ kind: 'plugin', id: 'dsh-ffmpeg', name: 'dsh-ffmpeg' }],
    categories,
  );
  assert.equal(assigned.get('first').length, 1);
  assert.equal(assigned.get('second').length, 0);
});

test('an exclude vetoes the category that would have claimed it', () => {
  const categories = [
    { id: 'vetoed', kind: 'plugin', include: ['dsh-*'], exclude: ['dsh-secret'], preset: { id: 'cat-vetoed', extras: [] } },
  ];
  const { assigned, unassigned } = assignCapabilities(
    [{ kind: 'plugin', id: 'dsh-secret', name: 'dsh-secret' }],
    categories,
  );
  assert.equal(assigned.get('vetoed').length, 0);
  assert.equal(unassigned.length, 1);
});

// --- preset construction ----------------------------------------------------

test('preset rows come from extras and never duplicate an id', () => {
  const category = {
    id: 'c',
    preset: {
      id: 'cat-c',
      pluginRows: [
        { id: 'a', name: 'pkg-a' },
        { id: 'b', name: 'pkg-b' },
        { id: 'a', name: 'pkg-a-again' },
      ],
    },
  };
  const { rows } = buildPresetRows(category, []);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b']);
});

test('base rows are inherited and extras are appended', () => {
  const category = { id: 'c', preset: { id: 'cat-c', pluginRows: [{ id: 'b', name: 'pkg-b' }] } };
  const { rows } = buildPresetRows(category, [{ id: 'a', name: 'pkg-a', config: { x: 1 } }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'a');
  assert.deepEqual(rows[0].config, { x: 1 });
  assert.equal(rows[1].id, 'b');
});

test('an MCP row keeps its full config', () => {
  const category = {
    id: 'c',
    preset: {
      id: 'cat-c',
      mcpRows: [
        {
          id: 'mcp-x',
          name: '@deepseek-ai/dsh-mcp-client',
          config: { serverName: 'x', transport: 'stdio', command: '/bin/x' },
        },
      ],
    },
  };
  const { rows } = buildPresetRows(category, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '@deepseek-ai/dsh-mcp-client');
  assert.equal(rows[0].config.serverName, 'x');
  assert.equal(rows[0].config.transport, 'stdio');
});

test('a skill root becomes one skill-provider row', () => {
  const category = { id: 'c', preset: { id: 'cat-c', skillRoot: '/tmp/skills-x' } };
  const { rows } = buildPresetRows(category, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '@deepseek-ai/dsh-skill-filesystem');
  assert.deepEqual(rows[0].config.customSkillDirs, ['/tmp/skills-x']);
  assert.equal(rows[0].config.includeDefaultRoots, false);
  assert.ok(rows[0].config.providerName, 'the provider needs a unique name');
});

test('a skill root already claimed is reported, not mounted twice', () => {
  const used = new Set(['/tmp/skills-shared']);
  const category = { id: 'c', preset: { id: 'cat-c', skillRoot: '/tmp/skills-shared' } };
  const { rows, notes } = buildPresetRows(category, [], used);
  assert.equal(rows.length, 0, 'no second provider for the same root');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /already mounted/);
});

test('a preset definition carries id, name, description and order', () => {
  const category = {
    id: 'c',
    preset: {
      id: 'cat-c',
      name: 'C',
      description: 'the c preset',
      order: 7,
      pluginRows: [{ id: 'a', name: 'pkg-a' }],
    },
  };
  const { definition } = buildPresetDefinition(category, []);
  assert.equal(definition.id, 'cat-c');
  assert.equal(definition.name, 'C');
  assert.equal(definition.description, 'the c preset');
  assert.equal(definition.order, 7);
  assert.equal(definition.plugins.length, 1);
});

test('every built-in category uses the owned id prefix', () => {
  for (const category of DEFAULT_CATEGORIES) {
    assert.ok(
      category.preset.id.startsWith('cat-'),
      `${category.id} has preset id "${category.preset.id}" without the cat- prefix`,
    );
  }
});

test('no two built-in categories claim the same preset id', () => {
  const ids = DEFAULT_CATEGORIES.map((c) => c.preset.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('no two built-in categories mount the same skill root', () => {
  const roots = DEFAULT_CATEGORIES.map((c) => c.preset.skillRoot).filter(Boolean);
  assert.equal(new Set(roots).size, roots.length);
});

test('no two built-in categories produce the same loader row id', () => {
  const ids = [];
  for (const category of DEFAULT_CATEGORIES) {
    for (const row of category.preset.pluginRows ?? []) ids.push(row.id);
    for (const row of category.preset.mcpRows ?? []) ids.push(row.id);
  }
  assert.equal(new Set(ids).size, ids.length, `duplicate row ids: ${ids.join(', ')}`);
});

test('no two built-in categories match the same capability', () => {
  const capabilities = [
    { kind: 'mcp', id: 'mcp-playwright', name: '@playwright/mcp' },
    { kind: 'mcp', id: 'mcp-drawio', name: 'mcp' },
    { kind: 'mcp', id: 'mcp-blender', name: 'mcp' },
    { kind: 'mcp', id: 'mcp-figcraft', name: 'mcp' },
    { kind: 'mcp', id: 'mcp-genoffice', name: 'mcp' },
    { kind: 'plugin', id: 'dsh-ffmpeg', name: 'dsh-ffmpeg' },
    { kind: 'plugin', id: 'dsh-remotion', name: 'dsh-remotion' },
    { kind: 'plugin', id: 'dsh-image-gen', name: 'dsh-image-gen' },
    { kind: 'skill', id: 'genoffice', name: 'genoffice' },
    { kind: 'skill', id: 'mineru', name: 'mineru' },
    { kind: 'skill', id: 'typst', name: 'typst' },
    { kind: 'skill', id: 'codebase-memory', name: 'codebase-memory' },
    { kind: 'skill', id: 'audio-edit', name: 'audio-edit' },
  ];
  for (const capability of capabilities) {
    const owners = DEFAULT_CATEGORIES.filter((c) => matchesCategory(capability, c));
    assert.equal(
      owners.length,
      1,
      `${capability.id} is claimed by ${owners.length} categories (${owners.map((o) => o.id).join(', ')})`,
    );
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
