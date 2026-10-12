// Safe JSON cloud-save recipe. Load before save; writes always use a condition.
// The save bytes are UTF-8 JSON. StarHermit accepts opaque bytes even though
// downloads use application/zip. Do not use this to read a different save format.
export class CloudSaveStore {
  constructor({ gameId, token, base = '', fetch: request = globalThis.fetch.bind(globalThis) }) {
    this.url = `${base.replace(/\/$/, '')}/api/v1/me/cloud-saves/${encodeURIComponent(`game:${gameId}`)}`;
    this.token = token; // Function returning the current player launch token.
    this.request = request;
    this.loaded = false;
    this.etag = null;
  }

  headers(extra = {}) {
    const token = this.token();
    if (!token) throw new Error('Sign in before accessing account progress.');
    return { Authorization: `Bearer ${token}`, ...extra };
  }

  async load(validate) {
    // A failed or invalid read blocks subsequent writes, including after a
    // previous successful read. The caller keeps its current game state.
    this.loaded = false;
    const response = await this.request(this.url, { headers: this.headers() });
    if (response.status === 404) {
      this.etag = null;
      this.loaded = true;
      return null;
    }
    if (!response.ok) throw await responseError(response);
    const etag = response.headers.get('ETag');
    if (!etag) throw new Error('Save version unavailable; retry on the game\'s hosted origin.');
    const value = JSON.parse(await response.text());
    if (!validate(value)) throw new Error('Saved progress has an unsupported format.');
    this.etag = etag;
    this.loaded = true;
    return value;
  }

  async save(value) {
    if (!this.loaded) throw new Error('Load and validate cloud progress before saving.');
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const condition = this.etag ? { 'If-Match': this.etag } : { 'If-None-Match': '*' };
    let response;
    try {
      response = await this.request(this.url, {
        method: 'PUT',
        headers: this.headers({ ...condition, 'Content-Type': 'application/json' }),
        body: JSON.stringify({ dataBase64: btoa(binary) }),
      });
    } catch (error) {
      // The server may have committed the write before the connection failed.
      this.loaded = false;
      throw error;
    }
    if (!response.ok) {
      if (response.status === 412) this.loaded = false;
      throw await responseError(response);
    }
    const body = await response.json().catch(() => null);
    if (!body?.etag) {
      this.loaded = false;
      throw new Error('Save acknowledgement unavailable; reload before another write.');
    }
    this.etag = body.etag;
    return body;
  }
}

async function responseError(response) {
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  return Object.assign(new Error(body?.error || text || response.statusText), {
    status: response.status, code: body?.code, body,
    retryAfter: response.headers.get('Retry-After'),
  });
}
