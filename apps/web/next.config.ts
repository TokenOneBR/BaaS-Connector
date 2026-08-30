import type { NextConfig } from 'next';

const config: NextConfig = {
  // Imagem unica para homologacao e producao: `API_INTERNAL_URL` e lida em
  // RUNTIME pelo cliente server-only, nunca embutida no bundle.
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    serverActions: {
      /**
       * Origens permitidas, EXPLICITAS.
       *
       * O Next 15 confere `Origin` contra `Host` por padrao, mas isso e um
       * comportamento de framework, nao um controle que um revisor de
       * seguranca consiga apontar — e evapora sob um `allowedOrigins` mal
       * configurado. Declarar aqui torna a regra visivel, e o double-submit
       * de `server/csrf.ts` e a segunda camada.
       */
      allowedOrigins: [new URL(process.env.CONSOLE_ORIGIN ?? 'http://localhost:3000').host],
    },
  },
};

export default config;
