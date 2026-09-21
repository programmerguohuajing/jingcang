import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeleniumRepository, selectSeleniumTag } from './browser-provisioning.service.js';

test('buildSeleniumRepository supports a custom registry namespace', () => {
  assert.equal(
    buildSeleniumRepository('chrome', 'registry.example.com/team/selenium'),
    'registry.example.com/team/selenium/standalone-chrome'
  );
  assert.equal(buildSeleniumRepository('firefox'), 'selenium/standalone-firefox');
});

test('selectSeleniumTag resolves a major browser version to the newest dated stable tag', () => {
  const tag = selectSeleniumTag('140', [
    '140.0-chromedriver-140.0-20260909',
    '140.0-20260808',
    '140.0.7339.207-20260909',
    '140.0-20260909',
    '140.0-chromedriver-140.0-grid-4.48.0-20260909'
  ]);

  assert.equal(tag, '140.0-20260909');
});

test('selectSeleniumTag prefers an exact tag when it exists', () => {
  assert.equal(
    selectSeleniumTag('153.0', ['153.0', '153.0-20260909']),
    '153.0'
  );
});

test('selectSeleniumTag resolves a full browser version to a dated release', () => {
  assert.equal(
    selectSeleniumTag('140.0.7339.207', [
      '140.0.7339.207-chromedriver-140.0.7339.207-20260909',
      '140.0.7339.207-20260808',
      '140.0.7339.207-20260909'
    ]),
    '140.0.7339.207-20260909'
  );
});
