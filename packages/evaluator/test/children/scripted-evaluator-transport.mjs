// Public protocol exercise. The placeholder can never assert eligibility.
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const report = {
  id: 'report-transport-public',
  artifactHash: request.artifact.hash,
  profileHashes: request.profiles.map(profile => profile.hash),
  manifestHash: request.manifest.hash,
  harnessVersion: '1',
  evaluatorBuildHash: request.evaluatorBuildHash,
  fixtureSetId: request.fixtureSetId,
  fixtureSetVersion: request.fixtureSetVersion,
  checks: [],
  coverage: { required: [], executed: [], sourceRefs: [], profileHashes: [], eventKinds: [] },
  unexplainedDifferenceCents: 0,
  eligible: false,
  createdAt: '2026-10-01T00:00:00.000Z',
};
const json = JSON.stringify(report);
switch (request.jobId) {
  case 'missing-line':
    process.stdout.write(json);
    break;
  case 'multiple-lines':
    process.stdout.write(json + '\n' + json + '\n');
    break;
  default:
    process.stdout.write(json + '\n');
}
