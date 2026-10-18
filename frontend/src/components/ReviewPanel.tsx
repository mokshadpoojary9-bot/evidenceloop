import { Gavel, LoaderCircle, Send, UserCheck, UserSearch } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import {
  EVIDENCE_KINDS,
  EVIDENCE_KIND_LABELS,
  type EvidenceKind,
  type Review,
  type ReviewDecision,
  type WorkOrderDetail,
} from '../types';
import { formatDate } from './labels';
import { Button, Input, Select, Textarea, useToast } from './ui';

/** Toast after a reviewer's decision. Approval is a human decision, never "verified". */
const DECIDED: Record<ReviewDecision, string> = {
  approve: 'Approved by you (a human decision, not AI verification)',
  reject: 'Work order rejected',
  request_evidence: 'Evidence requested from the technician',
};

interface Props {
  detail: WorkOrderDetail;
  onChanged: () => void;
}

const DECISION_LABEL: Record<ReviewDecision, string> = {
  approve: 'Approve',
  reject: 'Reject',
  request_evidence: 'Request more evidence',
};

const OUTCOME: Record<Review['status'], string> = {
  PENDING: 'Waiting for a reviewer',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EVIDENCE_REQUESTED: 'More evidence requested',
};

/** Human sign-off for work orders the evidence could not settle. */
export function ReviewPanel({ detail, onChanged }: Props) {
  const { workOrder, reviews, permissions } = detail;
  const pending = reviews.find((review) => review.status === 'PENDING');
  const history = reviews.filter((review) => review.status !== 'PENDING').reverse();

  if (!pending && !permissions.submitForReview && history.length === 0) return null;

  return (
    <section aria-labelledby="review-heading" className="rounded-2xl border border-review/40 bg-review/[0.06] p-4">
      <h2 id="review-heading" className="flex items-center gap-2 font-semibold text-review-fg">
        <UserSearch className="size-5" aria-hidden /> Reviewer sign-off
      </h2>

      {pending ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-fg-muted">
            Submitted for review {formatDate(pending.submittedAt)} while{' '}
            <strong>{pending.statusAtSubmission === 'CONTRADICTED' ? 'contradicted' : 'uncertain'}</strong>.
            {pending.submissionNote && <span className="text-fg-subtle"> Technician’s note: “{pending.submissionNote}”</span>}
          </p>
          {permissions.review ? (
            <DecisionForm workOrderId={workOrder.id} onDone={onChanged} />
          ) : (
            <p className="text-xs text-fg-subtle">{permissions.reasons.review}</p>
          )}
        </div>
      ) : (
        permissions.submitForReview && <SubmitForm workOrderId={workOrder.id} onDone={onChanged} />
      )}

      {history.length > 0 && (
        <ol className="mt-4 space-y-2 border-t border-review/20 pt-3">
          {history.map((review) => (
            <li key={review.id} className="text-sm">
              <p className="flex flex-wrap items-center gap-x-2 text-fg">
                <UserCheck className="size-4 text-review-fg" aria-hidden />
                <strong>{OUTCOME[review.status]}</strong>
                <span className="text-xs text-fg-faint">{review.decidedAt && formatDate(review.decidedAt)}</span>
              </p>
              {review.decisionNote && <p className="mt-0.5 pl-6 text-fg-subtle">“{review.decisionNote}”</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function SubmitForm({ workOrderId, onDone }: { workOrderId: string; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.submitForReview(workOrderId, note);
      toast.success('Submitted for review');
      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not submit for review';
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <p className="text-sm text-fg-muted">
        The evidence could not settle this work order. A reviewer can approve it with a note, reject it, or ask for
        more evidence. Uploads pause while it is with them.
      </p>
      <Textarea
        className="text-sm"
        rows={2}
        value={note}
        maxLength={2000}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Note for the reviewer (optional)"
        aria-label="Note for the reviewer"
      />
      {error && <p role="alert" className="text-sm text-contradicted-fg">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
        Submit for review
      </Button>
    </form>
  );
}

function DecisionForm({ workOrderId, onDone }: { workOrderId: string; onDone: () => void }) {
  const [decision, setDecision] = useState<ReviewDecision>('approve');
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<EvidenceKind>('video');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.decideReview(workOrderId, {
        decision,
        note,
        ...(decision === 'request_evidence' ? { request: { kind, instruction } } : {}),
      });
      toast.success(DECIDED[decision]);
      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not record the decision';
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface p-3">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="eyebrow mb-1.5">Your decision</legend>
        {(Object.keys(DECISION_LABEL) as ReviewDecision[]).map((value) => (
          <label
            key={value}
            className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-semibold ${
              decision === value ? 'border-review bg-review/15 text-review-fg' : 'border-line text-fg-muted'
            }`}
          >
            <input
              type="radio"
              name="decision"
              value={value}
              checked={decision === value}
              onChange={() => setDecision(value)}
              className="sr-only"
            />
            {DECISION_LABEL[value]}
          </label>
        ))}
      </fieldset>

      {decision === 'approve' && (
        <p className="text-xs text-uncertain-fg/90">
          Approval is your decision, not AI verification: the requirements that were not proven stay unproven, and the
          work order is shown as “Approved by reviewer”, never as verified.
        </p>
      )}

      {decision === 'request_evidence' && (
        <div className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold text-fg-subtle">Evidence type</span>
            <Select value={kind} onChange={(event) => setKind(event.target.value as EvidenceKind)}>
              {EVIDENCE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {EVIDENCE_KIND_LABELS[value]}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold text-fg-subtle">Exactly what is needed</span>
            <Input
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              minLength={5}
              maxLength={500}
              required
              placeholder="Upload a close-up of the lit charge indicator."
            />
          </label>
        </div>
      )}

      <label className="block text-sm">
        <span className="mb-1 block text-xs font-semibold text-fg-subtle">Note (required, recorded in the audit trail)</span>
        <Textarea
          rows={2}
          value={note}
          minLength={3}
          maxLength={2000}
          required
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      {error && <p role="alert" className="text-sm text-contradicted-fg">{error}</p>}
      <button type="submit" className={`btn ${decision === 'reject' ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Gavel className="size-4" aria-hidden />}
        {DECISION_LABEL[decision]}
      </button>
    </form>
  );
}
