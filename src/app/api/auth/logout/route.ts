import { NextResponse } from 'next/server';
import { validateOrigin } from '@/lib/security/origin';
import { getSessionCookieConfig, validateSession, revokeSession } from '@/lib/security/session';

export async function POST(req: Request) {
  // 1. Origin validation
  const originCheck = validateOrigin(req);
  if (!originCheck.valid) {
    return NextResponse.json(
      { error: 'درخواست نامعتبر از مبدأ غیرمجاز شناسایی شد.' },
      { status: 403 }
    );
  }

  // 2. Validate session to find jti
  const auth = await validateSession(req);
  if (auth.valid && auth.jti) {
    await revokeSession(auth.jti);
  }

  // 3. Clear session cookie and legacy token cookie
  const response = NextResponse.json({
    success: true,
    message: 'خروج با موفقیت انجام شد',
  });

  const cookieConfig = getSessionCookieConfig();
  response.cookies.set(cookieConfig.name, '', {
    ...cookieConfig,
    maxAge: 0,
  });
  response.cookies.set('token', '', {
    path: '/',
    maxAge: 0,
  });

  return response;
}

export async function GET(req: Request) {
  const auth = await validateSession(req);
  if (auth.valid && auth.jti) {
    await revokeSession(auth.jti);
  }

  const response = NextResponse.redirect(new URL('/', req.url));
  const cookieConfig = getSessionCookieConfig();
  response.cookies.set(cookieConfig.name, '', {
    ...cookieConfig,
    maxAge: 0,
  });
  response.cookies.set('token', '', {
    path: '/',
    maxAge: 0,
  });

  return response;
}
