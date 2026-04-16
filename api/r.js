const CODE_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const HOME = 'https://studioazur.dev';

export default function handler(req, res) {
  const code = req.query.c || '';
  const valid = CODE_RE.test(code);

  if (valid) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        code,
        ua: req.headers['user-agent'] || '',
        ref: req.headers['referer'] || '',
        ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
      })
    );
  }

  const dest = valid
    ? `${HOME}/?utm_source=outreach&utm_medium=email&utm_campaign=artisan-q2&utm_content=${encodeURIComponent(code)}`
    : `${HOME}/`;

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', dest);
  res.status(302).end();
}
