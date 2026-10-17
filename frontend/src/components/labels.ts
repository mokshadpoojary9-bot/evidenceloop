import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  FileText,
  Film,
  Image,
  LoaderCircle,
  Mic,
  OctagonAlert,
  ShieldCheck,
  Upload,
  UserCheck,
  UserSearch,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import type { EvidenceKind, RequirementStatus, WorkOrderStatus } from '../types';

export interface StatusMeta {
  label: string;
  icon: LucideIcon;
  /** Tailwind classes for a tinted chip. */
  chip: string;
  /** Colour used by the 3D loop. */
  hex: string;
  spin?: boolean;
}

const tones = {
  emerald: { chip: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300', hex: '#34d399' },
  slate: { chip: 'border-slate-500/40 bg-slate-500/10 text-slate-300', hex: '#7c8aa3' },
  amber: { chip: 'border-amber-400/30 bg-amber-400/10 text-amber-300', hex: '#fbbf24' },
  rose: { chip: 'border-rose-400/40 bg-rose-400/10 text-rose-300', hex: '#fb7185' },
  sky: { chip: 'border-sky-400/30 bg-sky-400/10 text-sky-300', hex: '#38bdf8' },
  violet: { chip: 'border-violet-400/40 bg-violet-400/10 text-violet-200', hex: '#a78bfa' },
};

export const REQUIREMENT_STATUS: Record<RequirementStatus, StatusMeta> = {
  PROVEN: { label: 'Proven', icon: CircleCheck, ...tones.emerald },
  NOT_PROVEN: { label: 'Not proven', icon: CircleDashed, ...tones.slate },
  UNCERTAIN: { label: 'Uncertain', icon: CircleHelp, ...tones.amber },
  CONTRADICTED: { label: 'Contradicted', icon: OctagonAlert, ...tones.rose },
  ANALYZING: { label: 'Analyzing', icon: LoaderCircle, spin: true, ...tones.sky },
};

export const WORK_ORDER_STATUS: Record<WorkOrderStatus, StatusMeta & { explanation: string }> = {
  AWAITING_EVIDENCE: {
    label: 'Awaiting evidence',
    icon: Upload,
    ...tones.slate,
    explanation: 'No verification has run yet. Nothing is proven until evidence says so.',
  },
  ANALYZING: {
    label: 'Analyzing',
    icon: LoaderCircle,
    spin: true,
    ...tones.sky,
    explanation: 'The agent is checking the evidence against the requirements.',
  },
  NEEDS_EVIDENCE: {
    label: 'Not verified — evidence needed',
    icon: CircleHelp,
    ...tones.amber,
    explanation: 'At least one mandatory requirement cannot be verified from the available evidence.',
  },
  CONTRADICTED: {
    label: 'Contradicted — review required',
    icon: OctagonAlert,
    ...tones.rose,
    explanation: 'Evidence conflicts with at least one requirement. A person needs to review it.',
  },
  VERIFIED: {
    label: 'Verified',
    icon: ShieldCheck,
    ...tones.emerald,
    explanation:
      'Every mandatory requirement is supported by the evidence on file. This is not a safety certification.',
  },
  IN_REVIEW: {
    label: 'In review',
    icon: UserSearch,
    ...tones.violet,
    explanation: 'A reviewer is deciding. Evidence and requirements are frozen until they do.',
  },
  APPROVED: {
    label: 'Approved by reviewer',
    icon: UserCheck,
    ...tones.violet,
    explanation:
      'A reviewer approved this work order although the evidence did not prove every requirement. This is a human decision, not AI verification.',
  },
  REJECTED: {
    label: 'Rejected by reviewer',
    icon: UserX,
    ...tones.rose,
    explanation: 'A reviewer rejected this work. See their note in the review history.',
  },
};

export const EVIDENCE_ICON: Record<EvidenceKind, LucideIcon> = {
  before_photo: Image,
  after_photo: Image,
  additional_photo: Image,
  video: Film,
  document: FileText,
  audio: Mic,
  transcript: FileText,
};

export const EVIDENCE_ACCEPT: Record<EvidenceKind, string> = {
  before_photo: 'image/*',
  after_photo: 'image/*',
  additional_photo: 'image/*',
  video: 'video/*',
  document: 'application/pdf,text/plain',
  audio: 'audio/*',
  transcript: 'text/plain',
};

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatSeconds(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
