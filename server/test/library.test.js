const assert = require('node:assert/strict');
const test = require('node:test');
const { addPaperToLibrary } = require('../library');

function makeClient(error = null) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push({ method: 'from', table });
      return {
        async insert(value) {
          calls.push({ method: 'insert', value });
          return { error };
        },
      };
    },
  };
}

test('addPaperToLibrary inserts with no update requirement', async () => {
  const client = makeClient();
  await addPaperToLibrary(client, 'user-1', 'W123');
  assert.deepEqual(client.calls, [
    { method: 'from', table: 'user_library' },
    { method: 'insert', value: { user_id: 'user-1', paper_pmid: 'W123' } },
  ]);
});

test('addPaperToLibrary treats an existing relation as success', async () => {
  const client = makeClient({ code: '23505', message: 'duplicate key' });
  await addPaperToLibrary(client, 'user-1', 'W123');
});

test('addPaperToLibrary surfaces other persistence failures', async () => {
  const expected = { code: '42501', message: 'permission denied' };
  const client = makeClient(expected);
  await assert.rejects(addPaperToLibrary(client, 'user-1', 'W123'), expected);
});
