import { describe, expect, it } from 'vitest';
import { parseModelJson } from './modelJson.js';

const answer = { assessments: [{ requirementId: 'r1', status: 'PROVEN' }] };
const json = JSON.stringify(answer);

describe('parseModelJson', () => {
  it('parses a bare JSON object', () => {
    expect(parseModelJson(json)).toEqual(answer);
  });

  it('parses JSON inside a ```json code fence', () => {
    expect(parseModelJson(`Here is my answer:\n\`\`\`json\n${json}\n\`\`\`\nHope that helps.`)).toEqual(answer);
  });

  it('parses JSON inside an unlabelled fence', () => {
    expect(parseModelJson(`\`\`\`\n${json}\n\`\`\``)).toEqual(answer);
  });

  it('ignores a <think> reasoning block, even one containing braces', () => {
    const text = `<think>The photo shows {a bracket}. Maybe {"status":"PROVEN"}?</think>\n${json}`;
    expect(parseModelJson(text)).toEqual(answer);
  });

  it('handles an unterminated opening of reasoning (only a closing tag)', () => {
    expect(parseModelJson(`thinking about {stuff}...</think>${json}`)).toEqual(answer);
  });

  it('finds the answer after free-form reasoning prose', () => {
    expect(parseModelJson(`Let me check each requirement {carefully}. Final answer: ${json} Done.`)).toEqual(answer);
  });

  it('respects braces inside strings', () => {
    const tricky = { assessments: [{ reasoning: 'label reads "}{" oddly' }] };
    expect(parseModelJson(`x ${JSON.stringify(tricky)} y`)).toEqual(tricky);
  });

  it('returns null for truncated or missing JSON instead of guessing', () => {
    expect(parseModelJson(json.slice(0, -5))).toBeNull();
    expect(parseModelJson('I cannot answer.')).toBeNull();
    expect(parseModelJson('[1, 2, 3]')).toBeNull();
  });
});
