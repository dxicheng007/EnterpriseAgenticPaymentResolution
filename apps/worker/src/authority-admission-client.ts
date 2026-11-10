import {
  AuthorityAdmissionCheckV1Schema, AuthorityAdmissionResponseV1Schema, type AuthorityAdmissionCheckV1,
} from '@eapr/contracts';
import { readJson, responseError } from './authority-transport.js';
import { authorityError } from './sync/current-authority-errors.js';

export function createAuthorityAdmissionClient({ baseUrl, token }: { baseUrl: string; token: string }) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.origin !== baseUrl ||
      !/^[A-Za-z0-9._~+/-]+=*$/.test(token) || token.length > 1024) {
    throw new Error('Authority admission requires a fixed loopback control origin and admission credential');
  }
  const url = new URL('/internal/authority-admissions/check', origin);

  return {
    async check(input: AuthorityAdmissionCheckV1) {
      const request = AuthorityAdmissionCheckV1Schema.safeParse(input);
      if (!request.success) throw authorityError('AUTHORITY_UNAVAILABLE');
      let response: Response;
      let json: unknown;
      try {
        const signal = AbortSignal.timeout(2000);
        response = await fetch(url, {
          method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify(request.data), signal, redirect: 'error',
        });
        json = await readJson(response, signal);
        signal.throwIfAborted();
      } catch {
        throw authorityError('AUTHORITY_UNAVAILABLE');
      }
      if (response.status !== 200) throw responseError(response.status, json);
      const result = AuthorityAdmissionResponseV1Schema.safeParse(json);
      if (!result.success || result.data.requestHash !== request.data.requestHash) {
        throw authorityError('AUTHORITY_UNAVAILABLE');
      }
      return result.data;
    },
  };
}

export type AuthorityAdmissionClient = ReturnType<typeof createAuthorityAdmissionClient>;
