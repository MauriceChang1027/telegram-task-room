import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {inputFor} from './telegram.mjs';
import {mergeWindowMs, TaskRoom} from './workflow.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'task-room-test-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const file = join(dir, 'state.json');
  return {file, room: new TaskRoom(file)};
}

test('two messages extend the merge window and survive restart', t => {
  const {file, room} = fixture(t);
  room.submit('Fake event', 1, 101);
  room.submit('Add a reminder', 2000, 102);
  const resumed = new TaskRoom(file);
  assert.equal(resumed.state.offset, 102);
  assert.equal(resumed.prepare(mergeWindowMs + 1), null);
  const item = resumed.prepare(mergeWindowMs + 2000);
  assert.deepEqual(item.messages, ['Fake event', 'Add a reminder']);
  assert.match(item.preview, /Reviewer/);
});

test('only the exact pending preview may be approved once after restart', t => {
  const {file, room} = fixture(t);
  room.submit('Fake event', 0);
  const item = room.prepare(mergeWindowMs);
  const resumed = new TaskRoom(file);
  assert.throws(() => resumed.submit('Another event'), /pending/);
  assert.equal(resumed.decide('T99', item.digest, 'approve'), null);
  assert.equal(resumed.decide(item.id, 'wrong', 'approve'), null);
  assert.equal(resumed.decide(item.id, item.digest, 'approve', 107).status, 'completed');
  assert.equal(resumed.decide(item.id, item.digest, 'approve'), null);
  assert.equal(new TaskRoom(file).state.offset, 107);
});

test('a rejected preview ends the task and the next starts with a new ID', t => {
  const {room} = fixture(t);
  room.submit('Fake event', 0);
  const item = room.prepare(mergeWindowMs);
  assert.equal(room.decide(item.id, item.digest, 'reject').status, 'rejected');
  assert.equal(room.submit('Another event').id, 'T2');
});

test('Telegram only accepts explicit demo commands from the configured owner and group', () => {
  const rule = {owner: 17, group: -42};
  const message = {chat: {id: -42}, from: {id: 17}, text: '/demo Fake event'};
  assert.deepEqual(inputFor({message}, rule), {text: 'Fake event'});
  assert.equal(inputFor({message: {...message, text: 'Normal chat'}}, rule), null);
  assert.equal(inputFor({message: {...message, from: {id: 18}}}, rule), null);
  assert.equal(inputFor({message: {...message, chat: {id: -43}}}, rule), null);
});

test('Telegram approval buttons require an authorized sender and a well-formed payload', () => {
  const rule = {owner: 17, group: -42};
  const callback = {id: 'fixture', from: {id: 17}, message: {chat: {id: -42}}, data: 'approve:T1:0123456789abcdef'};
  assert.equal(inputFor({callback_query: callback}, rule).decision, 'approve');
  assert.equal(inputFor({callback_query: {...callback, from: {id: 18}}}, rule), null);
  assert.equal(inputFor({callback_query: {...callback, data: 'approve:T1'}}, rule), null);
});
