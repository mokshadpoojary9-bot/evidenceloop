import { describe, expect, it } from 'vitest';
import { validateProposals } from './sopDraft.js';

const SOP = `Emergency light replacement procedure
1. Isolate the supply before removing the old unit.
2. The replacement unit must be model EL-200.
3. Press the test button; the lamp shall illuminate for 30 seconds.`;

const proposal = (overrides: Record<string, unknown> = {}) => ({
  title: 'Correct model installed',
  description: 'Model EL-200',
  mandatory: true,
  evidenceNeeds: [{ kind: 'after_photo', instruction: 'Photograph the model label.' }],
  sourceQuote: 'The replacement unit must be model EL-200.',
  ...overrides,
});

describe('validateProposals (SOP → requirements guard)', () => {
  it('keeps proposals whose quote is in the SOP, ignoring case, whitespace and curly quotes', () => {
    const { proposals, dropped } = validateProposals(
      [proposal({ sourceQuote: '  the REPLACEMENT unit\nmust be model EL-200 ' })],
      SOP,
    );
    expect(dropped).toBe(0);
    expect(proposals).toHaveLength(1);
  });

  it('drops proposals the SOP does not state (invented quote)', () => {
    const { proposals, dropped } = validateProposals(
      [proposal(), proposal({ title: 'Torque to 5 Nm', sourceQuote: 'Tighten the bracket to 5 Nm.' })],
      SOP,
    );
    expect(proposals.map((p) => p.title)).toEqual(['Correct model installed']);
    expect(dropped).toBe(1);
  });

  it('accepts quotes elided with "..." only when every fragment is verbatim', () => {
    const ok = validateProposals([proposal({ sourceQuote: 'Press the test button; ... 30 seconds.' })], SOP);
    expect(ok.proposals).toHaveLength(1);
    const bad = validateProposals([proposal({ sourceQuote: 'Press the test button ... 60 seconds.' })], SOP);
    expect(bad.proposals).toHaveLength(0);
  });

  it('drops malformed proposals and duplicates, and de-duplicates evidence kinds', () => {
    const { proposals, dropped } = validateProposals(
      [
        proposal({
          evidenceNeeds: [
            { kind: 'after_photo', instruction: 'a' },
            { kind: 'after_photo', instruction: 'b' },
            { kind: 'hologram', instruction: 'c' },
          ],
        }),
        proposal({ title: 'correct MODEL installed' }),
        proposal({ title: '' }),
        proposal({ sourceQuote: undefined }),
        'not an object',
      ],
      SOP,
    );
    expect(proposals).toHaveLength(1);
    // An invalid kind invalidates the list; it is replaced by an empty one rather than guessed.
    expect(proposals[0]!.evidenceNeeds).toEqual([]);
    expect(dropped).toBe(4);
  });

  it('returns nothing for a non-array answer', () => {
    expect(validateProposals(null, SOP)).toEqual({ proposals: [], dropped: 0 });
  });
});
