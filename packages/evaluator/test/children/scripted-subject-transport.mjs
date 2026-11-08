// A public transport script with no planner or expected-state logic.
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const response = { requestId: request.requestId, outcome: { plans: [], holds: [] } };
const json = JSON.stringify(response);

switch (request.requestId) {
  case 'public-input':
    if (Object.keys(request).sort().join() !== 'artifact,events,profile,protocolVersion,requestId,target' ||
        request.events[0]?.id !== 'evt-a-inv-1' || request.target.version !== 0 ||
        request.artifact.id !== 'artifact-transport' || request.profile.id !== 'profile-a' ||
        Object.keys(process.env).some(key => key !== '__CF_USER_TEXT_ENCODING')) {
      process.stderr.write('Transport script received unexpected input or environment');
      process.exitCode = 1;
      break;
    }
    process.stdout.write(json + '\n');
    break;
  case 'malformed':
    process.stdout.write('not-json');
    break;
  case 'truncated':
    process.stdout.write(json.slice(0, -1));
    break;
  case 'multiple':
    process.stdout.write(json + '\n' + json + '\n');
    break;
  case 'extra-field':
    process.stdout.write(JSON.stringify({ ...response, extra: true }));
    break;
  case 'invalid-outcome':
    process.stdout.write(JSON.stringify({ ...response, outcome: { plans: [{}], holds: [] } }));
    break;
  case 'wrong-request-id':
    process.stdout.write(JSON.stringify({ ...response, requestId: 'other-request' }));
    break;
  case 'invalid-utf8':
    process.stdout.write(Buffer.concat([Buffer.from('{"unexpected":"'), Buffer.from([255]), Buffer.from('"}')]));
    break;
  case 'stdout-limit':
    process.stdout.write('x'.repeat(8_192));
    break;
  case 'stderr-limit':
    process.stdout.write(json);
    process.stderr.write('x'.repeat(8_192));
    break;
  case 'combined-limit':
    process.stdout.write(json + ' '.repeat(3_000));
    process.stderr.write('x'.repeat(3_000));
    break;
  case 'abnormal-exit':
    process.stdout.write(json);
    process.stderr.write('child-stderr-redaction-sentinel');
    process.exitCode = 1;
    break;
  case 'timeout':
    setInterval(() => {}, 1000);
    break;
  default:
    process.stdout.write(json);
}
