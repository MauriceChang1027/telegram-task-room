import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mergeWindowMs, TaskRoom} from './workflow.mjs';

const dir = mkdtempSync(join(tmpdir(), 'telegram-task-room-'));
const file = join(dir, 'state.json');
try {
  const room = new TaskRoom(file);
  room.submit('Plan a fictional library workshop for 20 participants.', 0);
  room.submit('Include an equipment checklist and an attendee reminder.', 1);
  const preview = room.prepare(mergeWindowMs + 1);
  console.log(`${preview.id} · Awaiting approval\n\n${preview.preview}`);
  const resumed = new TaskRoom(file);
  const result = resumed.decide(preview.id, preview.digest, 'approve');
  console.log(`\n${result.id} · Approved after restart. Simulated result: workshop draft ready.`);
} finally {
  rmSync(dir, {recursive: true, force: true});
}
