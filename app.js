import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  supabaseReady
} from "./supabase.js";

console.log("[Musica] app.js v2.15 (spotify-style arc cards)");

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
let arcs = [];
let currentChapterIndex = -1;
let currentTrackIndex = -1;
let youtubePlayer = null;
let youtubeReady = false;
let pendingYoutubeVideoId = null;
let autoNextEnabled = false;
let isSeeking = false;
let youtubeProgressTimer = null;
let lastPct = 0;
let chapterSortDir = "asc";

// ★ Chế độ phát theo arc
let arcPlayMode = false;
let currentArcIndex = -1;

// Đối tượng DOM để tìm kiếm
let arcCards = [];
let chapterCards = [];

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

function seedHash(input = "") {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) % 2147483647;
  }
  return h;
}

// ---------- Wave strip ----------
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

  const { data: ar, error: arErr } = await supabase
    .from("arcs")
    .select("*")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (arErr) {
    return showError(arErr);
  }
  arcs = ar || [];

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

  const arcNameById = {};
  const arcNumById = {};
  arcs.forEach((a, i) => {
    arcNameById[a.id] = a.name;
    arcNumById[a.id] = i + 1;
  });

  chapters = (ch || []).map(chapter => ({
    ...chapter,
    arc_name: arcNameById[chapter.arc_id] || "",
    arc_num: arcNumById[chapter.arc_id] || 0,
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

  renderArcs();
  renderChapters();
  applySearch();
}

// ★ Render các thẻ arc — KIỂU PLAYLIST SPOTIFY:
//   bìa vuông + nút play tròn, click card = phát arc
function renderArcs() {
  const wrap = document.querySelector("#arcsList");
  if (!wrap) return;
  wrap.innerHTML = "";
  arcCards = [];

  const groups = arcs.map((arc, i) => ({
    arc,
    num: i + 1,
    chapters: chapters.filter(ch => ch.arc_id === arc.id).sort((a, b) => a.chapter_number - b.chapter_number),
    ungrouped: false
  }));

  const ungroupedChs = chapters.filter(ch => !ch.arc_id).sort((a, b) => a.chapter_number - b.chapter_number);
  if (ungroupedChs.length) {
    groups.push({
      arc: { id: null, name: "Chưa thuộc arc" },
      num: null,
      chapters: ungroupedChs,
      ungrouped: true
    });
  }

  if (!groups.length) {
    wrap.innerHTML = `<p class="hint">Chưa có arc nào.</p>`;
    return;
  }

  groups.forEach((group, gIdx) => {
    const { arc, num, chapters: chs, ungrouped } = group;
    const trackCount = chs.reduce((sum, c) => sum + (c.tracks?.length || 0), 0);

    const card = document.createElement("div");
    card.className = "arc-card";
    card.innerHTML = `
      <div class="arc-cover">
        <span class="arc-cover-glyph">${ungrouped ? "…" : "♢"}</span>
        <button class="arc-play-btn" type="button" title="Phát toàn bộ nhạc của arc này" aria-label="Phát cả arc">▶</button>
        <button class="arc-card-cancel" type="button" title="Hủy phát theo arc" aria-label="Hủy phát theo arc">✕</button>
      </div>
      <div class="arc-info">
        <p class="eyebrow">${ungrouped ? "OTHERS" : `ARC ${String(num).padStart(2, "0")}`}</p>
        <h3>${esc(arc.name || "")}</h3>
        <p class="arc-meta">${chs.length} chapter${chs.length === 1 ? "" : "s"} · ${trackCount} track${trackCount === 1 ? "" : "s"}</p>
      </div>
      <div class="arc-chips"></div>
    `;

    // Nút play trên bìa: đang phát arc này → pause; ngược lại → phát arc
    card.querySelector(".arc-play-btn").onclick = (e) => {
      e.stopPropagation();
      if (arcPlayMode && currentArcIndex === gIdx) {
        togglePlayPause();
      } else {
        playArcByIndex(gIdx);
      }
    };
    card.querySelector(".arc-card-cancel").onclick = (e) => {
      e.stopPropagation();
      cancelArcMode();
    };

    // Click bất kỳ đâu trên card → phát arc (trừ nút con)
    card.addEventListener("click", (e) => {
      if (e.target.closest(".arc-chip")) return;
      if (e.target.closest(".arc-play-btn")) return;
      if (e.target.closest(".arc-card-cancel")) return;
      playArcByIndex(gIdx);
    });

    const chipsWrap = card.querySelector(".arc-chips");
    chs.forEach(ch => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "arc-chip";
      chip.textContent = String(ch.chapter_number).padStart(2, "0");
      chip.title = `Phát chương ${ch.chapter_number}: ${ch.title}`;
      chip.onclick = () => playChapterFromChip(ch);
      chipsWrap.appendChild(chip);
    });

    wrap.appendChild(card);
    arcCards.push({ card, arc, chapters: chs, ungrouped, groupIndex: gIdx });
  });
  refreshArcActive();
}

// ★ Bấm chip → nghe thường (tự hủy arc mode) + cuộn tới thẻ chương
function playChapterFromChip(ch) {
  cancelArcMode();
  const idx = chapters.indexOf(ch);
  if (idx < 0) return;

  if (!ch.tracks || !ch.tracks.length) {
    const na = document.querySelector("#nowArtist");
    if (na) na.textContent = "Chapter này chưa có bài nhạc.";
    return;
  }

  playTrack(idx, 0);

  const item = chapterCards.find(c => c.chapter === ch);
  if (item && !item.card.hidden) {
    item.card.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ★ Render danh sách chapter — theo hướng sắp xếp đang chọn
function renderChapters() {
  const list = document.querySelector("#chaptersList");
  if (!list) return;
  list.innerHTML = "";
  chapterCards = [];
  document.querySelector("#empty").hidden = chapters.length > 0;

  const sorted = [...chapters].sort((a, b) =>
    chapterSortDir === "desc"
      ? b.chapter_number - a.chapter_number
      : a.chapter_number - b.chapter_number
  );

  sorted.forEach(chapter => {
    const chapterIndex = chapters.indexOf(chapter);

    const card = document.createElement("article");
    card.className = "chapter-card";
    const arcTag = chapter.arc_name
      ? `<span class="arc-num-tag">ARC ${String(chapter.arc_num).padStart(2, "0")}</span><span class="arc-tag">${esc(chapter.arc_name)}</span>`
      : "";
    card.innerHTML = `
      <div class="chapter-cover"><span>${String(chapter.chapter_number).padStart(2, "0")}</span></div>
      <div class="chapter-content">
        <div class="chapter-title-row">
          <div>
            <p class="eyebrow">CHAPTER ${String(chapter.chapter_number).padStart(2, "0")}</p>
            <h3>${esc(chapter.title)}${arcTag}</h3>
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
    chapterCards.push({ card, chapter });
  });
}

// ---------- Search ----------
function chMatches(ch, q) {
  if (!q) return true;
  return (
    (ch.title || "").toLowerCase().includes(q) ||
    String(ch.chapter_number).includes(q)
  );
}

function applySearch() {
  const arcsQ = (document.querySelector("#searchInput")?.value || "").trim().toLowerCase();
  const chQ = (document.querySelector("#chapterSearchInput")?.value || "").trim().toLowerCase();

  let foundArcs = 0;
  arcCards.forEach(({ card, arc, chapters: chs, ungrouped }) => {
    const arcMatch = !ungrouped && (arc.name || "").toLowerCase().includes(arcsQ);
    const chMatch = chs.some(ch => chMatches(ch, arcsQ));
    const show = !arcsQ || arcMatch || chMatch;
    card.hidden = !show;
    if (show) foundArcs++;
  });

  const arcEmpty = document.querySelector("#searchEmpty");
  if (arcEmpty) arcEmpty.hidden = !(arcsQ && foundArcs === 0);

  let foundCh = 0;
  chapterCards.forEach(({ card, chapter }) => {
    const chMatch = chMatches(chapter, chQ);
    const arcMatch = arcsQ && (chapter.arc_name || "").toLowerCase().includes(arcsQ);
    const showCh = !chQ || chMatch;
    const showArc = !arcsQ || chMatch || arcMatch;
    card.hidden = !(showCh && showArc);
    if (!card.hidden) foundCh++;
  });

  const chEmpty = document.querySelector("#chapterSearchEmpty");
  if (chEmpty) chEmpty.hidden = !(chQ && foundCh === 0);
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

  const npBlock = document.querySelector("#nowPlaying");
  const npTitle = document.querySelector("#npTitle");
  const npArtist = document.querySelector("#npArtist");
  const npCover = document.querySelector("#npCover");
  const ytWrap = document.querySelector("#youtubePlayerWrap");
  if (npBlock) npBlock.hidden = false;
  if (npTitle) npTitle.textContent = track.title;
  if (npArtist) npArtist.textContent = track.artist || sourceType(track.source_type);
  buildWave(track.id || track.title || String(trackIndex));

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

  if (track.source_type === "upload" && track.audio_path) {
    const { data } = supabase.storage.from("music").getPublicUrl(track.audio_path);
    await playUploadedAudio(data.publicUrl);
    return;
  }

  if (track.source_url && isDirectAudio(track.source_url)) {
    await playUploadedAudio(track.source_url);
  } else if (track.source_url) {
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

// ★ Tự chuyển bài: trong arc mode luôn tự chuyển; ngoài arc mode cần bật Auto
function nextTrackAuto() {
  const chapter = chapters[currentChapterIndex];
  if (!chapter?.tracks.length) return;

  if (!arcPlayMode && !autoNextEnabled) return;

  const next = currentTrackIndex + 1;
  if (next < chapter.tracks.length) {
    playTrack(currentChapterIndex, next);
  } else if (arcPlayMode) {
    moveToNextChapterInArc();
  } else {
    moveToNextChapter();
  }
}

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

// ★ Thoát bài: tắt hết nhạc + hủy cả arc mode
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
  cancelArcMode();
}

// ---------- Controls ----------
const seekBar = document.querySelector("#seekBar");
const progCurrent = document.querySelector("#progCurrent");
const progDuration = document.querySelector("#progDuration");

document.querySelector("#prevTrack").onclick = () => moveTrack(-1);
document.querySelector("#nextTrack").onclick = () => moveTrack(1);
document.querySelector("#nextChapter").onclick = () => moveToNextChapter();
document.querySelector("#clearPlayer").onclick = togglePlayPause; // ★ nút giữa = play/pause
document.querySelector("#exitPlayer").onclick = () => { stopEverything(); setPlayPauseIcon(false); };
document.querySelector("#autoNext").onchange = (e) => {
  autoNextEnabled = e.target.checked;
};

// 2 ô tìm kiếm: arc + chapter
const searchInput = document.querySelector("#searchInput");
if (searchInput) searchInput.addEventListener("input", applySearch);
const chapterSearchInput = document.querySelector("#chapterSearchInput");
if (chapterSearchInput) chapterSearchInput.addEventListener("input", applySearch);

// Nút sắp xếp chapter: 1 → nhiều / nhiều → 1
const chapterSort = document.querySelector("#chapterSort");
if (chapterSort) {
  chapterSort.addEventListener("change", () => {
    chapterSortDir = chapterSort.value === "desc" ? "desc" : "asc";
    renderChapters();
    applySearch();
  });
}

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

const audioEl = document.querySelector("#audio");
audioEl.addEventListener("loadedmetadata", () => updateProgress(audioEl.currentTime, audioEl.duration));
audioEl.addEventListener("durationchange", () => updateProgress(audioEl.currentTime, audioEl.duration));
audioEl.addEventListener("timeupdate", () => updateProgress(audioEl.currentTime, audioEl.duration));
audioEl.addEventListener("play", () => startWaveAnim());
audioEl.addEventListener("pause", () => stopWaveAnim());
audioEl.addEventListener("ended", nextTrackAuto);

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

buildWave("musica");

// ★ Di chuyển bài: nút ▶ trong arc mode chạy theo trình tự arc
function moveTrack(direction) {
  const chapter = chapters[currentChapterIndex];
  if (!chapter?.tracks.length) return;
  let next = currentTrackIndex + direction;
  if (next < 0) next = chapter.tracks.length - 1;
  if (next >= chapter.tracks.length) {
    if (arcPlayMode && direction > 0) {
      const groups = getArcGroups();
      const group = groups[currentArcIndex];
      const chs = group ? group.chapters.filter(c => c.tracks && c.tracks.length) : [];
      const pos = chs.findIndex(c => c.id === chapter.id);
      const nxt = chs[pos + 1];
      if (nxt) {
        playTrack(chapters.indexOf(nxt), 0);
        return;
      }
      for (let i = 1; i <= groups.length; i++) {
        const gi = (currentArcIndex + i) % groups.length;
        const g = groups[gi];
        const first = g.chapters.find(c => c.tracks && c.tracks.length);
        if (first) {
          currentArcIndex = gi;
          updateArcModeBar();   // ★ cập nhật tên arc trên thanh trạng thái
          scrollToArcCard(gi);  // ★ cũng cuộn tới arc kế tiếp khi bấm ▶
          playTrack(chapters.indexOf(first), 0);
          return;
        }
      }
      cancelArcMode();
      return;
    }
    next = 0;
  }
  playTrack(currentChapterIndex, next);
}

/* =========================================================
   PHÁT THEO ARC — state + helper + nút Hủy
========================================================= */

// Nhóm các arc giống hệt cách renderArcs() dựng (thứ tự khớp card)
function getArcGroups() {
  const groups = arcs.map((arc, i) => ({
    arc,
    num: i + 1,
    chapters: chapters.filter(ch => ch.arc_id === arc.id).sort((a, b) => a.chapter_number - b.chapter_number),
    ungrouped: false
  }));

  const ungroupedChs = chapters.filter(ch => !ch.arc_id).sort((a, b) => a.chapter_number - b.chapter_number);
  if (ungroupedChs.length) {
    groups.push({
      arc: { id: null, name: "Chưa thuộc arc" },
      num: null,
      chapters: ungroupedChs,
      ungrouped: true
    });
  }
  return groups;
}

// Cập nhật thanh trạng thái arc mode trên player
function updateArcModeBar() {
  const bar = document.querySelector("#arcModeBar");
  if (!bar) return;
  bar.hidden = !arcPlayMode;

  if (arcPlayMode) {
    const nameEl = document.querySelector("#arcModeName");
    if (nameEl) {
      const groups = getArcGroups();
      const g = groups[currentArcIndex];
      nameEl.textContent = g
        ? (g.ungrouped ? "Chưa thuộc arc" : `ARC ${String(g.num).padStart(2, "0")} — ${g.arc.name}`)
        : "—";
    }
  }
  refreshArcActive();
}

// ★ Tô viền card arc đang phát + đổi icon nút play trên bìa (▶ / ❚❚)
function refreshArcActive() {
  const playing = (() => {
    const ytWrap = document.querySelector("#youtubePlayerWrap");
    if (youtubePlayer && ytWrap && ytWrap.hidden === false) {
      try { return youtubePlayer.getPlayerState() === YT.PlayerState.PLAYING; } catch (_) { return false; }
    }
    const audio = document.querySelector("#audio");
    return !!(audio && audio.src && !audio.paused);
  })();

  arcCards.forEach(({ card, groupIndex }) => {
    const active = arcPlayMode && groupIndex === currentArcIndex;
    card.classList.toggle("active", active);
    const pb = card.querySelector(".arc-play-btn");
    if (pb) {
      pb.textContent = active ? (playing ? "❚❚" : "▶") : "▶";
      pb.setAttribute("aria-label", active && playing ? "Tạm dừng" : "Phát cả arc");
    }
  });
}

// Hủy arc mode → nghe bình thường
function cancelArcMode() {
  if (!arcPlayMode && currentArcIndex < 0) return;
  arcPlayMode = false;
  currentArcIndex = -1;
  updateArcModeBar();
}

// Bấm "▶ Phát cả arc" (hoặc click card) → phát bài đầu của chương đầu có nhạc
function playArcByIndex(groupIndex) {
  const groups = getArcGroups();
  const group = groups[groupIndex];
  if (!group) return;

  const firstCh = group.chapters.find(c => c.tracks && c.tracks.length);
  if (!firstCh) {
    const na = document.querySelector("#nowArtist");
    if (na) na.textContent = "Arc này chưa có bài nhạc nào.";
    return;
  }

  currentArcIndex = groupIndex;
  arcPlayMode = true;
  updateArcModeBar();
  playTrack(chapters.indexOf(firstCh), 0);
}

// Hết bài cuối của chương → chương kế trong arc → hết arc → cuộn tới arc kế tiếp và phát
function moveToNextChapterInArc() {
  const groups = getArcGroups();
  const group = groups[currentArcIndex];
  if (!group) { cancelArcMode(); return; }

  const chs = group.chapters.filter(c => c.tracks && c.tracks.length);
  const curCh = chapters[currentChapterIndex];
  const pos = chs.findIndex(c => c.id === curCh?.id);
  const nxt = chs[pos + 1];
  if (nxt) {
    playTrack(chapters.indexOf(nxt), 0);
    return;
  }

  // Tìm arc kế tiếp có nhạc (quay vòng từ đầu) + cuộn trình duyệt tới arc đó
  for (let i = 1; i <= groups.length; i++) {
    const gi = (currentArcIndex + i) % groups.length;
    const g = groups[gi];
    const first = g.chapters.find(c => c.tracks && c.tracks.length);
    if (first) {
      currentArcIndex = gi;
      updateArcModeBar();   // ★ cập nhật tên arc trên thanh trạng thái
      scrollToArcCard(gi);  // ★ trình duyệt tự cuộn tới arc kế tiếp
      playTrack(chapters.indexOf(first), 0);
      return;
    }
  }
  cancelArcMode();
}

// Cuộn tới card arc trong vùng Arcs (card đó sẽ tô viền + hiện nút ✕ Hủy)
function scrollToArcCard(groupIndex) {
  const item = arcCards.find(c => c.groupIndex === groupIndex);
  if (item && !item.card.hidden) {
    item.card.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// ---------- Nút Hủy arc mode (thanh player) + tự hủy khi bấm bài bất kỳ ----------
const cancelArcBtn = document.querySelector("#cancelArcMode");
if (cancelArcBtn) cancelArcBtn.onclick = cancelArcMode;

document.addEventListener("click", (e) => {
  const list = document.querySelector("#chaptersList");
  if (!list) return;
  const btn = e.target.closest(".play-btn");
  if (btn && list.contains(btn)) cancelArcMode();
}, true);

/* =========================================================
   NÚT GIỮA = PLAY/PAUSE + ĐỒNG BỘ ICON
========================================================= */

function setPlayPauseIcon(playing) {
  const btn = document.querySelector("#clearPlayer");
  if (!btn) return;
  btn.textContent = playing ? "❚❚" : "▶";
  btn.setAttribute("aria-label", playing ? "Pause" : "Play");
}

function isYoutubeActive() {
  const wrap = document.querySelector("#youtubePlayerWrap");
  return !!(youtubePlayer && wrap && wrap.hidden === false);
}

async function togglePlayPause() {
  if (currentChapterIndex < 0) return; // chưa có bài nào được chọn

  if (isYoutubeActive()) {
    try {
      const s = youtubePlayer.getPlayerState();
      if (s === YT.PlayerState.PLAYING) {
        youtubePlayer.pauseVideo();
      } else {
        youtubePlayer.playVideo();
      }
    } catch (_) {}
    return;
  }

  const audio = document.querySelector("#audio");
  if (audio && audio.src) {
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }
}

// Đồng bộ icon với sự kiện audio
const audioForPP = document.querySelector("#audio");
if (audioForPP) {
  audioForPP.addEventListener("play", () => setPlayPauseIcon(true));
  audioForPP.addEventListener("pause", () => setPlayPauseIcon(false));
  audioForPP.addEventListener("ended", () => setPlayPauseIcon(false));
}

// Đồng bộ icon với YouTube (API không cho gắn thêm event ngoài config)
setInterval(() => {
  const wrap = document.querySelector("#youtubePlayerWrap");
  if (!youtubePlayer || !wrap || wrap.hidden) return;
  try {
    const s = youtubePlayer.getPlayerState();
    if (s === YT.PlayerState.PLAYING) setPlayPauseIcon(true);
    else if (s === YT.PlayerState.PAUSED || s === YT.PlayerState.ENDED) setPlayPauseIcon(false);
  } catch (_) {}
}, 1000);

// Mặc định lúc mới vào trang: hiển thị ▶
setPlayPauseIcon(false);

/* =========================================================
   VOLUME — slider + nút mute
========================================================= */

const volumeSlider = document.querySelector("#volumeSlider");
const muteBtn = document.querySelector("#muteBtn");
let lastVolume = 100;

function applyVolume(v) {
  const vol = Math.min(100, Math.max(0, v));
  if (audioEl) audioEl.volume = vol / 100;
  try {
    if (youtubePlayer && typeof youtubePlayer.setVolume === "function") {
      youtubePlayer.setVolume(Math.round(vol));
    }
  } catch (_) {}
  if (volumeSlider) {
    volumeSlider.value = Math.round(vol);
    volumeSlider.style.setProperty("--vol", vol + "%");
  }
  if (muteBtn) muteBtn.textContent = vol === 0 ? "🔇" : "🔊";
}

if (volumeSlider) {
  volumeSlider.addEventListener("input", () => {
    const v = Number(volumeSlider.value);
    if (v > 0) lastVolume = v;
    applyVolume(v);
  });
}

if (muteBtn) {
  muteBtn.addEventListener("click", () => {
    const v = Number(volumeSlider?.value || 0);
    if (v > 0) {
      lastVolume = v;
      applyVolume(0);
    } else {
      applyVolume(lastVolume || 100);
    }
  });
}

// Volume mặc định khi tải trang
applyVolume(100);