import { config } from '../config.js';

const PRIORITIES = ['low', 'medium', 'high'];

function fallbackAnalysis(action, feedback) {
  const urgent = /urgent|asap|blocker|critical|security|legal/i.test(feedback);
  return {
    summary: `${action.title}: ${feedback}`.slice(0, 280),
    priority: urgent ? 'high' : 'medium',
    source: 'rules',
  };
}

// Summarises reviewer feedback and rates urgency. Falls back to simple rules
// when no Gemini key is configured or the call fails.
export async function analyzeFeedback(action, decision, feedback) {
  const { apiKey, model } = config.gemini;
  if (!apiKey) return fallbackAnalysis(action, feedback);

  const prompt =
    `A reviewer marked an action as "${decision}".\n` +
    `Action title: ${action.title}\nAction description: ${action.description || '-'}\n` +
    `Reviewer feedback: ${feedback}\n\n` +
    'Reply with JSON: {"summary": "<=2 sentences: what must be fixed", "priority": "low|medium|high"}.';

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
    return {
      summary: String(parsed.summary).slice(0, 500),
      priority: PRIORITIES.includes(parsed.priority) ? parsed.priority : 'medium',
      source: 'gemini',
    };
  } catch (err) {
    console.warn('Gemini analysis failed, using rules:', err.message);
    return fallbackAnalysis(action, feedback);
  }
}
