import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { guidanceModeFromEnv } from '../guidance.js';
import { getServerInstructions, SERVER_INSTRUCTIONS } from '../instructions.js';
import {
  UNDERSTANDING_PROTOCOL_ID,
  UNDERSTANDING_PROTOCOL_LABEL,
  UNDERSTANDING_PROTOCOL_MOVES,
  UNDERSTANDING_STANCES,
} from '../protocol.js';
import { BATCH_OPERATION_TOOLS } from '../tools/batch.js';
import { conceptTools } from '../tools/concept.js';
import { documentTools } from '../tools/document.js';
import {
  getToolDefinitions,
  SYNTHETIC_THINKING_TOOLS,
  TOOL_MODES,
} from '../tools/index.js';

const UNDERSTANDING_WORKFLOWS = [
  'auto',
  'reading',
  'research',
  'coding',
  'collaborative_coding',
  'writing',
  'general',
];

function expectChronologicalReaderActivation(contract: string): void {
  expect(contract).toContain('source_load');
  expect(contract).toContain('source_read');
  expect(contract).toContain('graph_note');
  expect(contract).toMatch(
    /(?:before|without)[^.]{0,160}(?:opening|reading|inspecting|sampling|summarizing)[^.]{0,160}(?:source|file)/i,
  );
  expect(contract).toMatch(
    /(?:unread\s+(?:text|material|source|part)|read\s+ahead)/i,
  );
  expect(contract).toMatch(/workflow `reading`/i);
  expect(contract).toMatch(/(?:ordinary|general) (?:mode|tool mode|reading)/i);
  expect(contract).toContain('synthetic_reader');
  expect(contract).toMatch(/reserved `thinking` trigger/i);
}

describe('runtime instruction and tool contracts', () => {
  it('uses one canonical fluid-understanding protocol', () => {
    expect(UNDERSTANDING_PROTOCOL_MOVES).toEqual([
      'orient',
      'preserve',
      'search',
      'make',
      'test',
      'connect',
      'disrupt',
      'force-bisociation',
      're-enter',
      'reconsider',
      'pause',
    ]);
    expect(SERVER_INSTRUCTIONS).toContain(UNDERSTANDING_PROTOCOL_LABEL);
    expect(SERVER_INSTRUCTIONS).toContain(UNDERSTANDING_PROTOCOL_ID);
    expect(SERVER_INSTRUCTIONS).toContain('There is no required state machine');
    expect(SERVER_INSTRUCTIONS).toMatch(
      /all\s+communicable, material understanding/i,
    );
    expect(SERVER_INSTRUCTIONS).toMatch(/reader's future inquiry/i);
    expect(SERVER_INSTRUCTIONS).toContain('graph_suggest_next');
    expect(UNDERSTANDING_STANCES).toEqual([
      'balanced',
      'deepen',
      'resist',
      'connect',
      'disrupt',
      'revisit',
      'test',
    ]);
    expect(SERVER_INSTRUCTIONS).toContain('Medium-integrity invariant');
    expect(SERVER_INSTRUCTIONS).toContain('only in chat');
    expect(SERVER_INSTRUCTIONS).toContain(
      '`workflow` says where the work lives',
    );
    expect(SERVER_INSTRUCTIONS).not.toMatch(/target:\s*70|2-3 concepts/i);

    const bootContract = SERVER_INSTRUCTIONS.trim().slice(0, 512);
    expect(bootContract).toContain('canonical persistent workspace');
    expect(bootContract).toContain('Suggestion guidance is optional');
    expect(bootContract).toContain('graph_batch');
    expect(bootContract).toContain('Chat may report');
  });

  it('offers guided and direct use without removing graph capabilities', () => {
    const guided = getServerInstructions('guided');
    const direct = getServerInstructions('direct');
    const synthetic = getServerInstructions('guided', false);

    expect(guided).toContain('Guidance mode: guided');
    expect(guided).toMatch(/deepen or\s+diversify\s+understanding/i);
    expect(guided).toContain('no quality guarantee');
    expect(direct).toContain('Guidance mode: direct');
    expect(direct).toContain('No graph capability is lost');
    expect(direct).toContain('graph_suggest_next');
    expect(direct).not.toMatch(/At the start and each real choice point, call/);
    expect(synthetic).toContain('Suggestion guidance is unavailable');
    expect(synthetic).toContain('do not attempt to call `graph_suggest_next`');

    expect(guidanceModeFromEnv({})).toBe('guided');
    expect(guidanceModeFromEnv({ UG_GUIDANCE_MODE: ' DIRECT ' })).toBe(
      'direct',
    );
    expect(() =>
      guidanceModeFromEnv({ UG_GUIDANCE_MODE: 'sometimes' }),
    ).toThrow(/Invalid UG_GUIDANCE_MODE/);
  });

  it('keeps the installable workflow skill aligned with the runtime protocol', () => {
    const repo = path.resolve(import.meta.dirname, '../../../..');
    const skill = fs.readFileSync(
      path.join(repo, 'skills/understanding-work/SKILL.md'),
      'utf8',
    );

    expect(skill).toContain(
      `Protocol compatibility: \`${UNDERSTANDING_PROTOCOL_ID}\``,
    );
    expect(skill).toContain('Do not wait for the user to name a tool');
    expect(skill).toContain('graph_understand');
    expect(skill).toContain('graph_batch');
    expect(skill).toContain('graph_suggest_next');
    expect(skill).toContain('not merely to write a novel');
    expect(skill).toContain('all communicable, material understanding');
    expect(skill).toContain("the Reader's future inquiry");
    expect(skill).toContain('There is no mandatory loop or state machine');
    expect(skill).toContain('Maintain medium integrity');
    expect(skill).toContain('Workflow and stance are separate');
  });

  it('activates chronological reader mode before the source is inspected', () => {
    const repo = path.resolve(import.meta.dirname, '../../../..');
    const skill = fs.readFileSync(
      path.join(repo, 'skills/understanding-work/SKILL.md'),
      'utf8',
    );

    for (const contract of [SERVER_INSTRUCTIONS, skill]) {
      expectChronologicalReaderActivation(contract);
    }
  });

  it('teaches corrections as evaluation testimony rather than an invalid trigger', () => {
    const note = conceptTools.find((tool) => tool.name === 'graph_note');
    const trigger = note?.inputSchema.properties?.trigger as {
      enum?: string[];
    };

    expect(trigger.enum).toContain('evaluation');
    expect(trigger.enum).not.toContain('correction');
    expect(note?.description).toContain('evaluations that record corrections');
    expect(SERVER_INSTRUCTIONS).toContain(
      'Record a\ncorrection as an `evaluation`',
    );
  });

  it('only advertises graph_analyze include values supported by its schema', () => {
    const analyzeTool = getToolDefinitions('full').find(
      (tool) => tool.name === 'graph_analyze',
    );
    const supported = new Set(
      (
        analyzeTool?.inputSchema.properties?.include as {
          items?: { enum?: string[] };
        }
      )?.items?.enum || [],
    );
    const examples = [
      ...SERVER_INSTRUCTIONS.matchAll(
        /graph_analyze\s*\(\s*\{\s*include\s*:\s*\[([^\]]*)\]/g,
      ),
    ];

    expect(supported.size).toBeGreaterThan(0);
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      const advertised = [...example[1].matchAll(/["']([^"']+)["']/g)].map(
        (match) => match[1],
      );
      expect(advertised.length).toBeGreaterThan(0);
      expect(advertised.filter((value) => !supported.has(value))).toEqual([]);
    }
  });

  it('does not teach tool names that do not exist', () => {
    expect(SERVER_INSTRUCTIONS).not.toContain('source_commit');
    expect(SERVER_INSTRUCTIONS).not.toContain('project_create');
  });

  it('generates project guidance from the canonical workflow skill', () => {
    const cli = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../../../bin/cli.js'),
      'utf8',
    );

    expect(cli).toContain("'skills',");
    expect(cli).toContain("'understanding-work',");
    expect(cli).toContain("'SKILL.md',");
    expect(cli).toContain('understanding-graph:fluid-understanding-v1');
    expect(cli).toContain('AGENTS.md');
    expect(cli).toContain('CLAUDE.md');
    expect(cli).not.toContain(
      'ask Claude to create an agent team for your task',
    );
  });

  it('keeps release manifests and internal package ranges synchronized', () => {
    const repo = path.resolve(import.meta.dirname, '../../../..');
    const json = (relative: string) =>
      JSON.parse(fs.readFileSync(path.join(repo, relative), 'utf8')) as Record<
        string,
        unknown
      >;
    const root = json('package.json') as {
      version: string;
      dependencies: Record<string, string>;
      engines: { node: string };
      repository: { url: string };
    };
    const core = json('packages/core/package.json') as {
      version: string;
      engines: { node: string };
      publishConfig: { access: string };
      repository: { url: string; directory: string };
    };
    const mcp = json('packages/mcp-server/package.json') as {
      version: string;
      dependencies: Record<string, string>;
      engines: { node: string };
      publishConfig: { access: string };
      repository: { url: string; directory: string };
    };
    const web = json('packages/web-server/package.json') as {
      version: string;
      dependencies: Record<string, string>;
      engines: { node: string };
      publishConfig: { access: string };
      repository: { url: string; directory: string };
    };
    const lock = json('package-lock.json') as {
      packages: Record<string, { engines?: { node?: string } }>;
    };
    const plugin = json('.claude-plugin/plugin.json') as {
      version: string;
      mcpServers: {
        ug: { args: string[]; env: Record<string, string> };
      };
    };
    const codexPlugin = json('.codex-plugin/plugin.json') as {
      version: string;
      skills: string;
      mcpServers: string;
    };
    const codexMcp = json('.mcp.json') as {
      mcpServers: {
        ug: { args: string[]; env: Record<string, string> };
      };
    };
    const registry = json('server.json') as {
      version: string;
      packages: Array<{ version: string }>;
    };

    expect(plugin.version).toBe(root.version);
    expect(plugin.mcpServers.ug.args).toContain(
      `understanding-graph@${root.version}`,
    );
    expect(plugin.mcpServers.ug.env.UG_SOURCE_ROOT).toBe(
      `\${CLAUDE_PROJECT_DIR}`,
    );
    expect(codexPlugin.version).toBe(root.version);
    expect(codexPlugin.skills).toBe('./skills/');
    expect(codexPlugin.mcpServers).toBe('./.mcp.json');
    expect(codexMcp.mcpServers.ug.args).toContain(
      `understanding-graph@${root.version}`,
    );
    expect(codexMcp.mcpServers.ug.env.UG_SOURCE_ROOT).toBe('.');
    expect(registry.version).toBe(root.version);
    expect(registry.packages[0]?.version).toBe(root.version);
    expect(root.dependencies['@emergent-wisdom/understanding-graph-core']).toBe(
      core.version,
    );
    const repositoryUrl =
      'https://github.com/emergent-wisdom/understanding-graph.git';
    expect(root.repository.url).toBe(repositoryUrl);
    expect(core.repository).toEqual({
      type: 'git',
      url: repositoryUrl,
      directory: 'packages/core',
    });
    expect(mcp.repository).toEqual({
      type: 'git',
      url: repositoryUrl,
      directory: 'packages/mcp-server',
    });
    expect(web.repository).toEqual({
      type: 'git',
      url: repositoryUrl,
      directory: 'packages/web-server',
    });
    expect(
      root.dependencies['@emergent-wisdom/understanding-graph-mcp-server'],
    ).toBe(mcp.version);
    expect(mcp.dependencies['@emergent-wisdom/understanding-graph-core']).toBe(
      core.version,
    );
    expect(
      root.dependencies['@emergent-wisdom/understanding-graph-web-server'],
    ).toBe(web.version);
    expect(web.dependencies['@emergent-wisdom/understanding-graph-core']).toBe(
      core.version,
    );
    expect(
      web.dependencies['@emergent-wisdom/understanding-graph-mcp-server'],
    ).toBe(mcp.version);
    for (const manifest of [root, core, mcp, web]) {
      expect(manifest.engines.node).toBe('>=22.0.0');
    }
    for (const manifest of [core, mcp, web]) {
      expect(manifest.publishConfig.access).toBe('public');
    }
    for (const workspace of [
      '',
      'packages/core',
      'packages/mcp-server',
      'packages/web-server',
    ]) {
      expect(lock.packages[workspace]?.engines?.node).toBe('>=22.0.0');
    }
  });

  it('distinguishes reading, research, coding, collaborative coding, and writing loops', () => {
    expect(SERVER_INSTRUCTIONS).toContain('workflow: "reading"');
    expect(SERVER_INSTRUCTIONS).toContain('workflow: "research"');
    expect(SERVER_INSTRUCTIONS).toContain('workflow: "coding"');
    expect(SERVER_INSTRUCTIONS).toContain('workflow: "collaborative_coding"');
    expect(SERVER_INSTRUCTIONS).toContain('workflow: "writing"');

    expect(SERVER_INSTRUCTIONS).toMatch(
      /Reading[\s\S]*Advance sources chronologically/,
    );
    expect(SERVER_INSTRUCTIONS).toMatch(
      /Research[\s\S]*competing explanations[\s\S]*live inquiry/,
    );
    expect(SERVER_INSTRUCTIONS).toMatch(
      /Coding[\s\S]*document nodes[\s\S]*generate executable files/,
    );
    expect(SERVER_INSTRUCTIONS).toMatch(
      /Collaborative coding[\s\S]*ownership[\s\S]*handoffs[\s\S]*integration checks/,
    );
    expect(SERVER_INSTRUCTIONS).toMatch(
      /Writing[\s\S]*graph material exert creative pressure[\s\S]*locally addressable prose/,
    );
  });

  it('explains semantic artifact units without imposing node quotas', () => {
    expect(SERVER_INSTRUCTIONS).toContain(
      'A document leaf is an\naddressable unit of attention and change',
    );
    expect(SERVER_INSTRUCTIONS).toMatch(
      /function,[\s\S]*class,[\s\S]*test,[\s\S]*revised, moved, reused, or removed/,
    );
    expect(SERVER_INSTRUCTIONS).toContain(
      'smallest passage you can plausibly imagine moving',
    );
    expect(SERVER_INSTRUCTIONS).toContain(
      'semantic granularity, not a word count or node quota',
    );
    expect(SERVER_INSTRUCTIONS).toMatch(
      /exact passage, function, class, or test[\s\S]*recorded reason that unit\s+exists or changed/,
    );
    expect(SERVER_INSTRUCTIONS).toMatch(/`implements` points commitment→unit/);
    expect(SERVER_INSTRUCTIONS).toMatch(
      /authored claims, not\s+verified causality/,
    );

    const writingTools = getToolDefinitions('writing');
    // doc_create, doc_revise and doc_weave are batch-only, so they are absent
    // from every advertised surface. Their descriptions still instruct the
    // agent composing a graph_batch operation, so they are read from the
    // definitions themselves.
    const create = documentTools.find((tool) => tool.name === 'doc_create');
    const read = documentTools.find((tool) => tool.name === 'doc_read');
    const revise = documentTools.find((tool) => tool.name === 'doc_revise');
    const weave = documentTools.find((tool) => tool.name === 'doc_weave');
    const batch = writingTools.find((tool) => tool.name === 'graph_batch');
    expect(create?.description).toContain(
      'move, replace, compare, or revise without rewriting neighbors',
    );
    expect(create?.inputSchema.properties).toHaveProperty('purpose');
    expect(read?.inputSchema.properties).toHaveProperty('showProvenance');
    expect(read?.inputSchema.properties).toHaveProperty('offset');
    expect(read?.inputSchema.properties).toHaveProperty('limit');
    expect(read?.description).toContain('without pagination is unbounded');
    expect(read?.description).toContain('pagination.nextOffset');
    expect(read?.description).toContain('why this unit exists or changed');
    expect(revise?.description).toContain('independently revisable');
    expect(revise?.description).toContain(
      'insight, question, or tension should influence other passages or future work',
    );
    expect(revise?.description).toContain('revision history is enough');
    expect(weave?.description).toContain('graph material');
    expect(weave?.description).not.toContain('Sample random nodes');
    expect(batch?.description).toContain('never to meet a quota');
    expect(batch?.description).toContain('doc_create_passages');
    expect(batch?.description).toContain(
      'move, replace, compare, annotate, or revise independently',
    );
    expect(batch?.description).toContain(
      'inspiration is optional, never forced',
    );
    expect(batch?.description).toContain('Arguments belong inside params');
    expect(batch?.description).toContain('{ tool: "doc_create", params:');
    expect(batch?.description).toContain(
      'Every call requires operations, commit_message, and agent_name',
    );
    expect(batch?.description).toContain(
      'wrong names are rejected with an explicit remedy',
    );
    expect(batch?.description).not.toContain('fail silently');
    expect(batch?.description).toContain('a root uses isDocRoot: true');
    expect(batch?.description).toContain('a child uses parentId');
    expect(batch?.description).toContain('append with afterId');
    expect(SERVER_INSTRUCTIONS).toContain('actual `agent_name`');

    const history = getToolDefinitions('general').find(
      (tool) => tool.name === 'graph_history',
    );
    expect(history?.description).toContain(
      'when recent collaboration or activity could affect the current task',
    );
    expect(history?.description).not.toContain('start of every session');
  });

  it('invites open cognitive testimony while reserving synthetic thinking', () => {
    expect(SERVER_INSTRUCTIONS).toContain(
      'active medium for **fluid, emergent understanding**',
    );
    expect(SERVER_INSTRUCTIONS).toMatch(
      /all\s+communicable, material understanding/i,
    );
    expect(SERVER_INSTRUCTIONS).toContain('There is no required state machine');
    expect(SERVER_INSTRUCTIONS).toMatch(/preserve enough texture/i);
    expect(SERVER_INSTRUCTIONS).toContain('Do not transcribe token-level');
    expect(SERVER_INSTRUCTIONS).toContain('non-`thinking`');
    expect(SERVER_INSTRUCTIONS).toMatch(
      /synthetic\s+Reader\/CMP synthesis mode/,
    );
    expect(SERVER_INSTRUCTIONS).toMatch(
      /not a claim to reveal\s+hidden chain-of-thought/,
    );
  });

  it('keeps the live contract concise without turning testimony into a quota', () => {
    expect(SERVER_INSTRUCTIONS.trim().split(/\s+/).length).toBeLessThan(900);
    expect(SERVER_INSTRUCTIONS).toContain(
      'Do not privately pre-author an entire',
    );
    expect(SERVER_INSTRUCTIONS).toMatch(/batch-only\s+`graph_note/);
    expect(SERVER_INSTRUCTIONS).toContain(
      'do not manufacture understanding to prove activity',
    );

    expect(BATCH_OPERATION_TOOLS).toContain('graph_note');
    for (const mode of TOOL_MODES) {
      expect(
        getToolDefinitions(mode).some((tool) => tool.name === 'graph_note'),
      ).toBe(false);
    }
  });

  it('keeps grounded serendipity optional and honestly inconclusive', () => {
    const skill = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../../../skills/serendipity/SKILL.md',
      ),
      'utf8',
    );
    const frontmatter = skill.split('---')[1] ?? '';
    const advertised = frontmatter
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('mcp__plugin_understanding-graph_ug__'))
      .map((line) => line.replace('mcp__plugin_understanding-graph_ug__', ''));
    const generalTools = new Set(
      getToolDefinitions('general').map((tool) => tool.name),
    );

    expect(skill).toContain(
      'mcp__plugin_understanding-graph_ug__graph_discover_grounded',
    );
    expect(skill).toContain(
      'mcp__plugin_understanding-graph_ug__graph_suggest_next',
    );
    expect(advertised.filter((tool) => !generalTools.has(tool))).toEqual([]);
    expect(skill).toContain('A defensible\nno-connection result needs no node');
    expect(skill).not.toContain('next batch must write');
    expect(skill).toContain(
      'Never create a note merely to prove that\nthe exploratory call was useful',
    );
  });

  it('keeps artifact skills choice-driven and gates concurrent coordination', () => {
    const repo = path.resolve(import.meta.dirname, '../../../..');
    const skills = [
      ['code-work', 'coding'],
      ['creative-work', 'writing'],
      ['collaborative-code', 'collaborative_coding'],
    ] as const;
    for (const [name, mode] of skills) {
      const skill = fs.readFileSync(
        path.join(repo, 'skills', name, 'SKILL.md'),
        'utf8',
      );
      const advertised = (skill.split('---')[1] ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) =>
          line.startsWith('mcp__plugin_understanding-graph_ug__'),
        )
        .map((line) =>
          line.replace('mcp__plugin_understanding-graph_ug__', ''),
        );
      const available = new Set(
        getToolDefinitions(mode).map((tool) => tool.name),
      );
      expect(skill).toContain('graph_suggest_next');
      expect(skill).toMatch(/choose,\s+combine,\s+modify,\s+or\s+reject/i);
      expect(skill).not.toContain('mcp__ug__');
      expect(advertised.filter((tool) => !available.has(tool))).toEqual([]);
    }

    const collaborative = fs.readFileSync(
      path.join(repo, 'skills/collaborative-code/SKILL.md'),
      'utf8',
    );
    expect(collaborative).toContain('TOOL_MODE=collaborative_coding');
    expect(collaborative).toContain('Work serially through `code-work`');
  });

  it('treats synthesis as an operation and types only its actual result', () => {
    expect(SERVER_INSTRUCTIONS).toContain(
      'Synthesis is normally an **operation**, not a catch-all node type',
    );
    expect(SERVER_INSTRUCTIONS).toContain('`analysis` for a cognitive ratchet');

    const addConcept = conceptTools.find(
      (tool) => tool.name === 'graph_add_concept',
    );
    const triggers = (
      addConcept?.inputSchema.properties?.trigger as { enum?: string[] }
    )?.enum;
    expect(triggers).toContain('analysis');
    expect(triggers).not.toContain('synthesis');
    expect(triggers).not.toContain('thinking');
  });

  it('exposes graph_understand with the same workflow enum in every mode', () => {
    for (const mode of [
      'general',
      'reading',
      'research',
      'coding',
      'collaborative_coding',
      'writing',
      'full',
      'synthetic_reader',
    ] as const) {
      const tools = getToolDefinitions(mode);
      const understandTool = tools.find(
        (tool) => tool.name === 'graph_understand',
      );

      expect(understandTool).toBeDefined();
      expect(understandTool?.description).toContain('CONTEXTUAL RE-ENTRY TOOL');
      expect(understandTool?.description).toContain('only in transient chat');
      expect(
        (
          understandTool?.inputSchema.properties?.workflow as {
            enum?: string[];
          }
        )?.enum,
      ).toEqual(UNDERSTANDING_WORKFLOWS);
    }
  });

  it('keeps the focused tool surfaces aligned with their working loops', () => {
    const names = (mode: Parameters<typeof getToolDefinitions>[0]) =>
      new Set(getToolDefinitions(mode).map((tool) => tool.name));

    const reading = names('reading');
    expect(reading.has('source_load')).toBe(true);
    expect(reading.has('source_read')).toBe(true);

    const general = names('general');
    expect(names(undefined)).toEqual(general);
    expect(general.has('graph_batch')).toBe(true);
    expect(general.has('source_read')).toBe(true);
    expect(general.has('graph_updates')).toBe(true);
    expect(general.has('doc_generate')).toBe(true);
    expect(general.has('graph_purge')).toBe(false);
    expect(general.has('graph_bulk_replace')).toBe(false);
    expect(general.has('graph_chaos')).toBe(false);
    expect(general.has('solver_delegate')).toBe(false);

    const coding = names('coding');
    expect(coding.has('source_load')).toBe(false);
    // Mutating document tools are batch-only, so the coding surface reaches
    // them through graph_batch rather than directly. doc_generate stays: it
    // projects a document to a file and mutates no graph state.
    expect(coding.has('doc_create')).toBe(false);
    expect(coding.has('doc_merge')).toBe(false);
    expect(coding.has('graph_batch')).toBe(true);
    expect(coding.has('doc_generate')).toBe(true);
    expect(coding.has('solver_delegate')).toBe(false);
    expect(coding.has('graph_discover_grounded')).toBe(true);

    const collaborative = names('collaborative_coding');
    expect(collaborative.has('source_load')).toBe(false);
    expect(collaborative.has('doc_create')).toBe(false);
    expect(collaborative.has('graph_batch')).toBe(true);
    expect(collaborative.has('doc_generate_all')).toBe(true);
    expect(collaborative.has('solver_delegate')).toBe(true);
    expect(collaborative.has('solver_lock')).toBe(true);
    expect(collaborative.has('graph_discover_grounded')).toBe(true);

    const writing = names('writing');
    expect(writing.has('doc_create')).toBe(false);
    expect(writing.has('doc_revise')).toBe(false);
    expect(writing.has('graph_batch')).toBe(true);
    expect(writing.has('source_read')).toBe(false);
    expect(writing.has('doc_append_thinking')).toBe(false);
    expect(writing.has('graph_discover_grounded')).toBe(true);

    const syntheticReader = names('synthetic_reader');
    expect(syntheticReader.has('graph_thermostat')).toBe(false);
    expect(syntheticReader.has('graph_suggest_next')).toBe(false);
    expect(syntheticReader.has('graph_understand')).toBe(true);
    expect(syntheticReader.has('graph_discover_grounded')).toBe(false);

    for (const mode of [
      'general',
      'reading',
      'research',
      'coding',
      'collaborative_coding',
      'writing',
      'full',
    ] as const) {
      expect(names(mode).has('graph_suggest_next')).toBe(true);
    }

    // Structural rewrites are first-class nested graph_batch operations,
    // never top-level mutations on an advertised workflow surface.
    for (const mode of TOOL_MODES) {
      expect(names(mode).has('doc_move')).toBe(false);
      expect(names(mode).has('doc_split')).toBe(false);
      expect(names(mode).has('doc_create_passages')).toBe(false);
    }
    expect(BATCH_OPERATION_TOOLS).toContain('doc_move');
    expect(BATCH_OPERATION_TOOLS).toContain('doc_split');
    expect(BATCH_OPERATION_TOOLS).toContain('doc_create_passages');
  });

  it('keeps graph_batch internal dispatch limited to graph mutations', () => {
    const batch = getToolDefinitions('full').find(
      (definition) => definition.name === 'graph_batch',
    );
    const operation = batch?.inputSchema.properties?.operations as
      | { items?: { properties?: { tool?: { enum?: string[] } } } }
      | undefined;
    expect(operation?.items?.properties?.tool?.enum).toEqual([
      ...BATCH_OPERATION_TOOLS,
    ]);
    for (const forbidden of [
      'graph_batch',
      'graph_context',
      'graph_purge',
      'solver_enforce',
      'source_delete',
    ]) {
      expect(BATCH_OPERATION_TOOLS).not.toContain(forbidden);
    }
  });

  it('isolates reserved thinking production in synthetic_reader', () => {
    const ordinaryModes = TOOL_MODES.filter(
      (mode) => mode !== 'synthetic_reader',
    );

    for (const mode of ordinaryModes) {
      const definitions = getToolDefinitions(mode);
      const names = new Set(definitions.map((definition) => definition.name));
      for (const tool of SYNTHETIC_THINKING_TOOLS) {
        expect(names.has(tool), `${tool} leaked into ${mode}`).toBe(false);
      }
      // Ordinary workflows retain graph context for their own visible nodes;
      // the runtime visibility boundary excludes reserved synthetic blocks.
      expect(names.has('graph_context')).toBe(true);
      if (
        mode === 'general' ||
        mode === 'reading' ||
        mode === 'research' ||
        mode === 'full'
      )
        expect(names.has('source_export')).toBe(true);

      const findByTrigger = definitions.find(
        (definition) => definition.name === 'graph_find_by_trigger',
      );
      const triggerEnum = findByTrigger?.inputSchema.properties?.trigger as
        | { enum?: string[] }
        | undefined;
      expect(triggerEnum?.enum).not.toContain('thinking');
    }

    const syntheticReader = new Set(
      getToolDefinitions('synthetic_reader').map(
        (definition) => definition.name,
      ),
    );
    for (const tool of SYNTHETIC_THINKING_TOOLS) {
      expect(
        syntheticReader.has(tool),
        `${tool} missing from synthetic_reader`,
      ).toBe(true);
    }
    const syntheticFindByTrigger = getToolDefinitions('synthetic_reader').find(
      (definition) => definition.name === 'graph_find_by_trigger',
    );
    expect(
      (
        syntheticFindByTrigger?.inputSchema.properties?.trigger as {
          enum?: string[];
        }
      )?.enum,
    ).toContain('thinking');

    const syntheticDefinitions = getToolDefinitions('synthetic_reader').filter(
      (definition) =>
        (SYNTHETIC_THINKING_TOOLS as readonly string[]).includes(
          definition.name,
        ),
    );
    expect(syntheticDefinitions).toHaveLength(SYNTHETIC_THINKING_TOOLS.length);
    for (const definition of syntheticDefinitions) {
      expect(definition.description).toContain('SYNTHETIC_READER MODE ONLY');
      expect(definition.description).toMatch(/Reader\/CMP.*pretraining/i);
    }

    const sourceRead = getToolDefinitions('reading').find(
      (definition) => definition.name === 'source_read',
    );
    expect(sourceRead?.description).toContain('non-"thinking" typed testimony');
    expect(sourceRead?.description).not.toContain('doc_append_thinking');
    expect(sourceRead?.description).not.toMatch(/25%|50%|75%|MILESTONE/);
  });

  it('exposes every graph tool allowed by reading-mode without synthetic tools', () => {
    const markdown = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../../../skills/reading-mode/SKILL.md',
      ),
      'utf8',
    );
    const advertised = [
      ...markdown.matchAll(/mcp__plugin_understanding-graph_ug__([a-z0-9_]+)/g),
    ].map((match) => match[1]);
    const exposed = new Set(
      getToolDefinitions('reading').map((definition) => definition.name),
    );

    expect(advertised.length).toBeGreaterThan(0);
    expect(advertised.filter((tool) => !exposed.has(tool))).toEqual([]);
    expect(
      advertised.filter((tool) =>
        (SYNTHETIC_THINKING_TOOLS as readonly string[]).includes(tool),
      ),
    ).toEqual([]);
  });

  it('exposes every graph tool allowed by the general and coding skills', () => {
    const assertSkillTools = (
      skill: string,
      mode: Parameters<typeof getToolDefinitions>[0],
    ) => {
      const markdown = fs.readFileSync(
        path.resolve(
          import.meta.dirname,
          `../../../../skills/${skill}/SKILL.md`,
        ),
        'utf8',
      );
      const advertised = [
        ...markdown.matchAll(
          /mcp__plugin_understanding-graph_ug__([a-z0-9_]+)/g,
        ),
      ].map((match) => match[1]);
      const exposed = new Set(
        getToolDefinitions(mode).map((tool) => tool.name),
      );

      expect(advertised.length).toBeGreaterThan(0);
      expect(advertised.filter((tool) => !exposed.has(tool))).toEqual([]);
    };

    assertSkillTools('orient', 'general');
    assertSkillTools('quality-check', 'general');
    assertSkillTools('code-work', 'coding');
    assertSkillTools('collaborative-code', 'collaborative_coding');
  });
});
