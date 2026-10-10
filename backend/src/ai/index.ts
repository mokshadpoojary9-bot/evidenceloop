import { aiMode, env } from '../config/env.js';
import type { FileStore } from '../stores/fileStore.js';
import type { SystemStatus } from '../types.js';
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
        message: 'NVIDIA Nemotron via Nebius Token Factory is configured.',
      };
    case 'dev-fixture':
      return {
        mode: 'dev-fixture',
        production: false,
        provider: 'dev-fixture',
        model: null,
        message:
          'DEV ONLY: production AI is not configured. A deterministic fixture is standing in — its results are simulated and are not AI inference.',
      };
    case 'unconfigured':
      return {
        mode: 'unconfigured',
        production: false,
        provider: 'none',
        model: null,
        message:
          'Production AI is not configured. Verification is disabled until NEBIUS_API_KEY and NEBIUS_MODEL are set (Nebius Token Factory + NVIDIA Nemotron).',
      };
  }
}
