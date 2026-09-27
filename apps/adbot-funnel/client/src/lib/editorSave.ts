export type EditorSaveFlush = {
  silent: boolean;
};

export type EditorSaveRequest<T> = {
  action: "start" | "queue" | "skip";
  revision: number;
  payload?: T;
};

export type EditorSaveFinish = {
  clearDirty: boolean;
  replay: EditorSaveFlush | null;
  persistedRevision: number;
};

/**
 * One in-flight persist at a time. Newer local edits bump a revision so a
 * completing save cannot clear dirty or silently drop the latest colors.
 */
export function createEditorSaveController<T>(options: {
  getLatest: () => T | undefined;
}) {
  let revision = 0;
  let inFlight = false;
  let inFlightRevision = 0;
  let queued: EditorSaveFlush | null = null;

  return {
    bumpRevision() {
      revision += 1;
      return revision;
    },
    reset() {
      revision = 0;
      inFlight = false;
      inFlightRevision = 0;
      queued = null;
    },
    get revision() {
      return revision;
    },
    get inFlight() {
      return inFlight;
    },
    requestPersist(silent: boolean): EditorSaveRequest<T> {
      const payload = options.getLatest();
      if (!payload) return { action: "skip", revision };
      if (inFlight) {
        queued = { silent: queued ? queued.silent && silent : silent };
        return { action: "queue", revision };
      }
      inFlight = true;
      inFlightRevision = revision;
      return { action: "start", revision, payload };
    },
    finishPersist(ok: boolean): EditorSaveFinish {
      const persistedRevision = inFlightRevision;
      inFlight = false;
      const newer = revision !== persistedRevision;
      const replay = queued ?? (ok && newer ? { silent: true } : null);
      queued = null;
      return {
        clearDirty: ok && !newer && !replay,
        replay,
        persistedRevision,
      };
    },
  };
}
