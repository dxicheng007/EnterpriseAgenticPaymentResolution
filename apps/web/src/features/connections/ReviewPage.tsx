import { useEffect, useRef, useState } from 'react';
import { LocalApiError } from '../../../../../packages/client/src/http.js';
import {
  activateReview, activationRequestFor, prepareReview, readReview, readReviewDetails, type ActivationOutcome,
} from '../../../../../packages/client/src/review.js';
import type { ReviewDetailsV1 } from '../../../../../packages/contracts/src/review-details.js';
import type { LocalSession } from '../../../../../packages/client/src/session.js';
import { ActivationRequestSchema, type ActivationRequest, type ReviewPackage } from '../../../../../packages/contracts/src/review.js';
import { formatUsdCents } from '../preview/preview-values.js';
import { EvidencePanel } from '../sources/EvidencePanel.js';
import { citationBinding, explainSafetyRule, explainValidator, lineageByOperation, mappingLabel } from '../../../../../packages/client/src/review-explain.js';
import { connectionCompanies } from '../../demo/connection-catalog.js';
import { Diagnostics, RequestFailure } from '../sources/review-details.js';
import { UnresolvedDecision } from '../review/UnresolvedDecision.js';

export function ReviewPackageView({ reviewPackage }: { reviewPackage: ReviewPackage }) {
  const { scope } = reviewPackage;
  const blockers = reviewPackage.diagnostics.filter(item => item.severity === 'blocker');
  return <section className="review-card" aria-label="Review package">
    <h2>Prepared review package</h2>
    <p><strong>{reviewPackage.ready && blockers.length === 0 ? 'Ready for reviewer decision' : 'Not ready for approval'}</strong></p>
    <dl className="review-facts">
      <dt>Company</dt><dd>{scope.companyId}</dd>
      <dt>Seller</dt><dd>{scope.sellerEntityId}</dd>
      <dt>Account</dt><dd>{scope.accountId}</dd>
      <dt>Package</dt><dd>{reviewPackage.id} · revision {reviewPackage.revision}</dd>
      <dt>Package hash</dt><dd><code>{reviewPackage.hash}</code></dd>
      <dt>Compiled artifact hash</dt><dd><code>{reviewPackage.artifactHash}</code></dd>
      <dt>Customer profile hash</dt><dd><code>{reviewPackage.profileHash}</code></dd>
      <dt>Evidence manifest hash</dt><dd><code>{reviewPackage.manifestHash}</code></dd>
      <dt>Verification report</dt><dd>{reviewPackage.verificationReportId}</dd>
      <dt>Preview plan hash</dt><dd><code>{reviewPackage.previewPlanHash}</code></dd>
      <dt>Expected parent version</dt><dd>{reviewPackage.expectedTargetVersion}</dd>
    </dl>
    <Diagnostics items={reviewPackage.diagnostics} />
  </section>;
}

function operationLabel(operation: ReviewDetailsV1['proposedImport']['operations'][number]) {
  const { record } = operation;
  const amount = 'amountCents' in record ? ' · ' + formatUsdCents(record.amountCents) : '';
  return operation.op + ' · ' + record.id + amount + ('effectiveAt' in record ? ' · effective ' + record.effectiveAt : '');
}

function EvidenceButtons({ ids, details, open }: { ids: readonly string[]; details: ReviewDetailsV1; open: (id: string) => void }) {
  if (ids.length === 0) return <span>no evidence cited</span>;
  return <>{ids.map(id => citationBinding(details, id)
    ? <button type="button" key={id} className="evidence-link" onClick={() => open(id)}>Inspect {id}</button>
    : <span key={id} role="alert"> {id} (not in the reviewed evidence set; cannot be inspected)</span>)}</>;
}

export function ReviewDetailsView({ details }: { details: ReviewDetailsV1 }) {
  const { baseline, proposedImport, profile, futureScope, artifact, evidence, capture } = details;
  const [opened, setOpened] = useState<string>();
  const open = (id: string) => setOpened(id);
  return <section className="review-card" aria-label="Decision details">
    <h2>What you are approving</h2>
    <h3>Proposed import (not yet applied)</h3>
    <dl className="review-facts">
      <dt>Parent version before</dt><dd>{baseline.version}</dd>
      <dt>Balance owed before import</dt><dd>{formatUsdCents(baseline.balanceCents)}</dd>
      <dt>Balance owed after proposed import</dt><dd>{formatUsdCents(proposedImport.expectedBalanceCents)}</dd>
      <dt>Evaluated as of</dt><dd>{proposedImport.asOf}</dd>
      <dt>Source events</dt><dd>{proposedImport.eventIds.length}</dd>
      <dt>Proposed operations</dt><dd>{proposedImport.operations.length}</dd>
    </dl>
    {proposedImport.operations.length > 0 && <ol>
      {lineageByOperation(proposedImport).map(({ operationIndex, fields }) => <li key={operationIndex}>
        {operationLabel(proposedImport.operations[operationIndex]!)}
        {fields.length === 0 ? <p>No field lineage recorded for this operation.</p> : <ul aria-label="Field lineage">
          {fields.map((field, index) => <li key={index}>
            <code>{field.targetField}</code> ← {mappingLabel(field.mapping)}
            {field.sourcePaths.length > 0 && <> · source fields {field.sourcePaths.join(', ')}</>}
            {field.sourceEventIds.length > 0 && <> · source events {field.sourceEventIds.join(', ')}</>}
            {field.derivationInputs.length > 0 && <> · derived from {field.derivationInputs.join(', ')}</>}
            {' '}<EvidenceButtons ids={[...new Set([...field.evidenceRefs, ...(field.mapping?.op === 'constant' ? [field.mapping.evidenceRef] : [])])]}
              details={details} open={open} />
          </li>)}
        </ul>}
      </li>)}
    </ol>}
    <p>Unallocated funds do not reduce an invoice balance. Parent writes during review: {details.parentWrites}.</p>
    <h3>Customer profile and contract terms</h3>
    <dl className="review-facts">
      <dt>Profile</dt><dd>{profile.id} · version {profile.version}</dd>
      <dt>Parent customer</dt><dd>{profile.bootstrap.customer.id} · {profile.bootstrap.customer.displayName}
        {' '}<EvidenceButtons ids={profile.bootstrap.customer.evidenceRefs} details={details} open={open} /></dd>
      <dt>Source accounts</dt><dd>{profile.sourceAccountIds.join(', ') || 'none'}</dd>
      <dt>Reviewed semantic version</dt><dd>{profile.semanticVersion}</dd>
    </dl>
    {profile.contractTerms.length === 0 ? <p>No contract terms are in this profile.</p> : <ul>
      {profile.contractTerms.map(term => <li key={term.id}>Term {term.id} · {formatUsdCents(term.fixedMonthlyFeeCents)} {term.currency} {term.cadence} on day {term.anchorDay},
        valid from {term.validFrom}{term.validToExclusive ? ' until ' + term.validToExclusive : ' with no end'} · <EvidenceButtons ids={term.evidenceRefs} details={details} open={open} /></li>)}
    </ul>}
    <h3>Approved identity lookups</h3>
    {profile.approvedLookups.length === 0 ? <p>No identity lookups are approved in this profile.</p> :
      profile.approvedLookups.map(lookup => <div key={lookup.id} aria-label={'Lookup ' + lookup.id}>
        <p><strong>{lookup.id}</strong> ({lookup.valueType})</p>
        <ul>{lookup.entries.map(entry => <li key={entry.source}>{entry.source} → {entry.target}{' '}
          <EvidenceButtons ids={entry.evidenceRefs} details={details} open={open} /></li>)}</ul>
      </div>)}
    <h3>Future automatic synchronization for this customer</h3>
    <dl className="review-facts">
      <dt>Allowed record kinds</dt><dd>{futureScope.allowedKinds.join(', ')}</dd>
      <dt>Maximum per transaction</dt><dd>{formatUsdCents(futureScope.limits.maxTransactionCents)}</dd>
      <dt>Maximum records per cycle</dt><dd>{futureScope.limits.maxRecordsPerCycle}</dd>
      <dt>Runtime model calls</dt><dd>{futureScope.runtimeModelCalls}</dd>
      <dt>Safety rules ({futureScope.safetyRulesVersion})</dt>
      <dd><ul>{futureScope.safetyRules.map(rule => <li key={rule}><code>{rule}</code>: {explainSafetyRule(rule)}</li>)}</ul></dd>
      <dt>Validators</dt>
      <dd><ul>{futureScope.validators.map(id => <li key={id}><code>{id}</code>: {explainValidator(id)}</li>)}</ul></dd>
    </dl>
    <h3>Evidence and versions</h3>
    <dl className="review-facts">
      <dt>Source</dt><dd>{details.sourceRef}</dd>
      <dt>Capture</dt><dd>{capture.manifestId} · snapshot {capture.snapshotId}</dd>
      <dt>Artifact</dt><dd>{artifact.id} · compiler {artifact.compilerVersion}, runtime {artifact.runtimeVersion}, target schema {artifact.targetSchemaVersion}</dd>
      <dt>Referenced evidence</dt><dd><EvidenceButtons ids={evidence.referencedEvidenceIds} details={details} open={open} /></dd>
    </dl>
    {opened && citationBinding(details, opened) && <div aria-label="Opened citation">
      <EvidencePanel evidenceId={opened} expectedSnapshotId={evidence.snapshotId} />
      <button type="button" onClick={() => setOpened(undefined)}>Close citation</button>
    </div>}
  </section>;
}

export function ActivationOutcomeView({ outcome }: { outcome: ActivationOutcome }) {
  if (outcome.state === 'pending') {
    return <p role="status"><strong>Approval recorded; application is still pending.</strong> This customer is not connected
      until a worker receipt exists. Retry with the same approval to check again.</p>;
  }
  const { receipt } = outcome;
  return <section className="review-card" aria-label="Activation receipt">
    <h3>{outcome.replayed ? 'Existing worker receipt (replayed)' : 'Worker receipt'}</h3>
    <dl className="review-facts">
      <dt>Receipt</dt><dd>{receipt.id}</dd>
      <dt>Activation</dt><dd>{receipt.activationId} · epoch {receipt.epoch}</dd>
      <dt>Committed at</dt><dd>{receipt.committedAt}</dd>
      <dt>Balance before</dt><dd>{formatUsdCents(receipt.beforeBalanceCents)}</dd>
      <dt>Balance after</dt><dd>{formatUsdCents(receipt.afterBalanceCents)}</dd>
      <dt>Records written</dt><dd>{receipt.targetRecordIds.length}</dd>
    </dl>
    <p>Inspect the imported records on the Parent page.</p>
  </section>;
}

const staleCodes = ['REVIEW_STALE', 'STALE_REVIEW', 'ACTIVATION_POLICY_MISMATCH', 'FINANCIAL_ATTESTATION_MISMATCH'];

/** True for accepted 409 stale / package-binding conflicts that require reload before approve. */
export function staleError(error: unknown) {
  return error instanceof LocalApiError && error.status === 409 && staleCodes.includes(error.code);
}

export type ApprovalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserApprovalStorage(): ApprovalStorage | undefined {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : undefined;
  } catch { return undefined; }
}

export const approvalStorageKey = (accountId: string) => 'eapr-review-approval:' + accountId;

const samePackage = (request: ActivationRequest, reviewPackage: Pick<ReviewPackage, 'id' | 'hash'>) =>
  request.reviewPackageId === reviewPackage.id && request.expectedPackageHash === reviewPackage.hash;

/** Unresolved approvals are kept per package; a legacy single-request value is still read. */
function readApprovals(accountId: string, storage: ApprovalStorage | undefined): ActivationRequest[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(approvalStorageKey(accountId));
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return (Array.isArray(value) ? value : [value]).flatMap(item => {
      const parsed = ActivationRequestSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  } catch { return []; }
}

function writeApprovals(accountId: string, requests: ActivationRequest[], storage: ApprovalStorage | undefined) {
  if (!storage) return;
  try {
    if (requests.length === 0) storage.removeItem(approvalStorageKey(accountId));
    else storage.setItem(approvalStorageKey(accountId), JSON.stringify(requests));
  } catch { /* storage only aids recovery */ }
}

export function loadSavedApproval(
  accountId: string,
  reviewPackage: ReviewPackage,
  storage: ApprovalStorage | undefined = browserApprovalStorage(),
): ActivationRequest | undefined {
  return readApprovals(accountId, storage).find(request => samePackage(request, reviewPackage));
}

/** Unresolved approvals for packages other than the current head, offered only as explicit recovery. */
export function loadOtherApprovals(
  accountId: string,
  reviewPackage: ReviewPackage | undefined,
  storage: ApprovalStorage | undefined = browserApprovalStorage(),
): ActivationRequest[] {
  return readApprovals(accountId, storage).filter(request => !reviewPackage || !samePackage(request, reviewPackage));
}

export function saveApproval(
  accountId: string,
  request: ActivationRequest,
  storage: ApprovalStorage | undefined = browserApprovalStorage(),
) {
  const others = readApprovals(accountId, storage).filter(item => item.idempotencyKey !== request.idempotencyKey &&
    !(item.reviewPackageId === request.reviewPackageId && item.expectedPackageHash === request.expectedPackageHash));
  writeApprovals(accountId, [...others, request], storage);
}

/** Clears one resolved approval by key, or every saved approval for the account when no key is given. */
export function clearApproval(
  accountId: string,
  storage: ApprovalStorage | undefined = browserApprovalStorage(),
  idempotencyKey?: string,
) {
  writeApprovals(accountId, idempotencyKey === undefined ? []
    : readApprovals(accountId, storage).filter(request => request.idempotencyKey !== idempotencyKey), storage);
}

/** Reuse a saved same-package approval; never invent a second key for that package. */
export function nextApprovalRequest(
  reviewPackage: ReviewPackage,
  savedApproval: ActivationRequest | undefined,
  createKey: () => string,
): ActivationRequest {
  return savedApproval ?? activationRequestFor(reviewPackage, createKey());
}

/** Approve stays off through load/busy/stale and after an applied outcome. */
export function canApproveReview(input: {
  reviewPackage: ReviewPackage | undefined;
  loading: boolean;
  busy: boolean;
  stale: boolean;
  outcome?: ActivationOutcome;
}): boolean {
  const { reviewPackage, loading, busy, stale, outcome } = input;
  return reviewPackage !== undefined && reviewPackage.ready && !loading && !busy && !stale &&
    !reviewPackage.diagnostics.some(item => item.severity === 'blocker') && outcome?.state !== 'applied';
}

/** Drop a selection that is no longer in the renewed session grants. */
export function authorizedAccountId(chosen: string, allowedAccountIds: readonly string[]): string {
  return allowedAccountIds.includes(chosen) ? chosen : '';
}

function AccountReview({ accountId, session }: { accountId: string; session: LocalSession }) {
  const [reviewPackage, setReviewPackage] = useState<ReviewPackage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActivationOutcome>();
  const [stale, setStale] = useState(false);
  const [savedApproval, setSavedApproval] = useState<ActivationRequest>();
  const [details, setDetails] = useState<ReviewDetailsV1>();
  const [detailsError, setDetailsError] = useState<unknown>();
  const [detailsAttempt, setDetailsAttempt] = useState(0);
  const [earlierApprovals, setEarlierApprovals] = useState<ActivationRequest[]>([]);
  const [recovered, setRecovered] = useState<{ request: ActivationRequest; outcome: ActivationOutcome }>();
  const inFlight = useRef(false);
  const loadGeneration = useRef(0);
  const loadAbort = useRef<AbortController | undefined>(undefined);

  function accept(value: ReviewPackage) {
    setReviewPackage(value);
    setSavedApproval(loadSavedApproval(accountId, value));
    setEarlierApprovals(loadOtherApprovals(accountId, value));
    setStale(false);
  }

  /** Drop any in-flight saved-package read so it cannot overwrite a newer prepare/reload. */
  function invalidateLoads() {
    loadGeneration.current += 1;
    loadAbort.current?.abort();
    loadAbort.current = undefined;
  }

  function load(signal?: AbortSignal) {
    const generation = ++loadGeneration.current;
    const controller = new AbortController();
    loadAbort.current?.abort();
    loadAbort.current = controller;
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    setLoading(true);
    setError(undefined);
    void readReview(accountId, controller.signal).then(value => {
      if (controller.signal.aborted || generation !== loadGeneration.current) return;
      accept(value);
      setLoading(false);
    }, failure => {
      if (controller.signal.aborted || generation !== loadGeneration.current) return;
      setLoading(false);
      if (!(failure instanceof LocalApiError && failure.status === 404)) setError(failure);
      else { setReviewPackage(undefined); setSavedApproval(undefined); setEarlierApprovals(loadOtherApprovals(accountId, undefined)); }
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => {
      controller.abort();
      loadAbort.current?.abort();
    };
  }, [accountId, session]);

  useEffect(() => {
    setDetails(undefined);
    setDetailsError(undefined);
    if (!reviewPackage) return;
    const controller = new AbortController();
    void readReviewDetails(accountId, reviewPackage, controller.signal).then(value => {
      if (!controller.signal.aborted) setDetails(value);
    }, failure => {
      if (!controller.signal.aborted) setDetailsError(failure);
    });
    return () => controller.abort();
  }, [accountId, reviewPackage?.hash, session, detailsAttempt]);

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try { await action(); } catch (failure) {
      if (staleError(failure)) setStale(true);
      setError(failure);
    } finally { inFlight.current = false; setBusy(false); }
  }

  const prepare = () => run(async () => {
    // Preparing advances head; an older in-flight GET must not clobber the new package
    // (that race makes Approve hit REVIEW_STALE against a newer head).
    invalidateLoads();
    setLoading(false);
    setOutcome(undefined);
    try {
      accept(await prepareReview(accountId));
    } catch (failure) {
      if (!(failure instanceof LocalApiError) || failure.status !== 409 || failure.code !== 'STALE_REVIEW') throw failure;
      // One retry after a concurrent head rewrite (second tab / overlapping prepare).
      accept(await prepareReview(accountId));
    }
  });

  const approve = () => run(async () => {
    if (!reviewPackage) return;
    const request = nextApprovalRequest(reviewPackage, savedApproval, () => 'approval-' + crypto.randomUUID());
    saveApproval(accountId, request);
    setSavedApproval(request);
    const result = await activateReview(accountId, request);
    setOutcome(result);
    if (result.state === 'applied') {
      clearApproval(accountId, undefined, request.idempotencyKey);
      setSavedApproval(undefined);
    }
  });

  const recover = (request: ActivationRequest) => run(async () => {
    const result = await activateReview(accountId, request);
    setRecovered({ request, outcome: result });
    if (result.state === 'applied') {
      clearApproval(accountId, undefined, request.idempotencyKey);
      setEarlierApprovals(current => current.filter(item => item.idempotencyKey !== request.idempotencyKey));
    }
  });

  const detailsFor = details?.reviewPackage.hash === reviewPackage?.hash ? details : undefined;
  const pendingApproval = outcome?.state === 'pending' || (savedApproval !== undefined && outcome === undefined);
  const canApprove = canApproveReview({ reviewPackage, loading, busy, stale, outcome }) && detailsFor !== undefined;
  return <>
    {loading && <p role="status">Loading saved review package…</p>}
    {!loading && !reviewPackage && error == null && <p>No review package is prepared for this account.</p>}
    {error != null && stale && <div className="review-error" role="alert">
      <strong>The package changed.</strong>
      <p>Reload the saved package or prepare again, then review it before approving.</p>
    </div>}
    {error != null && !stale &&
      <RequestFailure error={error} next="Nothing was assumed. Check the saved state before retrying." />}
    {reviewPackage && <ReviewPackageView reviewPackage={reviewPackage} />}
    {reviewPackage && reviewPackage.diagnostics.some(item => item.severity === 'blocker') &&
      <UnresolvedDecision diagnostics={reviewPackage.diagnostics} />}
    {reviewPackage && !detailsFor && detailsError == null && <p role="status">Loading decision details…</p>}
    {detailsError != null && <>
      <RequestFailure error={detailsError}
        next="Approval stays unavailable until the exact saved financial and future-scope details load." />
      <button type="button" onClick={() => { setDetailsError(undefined); setDetailsAttempt(value => value + 1); }}>
        Retry decision details</button>
    </>}
    {detailsFor && <ReviewDetailsView details={detailsFor} />}
    {(earlierApprovals.length > 0 || recovered) && <section className="review-card" aria-label="Unresolved earlier approvals">
      <h3>Unresolved approval for an earlier package</h3>
      <p>These approvals were submitted from this browser session for a package that is no longer the current one. They are
        never sent automatically and are separate from approving the package shown above. Retrying one checks only its
        original package and returns its original receipt.</p>
      <ul>{earlierApprovals.map(request => <li key={request.idempotencyKey}>
        Package {request.reviewPackageId} · hash <code>{request.expectedPackageHash}</code>
        {' '}<button type="button" disabled={busy || loading} onClick={() => void recover(request)}>
          Retry original approval for {request.reviewPackageId}</button>
      </li>)}</ul>
      {recovered && <>
        <p>Result for original package {recovered.request.reviewPackageId}:</p>
        <ActivationOutcomeView outcome={recovered.outcome} />
      </>}
    </section>}
    {pendingApproval && !stale && <p role="status">An approval for this exact package was already submitted from this
      browser session and may not have completed. Retrying sends the same approval; it is never sent automatically.</p>}
    <div className="review-actions">
      <button type="button" disabled={busy || loading} onClick={() => void prepare()}>Prepare review package</button>
      {stale && <button type="button" disabled={busy || loading} onClick={() => load()}>Reload saved package</button>}
      {reviewPackage && <button type="button" disabled={!canApprove} onClick={() => void approve()}>
        {pendingApproval ? 'Retry same approval' : 'Approve this customer only'}</button>}
    </div>
    <p>Approval applies to this one customer and the exact hashes shown. It does not approve any other customer.</p>
    {busy && <p role="status">Waiting for the server…</p>}
    {outcome && <ActivationOutcomeView outcome={outcome} />}
  </>;
}

export function ReviewPage({ session, embedded = false }: { session: LocalSession; embedded?: boolean }) {
  const [chosen, setAccountId] = useState('');
  const accountId = authorizedAccountId(chosen, session.allowedAccountIds);
  const body = <>
    {session.allowedAccountIds.length === 0 && <p>No accounts are authorized for this reviewer session.</p>}
    {session.allowedAccountIds.length > 0 && <>
      <label className="review-selection">Registered account
        <select value={accountId} onChange={event => setAccountId(event.target.value)}>
          <option value="">Select an account</option>
          {session.allowedAccountIds.map(id => {
            const company = connectionCompanies.find(item => item.accountId === id);
            return <option key={id} value={id}>
              {company ? company.name + ' · ' + company.parentCustomerName : id}
            </option>;
          })}
        </select>
      </label>
      {accountId && <AccountReview key={accountId} accountId={accountId} session={session} />}
    </>}
  </>;
  if (embedded) {
    return <section className="workspace-section" aria-label="Customer review">
      <header>
        <p className="review-eyebrow">Per-customer review</p>
        <h2>Customer review</h2>
        <p>Review one customer's prepared package. Approval grants bounded standing authority for that customer only.</p>
      </header>
      {body}
    </section>;
  }
  return <main className="review-main">
    <header>
      <p className="review-eyebrow">Per-customer review</p>
      <h1>Customer review</h1>
      <p>Review one customer's prepared package. Approval grants bounded standing authority for that customer only.</p>
    </header>
    {body}
  </main>;
}
