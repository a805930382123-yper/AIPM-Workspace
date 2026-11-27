// B04: confirmed-commit transactions. Nothing formal is written before the frozen manifest is
// persisted; a failure mid-way is reported honestly (operationId + which targets exist) and the
// same operation is resumed from the manifest instead of asking the user to confirm again.
export { CommitError, pendingRawCommit, scanWikiCommits } from './commit-types.ts';
export type {
  CommitPhaseName,
  CommitPhase,
  CommitStatus,
  CommitSnapshot,
  CommitManifest,
  QuestionCommitManifest,
  KnowledgeCommitManifest,
} from './commit-types.ts';
export { WikiCommitService } from './commit-service.ts';
