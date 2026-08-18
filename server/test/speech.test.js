const assert = require('node:assert/strict');
const test = require('node:test');
const { SPEECH_SPEED, buildSpeechRequest } = require('../speech');

test('all generated speech uses the shared 1.25x reading speed', () => {
  assert.equal(SPEECH_SPEED, 1.25);
  assert.deepEqual(buildSpeechRequest('Research summary'), {
    model: 'tts-1',
    input: 'Research summary',
    voice: 'echo',
    speed: 1.25,
    response_format: 'mp3',
  });
});
