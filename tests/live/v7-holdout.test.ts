import { expect, it } from 'vitest';
import {
  liveConfigurationStatus,
  requireLiveProviderConfiguration,
} from '../../scripts/live-build.js';

/**
 * V7 live holdout gate proof: missing provider config fails closed (no skip/pass).
 * Successful holdouts and joint G7 remain out of band. Configuration stays in
 * scripts/live-build — do not mount product env inside packages/discovery.
 */
it('fails closed when live provider configuration is missing', () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const status = liveConfigurationStatus();
    expect(status.ok).toBe(false);
    if (status.ok) throw new Error('expected unavailable live configuration');
    expect(status.code).toBe('LIVE_CONFIGURATION_UNAVAILABLE');
    expect(status.message).toContain('OPENAI_API_KEY');
    expect(() => requireLiveProviderConfiguration()).toThrow(/LIVE_CONFIGURATION_UNAVAILABLE/);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
