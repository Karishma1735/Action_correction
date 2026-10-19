import { config } from '../config.js';

// Delivers Slack/email through viaSocket Embed using the user's connected accounts.
// The embed API calls are filled in from the viaSocket skill
// (.claude/skills/viasocket/SKILL.md), which has not been installed yet.
export const viasocketNotifier = {
  name: 'viasocket',
  async send(message) {
    if (!config.viasocket.embedSecret) {
      throw new Error('VIASOCKET_EMBED_SECRET is not set');
    }
    throw new Error(
      `viaSocket delivery is not implemented yet (channel=${message.channel}); install the viaSocket skill first`,
    );
  },
};
