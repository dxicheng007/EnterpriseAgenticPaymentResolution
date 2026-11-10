import { useEffect, useRef, useState } from 'react';
import { LocalApiError } from '../../../../../packages/client/src/http.js';
import {
  activateReview, activationRequestFor, prepareReview, readReview, type ActivationOutcome,
} from '../../../../../packages/client/src/review.js';
import type { LocalSession } from '../../../../../packages/client/src/session.js';
import { ActivationRequestSchema, type ActivationRequest, type ReviewPackage } from '../../../../../packages/contracts/src/review.js';
import { formatUsdCents } from '../preview/preview-values.js';
import { Diagnostics, RequestFailure } from '../sources/review-details.js';

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
    <p>The review package exposes hashes only. It does not show the amount still owed after import, allowed operations or limits. Inspect the preview and evidence for those before deciding.</p>
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
function staleError(error: unknown) {
  return error instanceof LocalApiError && error.status === 409 && staleCodes.includes(error.code);
}

const approvalStorageKey = (accountId: string) => 'eapr-review-approval:' + accountId;
function loadSavedApproval(accountId: string, reviewPackage: ReviewPackage): ActivationRequest | undefined {
  try {
    const raw = window.sessionStorage.getItem(approvalStorageKey(accountId));
    const parsed = raw ? ActivationRequestSchema.safeParse(JSON.parse(raw)) : undefined;
    return parsed?.success && parsed.data.reviewPackageId === reviewPackage.id &&
      parsed.data.expectedPackageHash === reviewPackage.hash ? parsed.data : undefined;
  } catch { return undefined; }
}
function saveApproval(accountId: string, request: ActivationRequest) {
  try { window.sessionStorage.setItem(approvalStorageKey(accountId), JSON.stringify(request)); } catch { /* storage only aids recovery */ }
}
function clearApproval(accountId: string) {
  try { window.sessionStorage.removeItem(approvalStorageKey(accountId)); } catch { /* nothing to clear */ }
}

function AccountReview({ accountId, session }: { accountId: string; session: LocalSession }) {
  const [reviewPackage, setReviewPackage] = useState<ReviewPackage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActivationOutcome>();
  const [stale, setStale] = useState(false);
  const [savedApproval, setSavedApproval] = useState<ActivationRequest>();
  const inFlight = useRef(false);

  function accept(value: ReviewPackage) {
    setReviewPackage(value);
    setSavedApproval(loadSavedApproval(accountId, value));
    setStale(false);
  }

  function load(signal?: AbortSignal) {
    setLoading(true);
    setError(undefined);
    void readReview(accountId, signal).then(value => {
      if (signal?.aborted) return;
      accept(value);
      setLoading(false);
    }, failure => {
      if (signal?.aborted) return;
      setLoading(false);
      if (!(failure instanceof LocalApiError && failure.status === 404)) setError(failure);
      else { setReviewPackage(undefined); setSavedApproval(undefined); }
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [accountId, session]);

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
    setOutcome(undefined);
    accept(await prepareReview(accountId));
  });

  const approve = () => run(async () => {
    if (!reviewPackage) return;
    const request = savedApproval ?? activationRequestFor(reviewPackage, 'approval-' + crypto.randomUUID());
    saveApproval(accountId, request);
    setSavedApproval(request);
    const result = await activateReview(accountId, request);
    setOutcome(result);
    if (result.state === 'applied') clearApproval(accountId);
  });

  const pendingApproval = outcome?.state === 'pending' || (savedApproval !== undefined && outcome === undefined);
  const canApprove = reviewPackage !== undefined && reviewPackage.ready && !loading && !busy && !stale &&
    !reviewPackage.diagnostics.some(item => item.severity === 'blocker') && outcome?.state !== 'applied';
  return <>
    {loading && <p role="status">Loading saved review package…</p>}
    {!loading && !reviewPackage && error == null && <p>No review package is prepared for this account.</p>}
    {error != null && <RequestFailure error={error} next={stale
      ? 'The package changed. Reload the saved package or prepare again, then review it before approving.'
      : 'Nothing was assumed. Check the saved state before retrying.'} />}
    {reviewPackage && <ReviewPackageView reviewPackage={reviewPackage} />}
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

export function ReviewPage({ session }: { session: LocalSession }) {
  const [chosen, setAccountId] = useState('');
  const accountId = session.allowedAccountIds.includes(chosen) ? chosen : '';
  return <main className="review-main">
    <header>
      <p className="review-eyebrow">Per-customer review</p>
      <h1>Customer review</h1>
      <p>Review one customer's prepared package. Approval grants bounded standing authority for that customer only.</p>
    </header>
    {session.allowedAccountIds.length === 0 && <p>No accounts are authorized for this reviewer session.</p>}
    {session.allowedAccountIds.length > 0 && <>
      <label className="review-selection">Registered account
        <select value={accountId} onChange={event => setAccountId(event.target.value)}>
          <option value="">Select an account</option>
          {session.allowedAccountIds.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      {accountId && <AccountReview key={accountId} accountId={accountId} session={session} />}
    </>}
  </main>;
}
