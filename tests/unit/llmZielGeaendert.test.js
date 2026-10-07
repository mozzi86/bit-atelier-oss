// RC-04 (74-01 Task 9): a stored LLM api_key may only be reused for the
// endpoint it was stored for. zielGeaendert() is the gate used by
// PUT /llm/connections/:id and POST /llm/test in packages/nova-core/server/routes.js
// (and mirrored in supabase/functions/llm/index.ts).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { zielGeaendert } from '../../packages/nova-core/server/routes.js';

const gespeichert = { provider: 'anthropic', base_url: 'https://api.anthropic.com/' };

describe('zielGeaendert', () => {
  it('unchanged target → false (no provider/base_url in body)', () => {
    assert.equal(zielGeaendert(gespeichert, { name: 'neu', model: 'x' }), false);
  });
  it('same values, trailing slash differs → false', () => {
    assert.equal(zielGeaendert(gespeichert, { base_url: 'https://api.anthropic.com' }), false);
    assert.equal(zielGeaendert(gespeichert, { provider: 'anthropic' }), false);
  });
  it('other base_url → true (would exfiltrate the stored key)', () => {
    assert.equal(zielGeaendert(gespeichert, { base_url: 'https://evil.example/v1' }), true);
  });
  it('other provider → true', () => {
    assert.equal(zielGeaendert(gespeichert, { provider: 'custom' }), true);
  });
  it('stored row without base_url, body sets one → true', () => {
    assert.equal(zielGeaendert({ provider: 'openai' }, { base_url: 'https://x.example' }), true);
  });
  it('empty body base_url against empty stored → false', () => {
    assert.equal(zielGeaendert({ provider: 'openai', base_url: '' }, { base_url: '' }), false);
  });
});
