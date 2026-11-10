import { CursorSchema } from '@eapr/contracts';
import type { createSourceService, UploadDependencies } from '@eapr/sources';
import { createScenarioAdmin } from '../../../packages/sources/src/scenario-admin.js';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  companyADemo as demo, CompanyADemoPaymentResponseSchema, CompanyADemoRequestSchema,
} from '../../../packages/contracts/src/demo-company-a.js';
import { authorizeAuthorityService, sendAuthorityError } from '../../worker/src/routes/authority.js';
import { authorityError } from '../../worker/src/sync/current-authority-errors.js';

// Match the private client's decoded byte limit for one page of up to 100 events.
const maxPageBytes = 1024 * 1024;

function validBearer(token: string) {
  return typeof token === 'string' && token.length <= 1024 && /^[A-Za-z0-9._~+/-]+=*$/.test(token);
}

type Operator = { enabled: false } | { enabled: true; token: string; dependencies: UploadDependencies };

function authorize(request: FastifyRequest, token: string) {
  authorizeAuthorityService(request, token);
  if (request.headers.cookie !== undefined || request.headers['x-eapr-csrf'] !== undefined) {
    throw authorityError('AUTHORITY_UNAUTHORIZED');
  }
}

export function composeDemoSource({ source, sourceToken, serviceToken, operator }: {
  source: Pick<ReturnType<typeof createSourceService>, 'fetchChanges'>;
  sourceToken: string; serviceToken: string; operator: Operator;
}): FastifyPluginAsync {
  if (!validBearer(sourceToken) || sourceToken === serviceToken ||
      (operator.enabled && (!validBearer(operator.token) ||
        operator.token === sourceToken || operator.token === serviceToken))) {
    throw new Error('Demo source capabilities must be valid and distinct');
  }

  return async app => {
    app.setErrorHandler(sendAuthorityError);
    for (const streamId of demo.streams) {
      const path = '/internal/demo/company-a/changes/' + streamId;
      app.get(path, {
        exposeHeadRoute: false,
        onRequest: async request => {
          authorize(request, sourceToken);
          const length = request.headers['content-length'];
          if (request.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0')) {
            throw authorityError('AUTHORITY_INPUT_INVALID');
          }
        },
      }, async (request, reply) => {
        const prefix = path + '?after=';
        const after = CursorSchema.safeParse(request.url.slice(prefix.length));
        if (!request.url.startsWith(prefix) || !after.success) throw authorityError('AUTHORITY_INPUT_INVALID');
        const page = await source.fetchChanges(demo.sourceRef, streamId, after.data);
        const body = JSON.stringify(page);
        if (Buffer.byteLength(body) > maxPageBytes) throw authorityError('AUTHORITY_UNAVAILABLE');
        return reply.header('Cache-Control', 'no-store').type('application/json').send(body);
      });
    }

    if (!operator.enabled) return;
    const admin = createScenarioAdmin(operator.dependencies, {
      DEMO_OPERATOR_ENABLED: 'true', DEMO_OPERATOR_TOKEN: operator.token,
    });
    const path = '/internal/demo/company-a/payment';
    app.post(path, {
      bodyLimit: 4096,
      onRequest: async request => {
        authorize(request, operator.token);
        if (request.url !== path || request.mediaType !== 'application/json') {
          throw authorityError('AUTHORITY_INPUT_INVALID');
        }
      },
    }, async (request, reply) => {
      if (!CompanyADemoRequestSchema.safeParse(request.body).success) throw authorityError('AUTHORITY_INPUT_INVALID');
      const events = await admin.freshPaymentA(operator.token, demo.scenario);
      const result = CompanyADemoPaymentResponseSchema.parse({
        sourceRef: demo.sourceRef, eventIds: events.map(event => event.id),
      });
      return reply.header('Cache-Control', 'no-store').send(result);
    });
  };
}
