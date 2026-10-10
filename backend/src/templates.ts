import type { EvidenceNeed, WorkOrderTemplate } from './types.js';

// Requirement library. "Retrieve requirements" in the agent loop reads from here.
// Later stages can move this to the database or derive it from an uploaded SOP.

// One instruction per kind of evidence, shared by every requirement that needs it,
// so a single upload can be requested once and settle several requirements.
const BEFORE_PHOTO: EvidenceNeed = {
  kind: 'before_photo',
  instruction:
    'Upload a before photo showing the original unit and enough of the room to identify Room 204.',
};
const AFTER_PHOTO: EvidenceNeed = {
  kind: 'after_photo',
  instruction:
    'Upload an after photo of the installed unit, taken from the same position as the before photo, with the model label and status indicator visible.',
};
const CLOSE_UP: EvidenceNeed = {
  kind: 'additional_photo',
  instruction:
    'Upload a close-up photo of the mounting points and wiring entry of the installed unit.',
};
const MANUAL: EvidenceNeed = {
  kind: 'document',
  instruction: 'Upload the SOP or manual page that specifies the required unit model.',
};
const FUNCTIONAL_TEST_VIDEO: EvidenceNeed = {
  kind: 'video',
  instruction: 'Upload a 5–10 second video showing the emergency light functional test.',
};

export const TEMPLATES: WorkOrderTemplate[] = [
  {
    id: 'emergency-light-replacement',
    name: 'Emergency light replacement',
    title: 'Replace emergency light in Room 204',
    description:
      'Remove the failed emergency light unit and install the specified replacement. Confirm it is mounted, connected, and passes its functional test.',
    location: 'Room 204',
    requirements: [
      {
        title: 'Correct emergency light installed',
        description: 'The installed unit is the model specified for this work order in the SOP/manual.',
        mandatory: true,
        evidenceNeeds: [AFTER_PHOTO, MANUAL],
      },
      {
        title: 'Correct location',
        description: 'The unit is installed in Room 204, at the position of the unit it replaces.',
        mandatory: true,
        evidenceNeeds: [BEFORE_PHOTO, AFTER_PHOTO],
      },
      {
        title: 'Unit securely mounted',
        description: 'The unit sits flush on its mounting surface with all fixings in place.',
        mandatory: true,
        evidenceNeeds: [AFTER_PHOTO, CLOSE_UP],
      },
      {
        title: 'Electrical connection completed',
        description: 'The unit is wired to the supply and the connection is terminated and enclosed.',
        mandatory: true,
        evidenceNeeds: [CLOSE_UP],
      },
      {
        title: 'Indicator functioning',
        description: 'The charge/status indicator on the unit is lit after installation.',
        mandatory: true,
        evidenceNeeds: [AFTER_PHOTO, FUNCTIONAL_TEST_VIDEO],
      },
      {
        title: 'Functional test completed',
        description: 'The test button or a simulated supply failure makes the unit illuminate on battery.',
        mandatory: true,
        evidenceNeeds: [FUNCTIONAL_TEST_VIDEO],
      },
    ],
  },
];
