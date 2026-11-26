import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as wait} from 'node:timers/promises';
import {TaskRoom} from './workflow.mjs';

export function inputFor(update, {group, owner}) {
  const {message, callback_query: callback} = update;
  if (message?.chat.id === group && message.from?.id === owner) {
    const text = message.text?.match(/^\/demo(?:@\w+)?\s+([\s\S]+)$/)?.[1];
    return text?.trim() ? {text} : null;
  }
  if (callback?.message?.chat.id !== group || callback.from?.id !== owner) return null;
  const match = /^(approve|reject):(T\d+):([a-f0-9]{16})$/.exec(callback.data ?? '');
  return match ? {callback: callback.id, decision: match[1], id: match[2], digest: match[3]} : null;
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const owner = Number(process.env.TELEGRAM_OWNER_ID);
  const group = Number(process.env.TELEGRAM_GROUP_ID);
  if (!/^\d+:[\w-]+$/.test(token ?? '') || !Number.isSafeInteger(owner) || owner <= 0 || !Number.isSafeInteger(group) || group >= 0) {
    throw new Error('Set the bot token, numeric owner ID and negative group ID in your local .env.');
  }
  const room = new TaskRoom(resolve('data', 'state.json'));
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  const call = async (method, params) => {
    let response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        redirect: 'error',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(params),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)])
      });
      const body = await response.json();
      if (response.ok && body.ok) return body.result;
    } catch {
      // Fetch errors can include the URL. Keep credentials out of logs.
    }
    throw new Error(`Telegram ${method} failed${response ? ` (HTTP ${response.status})` : ''}.`);
  };
  const send = (text, extra) => call('sendMessage', {chat_id: group, text, ...extra});
  console.log('Waiting for /demo messages from the configured owner and group.');
  while (!controller.signal.aborted) {
    try {
      const updates = await call('getUpdates', {offset: room.state.offset, timeout: 2, allowed_updates: ['message', 'callback_query']});
      for (const update of updates) {
        const offset = update.update_id + 1;
        const input = inputFor(update, {owner, group});
        if (input?.text) {
          if (room.state.task?.status === 'pending' || room.state.task?.messages?.length === 8 && room.state.task.status === 'collecting') {
            room.save({offset});
            await send('Resolve the preview or wait for the current batch before adding another message.');
            continue;
          }
          room.submit(input.text, Date.now(), offset);
        } else if (input?.callback) {
          const result = room.decide(input.id, input.digest, input.decision, offset);
          if (!result) room.save({offset});
          await call('answerCallbackQuery', {callback_query_id: input.callback, text: result?.status ?? 'This preview is no longer active.'});
          if (result) await send(`${result.id} · ${result.status === 'completed' ? 'Approved. Simulated draft is ready.' : 'Rejected.'}`);
        } else {
          room.save({offset});
        }
      }
      room.prepare();
      const task = room.state.task;
      if (task?.status === 'pending' && !task.previewSent) {
        const button = (text, decision) => ({text, callback_data: `${decision}:${task.id}:${task.digest}`});
        await send(`${task.id} · Simulated preview\n\n${task.preview}`, {
          reply_markup: {inline_keyboard: [[button('Approve and resume', 'approve'), button('Reject', 'reject')]]}
        });
        room.markPreviewSent(task.id);
      }
    } catch (error) {
      if (controller.signal.aborted) break;
      if (!error.message.startsWith('Telegram ')) throw error;
      console.error(error.message);
      await wait(2_000);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
