import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

// Server-side session. The role used to live only in sessionStorage, which the browser (and anyone
// with devtools) controls. Server actions now trust ONLY this signed, httpOnly cookie.

export type Session = { role: 'admin' | 'staff'; name: string };

const COOKIE_NAME = 'pos_session';
const MAX_AGE_SECONDS = 12 * 60 * 60;

// Set SESSION_SECRET in Vercel. Without it we derive one from the admin passcode so it still works.
const secret = () =>
  process.env.SESSION_SECRET || `${process.env.ADMIN_PASSCODE || 'admin123'}:pos-session-v1`;

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');

export async function startSession(session: Session): Promise<void> {
  const payload = Buffer.from(
    JSON.stringify({ r: session.role, n: session.name, e: Date.now() + MAX_AGE_SECONDS * 1000 }),
  ).toString('base64url');
  (await cookies()).set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).set(COOKIE_NAME, '', { path: '/', maxAge: 0 });
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.e !== 'number' || data.e < Date.now()) return null;
    if (data.r !== 'admin' && data.r !== 'staff') return null;
    return { role: data.r, name: String(data.n || '') };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error('Your session has expired. Please log in again.');
  return session;
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.role !== 'admin') throw new Error('Only an admin can do this.');
  return session;
}
