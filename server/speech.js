const SPEECH_SPEED = 1.25;

function buildSpeechRequest(input, { voice = 'echo' } = {}) {
  return {
    model: 'tts-1',
    input,
    voice,
    speed: SPEECH_SPEED,
    response_format: 'mp3',
  };
}

module.exports = {
  SPEECH_SPEED,
  buildSpeechRequest,
};
