import PDFDocument from 'pdfkit';
import {
  DISCLAIMER,
  EVIDENCE_KIND_LABELS,
  REQUIREMENT_STATUS_LABELS,
  WORK_ORDER_STATUS_LABELS,
  type AuditEvent,
  type WorkOrderDetail,
} from '../types.js';

/**
 * Verification report for one work order: requirements, evidence, observations,
 * decisions and the full audit trail, with the disclaimer that EvidenceLoop does
 * not replace qualified inspectors. Simulated (DEV fixture) results are labelled.
 */

const MARGIN = 50;
const COLORS = { text: '#111827', muted: '#4b5563', rule: '#d1d5db', warn: '#9a3412', dev: '#86198f' };

// The built-in PDF fonts only cover WinAnsi; map the few symbols the app uses, drop the rest.
const SYMBOLS: Record<string, string> = { '→': '->', '←': '<-', '≤': '<=', '≥': '>=', '✓': 'v' };
export function pdfSafe(text: string): string {
  return text
    .replace(/[→←≤≥✓]/g, (c) => SYMBOLS[c] ?? '?')
    .replace(/[^\t\n\r\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/g, '?');
}

const formatDate = (iso: string) => new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const formatSec = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const actorLabel = (event: AuditEvent) =>
  event.actor === 'agent' ? 'Agent' : event.actor === 'system' ? 'System' : `User ${event.actor.slice(5, 13)}`;

export function renderWorkOrderReport(detail: WorkOrderDetail, generatedAt = new Date()): Promise<Buffer> {
  const { workOrder, requirements, evidence, requests, runs, audit } = detail;
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    bufferPages: true,
    info: { Title: pdfSafe(`EvidenceLoop report — ${workOrder.title}`), Creator: 'EvidenceLoop' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - MARGIN * 2;
  const text = (value: string, options: PDFKit.Mixins.TextOptions = {}) => doc.text(pdfSafe(value), options);
  const heading = (value: string) => {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor(COLORS.text);
    text(value);
    const y = doc.y + 2;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + width, y).strokeColor(COLORS.rule).lineWidth(0.5).stroke();
    doc.moveDown(0.5).font('Helvetica').fontSize(10);
  };
  const field = (label: string, value: string) => {
    doc.font('Helvetica-Bold').fillColor(COLORS.muted).fontSize(9);
    text(`${label}: `, { continued: true });
    doc.font('Helvetica').fillColor(COLORS.text);
    text(value);
  };
  const evidenceName = (id: string) => {
    const item = evidence.find((candidate) => candidate.id === id);
    return item ? `${EVIDENCE_KIND_LABELS[item.kind]} "${item.fileName}"` : 'unknown evidence';
  };
  const simulated = workOrder.simulated || runs.some((run) => run.simulated);

  // ---------- Header ----------
  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.text);
  text('EvidenceLoop verification report');
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
  text(`Generated ${formatDate(generatedAt.toISOString())}`);
  doc.moveDown(0.8);

  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.text);
  text(workOrder.title);
  doc.moveDown(0.3);
  if (workOrder.location) field('Location', workOrder.location);
  field('Status', WORK_ORDER_STATUS_LABELS[workOrder.status] + (simulated ? ' (SIMULATED — DEV fixture)' : ''));
  field('Created', formatDate(workOrder.createdAt));
  if (workOrder.archivedAt) field('Archived', formatDate(workOrder.archivedAt));
  const lastRun = runs.at(-1);
  field(
    'AI',
    lastRun
      ? lastRun.simulated
        ? 'DEV ONLY fixture — simulated, not AI inference'
        : `NVIDIA Nemotron via Nebius Token Factory (${lastRun.model ?? 'unknown model'})`
      : 'No verification run yet',
  );
  field('Work order id', workOrder.id);
  if (workOrder.description) {
    doc.moveDown(0.3).fontSize(10);
    text(workOrder.description);
  }

  doc.moveDown(0.8).font('Helvetica-Oblique').fontSize(9).fillColor(COLORS.warn);
  text(`${DISCLAIMER} This report does not replace qualified inspectors.`, { width });
  if (simulated) {
    doc.moveDown(0.4).font('Helvetica-Bold').fillColor(COLORS.dev);
    text(
      'DEV ONLY: results in this report were produced by a deterministic fixture. No AI model examined the evidence. ' +
        'Nothing here is a real verification.',
      { width },
    );
  }

  // ---------- Requirements ----------
  heading(`Requirements (${requirements.filter((r) => r.status === 'PROVEN').length} of ${requirements.length} proven)`);
  for (const requirement of requirements) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    const { assessment } = requirement;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text);
    text(
      `${requirement.position}. ${requirement.title} — ${REQUIREMENT_STATUS_LABELS[requirement.status]}` +
        (requirement.mandatory ? '' : ' (optional)') +
        (assessment?.simulated ? ' [simulated]' : ''),
    );
    doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.muted);
    if (requirement.description) text(requirement.description);
    doc.fillColor(COLORS.text);

    if (!assessment) {
      text('Not yet assessed. I cannot verify this requirement from the available evidence.');
    } else {
      if (assessment.observations.length === 0) text('Observations: none.');
      for (const observation of assessment.observations) {
        const time =
          observation.startSec !== null
            ? ` @ ${formatSec(observation.startSec)}${observation.endSec !== null ? `–${formatSec(observation.endSec)}` : ''}`
            : '';
        text(`• [${observation.kind}] ${observation.text} (${evidenceName(observation.evidenceId)}${time})`, {
          indent: 10,
        });
      }
      text(`Reasoning: ${assessment.reasoning}`);
      text(
        `Decision: ${REQUIREMENT_STATUS_LABELS[assessment.status]} · confidence ` +
          (assessment.confidence === null ? 'not reported' : `${Math.round(assessment.confidence * 100)}% (reported by the model)`) +
          ` · ${assessment.simulated ? 'DEV fixture (simulated)' : (assessment.model ?? assessment.provider)} · ${formatDate(assessment.createdAt)}`,
      );
      for (const note of assessment.policyNotes) {
        doc.fillColor(COLORS.warn);
        text(`Policy: ${note}`, { indent: 10 });
        doc.fillColor(COLORS.text);
      }
    }
    doc.moveDown(0.6);
  }

  // ---------- Evidence ----------
  heading(`Evidence (${evidence.length})`);
  if (evidence.length === 0) text('No evidence uploaded.');
  for (const item of evidence) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text);
    text(`${EVIDENCE_KIND_LABELS[item.kind]}: ${item.fileName}`);
    doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted);
    text(`${item.mimeType} · ${item.sizeBytes} bytes · uploaded ${formatDate(item.createdAt)}`);
    text(`SHA-256 ${item.sha256}`);
    if (item.note) text(`Uploader note (a claim, not proof): ${item.note}`);
    doc.moveDown(0.4);
  }

  // ---------- Evidence requests ----------
  if (requests.length > 0) {
    heading(`Evidence requests (${requests.length})`);
    doc.fontSize(9.5).fillColor(COLORS.text);
    for (const request of requests) {
      text(`• [${request.status}] ${request.instruction} (${EVIDENCE_KIND_LABELS[request.kind]})`);
    }
  }

  // ---------- Audit trail ----------
  heading(`Audit trail (${audit.length} events)`);
  for (const event of audit) {
    doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted);
    text(`${formatDate(event.createdAt)} · ${actorLabel(event)} · ${event.type}`);
    doc.fillColor(COLORS.text).fontSize(9);
    text(event.summary, { indent: 10 });
    doc.moveDown(0.2);
  }

  // ---------- Footer on every page ----------
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted);
    doc.text(
      pdfSafe(
        `EvidenceLoop · ${workOrder.title} · page ${index + 1} of ${range.count} · Assists verification; does not replace qualified inspectors.`,
      ),
      MARGIN,
      doc.page.height - 30,
      { width, align: 'center', lineBreak: false },
    );
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return done;
}
