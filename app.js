import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  supabaseReady
} from "./supabase.js";

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
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1 }
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

// ---------- Play ----------
async function playTrack(chapterIndex, trackIndex) {
  const track = chapters[chapterIndex]?.tracks[trackIndex];
  if (!track) return;

  currentChapterIndex = chapterIndex;
  currentTrackIndex = trackIndex;

  document.querySelector("#nowTitle").textContent = track.title;
  document.querySelector("#nowArtist").textContent = track.artist || sourceType(track.source_type);
  document.querySelector("#playerChapter").textContent = chapters[chapterIndex].title;
  document.querySelector("#playerSource").textContent = sourceType(track.source_type);

  const sourceLink = document.querySelector("#sourceLink");
  sourceLink.hidden = !track.source_url;
  if (track.source_url) sourceLink.href = track.source_url;

  const audio = document.querySelector("#audio");

  // YouTube
  if (track.source_type === "youtube" || /youtube\.com|youtu\.be/i.test(track.source_url || "")) {
    hideNormalAudio();
    const videoId = extractYoutubeId(track.source_url);
    if (!videoId) {
      return showError({ message: "Không đọc được YouTube link." });
    }
    loadYoutubeVideo(videoId);
    return;
  }

  hideYoutubePlayer();

  // Uploaded audio
  if (track.source_type === "upload" && track.audio_path) {
    const { data } = supabase.storage.from("music").getPublicUrl(track.audio_path);
    audio.src = data.publicUrl;
    audio.play().catch(() => {});
    return;
  }

  // Direct audio
  if (track.source_url && isDirectAudio(track.source_url)) {
    audio.src = track.source_url;
    audio.play().catch(() => {});
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

// ---------- Controls ----------
document.querySelector("#prevTrack").onclick = () => moveTrack(-1);
document.querySelector("#nextTrack").onclick = () => moveTrack(1);
document.querySelector("#clearPlayer").onclick = () => {
  const audio = document.querySelector("#audio");
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  hideYoutubePlayer();
  document.querySelector("#nowTitle").textContent = "Nothing playing";
  document.querySelector("#nowArtist").textContent = "Choose a track below.";
  document.querySelector("#playerChapter").textContent = "—";
  document.querySelector("#playerSource").textContent = "—";
  document.querySelector("#sourceLink").hidden = true;
  currentChapterIndex = -1;
  currentTrackIndex = -1;
};

function moveTrack(direction) {
  const chapter = chapters[currentChapterIndex];
  if (!chapter?.tracks.length) return;
  let next = currentTrackIndex + direction;
  if (next < 0) next = chapter.tracks.length - 1;
  if (next >= chapter.tracks.length) next = 0;
  playTrack(currentChapterIndex, next);
}