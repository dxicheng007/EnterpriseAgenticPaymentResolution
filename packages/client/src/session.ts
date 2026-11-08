import {
  LocalSessionResponseSchema, type LocalSessionResponse,
} from '../../contracts/src/local-demo.js';
import { jsonPost, onSessionExpiration, requestLocal, setCsrfToken } from './http.js';

export type LocalSession = Omit<LocalSessionResponse, 'csrfToken'>;

let sessionPromise: Promise<LocalSession> | undefined;
onSessionExpiration(() => { sessionPromise = undefined; });

export function getLocalSession(): Promise<LocalSession> {
  sessionPromise ??= requestLocal('/api/local-session', LocalSessionResponseSchema, {
    ...jsonPost({}), headers: { 'Content-Type': 'application/json', 'X-EAPR-Local-UI': '1' },
  }).then(({ csrfToken, ...session }) => {
    setCsrfToken(csrfToken);
    return session;
  }, failure => {
    sessionPromise = undefined;
    throw failure;
  });
  return sessionPromise;
}
