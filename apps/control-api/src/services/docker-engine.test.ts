import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrowserComposeLabels } from './docker-engine.service.js';

test('dynamic browser containers are grouped under jingcang-poc', () => {
  const labels = buildBrowserComposeLabels(
    'chrome-140-dbae772d',
    'dynamic-chrome-140-dbae772d'
  );

  assert.equal(labels['com.docker.compose.project'], 'jingcang-poc');
  assert.equal(labels['com.docker.compose.service'], 'dynamic-chrome-140-dbae772d');
  assert.equal(labels['com.docker.compose.container-number'], '1');
  assert.equal(labels['com.docker.compose.oneoff'], 'False');
  assert.equal(labels['com.jingcang.managed'], 'true');
  assert.equal(labels['com.jingcang.browser-id'], 'chrome-140-dbae772d');
});
