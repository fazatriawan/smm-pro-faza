/**
 * Records Outstand HTTP calls for integration tests.
 * @param {{ postIds?: string[] }} [opts]
 */
export function createRecordingOutstandClient(opts = {}) {
  const postIds = opts.postIds ?? ['ErFTA', '7it8W', 'ew0Tr', 'ArYS7'];
  /** @type {Array<{ method: string, url: string, data?: unknown }>} */
  const calls = [];
  let postCallIndex = 0;

  return {
    calls,
    async get(url) {
      calls.push({ method: 'GET', url });
      throw new Error(`Unexpected GET in test: ${url}`);
    },
    async post(url, data) {
      calls.push({ method: 'POST', url, data });
      if (url === '/v1/posts/' || url === '/v1/posts') {
        const id = postIds[postCallIndex++] ?? `POST${postCallIndex}`;
        return { data: { post: { id } } };
      }
      throw new Error(`Unexpected POST in test: ${url}`);
    },
    async delete(url) {
      calls.push({ method: 'DELETE', url });
      return { data: { success: true } };
    },
    async put() {
      throw new Error('Unexpected PUT in publishBulk test');
    },
  };
}

/**
 * @param {Array<{ method: string, url: string, data?: { accounts?: string[] } }>} calls
 */
export function getPublishPostCalls(calls) {
  return calls.filter(
    (c) =>
      c.method === 'POST' &&
      (c.url === '/v1/posts/' || c.url === '/v1/posts')
  );
}
