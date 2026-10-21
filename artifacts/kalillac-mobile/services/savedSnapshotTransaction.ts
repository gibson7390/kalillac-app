export type SnapshotTransactionStage =
  | 'repository_commit_started'
  | 'repository_commit_succeeded'
  | 'repository_commit_failed'
  | 'save_success'
  | 'rollback-record';

export async function persistThenCommitSnapshot(
  persist: () => Promise<() => Promise<void>>,
  commit: () => Promise<void>,
  report: (stage: SnapshotTransactionStage, status: 'started' | 'success' | 'failure', errorClass?: string) => unknown,
): Promise<void> {
  const rollback = await persist();
  await report('repository_commit_started', 'started');
  try {
    await commit();
  } catch (error) {
    await report('repository_commit_failed', 'failure', error instanceof Error ? error.name : 'UnknownError');
    try {
      await rollback();
    } catch (rollbackError) {
      await report('rollback-record', 'failure', rollbackError instanceof Error ? rollbackError.name : 'UnknownError');
    }
    throw error;
  }
  await report('repository_commit_succeeded', 'success');
  await report('save_success', 'success');
}
