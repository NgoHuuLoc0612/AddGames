/* ─────────────────────────────────────────────────────────────────────────────
   ADDGAMES — app.js
   Full game platform: list, add (upload or GitHub), play via Netlify redirect
   ───────────────────────────────────────────────────────────────────────────── */

(() => {
  'use strict';

  // ── Supabase client ──────────────────────────────────────────────────────────
  const sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON);
  const BUCKET = 'game-files';
  const TABLE  = 'games';

  // ── State ─────────────────────────────────────────────────────────────────────
  let allGames = [];
  let files    = [];
  let activeTab = 'upload';
  let selectedIcon = '🎮';

  const ICONS = ['🎮','🕹️','👾','🎯','🎲','🃏','🧩','⚔️','🛡️','🚀','🌍','🧪',
                 '💎','🔮','🏆','⚡','🎸','🎵','🌊','🔥','🌙','⭐','🦊','🐉',
                 '🤖','👻','💀','🧟','🦄','🍄','🌵','🎃'];

  const THUMB_COLORS = [
    ['#1a2332','#0f3460'],['#1a1a2e','#16213e'],['#0d1b2a','#1b4332'],
    ['#1a0a2e','#2d1b69'],['#2d0a0a','#6d1a1a'],['#0a2d1a','#1a5c2e'],
    ['#1a1a0a','#3d3200'],['#0a1a2d','#00376b'],['#2d1a0a','#6b3d00'],
    ['#0a2d2d','#006b6b'],
  ];

  // ── DOM refs ──────────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const gameGrid    = $('gameGrid');
  const addModal    = $('addModal');
  const alertBox    = $('alertBox');
  const slugPreview = $('slugPreview');
  const fileList    = $('fileList');
  const progressBar = $('progressBar');

  // ── Init ──────────────────────────────────────────────────────────────────────
  async function init() {
    buildIconGrid();
    bindEvents();
    await loadGames();
    subscribeRealtime();
  }

  // ── Load games from Supabase ──────────────────────────────────────────────────
  async function loadGames() {
    const { data, error } = await sb
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) { showToast('Failed to load games: ' + error.message, 'error'); return; }
    allGames = data || [];
    renderGames(allGames);
    $('statTotal').textContent = allGames.length;
  }

  // ── Realtime subscription ─────────────────────────────────────────────────────
  function subscribeRealtime() {
    sb.channel('games-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLE }, payload => {
        allGames.unshift(payload.new);
        renderGames(filterGames($('searchInput').value));
        $('statTotal').textContent = allGames.length;
        showToast(`🎮 "${payload.new.name}" was just added!`, 'success');
      })
      .subscribe();
  }

  // ── Render game cards ─────────────────────────────────────────────────────────
  function renderGames(games) {
    if (!games.length) {
      gameGrid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-icon">🕹️</div>
          <h3>No games yet</h3>
          <p>// Be the first to add one</p>
        </div>`;
      return;
    }

    gameGrid.innerHTML = games.map((g, i) => {
      const colors = THUMB_COLORS[i % THUMB_COLORS.length];
      const isNew  = Date.now() - new Date(g.created_at).getTime() < 3 * 24 * 60 * 60 * 1000;
      const badge  = isNew
        ? '<span class="game-badge badge-new">NEW</span>'
        : g.source_type === 'github'
          ? '<span class="game-badge badge-github">GitHub</span>'
          : '<span class="game-badge badge-upload">Uploaded</span>';

      return `
      <div class="game-card" onclick="window.location.href='/${g.slug}'" style="animation-delay:${i * 0.04}s">
        <div class="game-thumb">
          <div class="game-thumb-gradient" style="--thumb-a:${colors[0]};--thumb-b:${colors[1]}"></div>
          <div class="game-thumb-icon">${g.icon || '🎮'}</div>
          ${badge}
        </div>
        <div class="game-body">
          <div class="game-name">${escHtml(g.name)}</div>
          <div class="game-slug">/${g.slug}</div>
          <div class="game-meta">
            <span class="game-author">by ${escHtml(g.author || 'anonymous')}</span>
            <a class="btn-play" href="/${g.slug}" onclick="event.stopPropagation()">
              ▶ Play
            </a>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  // ── Search filter ─────────────────────────────────────────────────────────────
  function filterGames(q) {
    if (!q) return allGames;
    q = q.toLowerCase();
    return allGames.filter(g =>
      g.name.toLowerCase().includes(q) ||
      g.slug.toLowerCase().includes(q) ||
      (g.author || '').toLowerCase().includes(q) ||
      (g.description || '').toLowerCase().includes(q)
    );
  }

  // ── Submit game ───────────────────────────────────────────────────────────────
  async function submitGame() {
    clearAlert();
    const name   = $('gameName').value.trim();
    const slug   = $('gameSlug').value.trim();
    const author = $('authorName').value.trim();
    const desc   = $('gameDesc').value.trim();

    if (!name)        return showAlert('Game name is required.');
    if (!slug)        return showAlert('URL slug is required.');
    if (!/^[a-z0-9-]+$/.test(slug)) return showAlert('Slug: only lowercase letters, numbers, hyphens.');

    // Check slug uniqueness
    const { data: existing } = await sb.from(TABLE).select('id').eq('slug', slug).single();
    if (existing) return showAlert(`Slug "/${slug}" is already taken.`);

    const submitBtn = $('submitGame');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Publishing…';

    try {
      let gameUrl, sourceType;

      if (activeTab === 'upload') {
        if (!files.length) return showAlert('Please select at least one file.');
        if (!files.find(f => (f._relativePath || f.webkitRelativePath || f.name).replace(/^[^/]+\//, '') === 'index.html')) return showAlert('Your upload must include an index.html file.');
        gameUrl    = await uploadFiles(slug);
        sourceType = 'upload';
      } else {
        const repoUrl = $('githubUrl').value.trim();
        if (!repoUrl) return showAlert('Please enter a GitHub repository URL.');
        const path = $('githubPath').value.trim() || '';
        gameUrl    = await importGithub(slug, repoUrl, path);
        sourceType = 'github';
      }

      const { error } = await sb.from(TABLE).insert({
        name, slug, icon: selectedIcon, author, description: desc,
        game_url: gameUrl, source_type: sourceType,
      });

      if (error) throw error;

      showToast(`🎮 "${name}" published! /${slug}`, 'success');
      closeModal();
    } catch (err) {
      showAlert(err.message || 'Something went wrong. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg> Publish Game';
    }
  }

  // ── Upload files to Supabase Storage ─────────────────────────────────────────
  async function uploadFiles(slug) {
    const progressWrap = $('uploadProgress');
    progressWrap.classList.add('visible');

    // Pre-compute the public base URL for this game's folder so we can inject
    // a <base href="…"> into index.html — this makes all relative asset paths
    // (CSS, JS, images, fonts) resolve correctly when served from Supabase CDN.
    const { data: baseData } = sb.storage.from(BUCKET).getPublicUrl(`${slug}/`);
    const gameBaseUrl = baseData.publicUrl; // e.g. https://….supabase.co/storage/v1/object/public/game-files/slug/

    for (let i = 0; i < files.length; i++) {
      let file = files[i];
      // webkitRelativePath = "nonogram/styles/main.css" — strip the top folder so
      // we get "styles/main.css" and store as "slug/styles/main.css"
      let relativePath = file._relativePath || file.webkitRelativePath || file.name;
      if (relativePath.includes('/')) {
        relativePath = relativePath.split('/').slice(1).join('/'); // strip first folder
      }
      const path = `${slug}/${relativePath}`;
      const mime = guessMime(file.name);

      // Inject <base href> into index.html so relative asset paths work from CDN
      if (relativePath === 'index.html') {
        const originalText = await file.text();
        // Insert <base href> right after <head> (or at top if missing)
        const patched = originalText.replace(
          /(<head[^>]*>)/i,
          `$1\n  <base href="${gameBaseUrl}">`
        );
        file = new Blob([patched], { type: 'text/html' });
      }

      const { error } = await sb.storage.from(BUCKET).upload(path, file, {
        contentType: mime,
        upsert: true,
      });

      if (error) throw new Error(`Upload failed for ${relativePath}: ${error.message}`);
      const pct = Math.round(((i + 1) / files.length) * 100);
      progressBar.style.width = pct + '%';
    }

    const { data } = sb.storage.from(BUCKET).getPublicUrl(`${slug}/index.html`);
    return data.publicUrl;
  }

  // ── Import GitHub repo via raw.githubusercontent.com proxy ───────────────────
  async function importGithub(slug, repoUrl, customPath) {
    // Normalise URL → owner/repo + branch
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) throw new Error('Invalid GitHub URL. Format: https://github.com/user/repo');
    const [, owner, repoRaw] = match;
    const repo = repoRaw.replace(/\.git$/, '');

    // Fetch default branch via GitHub API (no auth needed for public repos)
    let branch = 'main';
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
      const j = await r.json();
      branch = j.default_branch || 'main';
    } catch (_) { /* fall through, assume main */ }

    // Fetch file tree to find all assets
    const treeResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
    );
    if (!treeResp.ok) throw new Error(`GitHub API error: ${treeResp.statusText}`);
    const tree = await treeResp.json();

    if (tree.truncated) {
      throw new Error('Repository has too many files (GitHub limit). Try pointing to a subdirectory with the "Subdirectory" field.');
    }

    const prefix   = customPath ? customPath.replace(/\/?index\.html$/, '').replace(/\/$/, '') : '';
    const blobs    = (tree.tree || []).filter(n => n.type === 'blob');
    const relevant = prefix
      ? blobs.filter(n => n.path.startsWith(prefix + '/'))
      : blobs;

    if (!relevant.length) throw new Error('No files found in the repository at the specified path.');

    // Must have an index.html at the root (or subdirectory root)
    const hasIndex = relevant.some(n => {
      const filePath = prefix ? n.path.slice(prefix.length + 1) : n.path;
      return filePath === 'index.html';
    });
    if (!hasIndex) throw new Error('No index.html found. Make sure your game has an index.html at the root (or specify the correct subdirectory).');

    const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/`;

    // Upload each file to Supabase Storage
    $('uploadProgress').classList.add('visible');
    for (let i = 0; i < relevant.length; i++) {
      const node     = relevant[i];
      const filePath = prefix ? node.path.slice(prefix.length + 1) : node.path;
      const rawUrl   = rawBase + node.path;
      const resp     = await fetch(rawUrl);
      if (!resp.ok) continue;
      const blob     = await resp.blob();
      const mime     = guessMime(node.path);

      // Inject <base href> into index.html so relative paths work from CDN
      let uploadBlob = blob;
      if (filePath === 'index.html') {
        const { data: baseData } = sb.storage.from(BUCKET).getPublicUrl(`${slug}/`);
        const originalText = await blob.text();
        const patched = originalText.replace(
          /(<head[^>]*>)/i,
          `$1\n  <base href="${baseData.publicUrl}">`
        );
        uploadBlob = new Blob([patched], { type: 'text/html' });
      }
      await sb.storage.from(BUCKET).upload(`${slug}/${filePath}`, uploadBlob, {
        contentType: mime, upsert: true,
      });
      progressBar.style.width = Math.round(((i + 1) / relevant.length) * 100) + '%';
    }

    const { data } = sb.storage.from(BUCKET).getPublicUrl(`${slug}/index.html`);
    return data.publicUrl;
  }

  // ── Icon grid ─────────────────────────────────────────────────────────────────
  function buildIconGrid() {
    const grid = $('iconGrid');
    grid.innerHTML = ICONS.map(ic => `
      <button type="button" class="icon-btn${ic === selectedIcon ? ' selected' : ''}"
              data-icon="${ic}" title="${ic}">${ic}</button>
    `).join('');
    grid.addEventListener('click', e => {
      const btn = e.target.closest('.icon-btn');
      if (!btn) return;
      grid.querySelectorAll('.icon-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedIcon = btn.dataset.icon;
    });
  }

  // ── Bind all events ───────────────────────────────────────────────────────────
  function bindEvents() {
    // Open/close modal
    $('btnAdd').addEventListener('click', openModal);
    $('closeModal').addEventListener('click', closeModal);
    $('cancelModal').addEventListener('click', closeModal);
    addModal.addEventListener('click', e => { if (e.target === addModal) closeModal(); });

    // Search
    $('searchInput').addEventListener('input', e => {
      renderGames(filterGames(e.target.value));
    });

    // Slug auto-generate from name
    $('gameName').addEventListener('input', e => {
      const auto = e.target.value.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      $('gameSlug').value = auto;
      slugPreview.textContent = auto || 'your-game';
    });
    $('gameSlug').addEventListener('input', e => {
      slugPreview.textContent = e.target.value || 'your-game';
    });

    // Tabs
    $('sourceTabs').addEventListener('click', e => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
      $('tab-upload').style.display  = activeTab === 'upload'  ? '' : 'none';
      $('tab-github').style.display  = activeTab === 'github'  ? '' : 'none';
    });

    // File input / drag-drop
    const dropZone = $('dropZone');
    const fileInput = $('fileInput');
    const folderInput = $('folderInput');
    fileInput.addEventListener('change', e => {
      addFiles([...e.target.files]);
      fileInput.value = '';
    });
    folderInput.addEventListener('change', e => {
      // Reset file list when a new folder is chosen — avoids stale dedup
      files = [];
      addFiles([...e.target.files]);
      folderInput.value = '';
    });
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', async e => {
      e.preventDefault(); dropZone.classList.remove('drag-over');
      const items = [...e.dataTransfer.items];
      const hasEntry = items.length && items[0].webkitGetAsEntry;
      if (hasEntry) {
        const collected = [];
        await Promise.all(items.map(item => readEntry(item.webkitGetAsEntry(), '', collected)));
        addFiles(collected);
      } else {
        addFiles([...e.dataTransfer.files]);
      }
    });

    // Submit
    $('submitGame').addEventListener('click', submitGame);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  }

  // ── File management ───────────────────────────────────────────────────────────

  // ── Recursive folder reader (drag & drop) ────────────────────────────────────
  function readEntry(entry, path, collected) {
    if (!entry) return Promise.resolve();
    if (entry.isFile) {
      return new Promise(resolve => {
        entry.file(file => {
          const fullPath = path ? path + '/' + entry.name : entry.name;
          // Can't defineProperty on File — wrap it in a new File with a custom path prop
          const wrapped = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
          wrapped._relativePath = fullPath;
          collected.push(wrapped);
          resolve();
        }, resolve);
      });
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      return new Promise(resolve => {
        const readAll = results => {
          if (!results.length) return resolve();
          const dirPath = path ? path + '/' + entry.name : entry.name;
          Promise.all(results.map(e => readEntry(e, dirPath, collected)))
            .then(() => reader.readEntries(readAll, resolve));
        };
        reader.readEntries(readAll, resolve);
      });
    }
    return Promise.resolve();
  }

    function addFiles(newFiles) {
    newFiles.forEach(f => {
      const fPath = f._relativePath || f.webkitRelativePath || f.name;
      if (!files.find(x => (x._relativePath || x.webkitRelativePath || x.name) === fPath)) files.push(f);
    });
    renderFileList();
  }

  function renderFileList() {
    fileList.innerHTML = files.map((f, i) => {
      const displayPath = f._relativePath || f.webkitRelativePath || f.name;
      return `
      <div class="file-item" data-idx="${i}">
        <span>${fileTypeIcon(f.name)}</span>
        <span class="file-item-name" title="${escHtml(displayPath)}">${escHtml(displayPath)}</span>
        <span class="file-item-size">${formatBytes(f.size)}</span>
        <button class="file-item-remove" data-remove="${i}" title="Remove">✕</button>
      </div>`;
    }).join('');

    fileList.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        files.splice(parseInt(btn.dataset.remove), 1);
        renderFileList();
      });
    });
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────────
  function openModal() {
    addModal.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('gameName').focus(), 100);
  }
  function closeModal() {
    addModal.classList.remove('open');
    document.body.style.overflow = '';
    // Reset form
    ['gameName','gameSlug','githubUrl','githubPath','authorName','gameDesc'].forEach(id => { $(id).value = ''; });
    files = [];
    renderFileList();
    clearAlert();
    progressBar.style.width = '0%';
    $('uploadProgress').classList.remove('visible');
    slugPreview.textContent = 'your-game';
  }

  // ── Alert & Toast ─────────────────────────────────────────────────────────────
  function showAlert(msg) {
    alertBox.textContent = msg;
    alertBox.className = 'alert alert-error visible';
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function clearAlert() { alertBox.className = 'alert'; }

  function showToast(msg, type = 'success') {
    const wrap = $('toastWrap');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300); }, 3500);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────────
  function escHtml(s = '') {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function fileTypeIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const map = { html:'🌐', css:'🎨', js:'⚡', json:'📋', png:'🖼️', jpg:'🖼️', gif:'🎞️',
                  svg:'✏️', mp3:'🎵', wav:'🎵', ogg:'🎵', woff:'🔤', woff2:'🔤', ttf:'🔤' };
    return map[ext] || '📄';
  }

  function guessMime(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
      html:'text/html', css:'text/css', js:'application/javascript',
      json:'application/json', svg:'image/svg+xml', png:'image/png',
      jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp',
      mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg',
      woff:'font/woff', woff2:'font/woff2', ttf:'font/ttf',
    };
    return map[ext] || 'application/octet-stream';
  }

  // ── Boot ──────────────────────────────────────────────────────────────────────
  init();
})();
