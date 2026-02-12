// Manually define ImportMetaEnv to avoid "Cannot find type definition file for 'vite/client'" error
interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY: string;
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
  [key: string]: any;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
