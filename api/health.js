export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: 'ai-youtube-analyst',
    time: new Date().toISOString(),
    database: Boolean(process.env.DATABASE_URL),
    node: process.version
  });
}
