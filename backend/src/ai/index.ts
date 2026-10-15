import { aiMode, env } from '../config/env.js';
import type { FileStore } from '../stores/fileStore.js';
import type { LiveAiStatus, SystemStatus } from '../types.js';
import { runLiveCheck } from './liveCheck.js';
import { DevFixtureProvider } from './devFixtureProvider.js';
import { NebiusNemotronProvider } from './nebiusProvider.js';
import type { AiProvider } from './provider.js';

/** Returns the configured provider, or null when AI inference is unavailable. */
export function createAiProvider(files: FileStore): AiProvider | null {
  switch (aiMode) {
    case 'nebius':
      return new NebiusNemotronProvider(
        { apiKey: env.NEBIUS_API_KEY!, baseUrl: env.NEBIUS_BASE_URL, model: env.NEBIUS_MODEL! },
        files,
      );
    case 'dev-fixture':
      return new DevFixtureProvider();
    case 'unconfigured':
      return null;
  }
}

export function describeAi(): SystemStatus['ai'] {
  switch (aiMode) {
    case 'nebius':
      return {
        mode: 'nebius',
        production: true,
        provider: 'nebius-nemotron',
        model: env.NEBIUS_MODEL!,
        message: 'NVIDIA Nemotron via Nebius Token Factory is configured but not yet verified by a live test.',
        live: { state: 'checking', vision: null, checkedAt: null, detail: null },
      };
    case 'dev-fixture':
      return {
        mode: 'dev-fixture',
        production: false,
        provider: 'dev-fixture',
        model: null,
        message:
          'DEV ONLY: production AI is not configured. A deterministic fixture is standing in — its results are simulated and are not AI inference.',
        live: NOT_CONFIGURED,
      };
    case 'unconfigured':
      return {
        mode: 'unconfigured',
        production: false,
        provider: 'none',
        model: null,
        message:
          'Production AI is not configured. Verification is disabled until NEBIUS_API_KEY and NEBIUS_MODEL are set (Nebius Token Factory + NVIDIA Nemotron).',
        live: NOT_CONFIGURED,
      };
  }
}

const NOT_CONFIGURED: LiveAiStatus = { state: 'not_configured', vision: null, checkedAt: null, detail: null };

/**
 * Runs the live connection test once (text + image request) and records the result
 * on the system status. Only a passing test makes the dashboard say "connected".
 */
export async function verifyLiveAi(ai: SystemStatus['ai']): Promise<void> {
  if (ai.mode !== 'nebius') return;
  const result = await runLiveCheck({
    apiKey: env.NEBIUS_API_KEY!,
    baseUrl: env.NEBIUS_BASE_URL,
    model: env.NEBIUS_MODEL!,
  });
  const vision = result.image?.ok ?? null;
  const connected = result.text.ok && vision === true;
  ai.live = {
    state: connected ? 'connected' : 'failed',
    vision,
    checkedAt: new Date().toISOString(),
    detail: connected
      ? null
      : !result.text.ok
        ? result.text.detail
        : `The model answered text but not the image request, so it is not vision-capable. Choose a vision Nemotron model (Nano VL / Omni). ${result.image?.detail ?? ''}`.trim(),
  };
  ai.message = connected
    ? `NVIDIA Nemotron via Nebius Token Factory — connected (live test passed, model ${ai.model}).`
    : `NVIDIA Nemotron via Nebius Token Factory is configured, but the live test failed: ${ai.live.detail}`;
}
