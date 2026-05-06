// CC Pocket — fetch ラッパ
// Bearer token は in-memory のみ保持 (PRD §認証)

export function createApi() {
  let token = null;
  return {
    setToken(t) { token = t; },
    getToken() { return token; },
    clearToken() { token = null; },
    async request(method, path, body, { includeToken = true } = {}) {
      const headers = {};
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (includeToken && token) headers['authorization'] = `Bearer ${token}`;
      const res = await fetch(path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      let json = null;
      try { json = await res.json(); } catch { /* not json */ }
      return { status: res.status, body: json };
    },
  };
}
