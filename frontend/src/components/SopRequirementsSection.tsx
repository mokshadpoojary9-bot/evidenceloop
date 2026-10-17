import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import type { SystemStatus, WorkOrder } from '../types';
import { toRequirementInput } from './RequirementEditor';
import { SopDraftPanel } from './SopDraftPanel';

interface Props {
  workOrder: WorkOrder;
  system: SystemStatus | null;
  onSaved: () => void;
}

/** Detail-page entry point: draft extra requirements from an SOP and add the confirmed ones. */
export function SopRequirementsSection({ workOrder, system, onSaved }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <section className="card" aria-label="Requirements from an SOP">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Add requirements from an SOP or manual
        <ChevronDown className={`size-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-line p-4">
          <SopDraftPanel
            context={{ title: workOrder.title, description: workOrder.description, location: workOrder.location }}
            aiAvailable={system !== null && system.ai.mode !== 'unconfigured'}
            maxUploadMb={system?.maxUploadMb ?? null}
            confirmLabel={(count) => `Save ${count} requirement${count === 1 ? '' : 's'}`}
            onConfirm={async (items, source) => {
              await api.addRequirements(workOrder.id, { requirements: items.map(toRequirementInput), source });
              setOpen(false);
              onSaved();
            }}
          />
        </div>
      )}
    </section>
  );
}
