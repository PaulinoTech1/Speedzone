import "server-only";

/** A caller raced another writer; the operation is safe to retry after a re-read. */
export class StateConflictError extends Error {}

/** Storage is missing, unreachable in a way the operator must fix, or malformed. */
export class StateConfigurationError extends Error {}
