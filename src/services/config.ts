type ViteEnv = {
  VITE_API_BASE_URL?: string;
  VITE_USE_MOCK_DATA?: string;
};

const env = ((import.meta as ImportMeta & { env?: ViteEnv }).env ?? {}) as ViteEnv;

export const API_BASE_URL = env.VITE_API_BASE_URL ?? '';

// Keep mock data enabled by default so the app works without a backend.
export const USE_MOCK_DATA = env.VITE_USE_MOCK_DATA !== 'false';