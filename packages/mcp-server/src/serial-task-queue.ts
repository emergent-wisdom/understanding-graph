/**
 * A minimal promise queue for process-global MCP state.
 *
 * The graph store uses one active-project pointer and one SQLite connection
 * per loaded project. Tool requests therefore must not overlap: a read could
 * otherwise observe another request's provisional transaction, and a project
 * switch could redirect an in-flight request. Keep this queue at the external
 * CallTool boundary; nested graph_batch operations already belong to the same
 * request and must not enqueue themselves.
 */
export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
