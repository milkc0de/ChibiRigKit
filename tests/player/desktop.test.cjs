const {test} = require('node:test'), assert = require('node:assert/strict');
const {allowMedia, isPlayerURL, capturePower} = require('../../desktop/policy.cjs');
const origin = 'http://127.0.0.1:5510';
test('only the local control window can request camera or microphone', () => {
  assert.equal(allowMedia('media', origin + '/', origin, {mediaTypes:['video','audio']}), true);
  for (const url of [origin + '/obs', 'https://example.com/', 'http://127.0.0.1:5511/', origin + '.example.com/'])
    assert.equal(allowMedia('media', url, origin), false);
  assert.equal(allowMedia('notifications', origin, origin), false);
  assert.equal(allowMedia('media', origin, origin, {isMainFrame:false}), false);
  assert.equal(isPlayerURL('file:///etc/passwd', origin), false);
});
test('capture prevents idle suspension until input is stopped or the window exits', () => {
  const calls = [], power = capturePower({start(type) {calls.push(type); return 7;}, stop(id) {calls.push(id);}});
  power.set(true); power.set(true); assert.equal(power.active, true);
  power.set(false); power.set(false); assert.equal(power.active, false);
  assert.deepEqual(calls, ['prevent-app-suspension', 7]);
});
