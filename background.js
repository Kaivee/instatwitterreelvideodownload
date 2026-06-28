/**
 * background.js — Service Worker for Video Saver
 *
 * Runs in extension context — NOT subject to CORS.
 * host_permissions in manifest.json allow fetch() to any declared domain.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'resolveAndDownload') {
    resolveAndDownload(message.pageUrl)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.action === 'downloadVideo') {
    downloadBlob(message.videoUrl, message.pageUrl)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  return false;
});

// ─────────────────────────────────────────────────────────────
// resolveAndDownload
// ─────────────────────────────────────────────────────────────
async function resolveAndDownload(pageUrl) {
  const hrefLow = pageUrl.toLowerCase();

  if (hrefLow.includes('twitter.com') || hrefLow.includes('x.com')) {
    const match = pageUrl.match(/\/status\/(\d+)/);
    if (!match) {
      return { success: false, error: 'Could not find a tweet ID in this URL.' };
    }

    const tweetId = match[1];
    const videoUrl = await fetchSyndicationBestMp4(tweetId);

    if (!videoUrl) {
      return {
        success: false,
        error: 'No downloadable video found. Private or age-restricted tweets are not supported.',
      };
    }

    return await downloadBlob(videoUrl, pageUrl);
  }

  return { success: false, error: 'Unsupported site for background resolution.' };
}

// ─────────────────────────────────────────────────────────────
// fetchSyndicationBestMp4
// ─────────────────────────────────────────────────────────────
async function fetchSyndicationBestMp4(tweetId) {
  const token = (Number(tweetId) / 1e15 * Math.PI).toString(36).replace(/0/g, '').replace(/\./g, '');
  const apiUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=${token}&lang=en`;

  let res;
  try {
    res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
        'Accept': 'application/json, */*',
        'Referer': 'https://platform.twitter.com/',
        'Origin': 'https://platform.twitter.com',
      }
    });
  } catch (netErr) {
    console.error('[VideoSaver] Syndication fetch failed:', netErr);
    return null;
  }

  if (!res.ok) return null;

  let data;
  try { data = await res.json(); } catch (_) { return null; }

  let variants = [];
  if (data.video?.variants)             variants = variants.concat(data.video.variants);
  if (Array.isArray(data.mediaDetails)) {
    for (const m of data.mediaDetails) {
      if (m.video_info?.variants)       variants = variants.concat(m.video_info.variants);
    }
  }

  const mp4s = variants
    .filter(v => v.url && v.content_type && v.content_type.toLowerCase().includes('video/mp4'))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  return mp4s.length ? mp4s[0].url : null;
}

// ─────────────────────────────────────────────────────────────
// downloadBlob — fetches binary content and downloads via Base64 data URL
// ─────────────────────────────────────────────────────────────
async function downloadBlob(videoUrl, pageUrl) {
  const filename = generateFilename(pageUrl);

  try {
    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download(
        { url: videoUrl, filename, saveAs: false, conflictAction: 'uniquify' },
        (id) => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(id)
      );
    });
    return { success: true, downloadId };
  } catch (dlErr) {
    return { success: false, error: dlErr.message };
  }
}

// ─────────────────────────────────────────────────────────────
// generateFilename
// ─────────────────────────────────────────────────────────────
function generateFilename(pageUrl) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let prefix = 'video';
  try {
    const u = new URL(pageUrl), h = u.hostname.toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);
    if (h.includes('instagram.com')) {
      const isStory = u.pathname.includes('/stories/');
      const id = parts[parts.length - 1];
      const type = isStory ? 'story' : 'reel';
      prefix = id && id.length > 3 ? `instagram_${type}_${id}` : `instagram_${type}`;
    } else if (h.includes('twitter.com') || h.includes('x.com')) {
      const si = parts.indexOf('status');
      prefix = si !== -1 && parts[si + 1] ? `x_${parts[si + 1]}` : 'x_video';
    }
  } catch (_) {}
  return `${prefix}_${ts}.mp4`;
}
