import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

/**
 * Is the post-hoc orphan check reachable, or is it dead code?
 *
 * Disabling it leaves the whole suite green, so it is indistinguishable from a
 * no-op — and "untested safety net" and "dead code" call for opposite
 * treatment. The two checks reason over different objects, which is where any
 * divergence has to come from: pre-flight walks a MODEL of the operations
 * before anything runs and decides which new concepts WILL be connected, by
 * matching graph_connect endpoints on title or idRef. The backstop reads the
 * ACTUAL graph afterwards and asks which created node ids have no edge.
 *
 * They share one input, which bounds what the backstop could ever add: both
 * consider only ops whose tool is in NODE_CREATING_TOOLS, so a tool creating a
 * cognitive node from outside that list is invisible to BOTH.
 *
 * The route these tests were written to explore is CLOSED, and the docblock
 * said otherwise until the tests below disproved it. The guess was that a
 * `from` naming an already-existing title is a string pre-flight would credit
 * to the new concept while execution bound it to the older node of that name.
 * It does not: pre-flight resolves the title the way execution would, and
 * refuses. So these tests do not answer the reachability question — they close
 * the most plausible way in, and that is all they claim.
 *
 * What they do establish was not what they went looking for. A concept created
 * under a title already in use cannot be grounded BY TITLE for the rest of
 * that batch, since every by-title reference binds to the pre-existing node.
 *
 * An earlier version of this docblock said it could not be grounded AT ALL,
 * "from either direction". That was false, and the refusal message itself said
 * so — it offers "a batch back-reference such as $0.id", which addresses the
 * new node by POSITION rather than by name, and works. I read the remedy and
 * recorded that no remedy existed. So the message is adequate; what it does
 * not do is explain WHY the title route failed, which leaves a reader free to
 * try the same name again.
 */
const PROJECT_ID = 'orphan-backstop';
const SHARED = 'Access cost is measured against a tolerance';
let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-backstop-'));
  const projectsDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectsDir, PROJECT_ID), { recursive: true });
  contextManager = new ContextManager();
  contextManager.setProjectDir(projectsDir);
  sqlite.initAllDatabases(projectsDir);
  if (!sqlite.getLoadedProjectIds().includes(PROJECT_ID)) {
    sqlite.initDatabase(path.join(projectsDir, PROJECT_ID));
  }
  sqlite.setCurrentProject(PROJECT_ID);
  await contextManager.switchProject(PROJECT_ID);
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore cleanup after failed assertions.
  }
  resetGraphStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface BatchResult {
  success: boolean;
  message?: string;
  error?: string;
  errors?: Array<{ tool?: string; error?: string }>;
}

async function batch(commit_message: string, operations: unknown[]) {
  return (await handleToolCall(
    'graph_batch',
    { agent_name: 'test-agent', commit_message, operations },
    contextManager,
    'research',
  )) as BatchResult;
}

async function seedTwoGrounded() {
  const result = await batch('Seed a grounded pair', [
    {
      tool: 'graph_add_concept',
      params: {
        title: SHARED,
        trigger: 'foundation',
        why: 'Anchors the pair so neither stands alone',
        understanding:
          'Journeys inside the tolerance cost nothing, and journeys beyond it are counted.',
      },
    },
    {
      tool: 'graph_add_concept',
      params: {
        title: 'A second concept',
        trigger: 'analysis',
        why: 'Grounds the first so neither stands alone',
        understanding: 'Draws out what the first one implies.',
      },
    },
    {
      tool: 'graph_connect',
      params: {
        from: 'A second concept',
        to: SHARED,
        type: 'learned_from',
        why: 'Following this reaches the definition the second concept uses.',
      },
    },
  ]);
  expect(result.success, `seed failed: ${result.message ?? result.error}`).toBe(
    true,
  );
}

describe('the post-hoc orphan check: reachable or dead', () => {
  it('reports which check refuses a batch whose connect names an existing title', async () => {
    await seedTwoGrounded();

    // A new concept carrying a title that ALREADY exists, plus a connect that
    // names that title. Pre-flight sees a connect mentioning the new
    // concept's title; execution has two nodes to choose from.
    const result = await batch(
      'Create a same-titled concept and connect by title',
      [
        {
          tool: 'graph_add_concept',
          params: {
            title: SHARED,
            trigger: 'model',
            why: 'Records a second, distinct claim that happens to share a title',
            understanding:
              'A different claim entirely, written under a title already in use.',
            skipDuplicateCheck: true,
          },
        },
        {
          tool: 'graph_connect',
          params: {
            from: SHARED,
            to: 'A second concept',
            type: 'refines',
            why: 'Following this reaches the concept this one sharpens.',
          },
        },
      ],
    );

    // Printed, not assumed. Which layer spoke — pre-flight, the backstop, or
    // neither — is the whole question, and an assertion that cannot see the
    // difference would answer it by accident.
    const who =
      result.errors?.map((e) => e.tool).join(', ') ??
      (result.success ? '(none — batch succeeded)' : '(refused, no errors[])');
    console.log(
      `backstop probe — success=${result.success} refusedBy=${who}\n` +
        `   message: ${String(result.message ?? result.error).slice(0, 220)}`,
    );

    // PRE-FLIGHT refuses it, and refuses it for the right reason: it resolves
    // the connect's `from` the way execution would — to the older node of that
    // name — and so sees the new concept reaching nothing. It does not
    // naively credit the title to the concept created beside it.
    expect(result.success).toBe(false);
    expect(String(result.message ?? result.error)).toContain(
      'would be ungrounded',
    );
    // The backstop announces itself with an `orphan_check` entry in errors[].
    // Its absence here is the point: this batch never got far enough to need
    // it, so it is not the layer under test.
    expect(result.errors?.some((e) => e.tool === 'orphan_check')).toBeFalsy();
  });

  it('accepts the identical shape when the new title is unique', async () => {
    await seedTwoGrounded();

    // The control, varying ONE thing: the new concept's title. Same operation
    // count, same tools, same edge direction. If this also failed, the earlier
    // refusal would be about the shape rather than the collision and the test
    // above would be pinning the wrong mechanism.
    const result = await batch('The same shape under a title nobody is using', [
      {
        tool: 'graph_add_concept',
        params: {
          title: 'A claim under a title nobody is using',
          trigger: 'model',
          why: 'Records a second, distinct claim under an unused title',
          understanding: 'A different claim entirely, addressable by its name.',
        },
      },
      {
        tool: 'graph_connect',
        params: {
          from: 'A claim under a title nobody is using',
          to: 'A second concept',
          type: 'refines',
          why: 'Following this reaches the concept this one sharpens.',
        },
      },
    ]);

    console.log(
      `control — success=${result.success} ${String(result.message ?? result.error ?? '').slice(0, 110)}`,
    );
    expect(
      result.success,
      'The shape itself is fine, so the refusal above is caused by the title ' +
        'collision and not by the grounding analysis being over-strict.',
    ).toBe(true);
  });

  it('cannot ground a same-titled concept by NAME, from either direction', async () => {
    await seedTwoGrounded();

    // Follows from the two above. Every by-title reference in a batch binds to
    // the PRE-EXISTING node, so a concept created under a title already in use
    // is unaddressable for the rest of that batch and therefore cannot be
    // grounded in it — whichever direction the edge points.
    const result = await batch(
      'Try to ground the same-titled concept from the other side',
      [
        {
          tool: 'graph_add_concept',
          params: {
            title: SHARED,
            trigger: 'model',
            why: 'Records a second, distinct claim that happens to share a title',
            understanding: 'A different claim entirely, under a title in use.',
            skipDuplicateCheck: true,
          },
        },
        {
          tool: 'graph_add_concept',
          params: {
            title: 'A distinctly named partner',
            trigger: 'analysis',
            why: 'Gives the same-titled concept something to reach',
            understanding: 'Named so no resolution ambiguity can arise.',
          },
        },
        {
          tool: 'graph_connect',
          params: {
            from: 'A distinctly named partner',
            to: SHARED,
            type: 'learned_from',
            why: 'Following this reaches the claim the partner was drawn from.',
          },
        },
      ],
    );

    expect(result.success).toBe(false);
    expect(String(result.message ?? result.error)).toContain(
      'would be ungrounded',
    );
  });

  it('grounds a same-titled concept by $0.id, the remedy the message names', async () => {
    await seedTwoGrounded();
    const result = await batch(
      'Ground the same-titled concept by back-reference',
      [
        {
          tool: 'graph_add_concept',
          params: {
            title: SHARED,
            trigger: 'model',
            why: 'Records a second, distinct claim that happens to share a title',
            understanding: 'A different claim entirely, under a title in use.',
            skipDuplicateCheck: true,
          },
        },
        {
          tool: 'graph_connect',
          params: {
            from: '$0.id',
            to: 'A second concept',
            type: 'refines',
            why: 'Following this reaches the concept this one sharpens.',
          },
        },
      ],
    );
    console.log(
      `backref — success=${result.success} :: ${String(result.message ?? result.error).slice(0, 120)}`,
    );
    // The refusal in the first test ends by offering exactly this. Pinned
    // because the claim it refutes had already been written into a docblock, a
    // commit message and the project graph.
    expect(
      result.success,
      'A $0.id back-reference addresses the new node by position rather than ' +
        'name, so the title collision does not block grounding after all.',
    ).toBe(true);
  });
});
