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
import type { Tone } from './ui/Badge';

export interface StatusMeta {
  label: string;
  icon: LucideIcon;
  /** Badge tone (shared with the UI kit). */
  tone: Tone;
  /** Colour used by the 3D loop. */
  hex: string;
  spin?: boolean;
}

// `tone` is the shared Badge tone; `hex` is the fill the 3D scenes use, which matches the
// status tokens in styles.css (the 3D stage is dark in both themes).
const tones = {
  emerald: { tone: 'proven', hex: '#34d399' },
  slate: { tone: 'not-proven', hex: '#7c8aa3' },
  amber: { tone: 'uncertain', hex: '#fbbf24' },
  rose: { tone: 'contradicted', hex: '#fb7185' },
  sky: { tone: 'analyzing', hex: '#38bdf8' },
  violet: { tone: 'review', hex: '#a78bfa' },
} as const;

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

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "just now", "5 min ago", "yesterday"; falls back to the date after a week. */
export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return RELATIVE.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return RELATIVE.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86_400) return RELATIVE.format(Math.round(seconds / 86_400), 'day');
  return formatDate(iso);
}
