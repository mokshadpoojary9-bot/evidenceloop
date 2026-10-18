import { Archive, ArchiveRestore, FileDown, LoaderCircle, Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import type { WorkOrder } from '../types';
import { Button, ConfirmDialog, Field, Input, Modal, Textarea, useToast } from './ui';

interface Props {
  workOrder: WorkOrder;
  /** Owner-only actions (edit, archive, delete) are hidden for other viewers. */
  canManage: boolean;
  onChanged: () => void;
}

type Open = 'edit' | 'archive' | 'delete' | null;

export function WorkOrderActions({ workOrder, canManage, onChanged }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const archived = workOrder.archivedAt !== null;
  const analyzing = workOrder.status === 'ANALYZING';
  const inReview = workOrder.status === 'IN_REVIEW';

  const close = () => {
    if (busy) return;
    setOpen(null);
    setError(null);
  };

  const run = async (action: () => Promise<unknown>, done: string, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setOpen(null);
      toast.success(done);
      if (after) after();
      else onChanged();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const exportReport = async () => {
    setExporting(true);
    setError(null);
    try {
      await api.downloadReport(workOrder.id);
      toast.success('Report exported as PDF');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed';
      setError(message);
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5 sm:justify-end">
      <Button size="sm" onClick={() => void exportReport()} disabled={exporting}>
        {exporting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <FileDown className="size-3.5" aria-hidden />}
        Export PDF
      </Button>
      {canManage && (
        <>
          <Button size="sm" onClick={() => setOpen('edit')} disabled={archived}>
            <Pencil className="size-3.5" aria-hidden /> Edit
          </Button>
          {archived ? (
            <Button size="sm" onClick={() => void run(() => api.unarchive(workOrder.id), 'Work order unarchived')} disabled={busy}>
              <ArchiveRestore className="size-3.5" aria-hidden /> Unarchive
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => setOpen('archive')}
              disabled={analyzing || inReview}
              title={inReview ? 'This work order is with a reviewer' : undefined}
            >
              <Archive className="size-3.5" aria-hidden /> Archive
            </Button>
          )}
          <Button variant="danger" size="sm" onClick={() => setOpen('delete')} disabled={analyzing}>
            <Trash2 className="size-3.5" aria-hidden /> Delete
          </Button>
        </>
      )}
      {error && open === null && <p className="w-full text-xs text-contradicted-fg sm:text-right">{error}</p>}

      <EditDialog
        open={open === 'edit'}
        workOrder={workOrder}
        busy={busy}
        error={error}
        onCancel={close}
        onSave={(patch) => void run(() => api.editWorkOrder(workOrder.id, patch), 'Work order updated')}
      />

      <ConfirmDialog
        open={open === 'archive'}
        title="Archive this work order?"
        message={
          <p>
            Archived work orders are read-only: no uploads, edits or verification runs until you unarchive them. The
            evidence and audit trail are kept.
          </p>
        }
        confirmLabel="Archive"
        busy={busy}
        error={error}
        onCancel={close}
        onConfirm={() => void run(() => api.archive(workOrder.id), 'Work order archived')}
      />

      <ConfirmDialog
        open={open === 'delete'}
        title="Delete this work order permanently?"
        message={
          <>
            <p>
              <strong className="text-fg">“{workOrder.title}”</strong> will be deleted with all of its requirements,
              evidence files, decisions and its audit trail. This cannot be undone.
            </p>
            <p className="text-fg-subtle">To keep the record but take it out of use, archive it instead.</p>
          </>
        }
        confirmLabel="Delete permanently"
        danger
        busy={busy}
        error={error}
        onCancel={close}
        onConfirm={() => void run(() => api.deleteWorkOrder(workOrder.id), 'Work order deleted', () => navigate('/work-orders'))}
      />
    </div>
  );
}

interface EditProps {
  open: boolean;
  workOrder: WorkOrder;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (patch: Pick<WorkOrder, 'title' | 'description' | 'location'>) => void;
}

function EditDialog({ open, workOrder, busy, error, onCancel, onSave }: EditProps) {
  return (
    <Modal open={open} title="Edit work order" onClose={onCancel}>
      {/* Keyed so the fields reset to the saved values each time the dialog opens. */}
      {open && <EditForm key={workOrder.updatedAt} workOrder={workOrder} busy={busy} error={error} onCancel={onCancel} onSave={onSave} />}
    </Modal>
  );
}

function EditForm({ workOrder, busy, error, onCancel, onSave }: Omit<EditProps, 'open'>) {
  const [title, setTitle] = useState(workOrder.title);
  const [location, setLocation] = useState(workOrder.location);
  const [description, setDescription] = useState(workOrder.description);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ title, location, description });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Title">
        {(field) => <Input {...field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />}
      </Field>
      <Field label="Location">
        {(field) => <Input {...field} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />}
      </Field>
      <Field label="Description">
        {(field) => (
          <Textarea {...field} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
        )}
      </Field>
      <p className="text-xs text-fg-subtle">Changes are recorded in the audit trail. Requirements are not changed here.</p>
      {error && <p role="alert" className="text-sm text-contradicted-fg">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />} Save
        </Button>
      </div>
    </form>
  );
}
