import type { Id } from '@eapr/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { createAuthorityAdmissionClient } from './authority-admission-client.js';
import { createWorkerAuthorityPlugin } from './routes/authority.js';
import type { WorkerServices } from './server.js';
import { createSourceSemanticsClient } from './source-semantics-client.js';
import { authorityError } from './sync/current-authority-errors.js';

export function composeWorkerAuthority({ admissionOrigin, admissionToken, source }: {
  admissionOrigin?: string; admissionToken?: string;
  source?: { origin: string; token: string; sourceRefs: readonly Id[] };
}): FastifyPluginAsync<WorkerServices> {
  return async (app, { db, clock, serviceToken }) => {
    if (admissionToken === serviceToken || source?.token === serviceToken ||
        (source && source.token === admissionToken)) {
      throw new Error('Worker, admission and source capabilities must be distinct');
    }
    const admissions = admissionOrigin !== undefined && admissionToken !== undefined
      ? createAuthorityAdmissionClient({ baseUrl: admissionOrigin, token: admissionToken }) : undefined;
    const observe = source
      ? createSourceSemanticsClient({ baseUrl: source.origin, token: source.token, sourceRefs: source.sourceRefs })
      : async () => { throw authorityError('AUTHORITY_SEMANTICS_UNAVAILABLE'); };
    app.register(createWorkerAuthorityPlugin({ db, clock, serviceToken, admissions, observe }));
  };
}
