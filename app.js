const bookPath = "Cereus_and_Limnic.epub"; // correct filename

// Quick network check to surface 404/CORS early in DevTools/UI
fetch(bookPath, { method: 'HEAD' })
  .then(res => {
    if (!res.ok) {
      const msg = `EPUB fetch error: ${res.status} ${res.statusText}`;
      console.error(msg);
      const loc = document.getElementById('location-indicator');
      if (loc) loc.textContent = 'Book not reachable — see console';
      throw new Error(msg);
    }
    console.log('EPUB reachable:', res.status);
  })
  .catch(err => {
    console.warn('EPUB network check failed:', err);
  });

const book = ePub(bookPath);

// Friendly error if opening fails
book.ready.catch(err => {
    console.error('Failed to open EPUB:', err);
    const loc = document.getElementById('location-indicator');
    if (loc) loc.textContent = 'Failed to load book — see console';
});

// Generate locations for progress (improves percentage/TOC behavior)
book.ready.then(() => book.locations.generate(1200)).catch(err => {
    console.warn('Could not generate locations:', err);
});

const rendition = book.renderTo("viewer", {
    width: "100%",
    height: "100vh",
    flow: "paginated",
    manager: "default",
    // ADD THIS LINE BELOW
    sandbox: "allow-same-origin allow-scripts"
});

// Defer the initial display until after the dev splash has shown.
// This ensures the dev logo appears before the book cover.
const SPLASH_DURATION_MS = 1000; // adjust as needed
function performInitialDisplay() {
    try { rendition.display(); } catch (e) { console.warn('Initial rendition.display() failed:', e); }
}

const _splashEl = document.getElementById('dev-splash');
if (_splashEl) {
    // mark body so CSS can hide HUD while splash active
    document.body.classList.add('splash-active');

    let _splashTimer = setTimeout(() => {
        _splashEl.classList.add('splash-hidden');
        document.body.classList.remove('splash-active');
        setTimeout(() => { _splashEl.remove(); }, 420);
        performInitialDisplay();
    }, SPLASH_DURATION_MS);

    // allow click/tap to skip splash early
    _splashEl.addEventListener('click', () => {
        clearTimeout(_splashTimer);
        _splashEl.classList.add('splash-hidden');
        document.body.classList.remove('splash-active');
        setTimeout(() => { _splashEl.remove(); }, 200);
        performInitialDisplay();
    }, { once: true });
} else {
    performInitialDisplay();
}

// Audio manifest + HUD audio player (per-chapter mapping + resume)
// Loads `manifest.json` and prepares a small audio player that shows the
// chapter title (from the manifest) while audio is playing.
let audioManifest = [];

// Robust loader: manifest.json may be encoded as UTF-16LE due to editor choice.
// Read as ArrayBuffer and try UTF-8 first, then UTF-16LE (with BOM stripping).
(async function loadAudioManifest() {
    try {
        const res = await fetch('manifest.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const buf = await res.arrayBuffer();
        let text = '';

        // Check for UTF-16LE BOM (FF FE)
        const bytes = new Uint8Array(buf);
        if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
            text = new TextDecoder('utf-16le').decode(buf.slice(2));
        } else {
            // Try UTF-8 (will skip BOM if present)
            text = new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, '');
        }

        const parsed = JSON.parse(text);
        audioManifest = parsed || [];
        console.log('[audioManifest] loaded successfully:', audioManifest.length, 'chapters');
        try { audioManager.setManifest(audioManifest); } catch (e) {}
        return;
    } catch (err) {
        console.warn('Could not load manifest.json for audio (falling back to empty manifest):', err);
        audioManifest = [];
        try { audioManager.setManifest(audioManifest); } catch (e) {}
    }
})();

const audioManager = {
    manifest: audioManifest,
    audioEl: null,
    listenBtn: null,
    playerEl: null,
    titleEl: null,
    closeBtn: null,
    hudBottom: null,
    currentItem: null,

    init() {
        this.audioEl = document.getElementById('chapter-audio');
        this.listenBtn = document.getElementById('listen-btn');
        this.playerEl = document.getElementById('audio-player');
        this.titleEl = document.getElementById('audio-title');
        this.closeBtn = document.getElementById('close-audio');
        this.hudBottom = document.getElementById('hud-bottom');

        console.log('[audioManager.init]', { audioEl: !!this.audioEl, listenBtn: !!this.listenBtn, playerEl: !!this.playerEl, titleEl: !!this.titleEl, closeBtn: !!this.closeBtn, hudBottom: !!this.hudBottom });

        if (!this.listenBtn || !this.audioEl) {
            console.warn('[audioManager.init] missing required DOM elements');
            return;
        }

        this.listenBtn.addEventListener('click', () => {
            if (this.listenBtn.disabled) return;
            this.openPlayer();
        });

        this.closeBtn && this.closeBtn.addEventListener('click', () => this.closePlayer());

        this.audioEl.addEventListener('timeupdate', () => {
            if (!this.currentItem) return;
            const key = 'audioPos:' + this.currentItem.file;
            try { localStorage.setItem(key, Math.floor(this.audioEl.currentTime)); } catch (e) {}
        });

        this.audioEl.addEventListener('play', () => { this.updateTitle(true); });
        this.audioEl.addEventListener('pause', () => { this.updateTitle(false); });
    },

    setManifest(m) { this.manifest = m || []; },

    getManifestForNavIndex(idx) {
        if (!this.manifest || !this.manifest.length) return null;
        return this.manifest.find(it => Number(it.id) === (idx + 1)) || null;
    },

    async setChapterByNavIndex(idx) {
        const item = this.getManifestForNavIndex(idx);
        console.log('[audioManager] setChapterByNavIndex:', idx, 'manifest item:', item);
        if (!item) { this.disable(); return; }
        // if switching chapters while playing, stop current audio
        if (this.currentItem && this.currentItem.file !== item.file) {
            this.closePlayer();
        }
        this.currentItem = item;
        this.updateTitle(false);
        const path = 'audio/' + item.file;
        const exists = await this._fileExists(path);
        console.log('[audioManager] checking', path, '-> exists:', exists);
        if (exists) {
            this.listenBtn.disabled = false;
            this.listenBtn.dataset.src = path;
            console.log('[audioManager] button enabled for', item.title);
        } else {
            this.listenBtn.disabled = true;
            this.listenBtn.dataset.src = '';
            console.log('[audioManager] button disabled (file not found)');
        }
    },

    openPlayer() {
        if (!this.currentItem) return;
        const src = this.listenBtn.dataset.src || ('audio/' + this.currentItem.file);
        if (this.audioEl.src !== src) {
            this.audioEl.src = src;
            try { this.audioEl.load(); } catch (e) {}
            this._restorePosition();
        }
        this.hudBottom.classList.add('audio-open');
        this.playerEl.setAttribute('aria-hidden', 'false');
    },

    closePlayer() {
        this.hudBottom.classList.remove('audio-open');
        this.playerEl.setAttribute('aria-hidden', 'true');
        try { this.audioEl.pause(); } catch (e) {}
    },

    updateTitle(isPlaying) {
        if (!this.titleEl) return;
        if (this.currentItem && isPlaying) {
            this.titleEl.textContent = this.currentItem.title;
            this.titleEl.classList.add('playing');
        } else if (this.currentItem) {
            this.titleEl.textContent = this.currentItem.title;
            this.titleEl.classList.remove('playing');
        } else {
            this.titleEl.textContent = '';
            this.titleEl.classList.remove('playing');
        }
    },

    _restorePosition() {
        if (!this.currentItem) return;
        const key = 'audioPos:' + this.currentItem.file;
        const s = localStorage.getItem(key);
        if (s && !isNaN(s)) {
            try { this.audioEl.currentTime = Math.max(0, Number(s) - 1); } catch (e) {}
        }
    },

    async _fileExists(path) {
        try {
            const res = await fetch(path, { method: 'HEAD' });
            return res && res.ok;
        } catch (e) {
            // HEAD checks can fail in local/file:// environments or due to CORS —
            // assume the file may exist and let the audio element handle errors.
            console.warn('HEAD check failed for', path, e);
            return true;
        }
    },

    disable() {
        if (this.listenBtn) this.listenBtn.disabled = true;
        this.currentItem = null;
        if (this.titleEl) this.titleEl.textContent = '';
        try { this.audioEl && this.audioEl.pause(); } catch (e) {}
        try { this.hudBottom && this.hudBottom.classList.remove('audio-open'); } catch (e) {}
    }
};

audioManager.init();

// map section href to nav index (best-effort)
// handles URL encoding mismatches (e.g., %28 vs literal parentheses)
function sectionToNavIndex(sectionHref, navArray) {
    if (!sectionHref || !navArray || navArray.length === 0) {
        console.log('[sectionToNavIndex] invalid inputs - sectionHref:', sectionHref, 'navArray.length:', navArray?.length);
        return -1;
    }
    // Normalize: decode the section href and also prepare a version for case-insensitive matching
    const decodedSection = decodeURIComponent(sectionHref).toLowerCase();
    
    for (let i = 0; i < navArray.length; i++) {
        if (!navArray[i]) continue; // skip undefined items
        const nh = navArray[i].href || '';
        if (!nh) continue;
        const decodedNav = decodeURIComponent(nh).toLowerCase();
        
        // Try various matching strategies
        if (decodedSection.indexOf(decodedNav) !== -1 || decodedNav.indexOf(decodedSection) !== -1 ||
            decodedNav === decodedSection) {
            console.log('[sectionToNavIndex] matched section', sectionHref, '-> nav index', i, '(href:', nh, ')');
            return i;
        }
    }
    console.log('[sectionToNavIndex] no match found for', sectionHref, 'in', navArray.length, 'nav items');
    return -1;
}

// The "rendered" event fires when a section is loaded
rendition.on("rendered", (section, view) => {
    // Update audio manager: map current section -> toc index -> manifest
    try {
        const idx = sectionToNavIndex(section.href, window.bookNav || []);
        console.log('[rendition.rendered]', 'section.href:', section.href, 'detected chapter index:', idx);
        if (typeof audioManager !== 'undefined') {
            if (idx !== -1) audioManager.setChapterByNavIndex(idx);
            else audioManager.disable();
        }
    } catch (e) { console.error('[rendition.rendered] error in audio mapping:', e); }

    // Check if the iframe and document exist
    const iframe = view.iframe;
    if (iframe && iframe.contentDocument) {
        const doc = iframe.contentDocument;
        
        // Initialize Hammer on the internal document of the iframe
        const hammer = new Hammer(doc.documentElement);

        hammer.on("swipeleft", () => rendition.next());
        hammer.on("swiperight", () => rendition.prev());

        hammer.on("tap", (ev) => {
            const x = ev.center.x;
            const width = (doc && doc.documentElement && doc.documentElement.clientWidth) || iframe.clientWidth || window.innerWidth;

            // If tap is in the middle 60% of the screen
            if (x > width * 0.2 && x < width * 0.8) {
                const top = document.getElementById('hud-top');
                const bottom = document.getElementById('hud-bottom');
                if (top) top.classList.toggle('visible');
                if (bottom) bottom.classList.toggle('visible');
                // record the toggle time to avoid duplicate parent click toggles
                window._lastHudToggle = Date.now();
            } else if (x <= width * 0.2) {
                rendition.prev();
            } else {
                rendition.next();
            }
        });

        // When a section renders, ensure any user font override is applied to this document
        try {
            const currentSizeStr = `${currentFontSize}%`;
            if (currentFontSize !== 100) {
                let style = doc.getElementById('user-font-override');
                const css = `html, body, p, div, span, li, a, h1, h2, h3, h4, h5, h6 { font-size: ${currentSizeStr} !important; }`;
                if (!style) {
                    style = doc.createElement('style');
                    style.id = 'user-font-override';
                    (doc.head || doc.documentElement).appendChild(style);
                }
                style.textContent = css;
            }
        } catch (e) {
            // ignore
        }

        // parent click fallback: handle regular mouse clicks on the viewer
        const viewerEl = document.getElementById('viewer');
        if (viewerEl) {
            viewerEl._hudClickListener && viewerEl.removeEventListener('click', viewerEl._hudClickListener);
            viewerEl._hudClickListener = (e) => {
                try {
                    // prevent double-toggle if iframe's Hammer already toggled HUD
                    if (window._lastHudToggle && (Date.now() - window._lastHudToggle) < 400) return;

                    const rect = iframe.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const width = rect.width || window.innerWidth;
                    if (x > width * 0.2 && x < width * 0.8) {
                        const top = document.getElementById('hud-top');
                        const bottom = document.getElementById('hud-bottom');
                        if (top) top.classList.toggle('visible');
                        if (bottom) bottom.classList.toggle('visible');
                        window._lastHudToggle = Date.now();
                    } else if (x <= width * 0.2) {
                        rendition.prev();
                    } else {
                        rendition.next();
                    }
                } catch (err) {
                    // ignore if iframe not ready
                }
            };
            viewerEl.addEventListener('click', viewerEl._hudClickListener);
        }
    }
});

// Load the Table of Contents
book.loaded.navigation.then((nav) => {
    // expose nav for helpers (section -> toc mapping)
    // convert to real array (EPUBjs may return array-like object)
    window.bookNav = Array.from(nav || []);
    console.log('[bookNav] loaded:', window.bookNav.length, 'chapters');
    if (window.bookNav.length > 0) {
        const firstValid = window.bookNav.find(n => n && n.label);
        if (firstValid) console.log('[bookNav] first valid:', firstValid.label, firstValid.href);
        else console.log('[bookNav] warning: all nav items are undefined or missing label');
    }

    const tocList = document.getElementById("toc-list");
    tocList.innerHTML = ""; // Clear existing
    nav.forEach((chapter) => {
        if (!chapter) return; // skip undefined items
        const li = document.createElement("li");
        li.textContent = chapter.label || "(untitled)";
        li.style.cursor = "pointer";
        li.onclick = () => {
            rendition.display(chapter.href);
            document.getElementById('side-menu').classList.remove('open');
        };
        tocList.appendChild(li);
    });

    // Ensure audioManager is aware of the section currently displayed (fixes initial disabled state)
    try {
        const getCurrentHref = () => {
            try {
                // epub.js: prefer currentLocation() then fallback to location()
                const cur = (typeof rendition.currentLocation === 'function') ? rendition.currentLocation() : (typeof rendition.location === 'function' ? rendition.location() : null);
                if (cur && cur.start && cur.start.href) return cur.start.href;
            } catch (e) { /* ignore */ }

            // fallback: use first active view if available
            try {
                const views = (rendition && rendition.manager && rendition.manager.views) ? rendition.manager.views : [];
                if (views.length && views[0] && views[0].section) return views[0].section.href || views[0].href || null;
            } catch (e) {}
            return null;
        };

        const curHref = getCurrentHref();
        const idx = sectionToNavIndex(curHref, window.bookNav || []);
        if (idx !== -1 && typeof audioManager !== 'undefined') {
            audioManager.setChapterByNavIndex(idx);
        }
    } catch (e) {
        // non-fatal
    }
});

// progress update when location changes
rendition.on("relocated", (location) => {
    let percentage = 0;
    try {
        if (book.locations && book.locations.length) {
            const pct = book.locations.percentageFromCfi(location.start.cfi);
            percentage = Math.round(pct * 100);
        }
    } catch (e) {
        console.warn('Error reading locations:', e);
    }
    const indicator = document.getElementById("location-indicator");
    if (indicator) indicator.textContent = `Progress: ${percentage}%`;
});

// Basic Navigation for Buttons
function prevPage() { rendition.prev(); }
function nextPage() { rendition.next(); }

// Menu toggle (HUD contents)
const menuBtn = document.getElementById('menu-btn');
if (menuBtn) {
    menuBtn.addEventListener('click', () => {
        const side = document.getElementById('side-menu');
        if (side) side.classList.toggle('open');
    });
}

// Fullscreen toggle (uses Fullscreen API)
// Toggling the `app-container` element keeps the rest of the page out of fullscreen.
function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
}
function toggleFullscreen() {
    const el = document.getElementById('app-container') || document.documentElement;
    if (!isFullscreen()) {
        // Request fullscreen on the app container
        if (el.requestFullscreen) {
            el.requestFullscreen().catch(err => console.warn('Fullscreen request failed:', err));
        } else if (el.webkitRequestFullscreen) {
            el.webkitRequestFullscreen();
        } else if (el.msRequestFullscreen) {
            el.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen().catch(err => console.warn('Exit fullscreen failed:', err));
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

// Wire up the button and keep its label/state in sync
const fsBtn = document.getElementById('fullscreen-btn');
if (fsBtn) {
    fsBtn.addEventListener('click', toggleFullscreen);

    // Auto-hide HUD when in fullscreen
    const HUD_AUTOHIDE_DELAY = 2000; // ms
    let _hudAutoHideTimer = null;

    function showHUD() {
        const top = document.getElementById('hud-top');
        const bottom = document.getElementById('hud-bottom');
        if (top) top.classList.add('visible');
        if (bottom) bottom.classList.add('visible');
    }
    function hideHUD() {
        // keep HUD visible when the side-menu is open
        const side = document.getElementById('side-menu');
        if (side && side.classList.contains('open')) return;
        const top = document.getElementById('hud-top');
        const bottom = document.getElementById('hud-bottom');
        if (top) top.classList.remove('visible');
        if (bottom) bottom.classList.remove('visible');
    }
    function clearHudTimer() {
        if (_hudAutoHideTimer) {
            clearTimeout(_hudAutoHideTimer);
            _hudAutoHideTimer = null;
        }
    }
    function scheduleHudHide() {
        clearHudTimer();
        _hudAutoHideTimer = setTimeout(() => {
            hideHUD();
            _hudAutoHideTimer = null;
        }, HUD_AUTOHIDE_DELAY);
    }
    function showHUDTemporarily() {
        if (!isFullscreen()) return; // only auto-show when fullscreen
        showHUD();
        scheduleHudHide();
    }

    const activityHandler = (ev) => {
        if (!isFullscreen()) return;
        showHUDTemporarily();
    };

    document.addEventListener('mousemove', activityHandler, { passive: true });
    document.addEventListener('touchstart', activityHandler, { passive: true });
    document.addEventListener('keydown', (ev) => {
        // let 'f' keep its toggle behavior; other keys reveal HUD while fullscreen
        if (!isFullscreen()) return;
        if (ev.key === 'f' || ev.key === 'F') return;
        activityHandler(ev);
    });

    const onFullscreenChange = () => {
        const active = isFullscreen();
        fsBtn.textContent = active ? '⤢ Exit Fullscreen' : '⤢ Fullscreen';
        fsBtn.setAttribute('aria-pressed', String(active));
        document.body.classList.toggle('is-fullscreen', active);

        clearHudTimer();
        if (active) {
            // show briefly then auto-hide
            showHUD();
            scheduleHudHide();
        } else {
            // leaving fullscreen -> ensure HUD visible
            showHUD();
        }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
}

// Optional keyboard shortcut: press "f" to toggle fullscreen (only when focused on the app)
document.addEventListener('keydown', (ev) => {
    if (ev.key === 'f' || ev.key === 'F') {
        // don't intercept when typing in inputs
        if ((document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable))) return;
        toggleFullscreen();
    }
});

// Register basic themes so `setTheme` works
try {
    rendition.themes.register("dark", { "body": { "background": "#1a1a1a", "color": "#e0e0e0" } });
    rendition.themes.register("sepia", { "body": { "background": "#f4ecd8", "color": "#5b4636" } });
} catch (e) {
    console.warn('Could not register themes:', e);
}

// Dynamic font sizing
let currentFontSize = 100;
function changeFontSize(v) {
    currentFontSize += (v * 10);
    const sizeStr = `${currentFontSize}%`;
    // Preferred API
    try {
        if (rendition && rendition.themes && typeof rendition.themes.fontSize === 'function') {
            rendition.themes.fontSize(sizeStr);
            console.log('Font size set via rendition.themes.fontSize:', sizeStr);
            return;
        }
    } catch (e) {
        console.warn('rendition.themes.fontSize failed:', e);
    }

    // Fallback: set inline style on loaded iframe documents
    try {
        const views = rendition.manager && rendition.manager.views ? rendition.manager.views : [];
        views.forEach(view => {
            try {
                const doc = view.document || (view.iframe && view.iframe.contentDocument);
                if (doc && doc.documentElement) {
                    doc.documentElement.style.fontSize = sizeStr;
                }
            } catch (e) {
                // ignore per-view errors
            }
        });
        console.log('Font size applied via iframe fallback:', sizeStr);
    } catch (e) {
        console.warn('Could not change font size (fallback):', e);
    }
}

// Apply a stronger CSS override inside each rendition iframe to force font-size changes
function applyFontOverride(sizeStr) {
    try {
        const views = (rendition && rendition.manager && rendition.manager.views) ? rendition.manager.views : [];
        const css = `html, body, p, div, span, li, a, h1, h2, h3, h4, h5, h6 { font-size: ${sizeStr} !important; }`;
        views.forEach(view => {
            try {
                const doc = view.document || (view.iframe && view.iframe.contentDocument);
                if (!doc) return;
                let style = doc.getElementById('user-font-override');
                if (!style) {
                    style = doc.createElement('style');
                    style.id = 'user-font-override';
                    (doc.head || doc.documentElement).appendChild(style);
                }
                style.textContent = css;
            } catch (e) {
                // ignore per-view errors
            }
        });
    } catch (e) {
        console.warn('applyFontOverride failed:', e);
    }
}

// Theme selector used by UI buttons
function setTheme(theme) {
    try {
        // Keep a body class so CSS can adapt (TOC text color, etc.)
        document.body.classList.remove('theme-light', 'theme-dark', 'theme-sepia');
        if (theme === 'light') {
            rendition.themes.select('default');
            document.body.style.background = '#ffffff';
            document.body.classList.add('theme-light');
        } else if (theme === 'dark') {
            rendition.themes.select('dark');
            document.body.style.background = '#1a1a1a';
            document.body.classList.add('theme-dark');
        } else if (theme === 'sepia') {
            rendition.themes.select('sepia');
            document.body.style.background = '#f4ecd8';
            document.body.classList.add('theme-sepia');
        } else {
            // unknown theme: fall back to default
            rendition.themes.select('default');
            document.body.classList.add('theme-light');
        }
    } catch (e) {
        console.warn('Could not set theme:', e);
    }
}

// Expose UI functions globally for inline onclick handlers
try { window.changeFontSize = changeFontSize; } catch (e) {}
try { window.setTheme = setTheme; } catch (e) {}