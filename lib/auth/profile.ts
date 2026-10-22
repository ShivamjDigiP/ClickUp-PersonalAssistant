import { kv } from "../kv";

// A small record per signed-in person, created on first sign-in and updated on every sign-in. It holds NO token and
// nothing secret: just who they are and when they were last here. It is stored next to their chats and settings.
export type Profile = {
  userId: string;
  username: string;
  email: string;
  firstSeen: string;
  lastLogin: string;
  logins: number;
  method: "token" | "oauth";
};

const key = (userId: string) => `u/${userId}/profile`;

export async function recordLogin(user: { userId: string; username: string; email: string }, method: Profile["method"]): Promise<Profile> {
  const now = new Date().toISOString();
  const prev = await kv().get<Profile>(key(user.userId));
  const profile: Profile = {
    userId: user.userId,
    username: user.username,
    email: user.email,
    firstSeen: prev?.firstSeen ?? now,
    lastLogin: now,
    logins: (prev?.logins ?? 0) + 1,
    method,
  };
  await kv().set(key(user.userId), profile);
  return profile;
}

export const getProfile = (userId: string) => kv().get<Profile>(key(userId));
