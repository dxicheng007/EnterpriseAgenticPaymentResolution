import type { Pool } from 'pg';
import { CommittedCaptureIdentityV1Schema, type ChangePage, type CommittedCaptureIdentityV1 } from '@eapr/contracts';
import type { Clock } from '@eapr/storage/control-db';
import { withTransaction } from '@eapr/storage/transaction';
import { initializeCommittedCapture } from './bootstrap.js';
import { CaptureError, requireStorage, safeCaptureError } from './capture-errors.js';
import { captureBoundPage, readBoundProgress, readCaptureLane } from './capture-store.js';

export function createRuntimeCapture({ db, clock }: { db: Pool; clock: Clock }) {
  return {
    async openCommitted(identity: CommittedCaptureIdentityV1) {
      let parsed: CommittedCaptureIdentityV1;
      try {
        parsed = CommittedCaptureIdentityV1Schema.parse(identity);
      } catch {
        throw new CaptureError('CAPTURE_INPUT_INVALID');
      }
      try {
        const bound = await withTransaction(db, async client => {
          const lane = await initializeCommittedCapture(client, parsed);
          const binding = await readCaptureLane(client, lane);
          requireStorage(binding);
          return { lane, binding };
        });
        return {
          lane: { ...bound.lane },
          capturePage: (page: ChangePage) => captureBoundPage(db, clock, bound, page),
          readProgress: () => readBoundProgress(db, bound),
        };
      } catch (error) {
        throw safeCaptureError(error);
      }
    },
  };
}
