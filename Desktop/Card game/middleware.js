export const config = { matcher: '/:path*' };

export default function middleware(req) {
  const auth = req.headers.get('authorization');

  if (auth) {
    const [user, pass] = atob(auth.split(' ')[1]).split(':');
    if (user === 'pokerapp' && pass === 'pokerapp') {
      return; // pass through to static files
    }
  }

  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Poker App"' },
  });
}
