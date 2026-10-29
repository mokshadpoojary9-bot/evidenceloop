import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { assessment, detail, system } from '../test/fixtures';
import { CANNOT_VERIFY, type AnalysisRun, type AuditEvent, type EvidenceRequest } from '../types';
import { AuditTrail, groupAudit } from './AuditTrail';
import { EvidenceRequests } from './EvidenceRequests';
import { EvidenceViewer } from './EvidenceViewer';
import { RequirementCard } from './RequirementCard';
import { Provenance, Score } from './WorkOrderDetail';

const apiMock = vi.hoisted(() => ({ uploadEvidence: vi.fn() }));
vi.mock('../api', () => ({ api: apiMock, fileUrl: (url: string | null) => url }));
vi.mock('../viewer', () => ({ useViewer: () => ({ viewer: null, switchDemoRole: () => {} }) }));

const T = '2026-10-01T10:00:00.000Z';
const VIDEO_REQUEST = 'Upload a 5–10 second video showing the emergency light functional test.';

const run = (overrides: Partial<AnalysisRun> = {}): AnalysisRun => ({
  id: 'run-1',
  workOrderId: 'wo-1',
  trigger: 'manual',
  triggerEvidenceId: null,
  requirementIds: ['req-1'],
  provider: 'nebius-nemotron',
  model: 'nvidia/test',
  simulated: false,
  status: 'COMPLETED',
  error: null,
  startedAt: T,
  completedAt: T,
  ...overrides,
});

describe('RequirementCard', () => {
  const unproven = {
    ...detail().requirements[0]!,
    status: 'NOT_PROVEN' as const,
    assessment: assessment({
      status: 'NOT_PROVEN',
      reasoning: `${CANNOT_VERIFY} No frame shows the indicator lit.`,
      confidence: null,
      observations: [{ evidenceId: 'ev-video', kind: 'inferred', text: 'The unit appears powered.', startSec: 12, endSec: null }],
      missingEvidence: [{ kind: 'video', instruction: VIDEO_REQUEST }],
    }),
  };

  it('says exactly that it cannot verify, what is missing, and that no confidence was given', () => {
    render(<ul><RequirementCard requirement={unproven} evidence={detail().evidence} onOpenEvidence={() => {}} /></ul>);
    expect(screen.getByText(CANNOT_VERIFY)).toBeTruthy();
    expect(screen.getByText(VIDEO_REQUEST)).toBeTruthy();
    expect(screen.getByText('Confidence not given')).toBeTruthy();
    expect(screen.getByText('Mandatory')).toBeTruthy();
  });

  it('expands into the chain, and a video observation jumps to its timestamp', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<ul><RequirementCard requirement={unproven} evidence={detail().evidence} onOpenEvidence={onOpen} /></ul>);
    await user.click(screen.getByRole('button', { expanded: false }));
    for (const step of ['Requirement', 'Evidence', 'Observation', 'Reasoning', 'Decision']) {
      expect(screen.getByRole('heading', { name: step })).toBeTruthy();
    }
    expect(screen.getByText('inferred')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Play from 0:12' }));
    expect(onOpen).toHaveBeenCalledWith({ evidenceId: 'ev-video', atSec: 12 });
  });
});

describe('EvidenceRequests', () => {
  const open: EvidenceRequest = {
    id: 'rq-1',
    workOrderId: 'wo-1',
    runId: 'run-1',
    requestedBy: 'agent',
    requirementIds: ['req-1'],
    kind: 'video',
    instruction: VIDEO_REQUEST,
    status: 'OPEN',
    fulfilledByEvidenceId: null,
    createdAt: T,
    updatedAt: T,
  };
  const props = {
    workOrderId: 'wo-1',
    requests: [open],
    requirements: detail().requirements,
    maxUploadMb: 50,
    canUpload: true,
    readOnlyReason: null,
    onUploaded: () => {},
    onSelectRequirement: () => {},
  };

  it('shows the request and what it affects, and uploads right there, with a retry after a failure', async () => {
    apiMock.uploadEvidence.mockReset().mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce({ reanalysis: 'started' });
    const onUploaded = vi.fn();
    const user = userEvent.setup();
    render(<EvidenceRequests {...props} onUploaded={onUploaded} />);
    expect(screen.getByText(VIDEO_REQUEST)).toBeTruthy();
    expect(screen.getByRole('button', { name: '#1 Functional test completed' })).toBeTruthy();

    const file = new File(['x'], 'test.mp4', { type: 'video/mp4' });
    await user.upload(screen.getByLabelText(`File for: ${VIDEO_REQUEST}`), file);
    expect(apiMock.uploadEvidence).toHaveBeenCalledWith(
      'wo-1',
      { file, kind: 'video', note: '', requestId: 'rq-1', capture: null },
      expect.any(Function),
    );
    expect(await screen.findByText(/Upload of test.mp4 failed: Network down/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(apiMock.uploadEvidence).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/Re-analysing the affected requirements/)).toBeTruthy();
    expect(onUploaded).toHaveBeenCalledOnce();
  });

  it('refuses a file of the wrong kind before uploading', async () => {
    apiMock.uploadEvidence.mockReset();
    const user = userEvent.setup({ applyAccept: false });
    render(<EvidenceRequests {...props} />);
    await user.upload(screen.getByLabelText(`File for: ${VIDEO_REQUEST}`), new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    expect(screen.getByRole('alert').textContent).toMatch(/must be video/);
    expect(apiMock.uploadEvidence).not.toHaveBeenCalled();
  });
});

describe('AuditTrail', () => {
  const event = (id: string, type: string, runId: string | null): AuditEvent => ({
    id,
    workOrderId: 'wo-1',
    runId,
    actor: runId ? 'agent' : 'user:tech',
    type,
    summary: `${type} summary`,
    data: { actorRole: 'technician' },
    createdAt: T,
  });
  const events = [
    event('e1', 'EVIDENCE_UPLOADED', null),
    event('e2', 'ANALYSIS_STARTED', 'run-1'),
    event('e3', 'REQUIREMENT_ASSESSED', 'run-1'),
    event('e4', 'ANALYSIS_COMPLETED', 'run-1'),
  ];

  it('groups events by verification run, newest first', () => {
    const blocks = groupAudit(events, [run()]);
    expect(blocks.map((b) => (b.kind === 'run' ? `run:${b.events.map((e) => e.id).join(',')}` : b.event.id))).toEqual([
      'run:e4,e3,e2',
      'e1',
    ]);
  });

  it('filters by event type', async () => {
    const user = userEvent.setup();
    render(<AuditTrail events={events} runs={[run()]} />);
    expect(screen.getByText('Verification run 1')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Evidence/ }));
    expect(screen.getByText('EVIDENCE_UPLOADED summary')).toBeTruthy();
    expect(screen.queryByText('ANALYSIS_STARTED summary')).toBeNull();
    expect(screen.queryByText('Verification run 1')).toBeNull();
  });
});

describe('work order header', () => {
  it('names Nemotron only for a real Nemotron run, and calls fixture runs simulated', () => {
    const { rerender } = render(<Provenance run={run()} system={system()} />);
    expect(screen.getByText('Verified by NVIDIA Nemotron via Nebius')).toBeTruthy();
    rerender(<Provenance run={run({ provider: 'dev-fixture', simulated: true })} system={system()} />);
    expect(screen.getByText('Simulated · dev fixture')).toBeTruthy();
    expect(screen.queryByText(/Verified by NVIDIA/)).toBeNull();
  });

  it('scores proven requirements out of all of them', () => {
    const base = detail().requirements[0]!;
    const requirements = (['PROVEN', 'PROVEN', 'NOT_PROVEN'] as const).map((status, i) => ({ ...base, id: `r${i}`, status }));
    render(<Score requirements={requirements} />);
    expect(screen.getByText('2 / 3')).toBeTruthy();
  });
});

describe('EvidenceViewer media', () => {
  const only = (overrides: Partial<ReturnType<typeof detail>['evidence'][number]>) =>
    detail({ evidence: [{ ...detail().evidence[0]!, ...overrides }] });

  it('labels a scanned PDF as not inspected and offers page navigation', async () => {
    const pdf = only({ id: 'ev-pdf', kind: 'document', fileName: 'scan.pdf', mimeType: 'application/pdf', pdf: { pages: 3, textLayer: false } });
    const user = userEvent.setup();
    render(<EvidenceViewer detail={pdf} aiMode="nebius" target={{ evidenceId: 'ev-pdf' }} onNavigate={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/no text layer \(likely a scan\)/)).toBeTruthy();
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Next page/ }));
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
    expect(screen.getByTitle('scan.pdf, page 2').getAttribute('src')).toContain('#page=2');
  });

  it('labels audio as not inspected', () => {
    const audio = only({ id: 'ev-audio', kind: 'audio', fileName: 'call.mp3', mimeType: 'audio/mpeg' });
    render(<EvidenceViewer detail={audio} aiMode="nebius" target={{ evidenceId: 'ev-audio' }} onNavigate={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/audio is not transcribed/)).toBeTruthy();
  });

  it('zooms an image with the buttons and resets from the keyboard', async () => {
    const image = only({ id: 'ev-img', kind: 'after_photo', fileName: 'after.jpg', mimeType: 'image/jpeg' });
    const user = userEvent.setup();
    render(<EvidenceViewer detail={image} aiMode="nebius" target={{ evidenceId: 'ev-img' }} onNavigate={() => {}} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeTruthy();
    screen.getByRole('group', { name: /Zoom 125%/ }).focus();
    await user.keyboard('0');
    expect(screen.getByText('100%')).toBeTruthy();
  });
});
