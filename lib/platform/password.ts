import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Passwords are stored as scrypt hashes with a random salt, never as text. Format: s1$N$r$p$salt$hash
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const N = 16384;
const R = 8;
const P = 1;
const LEN = 64;
const opts = { N, r: R, p: P, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, LEN, opts);
  return ["s1", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const [v, n, r, p, salt, hash] = (stored ?? "").split("$");
  if (v !== "s1" || !salt || !hash) return false;
  try {
    const want = Buffer.from(hash, "base64url");
    const got = await scryptAsync(password, Buffer.from(salt, "base64url"), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: opts.maxmem });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

// Sign-in does the same amount of work whether or not the e-mail exists, so response time does not reveal who has an account.
let dummy: Promise<string> | undefined;
export const dummyHash = () => (dummy ??= hashPassword("not-a-real-password"));

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "That password is too long.";
  if (/^(.)\1+$/.test(password)) return "Choose a password that is not one repeated character.";
  return null;
}
