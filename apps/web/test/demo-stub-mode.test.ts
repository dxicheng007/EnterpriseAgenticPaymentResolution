import { afterEach, describe, expect, test, vi } from 'vitest';

describe('demo stub mode', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    try { window.localStorage.clear(); } catch { /* ignore */ }
  });

  test('defaults off without env, url, or storage', async () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: () => undefined },
      location: { hash: '#health', search: '' },
    });
    vi.stubEnv('VITE_EAPR_DEMO_STUB', '');
    const { isDemoStubEnabled } = await import('../src/demo/stub-mode.js');
    expect(isDemoStubEnabled()).toBe(false);
  });

  test('enables from localStorage and notifies listeners', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
      },
      location: { hash: '#review', search: '' },
    });
    const mod = await import('../src/demo/stub-mode.js');
    const seen: boolean[] = [];
    mod.onDemoStubChange(() => seen.push(mod.isDemoStubEnabled()));
    expect(mod.isDemoStubEnabled()).toBe(false);
    mod.setDemoStubEnabled(true);
    expect(mod.isDemoStubEnabled()).toBe(true);
    expect(seen).toEqual([true]);
    mod.setDemoStubEnabled(false);
    expect(mod.isDemoStubEnabled()).toBe(false);
    expect(seen).toEqual([true, false]);
  });
});
