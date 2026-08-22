import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getGraphStore,
  resetGraphStore,
  sqlite,
  withReservedThinkingVisibility,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-collaboration-'));
  const projectDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectDir, 'collaboration-test'), {
    recursive: true,
  });

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDir);
  sqlite.initAllDatabases(projectDir);
  if (!sqlite.getLoadedProjectIds().includes('collaboration-test')) {
    sqlite.initDatabase(path.join(projectDir, 'collaboration-test'));
  }
  sqlite.setCurrentProject('collaboration-test');
  await contextManager.switchProject('collaboration-test');
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore cleanup after a failed fixture.
  }
  resetGraphStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return (await handleToolCall(
    name,
    args,
    contextManager,
    'collaborative_coding',
  )) as Record<string, unknown>;
}

async function spawn(name: string, role: 'executive' | 'validation') {
  return call('solver_spawn', {
    name,
    role,
    manifest: `${name} owns a bounded lane and reports exact evidence.`,
  });
}

async function seedWorkstream(commitMessage = 'Seed collaborative workstream') {
  const batch = await call('graph_batch', {
    commit_message: commitMessage,
    agent_name: 'integration-lead',
    operations: [
      {
        tool: 'doc_create',
        params: {
          title: 'Workstream root',
          content: '# Shared implementation workstream\n',
          fileType: 'md',
          isDocRoot: true,
          level: 'document',
        },
      },
      {
        tool: 'doc_create',
        params: {
          title: 'API lane',
          content: 'Contributor-owned API implementation.\n',
          parentId: '$0.id',
          level: 'section',
        },
      },
      {
        tool: 'doc_create',
        params: {
          title: 'Schema leaf',
          content: 'Nested schema resource with collision risk.\n',
          parentId: '$1.id',
          level: 'section',
        },
      },
      {
        tool: 'graph_add_concept',
        params: {
          title: 'External integration evidence',
          trigger: 'experiment',
          understanding: 'Evidence related to the lane but not owned by it.',
          why: 'Ensures semantic edges do not expand a subtree lease.',
          skipDuplicateCheck: true,
        },
      },
      {
        tool: 'graph_connect',
        params: {
          from: '$1.id',
          to: '$3.id',
          type: 'learned_from',
          why: 'The API artifact used integration evidence outside its ownership subtree.',
        },
      },
    ],
  });

  expect(batch.success).toBe(true);
  return (batch.results as Array<{ id: string }>).slice(0, 4).map((r) => r.id);
}

describe('collaborative solver handoffs', () => {
  it('returns exact child handoffs on parent reclaim and rejects ghost or replayed completion', async () => {
    await spawn('ContributorA', 'executive');
    await spawn('IntegrationLead', 'validation');

    const parent = await call('solver_delegate', {
      solver_name: 'IntegrationLead',
      input: 'Integrate the API lane after inspecting its handoff.',
      accept_spec: 'Acknowledge the child task and run combined tests.',
    });
    const firstParentClaim = await call('solver_claim_task', {
      specific_solver: 'IntegrationLead',
    });
    expect(firstParentClaim.task_id).toBe(parent.task_id);

    const child = await call('solver_delegate', {
      solver_name: 'ContributorA',
      parent_task_id: parent.task_id,
      input: 'Implement only the API lane and return an evidence-rich handoff.',
      accept_spec: 'API tests pass; files and risks are listed.',
    });
    const childClaim = await call('solver_claim_task', {
      specific_solver: 'ContributorA',
    });
    expect(childClaim.task_id).toBe(child.task_id);

    const handoff = JSON.stringify({
      files: ['src/api.ts'],
      tests: ['api.test.ts: pass'],
      risks: ['combined suite not run'],
    });
    const childCompletion = await call('solver_complete_task', {
      task_id: child.task_id,
      result: handoff,
      status: 'success',
    });
    expect(childCompletion.parent_unblocked).toBe(true);

    const reclaimedParent = await call('solver_claim_task', {
      specific_solver: 'IntegrationLead',
    });
    const workOrder = reclaimedParent.work_order as {
      completed_child_handoffs: Array<Record<string, unknown>>;
      handoff_note: string;
    };
    expect(workOrder.completed_child_handoffs).toEqual([
      expect.objectContaining({
        task_id: child.task_id,
        solver: 'ContributorA',
        status: 'completed',
        result: handoff,
        acceptance_criteria: 'API tests pass; files and risks are listed.',
      }),
    ]);
    expect(workOrder.handoff_note).toContain('Acknowledge the task IDs');

    const ghost = await call('solver_complete_task', {
      task_id: 'task_does_not_exist',
      result: 'ghost handoff',
      status: 'success',
    });
    expect(ghost).toMatchObject({ success: false });
    expect(ghost.error).toContain('not found');

    const parentCompletion = await call('solver_complete_task', {
      task_id: parent.task_id,
      result: JSON.stringify({
        acknowledged_task_ids: [child.task_id],
        combined_tests: 'pass',
      }),
      status: 'success',
    });
    expect(parentCompletion).toMatchObject({
      success: true,
      status: 'completed',
    });

    const replay = await call('solver_complete_task', {
      task_id: parent.task_id,
      result: 'replace the integration result',
      status: 'success',
    });
    expect(replay).toMatchObject({
      success: false,
      current_status: 'completed',
    });

    const unclaimed = await call('solver_delegate', {
      solver_name: 'ContributorA',
      input: 'A second lane that has not been claimed.',
    });
    const directCompletion = await call('solver_complete_task', {
      task_id: unclaimed.task_id,
      result: 'bypassed claim',
      status: 'success',
    });
    expect(directCompletion).toMatchObject({
      success: false,
      current_status: 'pending',
    });
  });
});

describe('collaborative graph locks', () => {
  it('cannot inspect, lock, unlock, or enforce reserved Reader artifacts', async () => {
    const hidden = withReservedThinkingVisibility(true, () =>
      getGraphStore().createNode({
        title: 'Reserved collaboration marker',
        trigger: 'thinking',
        understanding: 'Synthetic Reader content must remain isolated.',
        why: 'Exercises solver capability boundaries.',
      }),
    );
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    sqlite
      .getDb()
      .prepare(
        `INSERT INTO resource_locks
          (id, resource_id, holder_id, scope, expires_at, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'lock_hidden_fixture',
        hidden.id,
        'synthetic-holder',
        'node',
        expiresAt,
        'RESERVED_LOCK_REASON',
      );

    const lock = await call('solver_lock', {
      resource_ids: [hidden.id],
      holder_id: 'ordinary-agent',
    });
    expect(lock).toMatchObject({ success: false });
    expect(JSON.stringify(lock)).not.toContain(hidden.id);

    const listed = await call('solver_check_locks', {});
    expect(listed).toMatchObject({ count: 0, locks: [] });
    expect(JSON.stringify(listed)).not.toContain('RESERVED_LOCK_REASON');

    const unlocked = await call('solver_unlock', {
      resource_ids: ['all'],
      holder_id: 'synthetic-holder',
    });
    expect(unlocked).toMatchObject({ released: 0, released_resources: [] });
    expect(
      (
        sqlite
          .getDb()
          .prepare('SELECT COUNT(*) AS count FROM resource_locks WHERE id = ?')
          .get('lock_hidden_fixture') as { count: number }
      ).count,
    ).toBe(1);

    const gate = {
      green_case: 'A nominal success case.',
      red_case: 'A material failure case.',
      decision: 'red',
      reason: 'The failure case controls.',
    };
    const enforced = await call('solver_enforce', {
      target_id: hidden.id,
      parsimonious: gate,
      unique: gate,
      realizable: gate,
      expansive: gate,
    });
    expect(enforced).toMatchObject({ success: false });
    expect(JSON.stringify(enforced)).not.toContain(hidden.id);
    const hiddenAfter = withReservedThinkingVisibility(true, () =>
      getGraphStore().getNode(hidden.id),
    );
    expect(hiddenAfter?.metadata?.rejected).toBeUndefined();
  });

  it('locks a complete subtree atomically and releases it from the root', async () => {
    const [rootId, childId, grandchildId, externalEvidenceId] =
      await seedWorkstream();

    const otherLock = await call('solver_lock', {
      resource_ids: [childId],
      holder_id: 'other-agent',
      scope: 'node',
      duration_minutes: 10,
      reason: 'Own the API lane.',
    });
    expect(otherLock.success).toBe(true);

    const blockedSubtree = await call('solver_lock', {
      resource_ids: [rootId],
      holder_id: 'integration-lead',
      scope: 'subtree',
      duration_minutes: 10,
      reason: 'Own the complete workstream.',
    });
    expect(blockedSubtree).toMatchObject({ success: false, acquired: [] });
    expect(blockedSubtree.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resource: childId,
          holder: 'other-agent',
        }),
      ]),
    );

    const locksAfterConflict = await call('solver_check_locks', {});
    expect(
      (locksAfterConflict.locks as Array<{ holder_id: string }>).filter(
        (lock) => lock.holder_id === 'integration-lead',
      ),
    ).toHaveLength(0);

    await call('solver_unlock', {
      resource_ids: [childId],
      holder_id: 'other-agent',
    });
    const acquiredSubtree = await call('solver_lock', {
      resource_ids: [rootId],
      holder_id: 'integration-lead',
      scope: 'subtree',
      duration_minutes: 10,
      reason: 'Own the complete workstream.',
    });
    expect(new Set(acquiredSubtree.acquired as string[])).toEqual(
      new Set([rootId, childId, grandchildId]),
    );
    expect(acquiredSubtree.acquired).not.toContain(externalEvidenceId);

    const descendantConflict = await call('solver_lock', {
      resource_ids: [grandchildId],
      holder_id: 'late-contributor',
      scope: 'node',
      reason: 'Attempt to enter an owned subtree.',
    });
    expect(descendantConflict).toMatchObject({ success: false, acquired: [] });

    const released = await call('solver_unlock', {
      resource_ids: [rootId],
      holder_id: 'integration-lead',
    });
    expect(released.released).toBe(3);
    expect(new Set(released.released_resources as string[])).toEqual(
      new Set([rootId, childId, grandchildId]),
    );

    const finalLocks = await call('solver_check_locks', {});
    expect(finalLocks).toMatchObject({ count: 0, locks: [] });
  });

  it('garbage-collects ISO timestamps that expired earlier the same day', async () => {
    const [rootId] = await seedWorkstream();
    await call('solver_lock', {
      resource_ids: [rootId],
      holder_id: 'integration-lead',
      scope: 'node',
      duration_minutes: 10,
    });
    sqlite
      .getDb()
      .prepare(`UPDATE resource_locks SET expires_at = ? WHERE holder_id = ?`)
      .run(new Date(Date.now() - 60_000).toISOString(), 'integration-lead');

    const locks = await call('solver_check_locks', {});
    expect(locks).toMatchObject({ count: 0, locks: [] });
  });
});

describe('collaborative graph history', () => {
  it('includes commit origin stories and agent attribution with events', async () => {
    const ids = await seedWorkstream('Coordinate API & integration');
    const history = (await handleToolCall(
      'graph_history',
      { limit: 20 },
      contextManager,
    )) as string;

    expect(history).toContain('<project_history project="collaboration-test">');
    expect(history).toContain('<recent_commits count="1">');
    expect(history).toContain(
      '<message>Coordinate API &amp; integration</message>',
    );
    expect(history).toContain('<agent>integration-lead</agent>');
    expect(history).toContain(ids[0]);
    expect(history).toContain('<recent_activity');
  });
});
