# dsh-preset-categorizer

**Categorize plugins, MCP servers and skills into DeepSeek Harness agent
presets.**

DSH ships a fixed set of hand-written agent presets. This plugin reads what is
actually installed, groups the capabilities into categories, and registers
**one preset per category** with the host's own preset registry — so a category
becomes a first-class entry in the GUI's preset picker.

It recognises **all three** kinds of capability, not just skills:

| Kind | What it sees | How it is scoped into a preset |
|---|---|---|
| **plugin** | loader entries backed by a package (`dsh-ffmpeg`, `dsh-image-gen`) | a plugin row |
| **MCP** | loader entries backed by `@deepseek-ai/dsh-mcp-client` | an MCP row, with the server's own config |
| **skill** | the skill directories under `~/.agents/skills*` | a skill-provider row for a skill *root* |

---

## Why

A capability that lives in a profile's `bundles` is mounted into **every**
session, in every preset. That is right for the harness's own machinery and
wrong for everything else: a plugin that adds six tools costs every session
six tools' worth of schema, whether or not the session will ever use them.

The built-in presets solve this by hand — `Creative` carries drawio, Blender
and FigCraft; `Office` carries GenOffice; `Media` carries ffmpeg and Remotion.
That works until the set of installed capabilities changes, and then the
hand-written lists drift.

This plugin derives the same thing from the machine.

---

## Install

```sh
dsh plugin --profile web add dsh-preset-categorizer
```

Or from a checkout:

```sh
dsh plugin --profile web add "link:/path/to/dsh-preset-categorizer"
```

**Mount it inside a preset, not in `bundles`.** It adds no tools, but it does
run at boot and it adds presets to the picker, so it should only be present in
the sessions that want it:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml, inside the Creative preset
- id: preset-categorizer
  name: dsh-preset-categorizer
  config: {}
  # The loader reads `inject` from the ENTRY ROW, not from the module's
  # exports. Without it, ctx.agentPresets throws "cannot get property
  # agentPresets without inject".
  inject:
    - loader
    - agentPresets
```

---

## How it behaves

Three rules, in the order they matter:

1. **It only adds.** Every preset it creates has an id starting with
   `cat-`. If the host already has a preset with that id, it is skipped and
   reported. It never edits, replaces or removes an existing preset, and it
   never touches the profile's `package.json`.
2. **It never moves.** The plugin reports what belongs where; it does not
   unmount a capability from the host composition. Moving one is a decision
   with a cost — a plugin in `bundles` is also the one whose web UI loads — so
   it stays with the human.
3. **It adds no tools.** A categorizer that carried its own schemas would
   spend the very budget it exists to protect.

### A missing package drops the row, not the preset

A preset that names a package the profile does not have mounts **broken** and
shows up red in the picker. So the categorizer reads the profile's
`package.json` first and drops such rows:

```
cat-media → [ffmpeg, remotion-skills]        in a profile with both
cat-media → [remotion-skills]                 in a profile without dsh-ffmpeg
```

### Skills are scoped by root, not individually

A skill provider mounts a **directory**, and the skills on a machine usually
live in shared roots. So "genoffice but not mineru" is not expressible as a
preset — a category can only say "mount this root". Two categories claiming
the same root would mount the same provider twice, so the first wins and the
second is reported.

---

## Verify

The plugin writes its own report, including the **host's own roster** with a
`broken` flag per preset:

```sh
cat ~/.dsh/preset-categorizer-report.json
```

```json
{
  "report": {
    "registered": 5,
    "capabilities": 209,
    "plugins": 194,
    "mcps": 5,
    "skills": 15
  },
  "roster": [
    { "id": "cat-docs", "name": "Documents (office / pdf)" },
    { "id": "cat-web", "name": "Browser (playwright)" }
  ]
}
```

The category rules have unit tests:

```sh
node test.mjs
```

---

## Configuration

The categories live in `lib/categories.js` as plain data. Each one declares
what it matches and what its preset carries:

```js
{
  id: 'cat-web',
  kind: 'mcp',
  preset: {
    id: 'cat-web',
    name: 'Browser (playwright)',
    order: 42,
    mcpRows: [{ id: 'mcp-playwright', name: MCP_CLIENT, config: { /* ... */ } }],
    skillRoot: null,
  },
  include: ['mcp-playwright'],
  exclude: [],
}
```

* `include` / `exclude` — glob patterns (`*`, `?`) matched against the
  capability's id, name and package. `exclude` wins.
* `mcpRows` — literal loader rows. An MCP server is mounted by *config*
  (serverName, transport, command/url), which cannot be derived from a package
  name.
* `skillRoot` — an absolute path to a skill directory to mount.

The first matching category wins, so the order of the list is meaningful.

---

## Safety

* **No network.** The plugin makes no outbound request of any kind.
* **No subprocess.** No `exec`, no `spawn`, no `eval`.
* **Reads only**: the skill directories under `~/.agents/skills*` and the
  profile's `package.json`.
* **Writes one file**: `~/.dsh/preset-categorizer-report.json`, containing
  names and counts only — no absolute paths, no credentials.
* **Touches nothing else.** No profile manifest, no patch file, no existing
  preset.

---

## License

MIT — see [LICENSE](LICENSE).
