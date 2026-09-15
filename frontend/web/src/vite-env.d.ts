/// <reference types="vite/client" />

interface Window {
  signalgenDesktop?: {
    platform: string;
    versions: Readonly<{ chrome: string; electron: string }>;
  };
}
