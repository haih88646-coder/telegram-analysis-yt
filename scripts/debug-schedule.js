import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getYoutubeClients } from '../src/youtube/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const { youtube } = getYoutubeClients();
const ch = await youtube.channels.list({ part: 'contentDetails', mine: true });
const uploadsId = ch.data.items?.[0]?.contentDetails.relatedPlaylists.uploads;
console.log('uploads playlist:', uploadsId);

let items = [];
let token = undefined;
do {
  const res = await youtube.playlistItems.list({ part: 'snippet,contentDetails', playlistId: uploadsId, maxResults: 50, pageToken: token });
  items.push(...(res.data.items || []));
  token = res.data.nextPageToken;
} while (token);

console.log(`\nTotal uploads playlist items: ${items.length}`);
for (const it of items.slice(0, 25)) {
  const cd = it.contentDetails || {};
  const sn = it.snippet || {};
  console.log(`- id=${cd.videoId} title="${String(sn.title).slice(0, 40)}" snippet.publishedAt=${sn.publishedAt} videoPublishedAt=${cd.videoPublishedAt ?? '(none)'}`);
}

const ids = items.map((i) => i.contentDetails?.videoId).filter(Boolean).slice(0, 25);
if (ids.length) {
  const vids = await youtube.videos.list({ part: 'snippet,status,contentDetails', id: ids.join(',') });
  console.log(`\nvideos.list detail (${vids.data.items?.length || 0}):`);
  for (const v of vids.data.items || []) {
    const s = v.status || {};
    const n = v.snippet || {};
    console.log(`- ${v.id} "${String(n.title).slice(0, 40)}" | snippet.publishedAt=${n.publishedAt} | status.privacyStatus=${s.privacyStatus} uploadStatus=${s.uploadStatus} publishAt=${s.publishAt ?? '(none)'} lifeCycleStatus=${s.lifeCycleStatus ?? '(none)'}`);
  }
}
