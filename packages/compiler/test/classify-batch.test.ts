import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { planBatch } from '@eapr/compiler/plan-batch';
import { canonicalJson, type CompiledArtifact, type CustomerProfile, type SourceEvent, type TargetState } from '@eapr/contracts';
import { emptyTargetA, profileA } from '../../../tests/fixtures/index.js';
import { artifactA, compatibilityCases, invoice } from './fixtures/classification-cases.js';

const frozen: { baselineCommit: string; plannerBlob: string; cases: { id: string; outcome: unknown }[] } =
  JSON.parse(readFileSync(new URL('./fixtures/plan-batch-before-classification.json', import.meta.url), 'utf8'));

test('matches every pre-change planner outcome byte-for-byte canonically', () => {
  expect(frozen.baselineCommit).toBe('53c501f203903eb08054b84f1b6d93a11d763c64');
  expect(frozen.plannerBlob).toBe('70350f44c2d03ad9bda4b114e61c3eb36495a86a');
  const outcomes = new Map(frozen.cases.map(({ id, outcome }) => [id, outcome]));
  expect(outcomes.size).toBe(frozen.cases.length);
  expect([...outcomes.keys()].sort()).toEqual(compatibilityCases.map(({ id }) => id).sort());
  for (const { id, artifact, profile, inputs, target } of compatibilityCases) {
    const outcome = planBatch(artifact as CompiledArtifact, profile as CustomerProfile, inputs as SourceEvent[], target as TargetState);
    expect(canonicalJson(outcome), id).toBe(canonicalJson(outcomes.get(id)));
  }
});

test('keeps each sparse input position as an independent legacy envelope hold', () => {
  const inputs = new Array<SourceEvent>(3);
  inputs[1] = invoice;
  const outcome = planBatch(artifactA, profileA, inputs, emptyTargetA);
  const malformedHold = {
    eventIds: [], code: 'SOURCE_SCHEMA', dependencies: [],
    diagnostics: [{
      code: 'SOURCE_SCHEMA', severity: 'blocker', message: 'Invalid source event envelope', sourceIds: [], fieldPaths: [],
    }],
  };
  expect(outcome.holds).toEqual([malformedHold, malformedHold]);
  expect(outcome.plans.map(plan => plan.eventIds)).toEqual([[invoice.id]]);
});
