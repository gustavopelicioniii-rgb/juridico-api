const DATAJUD_UNSAFE_KEYS = new Set(['', 'changeme', 'mock', 'test']);

export const isDataJudMockEnabled = (): boolean =>
  process.env.DATAJUD_MOCK === 'true';

export const getDataJudApiKey = (): string | undefined =>
  process.env.DATAJUD_API_KEY?.trim();

export const validateDataJudProductionConfig = (): void => {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const apiKey = getDataJudApiKey();
  if (!apiKey || DATAJUD_UNSAFE_KEYS.has(apiKey.toLowerCase())) {
    throw new Error('FATAL: DATAJUD_API_KEY obrigatória em produção.');
  }

  if (isDataJudMockEnabled()) {
    throw new Error('FATAL: DATAJUD_MOCK não pode ser true em produção.');
  }
};

