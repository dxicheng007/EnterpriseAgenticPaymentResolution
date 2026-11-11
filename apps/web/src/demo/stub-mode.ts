/** Opt-in offline Company A responses when the local reviewer session cannot open. */

const storageKey = 'eapr-demo-stub';
const listeners = new Set<() => void>();

function readUrlFlag(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash;
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : window.location.search.slice(1);
  return new URLSearchParams(query).get('stub') === '1';
}

function readStorage(): boolean | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === '1') return true;
    if (value === '0') return false;
  } catch {
    return undefined;
  }
  return undefined;
}

function envEnabled(): boolean {
  try {
    return import.meta.env.VITE_EAPR_DEMO_STUB === '1';
  } catch {
    return false;
  }
}

export function isDemoStubEnabled(): boolean {
  const stored = readStorage();
  if (stored !== undefined) return stored;
  return envEnabled() || readUrlFlag();
}

export function setDemoStubEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, enabled ? '1' : '0');
  } catch {
    // Ignore quota / private-mode failures; in-memory listeners still update this tab.
  }
  for (const listener of listeners) listener();
}

export function onDemoStubChange(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function stageDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      window.clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    }
    if (signal?.aborted) {
      window.clearTimeout(timer);
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
