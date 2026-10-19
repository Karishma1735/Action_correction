import { runAction } from '../viasocket/client.js';

// Action versions, from the viaSocket documents of each app.
const SLACK_GET_USER = 'rowrubgppa5r'; // Get User Information
const SLACK_SEND_DM = 'rowa5mg9fywy'; // Send Direct Message
const SLACK_SEND_MESSAGE = 'rowj2u3wc8h5'; // Send Message (supports link buttons)
const GMAIL_SEND = 'rowwj0sfmhub'; // Send Email

const SLACK_ID = /^[UW][A-Z0-9]{6,}$/;

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// The id may sit at the top level or under a wrapper, depending on how the action answers.
function extractSlackId(result) {
  for (const candidate of [result?.id, result?.user?.id, result?.data?.id, result?.data?.user?.id]) {
    if (typeof candidate === 'string' && SLACK_ID.test(candidate)) return candidate;
  }
  return null;
}

// Slack member id: the one saved on the person, else found by their email through the connected Slack
// workspace and saved so the lookup happens once.
async function resolveSlackId(person, remember) {
  if (person.slack_id) return person.slack_id;
  if (!person.email) throw new Error(`${person.name} has no Slack ID and no email to find it by`);
  const result = await runAction('slack', SLACK_GET_USER, {
    search_by: 'email_search',
    email: person.email,
    response_fields: ['id'],
  });
  const id = extractSlackId(result);
  if (!id) throw new Error(`No Slack user found for ${person.email}${result?.message ? ` (${result.message})` : ''}`);
  remember?.(id);
  return id;
}

// Delivers Slack DMs and email through the Slack/Gmail accounts connected on the Integrations page.
export const viasocketNotifier = {
  name: 'viasocket',
  async send({ channel, to, subject, text, doneUrl, rememberSlackId }) {
    if (channel === 'slack') {
      const userId = await resolveSlackId(to, rememberSlackId);
      if (doneUrl) {
        // A DM with a "Mark as done" button (a link button: the action's buttons open a URL).
        try {
          await runAction('slack', SLACK_SEND_MESSAGE, {
            destination: { messageto: 'user', userId: [userId] },
            markdown_content: `*${subject}*\n${text}`,
            buttons: { '✅ Mark as done': doneUrl },
            bot_details: { bot_name: 'Plug Informatrix' },
            preview: { unfurl_links: false, unfurl_media: false },
          });
          return;
        } catch (err) {
          console.warn('Slack button message failed, sending a plain DM with the link:', err.message);
          text = `${text}\n\nMark as done: ${doneUrl}`;
        }
      }
      await runAction('slack', SLACK_SEND_DM, {
        userId,
        content: `*${subject}*\n${text}`,
        isScheduledMessage: 'no', // always immediate
        bot_details: { bot_name: 'Plug Informatrix', customIcon: false },
      });
      return;
    }
    if (channel === 'email') {
      if (!to.email) throw new Error(`${to.name} has no email address`);
      // Sender, labels, cc/bcc and attachments are left out: Gmail sends from the connected account.
      await runAction('gmail', GMAIL_SEND, {
        to: to.email,
        subject,
        messageBody:
          text.split(/\n{2,}/).map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`).join('') +
          (doneUrl ? `<p><a href="${escapeHtml(doneUrl)}">Mark as done</a></p>` : ''),
      });
      return;
    }
    throw new Error(`Unknown channel: ${channel}`);
  },
};
