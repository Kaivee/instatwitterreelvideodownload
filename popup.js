/**
 * popup.js — Video Saver for Instagram & X (Twitter)
 */

const downloadBtn           = document.getElementById('downloadBtn');
const btnText               = document.getElementById('btnText');
const spinner               = document.getElementById('spinner');
const statusEl              = document.getElementById('status');
const siteBadge             = document.getElementById('siteBadge');
const siteDot               = document.getElementById('siteDot');
const manualSelectContainer = document.getElementById('manualSelectContainer');
const manualSelectLink      = document.getElementById('manualSelectLink');

const ICONS = {
  success: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>',
  error:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-6h2v6z"/></svg>',
};

function showStatus(type, msg) {
  statusEl.className = type;
  statusEl.innerHTML = `${ICONS[type]}<span>${msg}</span>`;
}
function resetButton() {
  downloadBtn.disabled  = false;
  btnText.textContent   = 'Find & Download Video';
  spinner.style.display = 'none';
}
function setLoading() {
  downloadBtn.disabled  = true;
  btnText.textContent   = 'Scanning…';
  spinner.style.display = 'block';
  statusEl.className    = '';
  statusEl.innerHTML    = '';
}

// ── Site detection ──────────────────────────────────────────────
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const url = tab.url.toLowerCase();
    let siteName = '', siteClass = 'unsupported';

    if (url.includes('instagram.com'))                              { siteName = 'Instagram';   siteClass = 'instagram'; }
    else if (url.includes('twitter.com') || url.includes('x.com')) { siteName = 'X (Twitter)'; siteClass = 'twitter';   }

    if (siteName) {
      siteBadge.innerHTML = `<span class="dot ${siteClass}"></span>
        <span>Detected: <span class="site-name">${siteName}</span></span>`;
      downloadBtn.disabled = false;
      manualSelectContainer.style.display = 'block';
    } else {
      siteBadge.innerHTML = `<span class="dot unsupported"></span><span>Unsupported site</span>`;
      showStatus('warning', 'Navigate to an Instagram Reel or X/Twitter post with a video, then reopen.');
      manualSelectContainer.style.display = 'none';
    }
  } catch (e) { console.error('Site detection failed:', e); }
})();

// ── Helpers ─────────────────────────────────────────────────────
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

function startDownload(videoUrl, pageUrl) {
  // Route through background so the fetch uses proper headers + session cookies
  chrome.runtime.sendMessage({ action: 'downloadVideo', videoUrl, pageUrl }, (response) => {
    if (chrome.runtime.lastError) {
      showStatus('error', `Download failed: ${chrome.runtime.lastError.message}`);
      resetButton(); return;
    }
    if (response?.success) {
      showStatus('success', 'Download started! Check your Downloads folder.');
      btnText.textContent   = 'Done ✓';
      spinner.style.display = 'none';
      downloadBtn.disabled  = true;
    } else {
      showStatus('error', response?.error || 'Download failed unexpectedly.');
      resetButton();
    }
  });
}

// ── "Find & Download" button ────────────────────────────────────
downloadBtn.addEventListener('click', async () => {
  setLoading();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { showStatus('error', 'Could not access tab.'); resetButton(); return; }

    const url = tab.url.toLowerCase();
    const isTwitter = url.includes('twitter.com') || url.includes('x.com');

    if (isTwitter) {
      // ── Twitter: resolve entirely in background (no CORS, no page injection) ──
      btnText.textContent = 'Resolving…';
      chrome.runtime.sendMessage({ action: 'resolveAndDownload', pageUrl: tab.url }, (response) => {
        if (chrome.runtime.lastError) {
          showStatus('error', `Extension error: ${chrome.runtime.lastError.message}`);
          resetButton(); return;
        }
        if (response?.success) {
          showStatus('success', 'Download started! Check your Downloads folder.');
          btnText.textContent   = 'Done ✓';
          spinner.style.display = 'none';
          downloadBtn.disabled  = true;
        } else {
          showStatus('error', response?.error || 'Download failed.');
          resetButton();
        }
      });
    } else {
      // ── Instagram / other: inject scanner into page ──
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scanForVideo });

      if (!result)       { showStatus('error', 'Scanner returned no data.');                       resetButton(); return; }
      if (result.error)  { showStatus(result.privacy ? 'warning' : 'error', result.error);         resetButton(); return; }

      if (result.videoUrl) {
        btnText.textContent = 'Downloading…';
        startDownload(result.videoUrl, tab.url);
      }
    }
  } catch (err) {
    showStatus('error', `Error: ${err.message}`);
    resetButton();
  }
});

// ── "Select manually" link ──────────────────────────────────────
manualSelectLink.addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: selectVideoManually });
    window.close();
  } catch (err) {
    showStatus('error', `Could not start selector: ${err.message}`);
  }
});

// ═══════════════════════════════════════════════════════════════
// INJECTED: scanForVideo  (runs inside the active tab)
// ═══════════════════════════════════════════════════════════════
async function scanForVideo() {
  const href    = window.location.href;
  const hrefLow = href.toLowerCase();

  if (hrefLow.includes('/direct/') || hrefLow.includes('/messages')) {
    return { error: 'Downloads disabled in private messages.', privacy: true };
  }

  // ── Shared utilities ────────────────────────────────────────
  // Parse WxH from Twitter CDN URL for quality sorting
  function parseResolutionArea(url) {
    const m = url.match(/\/(\d+)x(\d+)\//);
    return m ? parseInt(m[1]) * parseInt(m[2]) : 0;
  }

  // Scan performance resource entries for Twitter video.twimg.com MP4 URLs.
  // When a video plays in the browser the actual mp4 URL is recorded here.
  function getTwitterVideosFromPerf() {
    try {
      const seen = new Set();
      const urls = [];
      for (const e of performance.getEntriesByType('resource')) {
        const u = e.name;
        if (!u.startsWith('blob:') && u.includes('video.twimg.com') && u.includes('.mp4')) {
          if (!seen.has(u)) { seen.add(u); urls.push(u); }
        }
      }
      // Sort highest resolution first
      return urls.sort((a, b) => parseResolutionArea(b) - parseResolutionArea(a));
    } catch (_) { return []; }
  }

  // Call Twitter's public embed syndication API
  async function fetchSyndicationBestMp4(tweetId) {
    const token = (Number(tweetId) / 1e15 * Math.PI).toString(36).replace(/0/g, '').replace(/\./g, '');
    const res   = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=${token}&lang=en`);
    if (!res.ok) return null;
    const data  = await res.json();
    let variants = [];
    if (data.video?.variants)             variants = variants.concat(data.video.variants);
    if (Array.isArray(data.mediaDetails)) data.mediaDetails.forEach(m => {
      if (m.video_info?.variants)         variants = variants.concat(m.video_info.variants);
    });
    const mp4s = variants
      .filter(v => v.content_type && v.content_type.toLowerCase().includes('video/mp4') && v.url)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    return mp4s.length ? mp4s[0].url : null;
  }

  // ── Twitter / X ────────────────────────────────────────────
  if (hrefLow.includes('twitter.com') || hrefLow.includes('x.com')) {

    // 1️⃣ Performance entries — most reliable when video has started playing.
    //    These are the ACTUAL urls the browser loaded for the current video.
    const perfUrls = getTwitterVideosFromPerf();
    if (perfUrls.length > 0) return { videoUrl: perfUrls[0] };

    // 2️⃣ Syndication API — works even before video has played.
    const match = href.match(/\/status\/(\d+)/);
    if (match) {
      try {
        const url = await fetchSyndicationBestMp4(match[1]);
        if (url) return { videoUrl: url };
      } catch (err) {
        console.warn('[VideoSaver] Syndication API failed:', err.message);
      }
    }

    // Neither worked
    return {
      error: 'No video URL found. ① Make sure the video is playing, then retry. ② Or use "Select video manually" and click directly on the video.',
    };
  }

  // ── Instagram / other: DOM + perf scanner ───────────────────
  const videos = Array.from(document.querySelectorAll('video'));
  if (!videos.length) return { error: 'No video found on this page.' };

  let best = null, bestScore = -1;
  for (const v of videos) {
    let score = 0;
    const r = v.getBoundingClientRect();
    
    // Check if video is within viewport boundaries
    const inViewport = (
      r.top < (window.innerHeight || document.documentElement.clientHeight) &&
      r.bottom > 0 &&
      r.left < (window.innerWidth || document.documentElement.clientWidth) &&
      r.right > 0
    );
    
    if (inViewport) {
      score += 100;
      // High bonus for being centered in the screen (standard for stories/reels)
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = cx - (window.innerWidth || document.documentElement.clientWidth) / 2;
      const dy = cy - (window.innerHeight || document.documentElement.clientHeight) / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      score += Math.max(0, 50 - dist / 10);
    }
    
    if (r.width > 0 && r.height > 0) score += 20;
    if (!v.paused)                   score += 30;
    if (v.currentTime > 0)           score += 10;

    let src = v.src || '';
    if ((!src || src.startsWith('blob:')) && v.querySelector('source')?.src)
      src = v.querySelector('source').src;
    if (src && !src.startsWith('blob:')) score += 50;
    else if (src)                        score += 10;

    if (score > bestScore) { bestScore = score; best = { src }; }
  }

  // Fallback to performance entry logs if the best video is a blob URL
  if (!best?.src || best.src.startsWith('blob:')) {
    try {
      const resources = [...performance.getEntriesByType('resource')].reverse();
      for (const e of resources) {
        const n = e.name;
        if (n.startsWith('blob:')) continue;
        
        const isMetaCdn = n.includes('cdninstagram') || n.includes('fbcdn');
        if (!isMetaCdn) continue;

        const isVideo = (
          n.includes('.mp4') ||
          n.includes('mime=video') ||
          n.includes('mime%3Dvideo') ||
          n.includes('bytestart') ||
          new URL(n).pathname.toLowerCase().includes('/v/')
        );

        if (isVideo) {
          const cleanU = new URL(n);
          cleanU.searchParams.delete('bytestart');
          cleanU.searchParams.delete('byteend');
          cleanU.searchParams.delete('range');
          best = { src: cleanU.toString() };
          break;
        }
      }
    } catch (_) {}
  }

  if (!best?.src || best.src.startsWith('blob:'))
    return { error: 'Could not extract a video URL. Play the video fully and try again.' };

  return { videoUrl: best.src };
}

// ═══════════════════════════════════════════════════════════════
// INJECTED: selectVideoManually  (runs inside the active tab)
// Highlights tweet CARDS on hover; on click extracts tweet ID
// from that card's permalink, then delegates resolution to background.
// ═══════════════════════════════════════════════════════════════
function selectVideoManually() {
  if (document.getElementById('_vs_overlay')) return;

  const isTwitter = /twitter\.com|x\.com/i.test(location.host);

  const getTweetArticle = (el) => {
    let cur = el;
    for (let i = 0; i < 20 && cur; i++) {
      if (cur.tagName === 'ARTICLE') return cur;
      if (cur.getAttribute?.('data-testid') === 'tweet') return cur;
      cur = cur.parentElement;
    }
    return null;
  };

  const getTweetId = (article) => {
    if (!article) return null;
    for (const a of article.querySelectorAll('a[href*="/status/"]')) {
      const m = a.href.match(/\/status\/(\d+)/);
      if (m) return m[1];
    }
    return null;
  };

  const findVideo = (el) => {
    let cur = el;
    for (let i = 0; i < 8; i++) {
      if (!cur) break;
      if (cur.tagName === 'VIDEO') return cur;
      const v = cur.querySelector?.('video');
      if (v) return v;
      cur = cur.parentElement;
    }
    return null;
  };

  // ── toast helper ──────────────────────────────────────────────
  function showToast(text, color, duration = 4000) {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position:'fixed', top:'14px', left:'50%', transform:'translateX(-50%)',
      background: color, color:'#fff', padding:'12px 24px', borderRadius:'999px',
      zIndex:'2147483647', fontFamily:'system-ui,sans-serif', fontSize:'13px',
      fontWeight:'600', boxShadow:'0 4px 18px rgba(0,0,0,0.3)',
      pointerEvents:'none', whiteSpace:'nowrap',
    });
    el.textContent = text;
    document.body.appendChild(el);
    if (duration > 0) setTimeout(() => el.remove(), duration);
    return el;
  }

  // ── UI ────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.id = '_vs_style';
  style.textContent = `
    ._vs_card { outline: 3px dashed #f093fb !important; outline-offset:2px !important;
                cursor: pointer !important; box-shadow: 0 0 18px rgba(240,147,251,0.4) inset !important; }
  `;
  document.head.appendChild(style);

  const banner = document.createElement('div');
  banner.id = '_vs_overlay';
  Object.assign(banner.style, {
    position:'fixed', top:'14px', left:'50%', transform:'translateX(-50%)',
    background:'linear-gradient(135deg,#667eea,#764ba2)', color:'#fff',
    padding:'12px 24px', borderRadius:'999px', zIndex:'2147483647',
    fontFamily:'system-ui,sans-serif', fontSize:'13px', fontWeight:'600',
    boxShadow:'0 6px 24px rgba(118,75,162,0.55)', pointerEvents:'none',
    border:'1px solid rgba(255,255,255,0.2)', whiteSpace:'nowrap',
  });
  banner.textContent = isTwitter
    ? '🎯  Hover over a tweet → click it to download  •  ESC = cancel'
    : '🎯  Click on the video to download  •  ESC = cancel';
  document.body.appendChild(banner);

  let highlighted = null;
  const unhighlight = () => {
    if (highlighted) { highlighted.classList.remove('_vs_card'); highlighted = null; }
  };

  const onOver = (e) => {
    const target = isTwitter ? getTweetArticle(e.target) : (findVideo(e.target)?.parentElement || null);
    if (!target) { unhighlight(); return; }
    if (target !== highlighted) { unhighlight(); target.classList.add('_vs_card'); highlighted = target; }
  };

  const onOut = () => {
    setTimeout(() => {
      if (!highlighted?.matches(':hover') && !highlighted?.querySelector(':hover'))
        unhighlight();
    }, 60);
  };

  const cleanup = () => {
    document.getElementById('_vs_overlay')?.remove();
    document.getElementById('_vs_style')?.remove();
    unhighlight();
    document.removeEventListener('mouseover', onOver, true);
    document.removeEventListener('mouseout',  onOut,  true);
    document.removeEventListener('click',     onClick, true);
    document.removeEventListener('keydown',   onKey,   true);
  };

  const onClick = async (e) => {
    if (isTwitter) {
      const article = getTweetArticle(e.target);
      if (!article) return;

      e.preventDefault(); e.stopImmediatePropagation();
      cleanup();

      const working = showToast('⏳  Finding highest quality video…', '#764ba2', 0);

      // Extract tweet ID from article links, or fall back to current tab URL if it's the main post detail page
      const tweetId = getTweetId(article) || window.location.href.match(/\/status\/(\d+)/)?.[1];

      if (tweetId) {
        chrome.runtime.sendMessage({
          action: 'resolveAndDownload',
          pageUrl: 'https://x.com/i/status/' + tweetId
        }, (response) => {
          working.remove();
          if (response?.success) {
            showToast('✅  Download started!', '#34d399', 3000);
          } else {
            showToast('❌  ' + (response?.error || 'No video found.'), '#f87171', 5000);
          }
        });
      } else {
        working.remove();
        showToast('❌  Could not identify the Tweet ID. Try opening the tweet page.', '#f87171', 5000);
      }

    } else {
      // Non-Twitter: click directly on the video element
      const video = findVideo(e.target);
      if (!video) return;

      e.preventDefault(); e.stopImmediatePropagation();
      cleanup();

      let videoUrl = video.src && !video.src.startsWith('blob:') ? video.src : null;
      if (!videoUrl) {
        try {
          const entries = [...performance.getEntriesByType('resource')].reverse();
          for (const entry of entries) {
            const n = entry.name;
            if (n.startsWith('blob:')) continue;

            const isMetaCdn = n.includes('cdninstagram') || n.includes('fbcdn');
            if (!isMetaCdn) continue;

            const isVideo = (
              n.includes('.mp4') ||
              n.includes('mime=video') ||
              n.includes('mime%3Dvideo') ||
              n.includes('bytestart') ||
              new URL(n).pathname.toLowerCase().includes('/v/')
            );

            if (isVideo) {
              videoUrl = n;
              break;
            }
          }
        } catch (_) {}
      }

      if (videoUrl) {
        try {
          const cleanU = new URL(videoUrl);
          cleanU.searchParams.delete('bytestart');
          cleanU.searchParams.delete('byteend');
          cleanU.searchParams.delete('range');
          videoUrl = cleanU.toString();
        } catch (_) {}
        chrome.runtime.sendMessage({ action: 'downloadVideo', videoUrl, pageUrl: location.href });
        showToast('✅  Download started!', '#34d399', 3000);
      } else {
        showToast('❌  Could not extract video URL. Play the video and try again.', '#f87171', 5000);
      }
    }
  };

  const onKey = (e) => { if (e.key === 'Escape') cleanup(); };

  document.addEventListener('mouseover', onOver,  true);
  document.addEventListener('mouseout',  onOut,   true);
  document.addEventListener('click',     onClick, true);
  document.addEventListener('keydown',   onKey,   true);
}
