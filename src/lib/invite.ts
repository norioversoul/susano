// Private preview: when SUSANO_INVITE_CODES is set (comma-separated), every page and API needs an invite cookie.
// The cookie holds a hash of the code, so it can't be made without knowing one. Runs in middleware (Web Crypto only).

export const INVITE_COOKIE = "susano_invite";

export function inviteCodes(): string[] {
  return (process.env.SUSANO_INVITE_CODES ?? "").split(",").map((c) => c.trim()).filter(Boolean);
}

export async function inviteToken(code: string): Promise<string> {
  const data = new TextEncoder().encode(`susano-invite:${code.trim().toLowerCase()}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function validToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  for (const code of inviteCodes()) if ((await inviteToken(code)) === token) return true;
  return false;
}
