/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { AppBindings } from '../src/types';

declare global {
  namespace Cloudflare {
    interface Env extends AppBindings {}
  }
}

export {};
