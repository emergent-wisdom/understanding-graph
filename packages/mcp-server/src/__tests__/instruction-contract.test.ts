import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../instructions.js';
import { BATCH_OPERATION_TOOLS } from '../tools/batch.js';
import { conceptTools } from '../tools/concept.js';
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

describe('runtime instruction and tool contracts', () => {
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

  it('keeps the generated project guidance aligned with workflow routing', () => {
    const cli = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../../../bin/cli.js'),
      'utf8',
    );

    expect(cli).toContain(
      'right workflow: reading, research, coding, collaborative coding',
    );
    expect(cli).toContain('Use an agent team only when the work');
    expect(cli).not.toContain(
      'ask Claude to create an agent team for your task',
    );
    expect(cli).toContain('Direct concept and edge mutations go through');
    expect(cli).toContain(
      'workflow modes also expose document helpers at the top level',
    );
    expect(cli).toMatch(/source_read\\`\s+manage their own atomic updates/);
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
    };
    const core = json('packages/core/package.json') as { version: string };
    const mcp = json('packages/mcp-server/package.json') as {
      version: string;
      dependencies: Record<string, string>;
    };
    const web = json('packages/web-server/package.json') as {
      version: string;
      dependencies: Record<string, string>;
    };
    const plugin = json('.claude-plugin/plugin.json') as {
      version: string;
      mcpServers: { ug: { args: string[] } };
    };
    const registry = json('server.json') as {
      version: string;
      packages: Array<{ version: string }>;
    };

    expect(plugin.version).toBe(root.version);
    expect(plugin.mcpServers.ug.args).toContain(
      `understanding-graph@${root.version}`,
    );
    expect(registry.version).toBe(root.version);
    expect(registry.packages[0]?.version).toBe(root.version);
    expect(root.dependencies['@emergent-wisdom/understanding-graph-core']).toBe(
      core.version,
    );
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

    const writingTools = getToolDefinitions('writing');
    const create = writingTools.find((tool) => tool.name === 'doc_create');
    const revise = writingTools.find((tool) => tool.name === 'doc_revise');
    const weave = writingTools.find((tool) => tool.name === 'doc_weave');
    const batch = writingTools.find((tool) => tool.name === 'graph_batch');
    expect(create?.description).toContain(
      'move, replace, compare, or revise without rewriting neighbors',
    );
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
  });

  it('invites open cognitive testimony while reserving synthetic thinking', () => {
    expect(SERVER_INSTRUCTIONS).toContain(
      'active medium for **recursive, emergent understanding**',
    );
    expect(SERVER_INSTRUCTIONS).toContain(
      'every substantive change in understanding',
    );
    expect(SERVER_INSTRUCTIONS).toContain('Re-enter the graph repeatedly');
    expect(SERVER_INSTRUCTIONS).toContain('Preserve enough texture');
    expect(SERVER_INSTRUCTIONS).toContain(
      'Do not transcribe every token-level',
    );
    expect(SERVER_INSTRUCTIONS).toContain('non-`thinking`');
    expect(SERVER_INSTRUCTIONS).toMatch(
      /synthetic\s+Reader\/CMP synthesis mode/,
    );
    expect(SERVER_INSTRUCTIONS).toContain(
      'not a claim to reveal hidden chain-of-thought',
    );
  });

  it('keeps the live contract concise without turning testimony into a quota', () => {
    expect(SERVER_INSTRUCTIONS.trim().split(/\s+/).length).toBeLessThan(900);
    expect(SERVER_INSTRUCTIONS).toContain(
      'Do not privately pre-author an entire',
    );
    expect(SERVER_INSTRUCTIONS).toContain('batch-only `graph_note');
    expect(SERVER_INSTRUCTIONS).toContain(
      'When routine work produces no change in understanding, no note is honest',
    );

    expect(BATCH_OPERATION_TOOLS).toContain('graph_note');
    for (const mode of TOOL_MODES) {
      expect(
        getToolDefinitions(mode).some((tool) => tool.name === 'graph_note'),
      ).toBe(false);
    }
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

    const coding = names('coding');
    expect(coding.has('source_load')).toBe(false);
    expect(coding.has('doc_create')).toBe(true);
    expect(coding.has('doc_generate')).toBe(true);
    expect(coding.has('doc_merge')).toBe(true);
    expect(coding.has('solver_delegate')).toBe(false);
    expect(coding.has('graph_discover_grounded')).toBe(true);

    const collaborative = names('collaborative_coding');
    expect(collaborative.has('source_load')).toBe(false);
    expect(collaborative.has('doc_create')).toBe(true);
    expect(collaborative.has('doc_generate_all')).toBe(true);
    expect(collaborative.has('solver_delegate')).toBe(true);
    expect(collaborative.has('solver_lock')).toBe(true);
    expect(collaborative.has('graph_discover_grounded')).toBe(true);

    const writing = names('writing');
    expect(writing.has('doc_create')).toBe(true);
    expect(writing.has('doc_revise')).toBe(true);
    expect(writing.has('source_read')).toBe(false);
    expect(writing.has('doc_append_thinking')).toBe(false);
    expect(writing.has('graph_discover_grounded')).toBe(true);

    const syntheticReader = names('synthetic_reader');
    expect(syntheticReader.has('graph_thermostat')).toBe(false);
    expect(syntheticReader.has('graph_discover_grounded')).toBe(false);

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
      if (mode === 'reading' || mode === 'research' || mode === 'full')
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
    const advertised = [...markdown.matchAll(/mcp__ug__([a-z0-9_]+)/g)].map(
      (match) => match[1],
    );
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

  it('exposes every graph tool allowed by the coding skills', () => {
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
      const advertised = [...markdown.matchAll(/mcp__ug__([a-z0-9_]+)/g)].map(
        (match) => match[1],
      );
      const exposed = new Set(
        getToolDefinitions(mode).map((tool) => tool.name),
      );

      expect(advertised.length).toBeGreaterThan(0);
      expect(advertised.filter((tool) => !exposed.has(tool))).toEqual([]);
    };

    assertSkillTools('code-work', 'coding');
    assertSkillTools('collaborative-code', 'collaborative_coding');
  });
});
