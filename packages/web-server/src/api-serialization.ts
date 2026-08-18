import { SerialTaskQueue } from '@emergent-wisdom/understanding-graph-mcp-server';
import type { RequestHandler } from 'express';

/**
 * Hold one process-wide API lease from project selection until the response is
 * complete (or its client disconnects). The core database and GraphStore use
 * process-global active-project pointers, so no API request may overlap the
 * project-sensitive portion of another request, even when callers live in
 * separate processes.
 */
export function createApiSerializationMiddleware(
  queue = new SerialTaskQueue(),
): RequestHandler {
  return (_req, res, next) => {
    // A client can disconnect while its request is still waiting behind an
    // earlier response. Remember that event before acquiring the lease so the
    // abandoned request cannot enter downstream middleware or strand the
    // queue waiting for a close event that already happened.
    let closedBeforeLease = false;
    const markClosedBeforeLease = () => {
      closedBeforeLease = true;
    };
    res.once('close', markClosedBeforeLease);

    void queue.run(
      () =>
        new Promise<void>((resolve) => {
          res.removeListener('close', markClosedBeforeLease);
          if (closedBeforeLease || res.destroyed || res.writableEnded) {
            resolve();
            return;
          }

          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            res.removeListener('finish', release);
            res.removeListener('close', release);
            resolve();
          };

          res.once('finish', release);
          res.once('close', release);
          next();
        }),
    );
  };
}
