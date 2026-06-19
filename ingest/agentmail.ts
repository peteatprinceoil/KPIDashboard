// AgentMail REST client.
// Docs: https://docs.agentmail.to
// Set AGENTMAIL_API_KEY and AGENTMAIL_INBOX_ID in env.

export interface AgentMailMessage {
  message_id: string;
  subject: string;
  text?: string;       // plain-text body — only present on the full GET, not the list
  html?: string;
  from: string;
  to: string[];
  preview?: string;    // short snippet from list endpoint
  timestamp: string;   // ISO 8601
}

const BASE_URL = "https://api.agentmail.to/v0";

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

/** List the most recent messages in the inbox (summary — no body text). */
export async function listMessages(
  inboxId: string,
  apiKey: string,
  limit = 50
): Promise<AgentMailMessage[]> {
  const url = `${BASE_URL}/inboxes/${encodeURIComponent(inboxId)}/messages?limit=${limit}`;
  const res = await fetch(url, { headers: authHeaders(apiKey) });
  if (!res.ok) {
    throw new Error(`AgentMail listMessages ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return json.messages ?? [];
}

/** Fetch a single message with full body text. */
export async function getMessage(
  inboxId: string,
  messageId: string,
  apiKey: string
): Promise<AgentMailMessage> {
  const url = `${BASE_URL}/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`;
  const res = await fetch(url, { headers: authHeaders(apiKey) });
  if (!res.ok) {
    throw new Error(`AgentMail getMessage ${res.status}: ${await res.text()}`);
  }
  return res.json();
}
