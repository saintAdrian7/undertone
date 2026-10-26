const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * A base URL for an OpenAI-compatible server: https anywhere, plain http only to this machine,
 * no credentials, query or fragment. Returns it normalised (no trailing slash). Throws with a
 * message fit for the Settings window otherwise.
 */
export function validateBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Base URL must be a full URL such as https://api.openai.com/v1')
  }
  if (url.username || url.password) throw new Error('Base URL must not contain credentials')
  if (url.search || url.hash) throw new Error('Base URL must not contain a query or fragment')
  const loopback = LOOPBACK_HOSTS.has(url.hostname)
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) {
    throw new Error('Base URL must use https (plain http is allowed only for localhost), so your key and transcript are never sent in the clear')
  }
  return url.toString().replace(/\/+$/, '')
}
