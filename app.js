import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  supabaseReady
} from "./supabase.js";

// ★ BẢN v2.8.1 — PHÁT ÂM THANH KIỂU NATIVE (KHÔNG đụng Web Audio)
//   Lý do: Web Audio (createMediaElementSource) hay làm CÂM tiếng
//   khi file từ domain khác (Supabase). Bỏ hẳn → âm thanh chạy
//   thẳng qua thẻ <audio> gốc, không gì chặn được.
console.log("[Musica] app.js v2.8.1 (native audio — no WebAudio hijack)");

const fallbackCover =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 900">
      <rect width="800" height="900" fill="#181512"/>
      <circle cx="400" cy="450" r="235" fill="none" stroke="#5e3b2d" stroke-width="2"/>
      <circle cx="400" cy="450" r="150" fill="none" stroke="#5e3b2d" stroke-width="2"/>
      <circle cx="400" cy="450" r="62" fill="#d66b3d"/>
      <text x="400" y="755" text-anchor="middle" fill="#d8d0c7" font-family="serif" font-size="36">MUSIC ARCHIVE</text>
    </svg>
  `);

let supabase = null;
let story = null;
let chapters = [];
let currentChapterIndex = -1;
let currentTrackIndex = -1;
let youtubePlayer = null;
let youtubeReady = false;
let pendingYoutubeVideoId = null;
let autoNextEnabled = false;       // Công tắc tự động chuyển bài
let isSeeking = false;             // Đang kéo thanh tua
let youtubeProgressTimer = null;   // Timer đồng bộ tiến trình YouTube
let lastPct = 0;                   // % hiện tại (cho phím mũi tên trên dải sóng)

// ---------- YouTube ----------
function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) {
    youtubeReady = true;
    createYoutubePlayer();
    return;
  }
  if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
    return;
  }
  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
}

window.onYouTubeIframeAPIReady = () => {
  youtubeReady = true;
  createYoutubePlayer();
  if (pendingYoutubeVideoId) {
    loadYoutubeVideo(pendingYoutubeVideoId);
    pendingYoutubeVideoId = null;
  }
};

function createYoutubePlayer() {
  if (youtubePlayer) return;
  const container = document.querySelector("#youtubePlayer");
  if (!container) return;
  youtubePlayer = new YT.Player("youtubePlayer", {
    width: "100%",
    height: "100%",
    videoId: "",
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1 },
    events: {
      onStateChange: (event) => {
        if (event.data === YT.PlayerState.PLAYING) {
          startYoutubeProgress();
          startWaveAnim();
        }
        if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
          stopYoutubeProgress();
          stopWaveAnim();
        }
        if (event.data === YT.PlayerState.ENDED) nextTrackAuto();
      }
    }
  });
}

function extractYoutubeId(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com")) {
      let id = parsed.searchParams.get("v");
      if (id) return id;
      const embedMatch = parsed.pathname.match(/\/embed\/([^/]+)/);
      if (embedMatch) return embedMatch[1];
      const shortsMatch = parsed.pathname.match(/\/shorts\/([^/]+)/);
      if (shortsMatch) return shortsMatch[1];
    }
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.substring(1).split("?")[0];
    }
  } catch (_) {}
  return null;
}

function loadYoutubeVideo(videoId) {
  if (!videoId) return;
  const wrap = document.querySelector("#youtubePlayerWrap");
  const audio = document.querySelector("#audio");
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  stopWaveAnim();
  if (wrap) wrap.hidden = false;
  if (!youtubeReady || !youtubePlayer) {
    pendingYoutubeVideoId = videoId;
    loadYouTubeAPI();
    return;
  }
  youtubePlayer.loadVideoById(videoId);
}

function hideYoutubePlayer() {
  const wrap = document.querySelector("#youtubePlayerWrap");
  if (wrap) wrap.hidden = true;
  if (youtubePlayer && youtubePlayer.stopVideo) {
    try { youtubePlayer.stopVideo(); } catch (_) {}
  }
  pendingYoutubeVideoId = null;
  stopYoutubeProgress();
}

// ---------- Helpers ----------
function esc(s = "") {
  return String(s).replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[m]);
}

function sourceType(type) {
  switch (type) {
    case "youtube": return "YOUTUBE";
    case "spotify": return "SPOTIFY";
    case "soundcloud": return "SOUNDCLOUD";
    case "upload": return "LOCAL / UPLOADED AUDIO";
    case "direct_audio": return "AUDIO URL";
    case "external": return "EXTERNAL LINK";
    default: return type?.toUpperCase() || "EXTERNAL LINK";
  }
}

function isDirectAudio(url) {
  return /\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i.test(url);
}

function showError(error) {
  console.error(error);
  const empty = document.querySelector("#empty");
  empty.hidden = false;
  empty.textContent = `Database error: ${error.message}`;
}

// Hash đơn giản để tạo dạng sóng "tĩnh" riêng cho từng bài
function seedHash(input = "") {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) % 2147483647;
  }
  return h;
}

// ---------- Wave strip (dải sóng — ANIMATION, không dùng Web Audio) ----------
let waveBarsArr = [];
let waveBaseHeights = [];
let wavePhases = [];
let waveRaf = null;
const waveStrip = document.querySelector("#waveStrip");
const waveBarsEl = document.querySelector("#waveBars");
const WAVE_COUNT = 48;

function buildWave(seed = "") {
  waveBarsEl.innerHTML = "";
  waveBarsArr = [];
  waveBaseHeights = [];
  wavePhases = [];
  let h = seedHash(seed) || 12345;
  for (let i = 0; i < WAVE_COUNT; i++) {
    h = (h * 9301 + 49297) % 233280;
    const r = h / 233280;
    const base = 18 + r * 74;
    const bar = document.createElement("span");
    bar.style.height = base + "%";
    waveBarsEl.appendChild(bar);
    waveBarsArr.push(bar);
    waveBaseHeights.push(base);
    wavePhases.push(r * Math.PI * 2);
  }
}

// Nhún nhảy nhẹ khi đang phát
function startWaveAnim() {
  stopWaveAnim();
  const t0 = performance.now();
  function tick(now) {
    const t = (now - t0) / 1000;
    waveBarsArr.forEach((bar, i) => {
      const base = waveBaseHeights[i];
      const pulse = 0.72 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2.4 + wavePhases[i] + i * 0.4));
      bar.style.height = Math.min(98, Math.max(8, base * pulse)) + "%";
    });
    waveRaf = requestAnimationFrame(tick);
  }
  waveRaf = requestAnimationFrame(tick);
}

function stopWaveAnim() {
  if (waveRaf) {
    cancelAnimationFrame(waveRaf);
    waveRaf = null;
  }
  waveBarsArr.forEach((bar, i) => {
    if (waveBaseHeights[i]) bar.style.height = waveBaseHeights[i] + "%";
  });
}

// Tô màu cam phần đã phát trên dải sóng
function paintWave(pct) {
  const n = waveBarsArr.length;
  if (!n) return;
  const onCount = Math.round((pct / 100) * n);
  waveBarsArr.forEach((bar, i) => bar.classList.toggle("on", i < onCount));
}

function wavePctFromEvent(e) {
  const r = waveStrip.getBoundingClientRect();
  return Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
}

function doSeek(pct) {
  const total = getTotalDuration();
  if (!total || currentChapterIndex < 0) return;
  const target = total * (pct / 100);
  const audio = document.querySelector("#audio");
  const isYoutubeActive = youtubePlayer && document.querySelector("#youtubePlayerWrap").hidden === false;
  if (isYoutubeActive) {
    try { youtubePlayer.seekTo(target, true); } catch (_) {}
  } else if (audio && audio.src) {
    audio.currentTime = target;
    audio.play().catch(() => {});
  }
}

function seekPreview(pct) {
  isSeeking = true;
  lastPct = pct;
  const total = getTotalDuration();
  const target = total * (pct / 100);
  const cur = document.querySelector("#progCurrent");
  const npT = document.querySelector("#npTime");
  if (cur) cur.textContent = fmtTime(target);
  if (npT) npT.textContent = fmtTime(target);
  paintWave(pct);
  const bar = document.querySelector("#seekBar");
  if (bar) {
    bar.value = Math.round(pct * 10);
    bar.style.setProperty("--progress", pct + "%");
  }
}

function commitSeek(pct) {
  isSeeking = false;
  doSeek(pct);
}

// ---------- Progress ----------
function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getTotalDuration() {
  const audio = document.querySelector("#audio");
  if (audio && audio.src && Number.isFinite(audio.duration) && audio.duration > 0) {
    return audio.duration;
  }
  if (youtubePlayer && typeof youtubePlayer.getDuration === "function") {
    const d = youtubePlayer.getDuration();
    if (Number.isFinite(d) && d > 0) return d;
  }
  return 0;
}

function resetProgress() {
  isSeeking = false;
  lastPct = 0;
  const bar = document.querySelector("#seekBar");
  if (bar) {
    bar.value = 0;
    bar.style.setProperty("--progress", "0%");
  }
  ["#progCurrent", "#progDuration", "#npTime", "#npDuration"].forEach(id => {
    const el = document.querySelector(id);
    if (el) el.textContent = "0:00";
  });
  paintWave(0);
}

function updateProgress(current, duration) {
  if (isSeeking) return;
  const cur = Number.isFinite(current) && current > 0 ? current : 0;
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const pct = total > 0 ? Math.min(100, (cur / total) * 100) : 0;
  lastPct = pct;

  const curEl = document.querySelector("#progCurrent");
  const durEl = document.querySelector("#progDuration");
  const npT = document.querySelector("#npTime");
  const npD = document.querySelector("#npDuration");
  if (curEl) curEl.textContent = fmtTime(cur);
  if (durEl) durEl.textContent = total > 0 ? fmtTime(total) : "0:00";
  if (npT) npT.textContent = fmtTime(cur);
  if (npD) npD.textContent = total > 0 ? fmtTime(total) : "0:00";

  const bar = document.querySelector("#seekBar");
  if (bar) {
    bar.value = Math.round(pct * 10);
    bar.style.setProperty("--progress", pct + "%");
  }
  if (waveStrip) waveStrip.setAttribute("aria-valuenow", Math.round(pct));
  paintWave(pct);
}

function startYoutubeProgress() {
  stopYoutubeProgress();
  youtubeProgressTimer = setInterval(() => {
    if (!youtubePlayer || typeof youtubePlayer.getCurrentTime !== "function") return;
    if (typeof YT !== "undefined" && YT.PlayerState &&
        youtubePlayer.getPlayerState && youtubePlayer.getPlayerState() === YT.PlayerState.ENDED) {
      stopYoutubeProgress();
      return;
    }
    updateProgress(youtubePlayer.getCurrentTime(), youtubePlayer.getDuration());
  }, 500);
}

function stopYoutubeProgress() {
  if (youtubeProgressTimer) {
    clearInterval(youtubeProgressTimer);
    youtubeProgressTimer = null;
  }
}

// ---------- Supabase ----------
(async function init() {
  if (supabaseReady()) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    loadYouTubeAPI();
    await loadLibrary();
  } else {
    document.querySelector("#storyTitle").textContent = "Supabase chưa được cấu hình";
    document.querySelector("#storyNote").textContent = "Mở supabase.js và điền Project URL + anon/publishable key để website kết nối database.";
    document.querySelector("#empty").hidden = false;
    document.querySelector("#empty").textContent = "Chưa kết nối Supabase.";
  }
})();

async function loadLibrary() {
  const { data: stories, error: storyError } = await supabase
    .from("stories")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1);

  if (storyError) {
    return showError(storyError);
  }

  story = stories?.[0] || null;
  if (!story) {
    render();
    return;
  }

  const { data: ch, error: chError } = await supabase
    .from("chapters")
    .select("*")
    .eq("story_id", story.id)
    .order("chapter_number", { ascending: true });

  if (chError) {
    return showError(chError);
  }

  const { data: tracks, error: trackError } = await supabase
    .from("tracks")
    .select("*")
    .order("track_number", { ascending: true });

  if (trackError) {
    return showError(trackError);
  }

  chapters = (ch || []).map(chapter => ({
    ...chapter,
    tracks: (tracks || []).filter(track => track.chapter_id === chapter.id)
  }));

  render();
}

// ---------- Render ----------
function render() {
  const title = story?.title || "Untitled story";
  document.querySelector("#storyTitle").textContent = title;
  document.querySelector("#storyNote").textContent = story?.note || "No note yet.";
  document.querySelector("#storyCover").src = story?.cover_url || fallbackCover;
  document.querySelector("#playerCover").src = story?.cover_url || fallbackCover;
  document.querySelector("#aboutHeading").textContent = `The sounds of “${title}”.`;

  const trackCount = chapters.reduce((sum, ch) => sum + ch.tracks.length, 0);
  document.querySelector("#chapterCount").textContent = `${chapters.length} chapter${chapters.length === 1 ? "" : "s"}`;
  document.querySelector("#trackCount").textContent = `${trackCount} track${trackCount === 1 ? "" : "s"}`;

  const list = document.querySelector("#chaptersList");
  list.innerHTML = "";
  document.querySelector("#empty").hidden = chapters.length > 0;

  chapters.forEach((chapter, chapterIndex) => {
    const card = document.createElement("article");
    card.className = "chapter-card";
    card.innerHTML = `
      <div class="chapter-cover"><span>${String(chapter.chapter_number).padStart(2, "0")}</span></div>
      <div class="chapter-content">
        <div class="chapter-title-row">
          <div>
            <p class="eyebrow">CHAPTER ${String(chapter.chapter_number).padStart(2, "0")}</p>
            <h3>${esc(chapter.title)}</h3>
          </div>
          <span class="style-pill">${esc(chapter.style || "soundtrack")}</span>
        </div>
        <div class="tracks"></div>
      </div>
    `;

    const tracksEl = card.querySelector(".tracks");
    if (!chapter.tracks.length) {
      tracksEl.innerHTML = `<p class="hint">No music has been added to this chapter.</p>`;
    } else {
      chapter.tracks.forEach((track, trackIndex) => {
        const row = document.createElement("div");
        row.className = "track-row";
        row.innerHTML = `
          <span class="track-number">${String(track.track_number).padStart(2, "0")}</span>
          <div>
            <strong>${esc(track.title)}</strong>
            <small>${esc(track.artist || sourceType(track.source_type))}</small>
          </div>
          <button class="play-btn" type="button" aria-label="Play">▶</button>
        `;
        row.querySelector(".play-btn").onclick = () => playTrack(chapterIndex, trackIndex);
        tracksEl.appendChild(row);
      });
    }
    list.appendChild(card);
  });
}

// ---------- Art (ảnh bài hát) ----------
function trackArtUrl(track) {
  if (track?.cover_path) {
    try {
      return supabase.storage.from("covers").getPublicUrl(track.cover_path).data.publicUrl;
    } catch (_) {}
  }
  return story?.cover_url || fallbackCover;
}

// ---------- Play ----------
// ★ NATIVE playback: phát thẳng qua thẻ <audio>, không qua Web Audio
async function playUploadedAudio(url) {
  const audio = document.querySelector("#audio");
  if (!url) return;
  audio.src = url;
  try {
    await audio.play();
    startWaveAnim();
  } catch (err) {
    console.warn("[Musica] play blocked:", err, url);
    document.querySelector("#nowArtist").textContent =
      "Không phát được — trình duyệt chặn hoặc file lỗi. Bấm play lần nữa, hoặc kiểm tra link file: " + url;
  }
}

async function playTrack(chapterIndex, trackIndex) {
  const track = chapters[chapterIndex]?.tracks[trackIndex];
  if (!track) return;

  currentChapterIndex = chapterIndex;
  currentTrackIndex = trackIndex;
  resetProgress();

  document.querySelector("#nowTitle").textContent = track.title;
  document.querySelector("#nowArtist").textContent = track.artist || sourceType(track.source_type);
  document.querySelector("#playerChapter").textContent = chapters[chapterIndex].title;
  document.querySelector("#playerSource").textContent = sourceType(track.source_type);

  const sourceLink = document.querySelector("#sourceLink");
  sourceLink.hidden = !track.source_url;
  if (track.source_url) sourceLink.href = track.source_url;

  const audio = document.querySelector("#audio");
  const coverImg = document.querySelector("#playerCover");

  // Hiện giao diện NOW PLAYING
  const npBlock = document.querySelector("#nowPlaying");
  const npTitle = document.querySelector("#npTitle");
  const npArtist = document.querySelector("#npArtist");
  const npCover = document.querySelector("#npCover");
  const ytWrap = document.querySelector("#youtubePlayerWrap");
  if (npBlock) npBlock.hidden = false;
  if (npTitle) npTitle.textContent = track.title;
  if (npArtist) npArtist.textContent = track.artist || sourceType(track.source_type);
  buildWave(track.id || track.title || String(trackIndex));

  // YouTube
  if (track.source_type === "youtube" || /youtube\.com|youtu\.be/i.test(track.source_url || "")) {
    hideNormalAudio();
    const videoId = extractYoutubeId(track.source_url);
    if (!videoId) {
      return showError({ message: "Không đọc được YouTube link." });
    }
    coverImg.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    coverImg.onerror = () => { coverImg.src = story?.cover_url || fallbackCover; };
    if (npCover) npCover.hidden = true;
    if (ytWrap) ytWrap.hidden = false;
    loadYoutubeVideo(videoId);
    return;
  }

  // Audio upload / link .mp3
  hideYoutubePlayer();
  const artUrl = trackArtUrl(track);
  coverImg.onerror = null;
  coverImg.src = artUrl;
  if (npCover) {
    npCover.hidden = false;
    npCover.style.backgroundImage = `url("${artUrl}")`;
    const glyph = npCover.querySelector(".np-glyph");
    const hasArt = !!(track.cover_path || story?.cover_url);
    if (glyph) glyph.style.display = hasArt ? "none" : "";
  }
  if (ytWrap) ytWrap.hidden = true;
  stopWaveAnim();

  // Uploaded audio
  if (track.source_type === "upload" && track.audio_path) {
    const { data } = supabase.storage.from("music").getPublicUrl(track.audio_path);
    await playUploadedAudio(data.publicUrl);
    return;
  }

  // Direct audio
  if (track.source_url && isDirectAudio(track.source_url)) {
    await playUploadedAudio(track.source_url);
  } else if (track.source_url) {
    // Spotify / SoundCloud / external link
    window.open(track.source_url, "_blank", "noopener");
  }
}

function hideNormalAudio() {
  const audio = document.querySelector("#audio");
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
}

// Auto: hết bài → bài kế tiếp trong chapter; hết chapter → sang chapter sau
function nextTrackAuto() {
  if (!autoNextEnabled) return;
  const chapter = chapters[currentChapterIndex];
  if (!chapter?.tracks.length) return;

  const next = currentTrackIndex + 1;
  if (next < chapter.tracks.length) {
    playTrack(currentChapterIndex, next);
  } else {
    moveToNextChapter();
  }
}

// Nhảy sang chapter kế tiếp (bài đầu chapter đó; chapter trống bỏ qua)
function moveToNextChapter() {
  if (!chapters.length) return;

  const start = (currentChapterIndex + 1) % chapters.length;
  for (let i = 0; i < chapters.length; i++) {
    const idx = (start + i) % chapters.length;
    const chapter = chapters[idx];
    if (chapter?.tracks.length) {
      playTrack(idx, 0);
      return;
    }
  }
}

// Thoát / dừng hẳn bài hát
function stopEverything() {
  const audio = document.querySelector("#audio");
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  hideYoutubePlayer();
  stopWaveAnim();
  resetProgress();
  document.querySelector("#nowTitle").textContent = "Nothing playing";
  document.querySelector("#nowArtist").textContent = "Choose a track below.";
  document.querySelector("#playerChapter").textContent = "—";
  document.querySelector("#playerSource").textContent = "—";
  document.querySelector("#sourceLink").hidden = true;
  document.querySelector("#playerCover").src = story?.cover_url || fallbackCover;

  const npBlock = document.querySelector("#nowPlaying");
  if (npBlock) npBlock.hidden = true;

  currentChapterIndex = -1;
  currentTrackIndex = -1;
}

// ---------- Controls ----------
const seekBar = document.querySelector("#seekBar");
const progCurrent = document.querySelector("#progCurrent");
const progDuration = document.querySelector("#progDuration");

document.querySelector("#prevTrack").onclick = () => moveTrack(-1);
document.querySelector("#nextTrack").onclick = () => moveTrack(1);
document.querySelector("#nextChapter").onclick = () => moveToNextChapter(); // nút ⏭
document.querySelector("#clearPlayer").onclick = stopEverything;   // nút ■
document.querySelector("#exitPlayer").onclick = stopEverything;    // nút ✕ thoát bài

// Công tắc tự động chuyển bài
document.querySelector("#autoNext").onchange = (e) => {
  autoNextEnabled = e.target.checked;
};

// Thanh tiến trình nhỏ dưới player: kéo/click để tua
seekBar.addEventListener("input", () => {
  isSeeking = true;
  const total = getTotalDuration();
  const pct = Number(seekBar.value) / 10;
  const target = total * (pct / 100);
  progCurrent.textContent = fmtTime(target);
  seekBar.style.setProperty("--progress", pct + "%");
  paintWave(pct);
});

seekBar.addEventListener("change", () => {
  isSeeking = false;
  const pct = Number(seekBar.value) / 10;
  doSeek(pct);
});

// Dải sóng trên trang: click / kéo / phím mũi tên để tua
if (waveStrip) {
  waveStrip.addEventListener("pointerdown", (e) => {
    if (currentChapterIndex < 0) return;
    waveStrip.setPointerCapture(e.pointerId);
    seekPreview(wavePctFromEvent(e));
  });
  waveStrip.addEventListener("pointermove", (e) => {
    if (isSeeking && currentChapterIndex >= 0) {
      seekPreview(wavePctFromEvent(e));
    }
  });
  waveStrip.addEventListener("pointerup", (e) => {
    if (currentChapterIndex < 0) return;
    const pct = wavePctFromEvent(e);
    seekPreview(pct);
    commitSeek(pct);
  });
  waveStrip.addEventListener("pointercancel", () => {
    isSeeking = false;
  });
  waveStrip.addEventListener("keydown", (e) => {
    if (currentChapterIndex < 0) return;
    let pct = lastPct;
    if (e.key === "ArrowLeft") { e.preventDefault(); pct = Math.max(0, pct - 5); }
    else if (e.key === "ArrowRight") { e.preventDefault(); pct = Math.min(100, pct + 5); }
    else if (e.key === "Home") { e.preventDefault(); pct = 0; }
    else if (e.key === "End") { e.preventDefault(); pct = 100; }
    else return;
    seekPreview(pct);
    commitSeek(pct);
  });
}

// Đồng bộ tiến trình cho audio thường (upload / link mp3)
const audioEl = document.querySelector("#audio");
audioEl.addEventListener("loadedmetadata", () => updateProgress(audioEl.currentTime, audioEl.duration));
audioEl.addEventListener("durationchange", () => updateProgress(audioEl.currentTime, audioEl.duration));
audioEl.addEventListener("timeupdate", () => updateProgress(audioEl.currentTime, audioEl.duration));
audioEl.addEventListener("play", () => startWaveAnim());
audioEl.addEventListener("pause", () => stopWaveAnim());
audioEl.addEventListener("ended", nextTrackAuto);

// ★ Báo lỗi rõ ràng nếu file không phát được
audioEl.addEventListener("error", () => {
  const trackNow = chapters[currentChapterIndex]?.tracks[currentTrackIndex];
  const src = audioEl.currentSrc || audioEl.src || "";
  console.error("[Musica] audio error:", audioEl.error, src);
  const na = document.querySelector("#nowArtist");
  if (na && trackNow) {
    na.textContent = "Lỗi phát file âm thanh: " + (audioEl.error?.code === 4 ? "file không hỗ trợ/không tồn tại" : "không đọc được") +
      ". Mở thử link này trong tab mới: " + src;
  }
});

// Dựng dải sóng mặc định (trước khi có bài nào)
buildWave("musica");

function moveTrack(direction) {
  const chapter = chapters[currentChapterIndex];
  if (!chapter?.tracks.length) return;
  let next = currentTrackIndex + direction;
  if (next < 0) next = chapter.tracks.length - 1;
  if (next >= chapter.tracks.length) next = 0;
  playTrack(currentChapterIndex, next);
}