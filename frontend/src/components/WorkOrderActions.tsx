import { Archive, ArchiveRestore, FileDown, LoaderCircle, Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import type { WorkOrder } from '../types';
import { ConfirmDialog, Dialog } from './Dialog';

interface Props {
  workOrder: WorkOrder;
  /** Owner-only actions (edit, archive, delete) are hidden for other viewers. */
  canManage: boolean;
  onChanged: () => void;
}

type Open = 'edit' | 'archive' | 'delete' | null;

export function WorkOrderActions({ workOrder, canManage, onChanged }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const archived = workOrder.archivedAt !== null;
  const analyzing = workOrder.status === 'ANALYZING';

  const close = () => {
    if (busy) return;
    setOpen(null);
    setError(null);
  };

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setOpen(null);
      if (after) after();
      else onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const exportReport = async () => {
    setExporting(true);
    setError(null);
    try {
      await api.downloadReport(workOrder.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5 sm:justify-end">
      <button className="btn px-2.5 py-1.5 text-xs" onClick={() => void exportReport()} disabled={exporting}>
        {exporting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <FileDown className="size-3.5" aria-hidden />}
        Export PDF
      </button>
      {canManage && (
        <>
          <button className="btn px-2.5 py-1.5 text-xs" onClick={() => setOpen('edit')} disabled={archived}>
            <Pencil className="size-3.5" aria-hidden /> Edit
          </button>
          {archived ? (
            <button className="btn px-2.5 py-1.5 text-xs" onClick={() => void run(() => api.unarchive(workOrder.id))} disabled={busy}>
              <ArchiveRestore className="size-3.5" aria-hidden /> Unarchive
            </button>
          ) : (
            <button className="btn px-2.5 py-1.5 text-xs" onClick={() => setOpen('archive')} disabled={analyzing}>
              <Archive className="size-3.5" aria-hidden /> Archive
            </button>
          )}
          <button className="btn btn-danger px-2.5 py-1.5 text-xs" onClick={() => setOpen('delete')} disabled={analyzing}>
            <Trash2 className="size-3.5" aria-hidden /> Delete
          </button>
        </>
      )}
      {error && open === null && <p className="w-full text-xs text-rose-300 sm:text-right">{error}</p>}

      <EditDialog
        open={open === 'edit'}
        workOrder={workOrder}
        busy={busy}
        error={error}
        onCancel={close}
        onSave={(patch) => void run(() => api.editWorkOrder(workOrder.id, patch))}
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
        onConfirm={() => void run(() => api.archive(workOrder.id))}
      />

      <ConfirmDialog
        open={open === 'delete'}
        title="Delete this work order permanently?"
        message={
          <>
            <p>
              <strong className="text-white">“{workOrder.title}”</strong> will be deleted with all of its requirements,
              evidence files, decisions and its audit trail. This cannot be undone.
            </p>
            <p className="text-slate-400">To keep the record but take it out of use, archive it instead.</p>
          </>
        }
        confirmLabel="Delete permanently"
        danger
        busy={busy}
        error={error}
        onCancel={close}
        onConfirm={() => void run(() => api.deleteWorkOrder(workOrder.id), () => navigate('/work-orders'))}
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
    <Dialog open={open} title="Edit work order" onClose={onCancel}>
      {/* Keyed so the fields reset to the saved values each time the dialog opens. */}
      {open && <EditForm key={workOrder.updatedAt} workOrder={workOrder} busy={busy} error={error} onCancel={onCancel} onSave={onSave} />}
    </Dialog>
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
      <label className="block text-sm">
        <span className="mb-1 block font-semibold">Title</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold">Location</span>
        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold">Description</span>
        <textarea className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
      </label>
      <p className="text-xs text-slate-400">Changes are recorded in the audit trail. Requirements are not changed here.</p>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />} Save
        </button>
      </div>
    </form>
  );
}
