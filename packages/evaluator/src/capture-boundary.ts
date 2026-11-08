import { hashCanonical, hashManifest, type BootstrapManifest, type RawSourceEvent, type SourceSnapshot } from '@eapr/contracts';
import { verifyCaptureBinding } from './fixture-store.js';
import { verifyTruthMembers, type ProtectedFixtureSet } from './fixtures.js';

type Capture = { truth: ProtectedFixtureSet; manifest: BootstrapManifest; snapshot: SourceSnapshot; events: RawSourceEvent[] };
export type CaptureValidation = {
  label: string;
  capture: Capture;
  accepts: boolean;
};

export function planCaptureValidation(capture: Capture): CaptureValidation[] | undefined {
  const { events, manifest, snapshot } = capture;
  const first = events[0];
  const stream = manifest.streams.find(member => member.eventIds.includes(first?.id));
  if (!first || !stream || !manifest.files.length || Number(stream.resumeAfter) === Number.MAX_SAFE_INTEGER) return;
  const alteredHash = (hash: string) => (hash[0] === '0' ? '1' : '0') + hash.slice(1);
  const changedFile = { ...manifest, files: manifest.files.map((file, index) =>
    index === 0 ? { ...file, sha256: alteredHash(file.sha256) } : file) };
  const changedCursor = { ...manifest, streams: manifest.streams.map(member =>
    member.streamId === stream.streamId ? { ...member, resumeAfter: String(Number(member.resumeAfter) + 1) } : member) };
  return [
    { label: 'capture-exact', capture, accepts: true },
    { label: 'capture-omitted-event', capture: { ...capture, events: events.slice(1) }, accepts: false },
    { label: 'capture-duplicate-event', capture: { ...capture, events: [...events, first] }, accepts: false },
    { label: 'capture-duplicate-member', capture: { ...capture, snapshot: { ...snapshot, eventIds: [...snapshot.eventIds, first.id] } }, accepts: false },
    { label: 'capture-altered-event-hash', capture: { ...capture, events: [{ ...first, contentHash: alteredHash(first.contentHash) }, ...events.slice(1)] }, accepts: false },
    { label: 'capture-altered-original-hash', capture: { ...capture, manifest: { ...changedFile, hash: hashManifest(changedFile) } }, accepts: false },
    { label: 'capture-altered-stream-watermark', capture: { ...capture, manifest: { ...changedCursor, hash: hashManifest(changedCursor) } }, accepts: false },
    { label: 'capture-altered-aggregate-hash', capture: { ...capture, snapshot: { ...snapshot, contentHash: alteredHash(snapshot.contentHash) } }, accepts: false },
  ];
}

export function captureInputHash({ capture }: CaptureValidation) {
  return hashCanonical({ truthHash: capture.truth.hash, manifest: capture.manifest, snapshot: capture.snapshot, events: capture.events });
}

export function runCaptureValidation({ capture, accepts }: CaptureValidation): boolean {
  const { truth, manifest, snapshot, events } = capture;
  try {
    verifyTruthMembers(truth, manifest, snapshot, events);
    verifyCaptureBinding(manifest, snapshot);
    return accepts;
  } catch {
    return !accepts;
  }
}
