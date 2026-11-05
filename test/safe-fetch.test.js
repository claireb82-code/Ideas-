import test from 'node:test';
import assert from 'node:assert/strict';
import { safeFetch, isPrivateIp } from '../src/safe-fetch.js';
import { fakeFetch } from './helpers.js';

const publicLookup = async () => [{ address: '93.184.216.34' }];

test('isPrivateIp', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test('blocks private literal IPs and hosts resolving to private addresses', async () => {
  const fetchImpl = fakeFetch({});
  await assert.rejects(safeFetch('http://169.254.169.254/latest/meta-data', { fetchImpl }), /non-public/);
  await assert.rejects(safeFetch('http://internal.test/', { fetchImpl, lookup: async () => [{ address: '10.0.0.5' }] }), /non-public/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('blocks non-http protocols', async () => {
  await assert.rejects(safeFetch('file:///etc/passwd', { fetchImpl: fakeFetch({}) }), /protocol/);
});

test('fetches html from a public host', async () => {
  const r = await safeFetch('https://ok.test/', { fetchImpl: fakeFetch({ 'https://ok.test/': '<p>hi</p>' }), lookup: publicLookup });
  assert.equal(r.text, '<p>hi</p>');
});

test('follows redirects but re-validates each hop', async () => {
  const f = async (url) => {
    if (String(url) === 'https://a.test/') return new Response(null, { status: 302, headers: { location: 'http://192.168.1.1/admin' } });
    return new Response('secret', { headers: { 'content-type': 'text/html' } });
  };
  await assert.rejects(safeFetch('https://a.test/', { fetchImpl: f, lookup: publicLookup }), /non-public/);
});

test('follows a normal redirect and reports the final URL', async () => {
  const f = async (url) =>
    String(url) === 'https://a.test/'
      ? new Response(null, { status: 301, headers: { location: '/home' } })
      : new Response('landed', { headers: { 'content-type': 'text/html' } });
  const r = await safeFetch('https://a.test/', { fetchImpl: f, lookup: publicLookup });
  assert.equal(r.url, 'https://a.test/home');
  assert.equal(r.text, 'landed');
});

test('gives up after too many redirects', async () => {
  const f = async () => new Response(null, { status: 302, headers: { location: '/loop' } });
  await assert.rejects(safeFetch('https://a.test/', { fetchImpl: f, lookup: publicLookup }), /too many redirects/);
});

test('rejects non-text content types and HTTP errors', async () => {
  const pdf = fakeFetch({ 'https://a.test/x': { body: '%PDF', headers: { 'content-type': 'application/pdf' } } });
  await assert.rejects(safeFetch('https://a.test/x', { fetchImpl: pdf, lookup: publicLookup }), /content-type/);
  await assert.rejects(safeFetch('https://a.test/missing', { fetchImpl: fakeFetch({}), lookup: publicLookup }), /HTTP 404/);
});

test('caps the body size', async () => {
  const big = 'a'.repeat(50_000);
  const r = await safeFetch('https://a.test/', { fetchImpl: fakeFetch({ 'https://a.test/': big }), lookup: publicLookup, maxBytes: 1000 });
  assert.ok(r.text.length < big.length);
});
