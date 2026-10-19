import { config } from '../config.js';
import { viasocketNotifier } from './viasocket.js';

// Dev-only notifier: prints the message instead of sending it.
const logNotifier = {
  name: 'log',
  async send(message) {
    console.log(`[notify:${message.channel}] to=${message.to.name} :: ${message.text}`);
  },
};

// A notifier exposes send({ channel: 'slack' | 'email', to, subject, text }).
export function getNotifier() {
  return config.notifier === 'viasocket' ? viasocketNotifier : logNotifier;
}
