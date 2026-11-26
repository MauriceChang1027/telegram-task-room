import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {atomicWriteJSON} from './atomic-store.mjs';

export const mergeWindowMs = 12_000;
const limit = 8;

export class TaskRoom {
  constructor(file) {
    this.file = file;
    try {
      this.state = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = {sequence: 0, offset: 0, task: null};
    }
  }

  save(changes) {
    const state = {...this.state, ...changes};
    atomicWriteJSON(this.file, state);
    this.state = state;
  }

  submit(text, now = Date.now(), offset = this.state.offset) {
    const item = this.state.task;
    if (item?.status === 'pending') {
      throw new Error('Resolve the pending preview before starting another task.');
    }
    const message = text.trim().replace(/\s+/g, ' ').slice(0, 300);
    if (!message) throw new Error('Add a text brief.');
    const collecting = item?.status === 'collecting';
    const sequence = this.state.sequence + (collecting ? 0 : 1);
    const messages = collecting ? [...item.messages, message] : [message];
    if (messages.length > limit) throw new Error('This demo accepts up to eight messages per task.');
    const task = {id: `T${sequence}`, status: 'collecting', messages, due: now + mergeWindowMs};
    this.save({task, sequence, offset});
    return task;
  }

  prepare(now = Date.now()) {
    const item = this.state.task;
    if (item?.status !== 'collecting' || now < item.due) return null;
    const preview = [
      'Manager · Combined brief',
      ...item.messages.map(message => `• ${message}`),
      'Operations · Build an event checklist.',
      'Content · Draft a reminder for attendees.',
      'Data · Mark the schedule and capacity to be confirmed.',
      'Reviewer · Flag pending details before any release.'
    ].join('\n');
    const digest = createHash('sha256').update(preview).digest('hex').slice(0, 16);
    const task = {...item, preview, digest, status: 'pending', previewSent: false};
    this.save({task});
    return task;
  }

  markPreviewSent(id) {
    const item = this.state.task;
    if (item?.id === id && item.status === 'pending') this.save({task: {...item, previewSent: true}});
  }

  decide(id, digest, decision, offset = this.state.offset) {
    const item = this.state.task;
    if (!['approve', 'reject'].includes(decision)) return null;
    if (item?.status !== 'pending' || item.id !== id || item.digest !== digest) return null;
    const task = {...item, status: decision === 'approve' ? 'completed' : 'rejected'};
    this.save({task, offset});
    return task;
  }
}
