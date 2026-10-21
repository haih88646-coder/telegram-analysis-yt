import { getEnv } from '../../src/config.js';
import { syncNow } from '../../src/services/sync.js';
import { saveRecommendation, collectChannelBundle, generateFullReport } from '../../src/services/recommendations.js';
import { sendText } from '../../src/telegram/client.js';
import { logSafeError, AppError } from '../../src/utils/errors.js';

export default async function handler(req, res) {
  const cronSecret = getEnv('CRON_SECRET');
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
  } else {
    logSafeError('cron.auth', new Error('CRON_SECRET not set; rejecting cron run'));
    res.status(401).json({ ok: false, error: 'CRON_SECRET not configured' });
    return;
  }

  try {
    const summary = await syncNow();
    let weeklyNote = 'weekly AI report skipped (no GEMINI_API_KEY)';
    if (process.env.GEMINI_API_KEY) {
      try {
        const bundle = await collectChannelBundle();
        const report = await generateFullReport(bundle);
        await saveRecommendation('weekly_auto', bundle.channel.channelId, { report });
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.OWNER_TELEGRAM_ID) {
          await sendText(process.env.OWNER_TELEGRAM_ID.trim(), report);
        }
        weeklyNote = 'weekly AI report generated' + (process.env.TELEGRAM_BOT_TOKEN ? ' and sent to owner' : '');
      } catch (err) {
        logSafeError('cron.weekly', err);
        weeklyNote = `weekly AI report failed: ${String(err?.message || '').slice(0, 150)}`;
      }
    }
    res.status(200).json({
      ok: true,
      sync: {
        channel: summary.channel,
        videos: summary.videosSaved,
        dailyRows: summary.dailyRows,
        videoStatRows: summary.videoStatRows,
        trafficRows: summary.trafficRows,
        errors: summary.errors.slice(0, 5)
      },
      weekly: weeklyNote
    });
  } catch (err) {
    logSafeError('cron.sync', err);
    res.status(500).json({ ok: false, error: String(err?.message || 'sync failed').slice(0, 300) });
  }
}
