import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseReady } from "./supabase.js";

const $ = (id) => document.getElementById(id);

let supabase = null;
let story = null;
let chapters = [];
let arcs = [];
let adminChapterCards = [];
let adminArcCards = [];

function msg(id, text, error = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", error);
  clearTimeout(el._timer);
  if (text) el._timer = setTimeout(() => { el.textContent = ""; el.classList.remove("error"); }, 6000);
}

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}

function safeFileName(name = "") {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_");
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
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  bindEvents();

  const { data, error } = await supabase.auth.getSession();
  if (error) { console.error(error); msg("loginMessage", error.message, true); return; }
  if (data.session) await showDashboard(data.session);

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session) await showDashboard(session);
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
  $("adminArcSearch").addEventListener("input", applyArcSearch);
  $("adminChapterSearch").addEventListener("input", applyAdminChapterSearch);
}

async function login() {
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  if (!email) return msg("loginMessage", "Bạn chưa nhập email.", true);
  if (!password) return msg("loginMessage", "Bạn chưa nhập password.", true);

  $("loginBtn").disabled = true;
  $("loginBtn").textContent = "Signing in...";
  msg("loginMessage", "Đang đăng nhập...");

  try {
    const timeout = new Promise((_, r) => setTimeout(() => r(new Error("Supabase không phản hồi sau 10 giây.")), 10000));
    const { data, error } = await Promise.race([
      supabase.auth.signInWithPassword({ email, password }), timeout
    ]);
    if (error) {
      console.error("SUPABASE LOGIN ERROR:", error);
      msg("loginMessage", /invalid login credentials/i.test(error.message)
        ? "Email hoặc mật khẩu không đúng."
        : error.message, true);
      return;
    }
    if (!data?.session) return msg("loginMessage", "Đăng nhập không tạo được session.", true);
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
  if (error) return alert(error.message);
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
    .from("stories").select("*").order("created_at", { ascending: true }).limit(1);
  if (error) { console.error(error); msg("storyMessage", error.message, true); return; }

  story = stories?.[0] || null;
  if (!story) {
    chapters = []; arcs = [];
    $("storyTitleInput").value = ""; $("storyNoteInput").value = "";
    renderArcsAdmin(); fillArcOptions(); renderChapters();
    return;
  }

  $("storyTitleInput").value = story.title || "";
  $("storyNoteInput").value = story.note || "";

  const { data: ar, error: arErr } = await supabase
    .from("arcs").select("*").order("position", { ascending: true }).order("created_at", { ascending: true });
  if (arErr) { console.error(arErr); msg("arcMessage", arErr.message, true); }
  arcs = ar || [];
  fillArcOptions();

  const { data: ch, error: chError } = await supabase
    .from("chapters").select("*").eq("story_id", story.id).order("chapter_number", { ascending: true });
  if (chError) { msg("chapterMessage", chError.message, true); return; }

  chapters = ch || [];
  renderChapters();
  renderArcsAdmin();
}

async function saveStory() {
  const title = $("storyTitleInput").value.trim() || "Untitled story";
  const note = $("storyNoteInput").value.trim();
  let cover_url = story?.cover_url || null;
  const file = $("coverFile").files?.[0];

  $("saveStoryBtn").disabled = true;
  $("saveStoryBtn").textContent = "Saving...";
  try {
    if (file) {
      if (!file.type.startsWith("image/")) { msg("storyMessage", "Cover phải là ảnh.", true); return; }
      const path = `covers/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const { error } = await supabase.storage.from("covers").upload(path, file, { upsert: false, contentType: file.type });
      if (error) { msg("storyMessage", error.message, true); return; }
      cover_url = supabase.storage.from("covers").getPublicUrl(path).data.publicUrl;
    }

    if (story) {
      const { data, error } = await supabase.from("stories").update({ title, note, cover_url }).eq("id", story.id).select().single();
      if (error) { msg("storyMessage", error.message, true); return; }
      story = data;
    } else {
      const { data, error } = await supabase.from("stories").insert({ title, note, cover_url }).select().single();
      if (error) { msg("storyMessage", error.message, true); return; }
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

function fillArcOptions() {
  const sel = $("chapterArc");
  if (!sel) return;
  sel.innerHTML = `<option value="">— Không thuộc arc —</option>` +
    arcs.map((a, i) => `<option value="${a.id}">ARC ${String(i + 1).padStart(2, "0")} — ${esc(a.name)}</option>`).join("");
}

function renderArcsAdmin() {
  const wrap = $("arcList");
  if (!wrap) return;
  wrap.innerHTML = "";
  adminArcCards = [];

  if (!arcs.length) {
    wrap.innerHTML = `<p class="hint">Chưa có arc nào.</p>`;
    return;
  }

  arcs.forEach((a, idx) => {
    const chs = chapters.filter(ch => ch.arc_id === a.id)
      .sort((x, y) => Number(x.chapter_number) - Number(y.chapter_number));

    const chipsHtml = chs.length
      ? chs.map(ch => `
          <span class="arc-chapter-chip">
            <span class="arc-chip-num">CH ${String(ch.chapter_number).padStart(2, "0")}</span>
            <span class="arc-chip-title">${esc(ch.title)}</span>
            <button class="arc-chip-del" type="button" title="Xóa chapter ${ch.chapter_number}: ${esc(ch.title)}">×</button>
          </span>`).join("")
      : `<p class="hint">Chưa có chương trong arc này.</p>`;

    const div = document.createElement("div");
    div.className = "arc-item";
    div.innerHTML = `
      <div class="arc-item-top">
        <div class="arc-item-main">
          <span class="arc-item-num">ARC ${String(idx + 1).padStart(2, "0")}</span>
          <strong class="arc-item-name">${esc(a.name)}</strong>
          <br>
          <small class="arc-item-count">${chs.length} chapter${chs.length === 1 ? "" : "s"}</small>
        </div>
        <div class="arc-item-actions">
          <button class="small-btn add" type="button" title="Thêm chapter vào arc này">+ Chương</button>
          <button class="small-btn" type="button" title="Lên trên" ${idx === 0 ? "disabled" : ""}>▲</button>
          <button class="small-btn" type="button" title="Xuống dưới" ${idx === arcs.length - 1 ? "disabled" : ""}>▼</button>
          <button class="small-btn" type="button">Rename</button>
          <button class="small-btn danger" type="button">Delete</button>
        </div>
      </div>
      <div class="arc-item-chapters">${chipsHtml}</div>
    `;

    const btns = div.querySelectorAll(".arc-item-actions button");
    btns[0].onclick = () => addChapterToArc(a);
    btns[1].onclick = () => moveArc(a, -1);
    btns[2].onclick = () => moveArc(a, 1);
    btns[3].onclick = () => renameArc(a);
    btns[4].onclick = () => deleteArc(a);

    div.querySelectorAll(".arc-chip-del").forEach((delBtn, i) => delBtn.onclick = () => deleteChapter(chs[i]));

    wrap.appendChild(div);
    adminArcCards.push({ card: div, arc: a, num: idx + 1 });
  });
  applyArcSearch();
}

function applyArcSearch() {
  const q = ($("adminArcSearch")?.value || "").trim().toLowerCase();
  function score(name) {
    if (!q) return 0;
    const n = (name || "").toLowerCase();
    if (!n.includes(q)) { if (n.split(/\s+/).some(w => w.startsWith(q))) return 30; return 0; }
    if (n === q) return 100;
    if (n.startsWith(q)) return 80;
    return 60;
  }
  const ranked = adminArcCards.map(e => ({ ...e, score: score(e.arc.name) }))
    .sort((a, b) => b.score - a.score);
  const wrap = $("arcList");
  if (wrap) ranked.forEach(({ card }) => wrap.appendChild(card));
  ranked.forEach(({ card, score }) => card.classList.toggle("search-hit", score > 0));
  const matches = ranked.filter(r => r.score > 0).length;
  const empty = $("adminArcSearchEmpty");
  if (empty) {
    empty.hidden = !(q && matches === 0);
    empty.textContent = `Không tìm thấy arc nào khớp "${q}". Đang hiển thị toàn bộ.`;
  }
}

async function createArc() {
  const name = $("arcNameInput").value.trim();
  if (!name) return msg("arcMessage", "Nhập tên arc.", true);
  if (!story) return msg("arcMessage", "Hãy Save story trước.", true);
  const { error } = await supabase.from("arcs").insert({ story_id: story.id, name, position: arcs.length });
  if (error) return msg("arcMessage", error.message, true);
  $("arcNameInput").value = "";
  msg("arcMessage", "Đã tạo arc.");
  await loadAdmin();
}

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
  if (err) return alert(err.message);
  await loadAdmin();
}

async function renameArc(arc) {
  const name = prompt("Tên mới của arc:", arc.name);
  if (name === null) return;
  const clean = name.trim();
  if (!clean) return alert("Tên arc không được để trống.");
  const { error } = await supabase.from("arcs").update({ name: clean }).eq("id", arc.id);
  if (error) return alert(error.message);
  await loadAdmin();
}

async function deleteArc(arc) {
  if (!confirm(`Xóa arc "${arc.name}"?\n\nCác chương giữ lại, chỉ bỏ gán.`)) return;
  const { error } = await supabase.from("arcs").delete().eq("id", arc.id);
  if (error) return alert(error.message);
  await loadAdmin();
}

async function assignChapterArc(chapterId, arcId) {
  const { error } = await supabase.from("chapters").update({ arc_id: arcId || null }).eq("id", chapterId);
  if (error) return alert(error.message);
  await loadAdmin();
}

async function addChapter() {
  if (!story) return msg("chapterMessage", "Hãy Save story trước.", true);
  const number = Number($("chapterNumber").value);
  const title = $("chapterTitle").value.trim();
  const style = $("chapterStyle").value.trim();
  const arcId = $("chapterArc").value;

  if (!Number.isInteger(number) || number < 1) return msg("chapterMessage", "Số chương phải là số nguyên từ 1.", true);
  if (!title) return msg("chapterMessage", "Bạn chưa nhập tên chapter.", true);
  if (chapters.some(c => Number(c.chapter_number) === number)) return msg("chapterMessage", `Chapter ${number} đã tồn tại.`, true);

  const { error } = await supabase.from("chapters").insert({ story_id: story.id, chapter_number: number, title, style, arc_id: arcId || null });
  if (error) return msg("chapterMessage", error.message, true);

  $("chapterNumber").value = ""; $("chapterTitle").value = ""; $("chapterStyle").value = ""; $("chapterArc").value = "";
  msg("chapterMessage", "Đã tạo chapter.");
  await loadAdmin();
}

function renderChapters() {
  const wrap = $("adminChapters");
  wrap.innerHTML = "";
  adminChapterCards = [];
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
          <button class="small-btn" type="button">Rename</button>
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
    div.querySelectorAll(".small-btn")[1].onclick = () => renameChapter(ch);
    div.querySelector(".danger").onclick = () => deleteChapter(ch);

    const sel = div.querySelector(".arc-select");
    sel.value = ch.arc_id || "";
    sel.onchange = () => assignChapterArc(ch.id, sel.value);

    $("adminChapters").appendChild(div);
    loadTracks(ch.id, div.querySelector(".admin-tracks"));
    adminChapterCards.push({ card: div, chapter: ch });
  });
  applyAdminChapterSearch();
}

function applyAdminChapterSearch() {
  const q = ($("adminChapterSearch")?.value || "").trim().toLowerCase();
  const isNumber = /^\d+$/.test(q);
  const ranked = adminChapterCards.map(({ card, chapter }) => {
    let score = 0;
    if (q && isNumber) {
      const numStr = String(chapter.chapter_number);
      if (numStr === q || numStr.padStart(2, "0") === q) score = 100;
      else if (numStr.startsWith(q)) score = 50;
    } else if (q) {
      const t = (chapter.title || "").toLowerCase();
      if (t === q) score = 90;
      else if (t.startsWith(q)) score = 70;
      else if (t.includes(q)) score = 50;
    }
    return { card, score };
  }).sort((a, b) => b.score - a.score);

  const wrap = $("adminChapters");
  if (wrap) ranked.forEach(({ card }) => wrap.appendChild(card));
  ranked.forEach(({ card, score }) => card.classList.toggle("search-hit", score > 0));

  const matches = ranked.filter(r => r.score > 0).length;
  const empty = $("adminChapterSearchEmpty");
  if (empty) {
    empty.hidden = !(q && matches === 0);
    empty.textContent = `Không tìm thấy chapter nào khớp "${q}". Đang hiển thị toàn bộ.`;
  }
}

async function loadTracks(chapterId, container) {
  const { data, error } = await supabase
    .from("tracks").select("*").eq("chapter_id", chapterId).order("track_number", { ascending: true });
  if (error) { container.innerHTML = `<p class="hint error">${esc(error.message)}</p>`; return; }
  if (!data?.length) { container.innerHTML = `<p class="hint">Chưa có bài nhạc.</p>`; return; }
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
      <div class="row-actions"><button class="small-btn" type="button">Delete</button></div>
    `;
    row.querySelector(".small-btn").onclick = () => deleteTrack(track);
    container.appendChild(row);
  });
}

function openTrack(chapterId) {
  $("trackChapterId").value = chapterId;
  $("trackId").value = "";
  $("trackTitle").value = ""; $("trackArtist").value = ""; $("trackUrl").value = "";
  $("trackFile").value = ""; $("trackCoverFile").value = "";
  $("trackModalTitle").textContent = "Add music";
  msg("trackMessage", "");
  $("trackModal").hidden = false;
}

function closeTrack() { $("trackModal").hidden = true; }

async function saveTrack() {
  const chapterId = $("trackChapterId").value;
  const title = $("trackTitle").value.trim();
  const artist = $("trackArtist").value.trim();
  const url = $("trackUrl").value.trim();
  const file = $("trackFile").files?.[0];
  const coverFile = $("trackCoverFile").files?.[0];

  if (!chapterId) return msg("trackMessage", "Không xác định chapter.", true);
  if (!title) return msg("trackMessage", "Bạn chưa nhập tên bài hát.", true);
  if (!url && !file) return msg("trackMessage", "Thêm link hoặc file audio.", true);
  if (url) { try { new URL(url); } catch (_) { return msg("trackMessage", "Link không hợp lệ.", true); } }

  $("saveTrackBtn").disabled = true;
  $("saveTrackBtn").textContent = "Saving...";
  try {
    const { data: oldTracks, error } = await supabase
      .from("tracks").select("track_number").eq("chapter_id", chapterId).order("track_number", { ascending: false }).limit(1);
    if (error) { msg("trackMessage", error.message, true); return; }
    const nextNumber = Number(oldTracks?.[0]?.track_number || 0) + 1;
    let source_type = url ? detectSource(url) : "upload";
    let audio_path = null, cover_path = null;

    if (file) {
      if (!file.type.startsWith("audio/")) { msg("trackMessage", "File phải là audio.", true); return; }
      audio_path = `audio/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const { error: ue } = await supabase.storage.from("music").upload(audio_path, file, { upsert: false, contentType: file.type });
      if (ue) { msg("trackMessage", ue.message, true); return; }
      source_type = "upload";
    }
    if (coverFile) {
      if (!coverFile.type.startsWith("image/")) { msg("trackMessage", "Ảnh phải là ảnh.", true); return; }
      cover_path = `track-covers/${crypto.randomUUID()}-${safeFileName(coverFile.name)}`;
      const { error: ce } = await supabase.storage.from("covers").upload(cover_path, coverFile, { upsert: false, contentType: coverFile.type });
      if (ce) { msg("trackMessage", ce.message, true); return; }
    }

    const { error: insertError } = await supabase.from("tracks").insert({
      chapter_id: chapterId, track_number: nextNumber, title, artist,
      source_type, source_url: url || null, audio_path, cover_path
    });
    if (insertError) {
      if (audio_path) await supabase.storage.from("music").remove([audio_path]);
      if (cover_path) await supabase.storage.from("covers").remove([cover_path]);
      return msg("trackMessage", insertError.message, true);
    }
    closeTrack();
    await loadAdmin();
  } finally {
    $("saveTrackBtn").disabled = false;
    $("saveTrackBtn").textContent = "Save track";
  }
}

async function renameChapter(ch) {
  const title = prompt("Tên chapter:", ch.title);
  if (title === null) return;
  const style = prompt("Tone / style:", ch.style || "");
  if (style === null) return;
  const cleanTitle = title.trim();
  if (!cleanTitle) return alert("Tên chapter không được để trống.");
  const { error } = await supabase.from("chapters").update({ title: cleanTitle, style: style.trim() }).eq("id", ch.id);
  if (error) return alert(error.message);
  await loadAdmin();
}

async function deleteChapter(ch) {
  if (!confirm(`Xóa "${ch.title}"?\n\nCác bài nhạc trong chapter cũng bị xóa.`)) return;
  const { data: tracks } = await supabase.from("tracks").select("audio_path, cover_path").eq("chapter_id", ch.id);
  const audioPaths = (tracks || []).map(t => t.audio_path).filter(Boolean);
  const coverPaths = (tracks || []).map(t => t.cover_path).filter(Boolean);
  if (audioPaths.length) await supabase.storage.from("music").remove(audioPaths);
  if (coverPaths.length) await supabase.storage.from("covers").remove(coverPaths);
  const { error } = await supabase.from("chapters").delete().eq("id", ch.id);
  if (error) return alert(error.message);
  await loadAdmin();
}

async function deleteTrack(track) {
  if (!confirm(`Xóa bài "${track.title}"?`)) return;
  if (track.audio_path) await supabase.storage.from("music").remove([track.audio_path]);
  if (track.cover_path) await supabase.storage.from("covers").remove([track.cover_path]);
  const { error } = await supabase.from("tracks").delete().eq("id", track.id);
  if (error) return alert(error.message);
  await loadAdmin();
}

async function addChapterToArc(arc) {
  if (!story) return alert("Hãy Save story trước.");
  const num = prompt(`Chapter number cho arc "${arc.name}":`);
  if (num === null) return;
  const number = Number(num.trim());
  if (!Number.isInteger(number) || number < 1) return alert("Chapter number phải là số nguyên từ 1.");
  if (chapters.some(c => Number(c.chapter_number) === number)) return alert(`Chapter ${number} đã tồn tại.`);
  const t = prompt(`Tiêu đề chapter ${number}:`);
  if (t === null) return;
  const title = t.trim();
  if (!title) return alert("Tên chapter không được để trống.");
  const style = prompt("Tone / style:", "") || "";
  const { error } = await supabase.from("chapters").insert({ story_id: story.id, chapter_number: number, title, style: style.trim(), arc_id: arc.id });
  if (error) return alert(error.message);
  alert(`Đã thêm chapter ${number} vào arc "${arc.name}".`);
  await loadAdmin();
}

init();