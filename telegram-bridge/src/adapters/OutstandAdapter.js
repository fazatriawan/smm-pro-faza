/**
 * OutstandAdapter — wrapper konkret di atas `services/outstand.js` yang ada.
 *
 * Status Phase 0: SKELETON. Method-method di sini sengaja men-delegasi
 * ke service eksisting tanpa mengubah perilaku. Tujuannya:
 *  - Memberi call-site (bot.js, worker, scheduler) satu permukaan abstrak
 *    yang bisa dipakai mulai Phase 1.
 *  - Memudahkan tukar implementasi (Vista, Meta direct) tanpa ubah call-site.
 *
 * Belum dipakai oleh runtime; aman untuk dideploy karena tidak diimport
 * di entry point (`src/index.js`).
 */

import {
  IPublishingAdapter,
  AdapterError,
  UnsupportedAdapterError,
} from './IPublishingAdapter.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('adapter:outstand');

export class OutstandAdapter extends IPublishingAdapter {
  /**
   * @param {{ outstandService?: any }} [deps]
   */
  constructor(deps = {}) {
    super();
    this.deps = deps;
  }

  get name() {
    return 'outstand';
  }

  async _service() {
    if (this.deps.outstandService) return this.deps.outstandService;
    return import('../services/outstand.js');
  }

  async listAccounts() {
    const svc = await this._service();
    if (typeof svc.listSocialAccounts !== 'function') {
      throw new UnsupportedAdapterError('listAccounts');
    }
    const accs = await svc.listSocialAccounts();
    return accs.map((a) => ({
      accountId: String(a.id),
      network: String(a.network || '').toLowerCase(),
      username: a.username || '',
      pageId: a.pageId,
    }));
  }

  async publish(req) {
    log.debug(
      {
        idempotencyKey: req?.idempotencyKey,
        targets: req?.targets?.length,
        media: req?.media?.length,
      },
      'publish() invoked (skeleton)',
    );
    throw new AdapterError(
      'OutstandAdapter.publish() belum dihubungkan ke services/outstand.js — Phase 1 task.',
      { code: 'NOT_WIRED', retriable: false },
    );
  }

  async getStatus(postId) {
    const svc = await this._service();
    if (typeof svc.getPost !== 'function') {
      throw new UnsupportedAdapterError('getStatus');
    }
    const raw = await svc.getPost(postId);
    return {
      postId: String(raw?.id ?? postId),
      status: raw?.status || 'unknown',
      accounts: [],
      fetchedAtIsoUtc: new Date().toISOString(),
    };
  }

  async health() {
    const t0 = Date.now();
    try {
      const svc = await this._service();
      if (typeof svc.listSocialAccounts === 'function') {
        await svc.listSocialAccounts();
      }
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        info: { error: err?.message || String(err) },
      };
    }
  }
}

export default OutstandAdapter;
