import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  supabaseReady
} from "./supabase.js";

const $ = (id) => document.getElementById(id);

let supabase = null;
let story = null;
let chapters = [];
let arcs = [];

function msg(id, text, error = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", error);
  clearTimeout(el._timer);
  if (text) {
    el._timer = setTimeout(() => {
      el.textContent = "";
      el.classList.remove("error");
    }, 6000);
  }
}

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

function safeFileName(name = "") {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

function detectSource(url = "") {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/spotify\.com/i.test(url)) return "spotify";
  if (/soundcloud\.com/i.test(url)) return "soundcloud";
  if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i.test(url)) return "direct_audio";
  return "external";
}

async function init() {
  if (!supabaseReady()) {
    msg("loginMessage", "Supabase chưa được cấu hình. Kiểm tra supabase.js.", true);
    $("loginBtn").disabled = true;
    return;
  }

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  bindEvents();

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error(error);
    msg("loginMessage", error.message, true);
    return;
  }
  if (data.session) {
    await showDashboard(data.session);
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session) {
      await showDashboard(session);
    }
    if (event === "SIGNED_OUT") {
      $("dashboard").hidden = true;
      $("loginView").hidden = false;
      $("loginPassword").value = "";
    }
  });
}

function bindEvents() {
  $("loginBtn").onclick = login;
  $("logoutBtn").onclick = logout;
  $("saveStoryBtn").onclick = saveStory;
  $("addChapterBtn").onclick = addChapter;
  $("closeTrack").onclick = closeTrack;
  $("trackModal").querySelector(".modal-bg").onclick = closeTrack;
  $("saveTrackBtn").onclick = saveTrack;
  $("loginEmail").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
  $("loginPassword").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
  $("createArcBtn").onclick = createArc;
  $("arcNameInput").addEventListener("keydown", e => { if (e.key === "Enter") createArc(); });
}

async function login() {
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  if (!email) {
    msg("loginMessage", "Bạn chưa nhập email.", true);
    $("loginEmail").focus();
    return;
  }
  if (!password) {
    msg("loginMessage", "Bạn chưa nhập password.", true);
    $("loginPassword").focus();
    return;
  }

  $("loginBtn").disabled = true;
  $("loginBtn").textContent = "Signing in...";
  msg("loginMessage", "Đang đăng nhập...");

  try {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Supabase không phản hồi sau 10 giây.")), 10000);
    });
    const loginRequest = supabase.auth.signInWithPassword({ email, password });
    const result = await Promise.race([loginRequest, timeout]);

    const { data, error } = result;
    if (error) {
      console.error("SUPABASE LOGIN ERROR:", error);
      let text = error.message;
      if (/invalid login credentials/i.test(error.message)) {
        text = "Email hoặc mật khẩu không đúng. Kiểm tra Supabase → Authentication → Users.";
      }
      msg("loginMessage", text, true);
      return;
    }
    if (!data?.session) {
      msg("loginMessage", "Đăng nhập không tạo được session.", true);
      return;
    }

    msg("loginMessage", "Đăng nhập thành công!");
    await showDashboard(data.session);
  } catch (error) {
    console.error("LOGIN FAILED:", error);
    msg("loginMessage", error.message || "Không thể kết nối tới Supabase.", true);
  } finally {
    $("loginBtn").disabled = false;
    $("loginBtn").textContent = "Sign in";
  }
}

async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    alert(error.message);
    return;
  }
  $("dashboard").hidden = true;
  $("loginView").hidden = false;
}

async function showDashboard(session) {
  $("loginView").hidden = true;
  $("dashboard").hidden = false;
  $("userEmail").textContent = session.user.email || "";
  await loadAdmin();
}

async function loadAdmin() {
  const { data: stories, error } = await supabase
    .from("stories")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error(error);
    msg("storyMessage", error.message, true);
    return;
  }

  story = stories?.[0] || null;
  if (!story) {
    chapters = [];
    arcs = [];
    $("storyTitleInput").value = "";
    $("storyNoteInput").value = "";
    renderArcsAdmin();
    fillArcOptions();
    renderChapters();
    return;
  }

  $("storyTitleInput").value = story.title || "";
  $("storyNoteInput").value = story.note || "";

  // ★ Nạp arcs (đã sắp theo position)
  const { data: ar, error: arErr } = await supabase
    .from("arcs")
    .select("*")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (arErr) {
    console.error(arErr);
    msg("arcMessage", arErr.message, true);
  }
  arcs = ar || [];
  renderArcsAdmin();
  fillArcOptions();

  const { data: ch, error: chError } = await supabase
    .from("chapters")
    .select("*")
    .eq("story_id", story.id)
    .order("chapter_number", { ascending: true });

  if (chError) {
    msg("chapterMessage", chError.message, true);
    return;
  }

  chapters = ch || [];
  renderChapters();
}

// ----- STORY -----
async function saveStory() {
  const title = $("storyTitleInput").value.trim() || "Untitled story";
  const note = $("storyNoteInput").value.trim();
  let cover_url = story?.cover_url || null;
  const file = $("coverFile").files?.[0];

  $("saveStoryBtn").disabled = true;
  $("saveStoryBtn").textContent = "Saving...";

  try {
    if (file) {
      if (!file.type.startsWith("image/")) {
        msg("storyMessage", "Cover phải là file hình ảnh.", true);
        return;
      }
      const path = `covers/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const { error } = await supabase.storage.from("covers").upload(path, file, {
        upsert: false,
        contentType: file.type
      });
      if (error) {
        msg("storyMessage", error.message, true);
        return;
      }
      cover_url = supabase.storage.from("covers").getPublicUrl(path).data.publicUrl;
    }

    if (story) {
      const { data, error } = await supabase
        .from("stories")
        .update({ title, note, cover_url })
        .eq("id", story.id)
        .select()
        .single();
      if (error) {
        msg("storyMessage", error.message, true);
        return;
      }
      story = data;
    } else {
      const { data, error } = await supabase
        .from("stories")
        .insert({ title, note, cover_url })
        .select()
        .single();
      if (error) {
        msg("storyMessage", error.message, true);
        return;
      }
      story = data;
    }

    $("coverFile").value = "";
    msg("storyMessage", "Đã lưu story.");
    await loadAdmin();
  } finally {
    $("saveStoryBtn").disabled = false;
    $("saveStoryBtn").textContent = "Save story";
  }
}

// ----- ARC -----
function fillArcOptions() {
  const sel = $("chapterArc");
  if (!sel) return;
  sel.innerHTML = `<option value="">— Không thuộc arc —</option>` +
    arcs.map((a, i) => `<option value="${a.id}">ARC ${String(i + 1).padStart(2, "0")} — ${esc(a.name)}</option>`).join("");
}

// ★ Render danh sách arc kèm SỐ THỨ TỰ + nút ▲▼ đổi thứ tự
function renderArcsAdmin() {
  const wrap = $("arcList");
  if (!wrap) return;
  wrap.innerHTML = "";

  if (!arcs.length) {
    wrap.innerHTML = `<p class="hint">Chưa có arc nào. Tạo arc đầu tiên ở ô phía trên.</p>`;
    return;
  }

  arcs.forEach((a, idx) => {
    const count = chapters.filter(ch => ch.arc_id === a.id).length;
    const div = document.createElement("div");
    div.className = "arc-item";
    div.innerHTML = `
      <div class="arc-item-main">
        <span class="arc-item-num">ARC ${String(idx + 1).padStart(2, "0")}</span>
        <strong class="arc-item-name">${esc(a.name)}</strong>
        <br>
        <small class="arc-item-count">${count} chapter${count === 1 ? "" : "s"}</small>
      </div>
      <div class="arc-item-actions">
        <button class="small-btn" type="button" title="Lên trên" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button class="small-btn" type="button" title="Xuống dưới" ${idx === arcs.length - 1 ? "disabled" : ""}>▼</button>
        <button class="small-btn" type="button">Rename</button>
        <button class="small-btn danger" type="button">Delete</button>
      </div>
    `;
    div.querySelectorAll("button")[0].onclick = () => moveArc(a, -1);
    div.querySelectorAll("button")[1].onclick = () => moveArc(a, 1);
    div.querySelectorAll("button")[2].onclick = () => renameArc(a);
    div.querySelectorAll("button")[3].onclick = () => deleteArc(a);
    wrap.appendChild(div);
  });
}

async function createArc() {
  const name = $("arcNameInput").value.trim();
  if (!name) return msg("arcMessage", "Nhập tên arc.", true);
  if (!story) return msg("arcMessage", "Hãy Save story trước.", true);

  const { error } = await supabase
    .from("arcs")
    .insert({ story_id: story.id, name, position: arcs.length });

  if (error) {
    msg("arcMessage", error.message, true);
    return;
  }

  $("arcNameInput").value = "";
  msg("arcMessage", "Đã tạo arc.");
  await loadAdmin();
}

// ★ Đổi thứ tự arc: hoán đổi position với arc kế bên
async function moveArc(arc, dir) {
  const idx = arcs.findIndex(a => a.id === arc.id);
  const target = idx + dir;
  if (target < 0 || target >= arcs.length) return;
  const other = arcs[target];

  const results = await Promise.all([
    supabase.from("arcs").update({ position: other.position }).eq("id", arc.id),
    supabase.from("arcs").update({ position: arc.position }).eq("id", other.id)
  ]);
  const err = results.find(r => r.error)?.error;
  if (err) {
    alert(err.message);
    return;
  }
  await loadAdmin();
}

async function renameArc(arc) {
  const name = prompt("Tên mới của arc:", arc.name);
  if (name === null) return;
  const clean = name.trim();
  if (!clean) {
    alert("Tên arc không được để trống.");
    return;
  }
  const { error } = await supabase.from("arcs").update({ name: clean }).eq("id", arc.id);
  if (error) {
    alert(error.message);
    return;
  }
  await loadAdmin();
}

async function deleteArc(arc) {
  if (!confirm(`Xóa arc "${arc.name}"?\n\nCác chương được giữ lại, chỉ bỏ gán khỏi arc này.`)) return;
  const { error } = await supabase.from("arcs").delete().eq("id", arc.id);
  if (error) {
    alert(error.message);
    return;
  }
  await loadAdmin();
}

async function assignChapterArc(chapterId, arcId) {
  const { error } = await supabase
    .from("chapters")
    .update({ arc_id: arcId || null })
    .eq("id", chapterId);
  if (error) {
    alert(error.message);
    return;
  }
  await loadAdmin();
}

// ----- CHAPTER -----
async function addChapter() {
  if (!story) {
    msg("chapterMessage", "Hãy Save story trước.", true);
    return;
  }

  const number = Number($("chapterNumber").value);
  const title = $("chapterTitle").value.trim();
  const style = $("chapterStyle").value.trim();
  const arcId = $("chapterArc").value;

  if (!Number.isInteger(number) || number < 1) {
    msg("chapterMessage", "Chapter number phải là số nguyên từ 1.", true);
    return;
  }
  if (!title) {
    msg("chapterMessage", "Bạn chưa nhập tên chapter.", true);
    return;
  }
  if (chapters.some(c => Number(c.chapter_number) === number)) {
    msg("chapterMessage", `Chapter ${number} đã tồn tại.`, true);
    return;
  }

  const { error } = await supabase
    .from("chapters")
    .insert({ story_id: story.id, chapter_number: number, title, style, arc_id: arcId || null });

  if (error) {
    msg("chapterMessage", error.message, true);
    return;
  }

  $("chapterNumber").value = "";
  $("chapterTitle").value = "";
  $("chapterStyle").value = "";
  $("chapterArc").value = "";
  msg("chapterMessage", "Đã tạo chapter.");
  await loadAdmin();
}

function renderChapters() {
  const wrap = $("adminChapters");
  wrap.innerHTML = "";

  if (!chapters.length) {
    wrap.innerHTML = `<p class="hint">Chưa có chapter.</p>`;
    return;
  }

  const arcOptions = arcs.map((a, i) => `<option value="${a.id}">ARC ${String(i + 1).padStart(2, "0")} — ${esc(a.name)}</option>`).join("");

  chapters.forEach(ch => {
    const div = document.createElement("div");
    div.className = "admin-chapter";
    div.innerHTML = `
      <div class="admin-chapter-head">
        <div>
          <p class="eyebrow">CHAPTER ${String(ch.chapter_number).padStart(2, "0")}</p>
          <h3>${esc(ch.title)}</h3>
          <small>${esc(ch.style || "No style")}</small>
        </div>
        <div class="row-actions">
          <button class="small-btn add" type="button">+ Music</button>
          <button class="small-btn rename" type="button">Rename</button>
          <button class="small-btn danger" type="button">Delete</button>
        </div>
      </div>
      <div class="chapter-arc-row">
        <span class="chapter-arc-label">ARC</span>
        <select class="arc-select" data-cid="${ch.id}">
          <option value="">— Không thuộc arc —</option>
          ${arcOptions}
        </select>
      </div>
      <div class="admin-tracks"><p class="hint">Loading tracks...</p></div>
    `;

    div.querySelector(".add").onclick = () => openTrack(ch.id);
    div.querySelector(".rename").onclick = () => renameChapter(ch);
    div.querySelector(".danger").onclick = () => deleteChapter(ch);

    const sel = div.querySelector(".arc-select");
    sel.value = ch.arc_id || "";
    sel.onchange = () => assignChapterArc(ch.id, sel.value);

    $("adminChapters").appendChild(div);
    loadTracks(ch.id, div.querySelector(".admin-tracks"));
  });
}

async function loadTracks(chapterId, container) {
  const { data, error } = await supabase
    .from("tracks")
    .select("*")
    .eq("chapter_id", chapterId)
    .order("track_number", { ascending: true });

  if (error) {
    container.innerHTML = `<p class="hint error">${esc(error.message)}</p>`;
    return;
  }

  if (!data?.length) {
    container.innerHTML = `<p class="hint">Chưa có bài nhạc.</p>`;
    return;
  }

  container.innerHTML = "";
  data.forEach(track => {
    const row = document.createElement("div");
    row.className = "admin-track-row";

    let thumbHtml = "";
    if (track.cover_path) {
      const coverUrl = supabase.storage.from("covers").getPublicUrl(track.cover_path).data.publicUrl;
      thumbHtml = `<img src="${esc(coverUrl)}" alt="" style="width:34px;height:34px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#12100e;">`;
    }

    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;min-width:0;">
        ${thumbHtml}
        <div style="min-width:0;">
          <strong>${String(track.track_number).padStart(2, "0")} — ${esc(track.title)}</strong>
          <small>${esc(track.artist || track.source_type || "External link")}</small>
        </div>
      </div>
      <div class="row-actions">
        <button class="small-btn delete-track" type="button">Delete</button>
      </div>
    `;
    row.querySelector(".delete-track").onclick = () => deleteTrack(track);
    container.appendChild(row);
  });
}

// ----- TRACK MODAL -----
function openTrack(chapterId) {
  $("trackChapterId").value = chapterId;
  $("trackId").value = "";
  $("trackTitle").value = "";
  $("trackArtist").value = "";
  $("trackUrl").value = "";
  $("trackFile").value = "";
  $("trackCoverFile").value = "";
  $("trackModalTitle").textContent = "Add music";
  msg("trackMessage", "");
  $("trackModal").hidden = false;
}

function closeTrack() {
  $("trackModal").hidden = true;
}

async function saveTrack() {
  const chapterId = $("trackChapterId").value;
  const title = $("trackTitle").value.trim();
  const artist = $("trackArtist").value.trim();
  const url = $("trackUrl").value.trim();
  const file = $("trackFile").files?.[0];
  const coverFile = $("trackCoverFile").files?.[0];

  if (!chapterId) return msg("trackMessage", "Không xác định được chapter.", true);
  if (!title) return msg("trackMessage", "Bạn chưa nhập tên bài hát.", true);
  if (!url && !file) return msg("trackMessage", "Thêm link hoặc chọn file audio.", true);

  if (url) {
    try { new URL(url); } catch (_) {
      return msg("trackMessage", "Link không hợp lệ.", true);
    }
  }

  $("saveTrackBtn").disabled = true;
  $("saveTrackBtn").textContent = "Saving...";

  try {
    const { data: oldTracks, error } = await supabase
      .from("tracks")
      .select("track_number")
      .eq("chapter_id", chapterId)
      .order("track_number", { ascending: false })
      .limit(1);

    if (error) {
      msg("trackMessage", error.message, true);
      return;
    }

    const nextNumber = Number(oldTracks?.[0]?.track_number || 0) + 1;
    let source_type = url ? detectSource(url) : "upload";
    let audio_path = null;
    let cover_path = null;

    if (file) {
      if (!file.type.startsWith("audio/")) {
        msg("trackMessage", "File phải là file audio.", true);
        return;
      }
      audio_path = `audio/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage.from("music").upload(audio_path, file, {
        upsert: false,
        contentType: file.type
      });
      if (uploadError) {
        msg("trackMessage", uploadError.message, true);
        return;
      }
      source_type = "upload";
    }

    if (coverFile) {
      if (!coverFile.type.startsWith("image/")) {
        msg("trackMessage", "Ảnh bài hát phải là file hình ảnh.", true);
        return;
      }
      cover_path = `track-covers/${crypto.randomUUID()}-${safeFileName(coverFile.name)}`;
      const { error: coverError } = await supabase.storage.from("covers").upload(cover_path, coverFile, {
        upsert: false,
        contentType: coverFile.type
      });
      if (coverError) {
        msg("trackMessage", coverError.message, true);
        return;
      }
    }

    const { error: insertError } = await supabase
      .from("tracks")
      .insert({
        chapter_id: chapterId,
        track_number: nextNumber,
        title,
        artist,
        source_type,
        source_url: url || null,
        audio_path,
        cover_path
      });

    if (insertError) {
      if (audio_path) {
        await supabase.storage.from("music").remove([audio_path]);
      }
      if (cover_path) {
        await supabase.storage.from("covers").remove([cover_path]);
      }
      msg("trackMessage", insertError.message, true);
      return;
    }

    closeTrack();
    await loadAdmin();
  } finally {
    $("saveTrackBtn").disabled = false;
    $("saveTrackBtn").textContent = "Save track";
  }
}

// ----- CHAPTER / TRACK ACTIONS -----
async function renameChapter(ch) {
  const title = prompt("Tên chapter:", ch.title);
  if (title === null) return;
  const style = prompt("Tone / style:", ch.style || "");
  if (style === null) return;
  const cleanTitle = title.trim();
  if (!cleanTitle) {
    alert("Tên chapter không được để trống.");
    return;
  }
  const { error } = await supabase
    .from("chapters")
    .update({ title: cleanTitle, style: style.trim() })
    .eq("id", ch.id);
  if (error) {
    alert(error.message);
    return;
  }
  await loadAdmin();
}

async function deleteChapter(ch) {
  if (!confirm(`Xóa "${ch.title}"?\n\nCác bài nhạc trong chapter cũng sẽ bị xóa.`)) return;
  const { data: tracks } = await supabase
    .from("tracks")
    .select("audio_path, cover_path")
    .eq("chapter_id", ch.id);

  const audioPaths = (tracks || []).map(t => t.audio_path).filter(Boolean);
  const coverPaths = (tracks || []).map(t => t.cover_path).filter(Boolean);
  if (audioPaths.length) {
    await supabase.storage.from("music").remove(audioPaths);
  }
  if (coverPaths.length) {
    await supabase.storage.from("covers").remove(coverPaths);
  }
  const { error } = await supabase.from("chapters").delete().eq("id", ch.id);
  if (error) {
    alert(error.message);
    return;
  }
  await loadAdmin();
}

async function deleteTrack(track) {
  if (!confirm(`Xóa bài "${track.title}"?`)) return;
  if (track.audio_path) {
    await supabase.storage.from("music").remove([track.audio_path]);
  }
  if (track.cover_path) {
    await supabase.storage.from("covers").remove([track.cover_path]);
  }
  const { error } = await supabase.from("tracks").delete().eq("id", track.id);
  if (error) {
    alert(error.message);
    return;
  }
  await loadAdmin();
}

init();