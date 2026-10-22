import { validateGemini, validateGroq, type KeyCheck } from "./ai";
import { githubLogin } from "./github";

// Everything whose secret can be connected from the Connections page: the name is both the storage key and the URL segment.
export const SECRET_PROVIDERS: Record<string, (secret: string) => Promise<KeyCheck>> = {
  github: async (token) => {
    const who = await githubLogin(token);
    return who.ok ? { ok: true } : who;
  },
  gemini: validateGemini,
  groq: validateGroq,
};
