import { IconCheck, IconGitCommit } from '@tabler/icons-react';
import type { FileDiff } from '../store/useRepoStore';

const SIGIL: Record<FileDiff['action'], string> = {
  add: '+',
  remove: '−',
  update: '~',
};

export interface DiffCardProps {
  diffs: FileDiff[];
  applied: boolean;
  onApply: () => void;
}

/**
 * A proposal is accepted as one unit. The copilot returns a batch, you read it
 * as a batch, and one button applies the batch — which also makes it one step
 * on the undo stack.
 */
export function DiffCard({ diffs, applied, onApply }: DiffCardProps) {
  if (diffs.length === 0) return null;

  return (
    <div className="diff-card">
      <div className="diff-card-header">
        <span className="diff-card-label">
          <IconGitCommit size={11} />
          PROPOSED
        </span>
        <span className="diff-card-count">
          {diffs.length} change{diffs.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="diff-card-body">
        {diffs.map((diff, i) => (
          <div key={`${diff.path}-${i}`} className="diff-line" data-action={diff.action}>
            <span className="diff-line-sigil">{SIGIL[diff.action]}</span>
            <span className="diff-line-path" title={diff.path}>
              {diff.path}
            </span>
          </div>
        ))}
      </div>

      <button type="button" className="diff-card-action" disabled={applied} onClick={onApply}>
        {applied ? (
          <>
            <IconCheck size={12} />
            APPLIED TO PLAN
          </>
        ) : (
          'APPLY TO PLAN'
        )}
      </button>
    </div>
  );
}
