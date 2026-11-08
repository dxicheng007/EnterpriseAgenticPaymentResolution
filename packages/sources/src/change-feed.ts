import {
  ChangePageSchema, CursorSchema, RawSourceEventSchema, hashEvent, type ChangePage, type Cursor, type Id,
  type RawSourceEvent,
} from '@eapr/contracts';
import type { Pool } from 'pg';
import { SourceError } from './errors.js';
import type { SourceDefinition } from './records.js';

export function validateChangePage(input: ChangePage,sourceRef:Id,streamId:Id,after:Cursor): ChangePage {
  const parsed = ChangePageSchema.safeParse(input);
  if (!parsed.success || !parsed.data.complete || parsed.data.sourceRef !== sourceRef ||
      parsed.data.streamId !== streamId || parsed.data.after !== after) {
    throw new SourceError(409,'SOURCE_GAP','Source change page is incomplete or noncontiguous');
  }
  if (new Set(parsed.data.events.map(event=>event.id)).size !== parsed.data.events.length ||
      parsed.data.events.some(event=>hashEvent(event) !== event.contentHash)) {
    throw new SourceError(409,'SOURCE_HASH_CONFLICT','Source change page contains conflicting event content');
  }
  return parsed.data;
}

export async function fetchChanges(
  db:Pool,source:SourceDefinition,streamId:Id,after:Cursor,
):Promise<ChangePage> {
  const stream = source.streams.find(candidate=>candidate.streamId === streamId);
  if (!stream) throw new SourceError(404,'SOURCE_STREAM_NOT_FOUND','Source stream was not found');
  if (!CursorSchema.safeParse(after).success) throw new SourceError(409,'SOURCE_GAP','Source cursor is invalid');
  const rows = (await db.query<{event:RawSourceEvent|null; high_water:string}>(
    'SELECT page.event, water.high_water FROM (' +
    'SELECT COALESCE(max(sequence),0) AS high_water FROM source_events WHERE source_ref = $1 AND stream_id = $2' +
    ') water LEFT JOIN LATERAL (' +
    'SELECT event, sequence FROM source_events WHERE source_ref = $1 AND stream_id = $2 AND sequence > $3 ' +
    'ORDER BY sequence LIMIT $4) page ON TRUE ORDER BY page.sequence',
    [source.sourceRef,streamId,after,stream.pageSize],
  )).rows;
  const highWater = Number(rows[0]?.high_water);
  if (Number(after) > highWater) throw new SourceError(409,'SOURCE_GAP','Source cursor exceeds its high water');
  const events = rows.flatMap(row=>row.event ? [RawSourceEventSchema.parse(row.event)] : []);
  const next = events.length ? String(events.at(-1)!.sequence) : after;
  if (events.length < stream.pageSize && Number(next) !== highWater) {
    throw new SourceError(409,'SOURCE_GAP','Source stream is missing events');
  }
  return validateChangePage({sourceRef:source.sourceRef,streamId,after,next,complete:true,events},source.sourceRef,streamId,after);
}
