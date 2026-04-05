const bookPath = "Cereus_and_Limnic.epub";

const SPLASH_DURATION_MS = 1400;
const HUD_AUTOHIDE_DELAY = 2200;
const MIN_FONT_SIZE = 80;
const MAX_FONT_SIZE = 180;
const FONT_STEP = 10;

const STORAGE_KEYS = {
    readerLocation: "cereusLimnic.reading.position",
    readerTheme: "cereusLimnic.reading.theme",
    readerFontSize: "cereusLimnic.reading.fontSize",
};

function safeStorageGet(key) {
    try {
        return window.localStorage.getItem(key);
    } catch (error) {
        console.warn("Could not read from localStorage:", error);
        return null;
    }
}

function safeStorageSet(key, value) {
    try {
        window.localStorage.setItem(key, value);
    } catch (error) {
        console.warn("Could not write to localStorage:", error);
    }
}

function loadStoredFontSize() {
    const storedValue = Number(safeStorageGet(STORAGE_KEYS.readerFontSize));
    if (!Number.isFinite(storedValue)) {
        return 100;
    }

    return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, storedValue));
}

function loadStoredTheme() {
    const storedTheme = safeStorageGet(STORAGE_KEYS.readerTheme);
    return storedTheme || "dark";
}

const state = {
    currentFontSize: loadStoredFontSize(),
    currentTheme: loadStoredTheme(),
    splashDismissed: false,
    bookNav: [],
    hudAutoHideTimer: null,
    lastHudToggle: 0,
};

const elements = {
    body: document.body,
    appContainer: document.getElementById("app-container"),
    splash: document.getElementById("dev-splash"),
    viewer: document.getElementById("viewer"),
    hudTop: document.getElementById("hud-top"),
    hudBottom: document.getElementById("hud-bottom"),
    menuButton: document.getElementById("menu-btn"),
    menuCloseButton: document.getElementById("menu-close-btn"),
    sideMenu: document.getElementById("side-menu"),
    tocList: document.getElementById("toc-list"),
    locationIndicator: document.getElementById("location-indicator"),
    fullscreenButton: document.getElementById("fullscreen-btn"),
    themeButtons: Array.from(document.querySelectorAll("[data-theme]")),
};

fetch(bookPath, { method: "HEAD" })
    .then((response) => {
        if (!response.ok) {
            throw new Error(`EPUB fetch error: ${response.status} ${response.statusText}`);
        }
    })
    .catch((error) => {
        console.warn("EPUB network check failed:", error);
    });

const book = ePub(bookPath);

book.ready.catch((error) => {
    console.error("Failed to open EPUB:", error);
    updateLocationIndicator("Failed to load Cereus & Limnic. Serve the folder over HTTP and check the console.");
});

book.ready
    .then(() => book.locations.generate(1200))
    .catch((error) => {
        console.warn("Could not generate locations:", error);
    });

const rendition = book.renderTo("viewer", {
    width: "100%",
    height: "100vh",
    flow: "paginated",
    manager: "default",
    sandbox: "allow-same-origin allow-scripts",
});

function updateLocationIndicator(text) {
    if (elements.locationIndicator) {
        elements.locationIndicator.textContent = text;
    }
}

function showHUD() {
    elements.hudTop?.classList.add("visible");
    elements.hudBottom?.classList.add("visible");
}

function hideHUD() {
    if (elements.sideMenu?.classList.contains("open")) {
        return;
    }

    elements.hudTop?.classList.remove("visible");
    elements.hudBottom?.classList.remove("visible");
}

function toggleHUD() {
    const shouldShow = !elements.hudTop?.classList.contains("visible");

    if (shouldShow) {
        showHUD();
    } else {
        hideHUD();
    }

    state.lastHudToggle = Date.now();

    if (isFullscreen() && shouldShow) {
        scheduleHudHide();
    } else if (!shouldShow) {
        clearHudHideTimer();
    }
}

function openSideMenu() {
    elements.sideMenu?.classList.add("open");
    elements.menuButton?.setAttribute("aria-expanded", "true");
    showHUD();
    clearHudHideTimer();
}

function closeSideMenu() {
    elements.sideMenu?.classList.remove("open");
    elements.menuButton?.setAttribute("aria-expanded", "false");

    if (isFullscreen()) {
        scheduleHudHide();
    }
}

function performInitialDisplay() {
    const savedLocation = safeStorageGet(STORAGE_KEYS.readerLocation);
    const initialDisplay = savedLocation ? rendition.display(savedLocation) : rendition.display();

    Promise.resolve(initialDisplay).catch((error) => {
        console.warn("Could not restore reading position, falling back to book start:", error);
        rendition.display();
    });
}

function dismissSplash() {
    if (!elements.splash || state.splashDismissed) {
        return;
    }

    state.splashDismissed = true;
    elements.splash.classList.add("splash-hidden");
    elements.body.classList.remove("splash-active");

    window.setTimeout(() => {
        elements.splash?.remove();
    }, 420);

    performInitialDisplay();
}

elements.body.classList.add("splash-active");

if (elements.splash) {
    const splashTimer = window.setTimeout(dismissSplash, SPLASH_DURATION_MS);
    elements.splash.addEventListener(
        "click",
        () => {
            window.clearTimeout(splashTimer);
            dismissSplash();
        },
        { once: true }
    );
} else {
    elements.body.classList.remove("splash-active");
    performInitialDisplay();
}

function flattenNavigation(items, depth = 0, output = []) {
    items.forEach((item) => {
        if (!item) {
            return;
        }

        output.push({
            id: item.id,
            label: item.label || "(untitled)",
            href: item.href,
            depth,
        });

        const childItems = Array.from(item.subitems || []);
        if (childItems.length > 0) {
            flattenNavigation(childItems, depth + 1, output);
        }
    });

    return output;
}

function buildToc(nav) {
    if (!elements.tocList) {
        return;
    }

    const items = Array.from(nav?.toc || nav || []);
    state.bookNav = flattenNavigation(items);
    elements.tocList.innerHTML = "";

    state.bookNav.forEach((chapter) => {
        const listItem = document.createElement("li");
        const button = document.createElement("button");

        button.type = "button";
        button.textContent = chapter.label;
        button.style.setProperty("--toc-depth", String(chapter.depth || 0));
        button.addEventListener("click", () => {
            rendition.display(chapter.href);
            closeSideMenu();
        });

        listItem.appendChild(button);
        elements.tocList.appendChild(listItem);
    });

    if (state.bookNav.length === 0) {
        updateLocationIndicator("Opened Cereus & Limnic, but no table of contents was found.");
    }
}

function sectionToNavIndex(sectionHref) {
    if (!sectionHref || state.bookNav.length === 0) {
        return -1;
    }

    const decodedSection = decodeURIComponent(sectionHref).toLowerCase();

    for (let index = 0; index < state.bookNav.length; index += 1) {
        const navItem = state.bookNav[index];
        const navHref = decodeURIComponent(navItem.href || "").toLowerCase();

        if (!navHref) {
            continue;
        }

        if (
            decodedSection === navHref ||
            decodedSection.includes(navHref) ||
            navHref.includes(decodedSection)
        ) {
            return index;
        }
    }

    return -1;
}

function applyFontOverride(sizeStr) {
    try {
        const views = rendition?.manager?.views || [];
        const css = `html, body, p, div, span, li, a, h1, h2, h3, h4, h5, h6 { font-size: ${sizeStr} !important; }`;

        views.forEach((view) => {
            try {
                const doc = view.document || view.iframe?.contentDocument;
                if (!doc) {
                    return;
                }

                let styleTag = doc.getElementById("user-font-override");
                if (!styleTag) {
                    styleTag = doc.createElement("style");
                    styleTag.id = "user-font-override";
                    (doc.head || doc.documentElement).appendChild(styleTag);
                }

                styleTag.textContent = css;
            } catch (error) {
                console.warn("Could not apply per-view font override:", error);
            }
        });
    } catch (error) {
        console.warn("applyFontOverride failed:", error);
    }
}

function changeFontSize(stepDirection) {
    const nextSize = state.currentFontSize + stepDirection * FONT_STEP;
    state.currentFontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, nextSize));
    const sizeStr = `${state.currentFontSize}%`;

    try {
        if (rendition?.themes?.fontSize) {
            rendition.themes.fontSize(sizeStr);
        }
    } catch (error) {
        console.warn("rendition.themes.fontSize failed:", error);
    }

    safeStorageSet(STORAGE_KEYS.readerFontSize, String(state.currentFontSize));
    applyFontOverride(sizeStr);
}

function setTheme(themeName) {
    state.currentTheme = themeName;
    safeStorageSet(STORAGE_KEYS.readerTheme, themeName);

    elements.body.classList.remove("theme-light", "theme-sepia", "theme-dark");

    try {
        if (themeName === "light") {
            rendition.themes.select("light");
            elements.body.classList.add("theme-light");
        } else if (themeName === "sepia") {
            rendition.themes.select("sepia");
            elements.body.classList.add("theme-sepia");
        } else {
            rendition.themes.select("dark");
            elements.body.classList.add("theme-dark");
        }
    } catch (error) {
        console.warn("Could not set theme:", error);
    }
}

function attachIframeInteractions(view) {
    const iframe = view?.iframe;
    const doc = iframe?.contentDocument;

    if (!iframe || !doc) {
        return;
    }

    const hammer = new Hammer(doc.documentElement);

    hammer.on("swipeleft", () => rendition.next());
    hammer.on("swiperight", () => rendition.prev());

    hammer.on("tap", (event) => {
        const width = doc.documentElement?.clientWidth || iframe.clientWidth || window.innerWidth;
        const xPosition = event.center.x;

        if (xPosition > width * 0.2 && xPosition < width * 0.8) {
            toggleHUD();
        } else if (xPosition <= width * 0.2) {
            rendition.prev();
        } else {
            rendition.next();
        }
    });

    applyFontOverride(`${state.currentFontSize}%`);
}

function attachViewerClickFallback(view) {
    const iframe = view?.iframe;
    if (!iframe || !elements.viewer) {
        return;
    }

    if (elements.viewer._hudClickListener) {
        elements.viewer.removeEventListener("click", elements.viewer._hudClickListener);
    }

    elements.viewer._hudClickListener = (event) => {
        if (state.lastHudToggle && Date.now() - state.lastHudToggle < 400) {
            return;
        }

        try {
            const rect = iframe.getBoundingClientRect();
            const width = rect.width || window.innerWidth;
            const xPosition = event.clientX - rect.left;

            if (xPosition > width * 0.2 && xPosition < width * 0.8) {
                toggleHUD();
            } else if (xPosition <= width * 0.2) {
                rendition.prev();
            } else {
                rendition.next();
            }
        } catch (error) {
            console.warn("Viewer click fallback failed:", error);
        }
    };

    elements.viewer.addEventListener("click", elements.viewer._hudClickListener);
}

function clearHudHideTimer() {
    if (state.hudAutoHideTimer) {
        window.clearTimeout(state.hudAutoHideTimer);
        state.hudAutoHideTimer = null;
    }
}

function scheduleHudHide() {
    clearHudHideTimer();
    state.hudAutoHideTimer = window.setTimeout(() => {
        hideHUD();
        state.hudAutoHideTimer = null;
    }, HUD_AUTOHIDE_DELAY);
}

function isFullscreen() {
    return Boolean(
        document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.msFullscreenElement
    );
}

function toggleFullscreen() {
    const fullscreenTarget = elements.appContainer || document.documentElement;

    if (!isFullscreen()) {
        if (fullscreenTarget.requestFullscreen) {
            fullscreenTarget.requestFullscreen().catch((error) => {
                console.warn("Fullscreen request failed:", error);
            });
        } else if (fullscreenTarget.webkitRequestFullscreen) {
            fullscreenTarget.webkitRequestFullscreen();
        } else if (fullscreenTarget.msRequestFullscreen) {
            fullscreenTarget.msRequestFullscreen();
        }
    } else if (document.exitFullscreen) {
        document.exitFullscreen().catch((error) => {
            console.warn("Exit fullscreen failed:", error);
        });
    } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
    }
}

function onFullscreenChange() {
    const active = isFullscreen();

    elements.fullscreenButton?.setAttribute("aria-pressed", String(active));
    if (elements.fullscreenButton) {
        elements.fullscreenButton.textContent = active ? "Exit Fullscreen" : "Fullscreen";
    }

    elements.body.classList.toggle("is-fullscreen", active);

    clearHudHideTimer();

    if (active) {
        showHUD();
        scheduleHudHide();
    } else {
        showHUD();
    }
}

function handleFullscreenActivity(event) {
    if (!isFullscreen()) {
        return;
    }

    if (event?.type === "keydown" && (event.key === "f" || event.key === "F")) {
        return;
    }

    showHUD();
    scheduleHudHide();
}

rendition.on("rendered", (section, view) => {
    attachIframeInteractions(view);
    attachViewerClickFallback(view);

    const tocIndex = sectionToNavIndex(section?.href);
    if (tocIndex >= 0) {
        const chapter = state.bookNav[tocIndex];
        updateLocationIndicator(`Reading: ${chapter.label}`);
    }
});

book.loaded.navigation
    .then((navigation) => {
        buildToc(navigation);
    })
    .catch((error) => {
        console.warn("Could not load navigation:", error);
        updateLocationIndicator("Opened Cereus & Limnic, but the table of contents could not be loaded.");
    });

rendition.on("relocated", (location) => {
    let percentage = 0;

    try {
        if (location?.start?.cfi) {
            safeStorageSet(STORAGE_KEYS.readerLocation, location.start.cfi);
        }

        if (book.locations?.length) {
            const progressValue = book.locations.percentageFromCfi(location.start.cfi);
            percentage = Math.round(progressValue * 100);
        }
    } catch (error) {
        console.warn("Error reading locations:", error);
    }

    const tocIndex = sectionToNavIndex(location?.start?.href);
    const chapterText = tocIndex >= 0 ? ` - ${state.bookNav[tocIndex].label}` : "";
    updateLocationIndicator(`Progress: ${percentage}%${chapterText}`);
});

try {
    rendition.themes.register("dark", {
        body: {
            background: "#111922",
            color: "#ecf5fb",
        },
        a: {
            color: "#7ad7f2",
        },
    });

    rendition.themes.register("sepia", {
        body: {
            background: "#f4e7d2",
            color: "#4f3925",
        },
        a: {
            color: "#8d6f50",
        },
    });

    rendition.themes.register("light", {
        body: {
            background: "#ffffff",
            color: "#182430",
        },
        a: {
            color: "#41748c",
        },
    });
} catch (error) {
    console.warn("Could not register themes:", error);
}

elements.menuButton?.addEventListener("click", () => {
    if (elements.sideMenu?.classList.contains("open")) {
        closeSideMenu();
    } else {
        openSideMenu();
    }
});

elements.menuCloseButton?.addEventListener("click", closeSideMenu);

elements.themeButtons.forEach((button) => {
    button.addEventListener("click", () => {
        const themeName = button.dataset.theme || "dark";
        setTheme(themeName);
    });
});

elements.fullscreenButton?.addEventListener("click", toggleFullscreen);

document.addEventListener("fullscreenchange", onFullscreenChange);
document.addEventListener("webkitfullscreenchange", onFullscreenChange);
document.addEventListener("msfullscreenchange", onFullscreenChange);

document.addEventListener("mousemove", handleFullscreenActivity, { passive: true });
document.addEventListener("touchstart", handleFullscreenActivity, { passive: true });
document.addEventListener("keydown", handleFullscreenActivity);

document.addEventListener("keydown", (event) => {
    if (event.key === "f" || event.key === "F") {
        const activeElement = document.activeElement;
        const isTypingTarget =
            activeElement &&
            (activeElement.tagName === "INPUT" ||
                activeElement.tagName === "TEXTAREA" ||
                activeElement.isContentEditable);

        if (!isTypingTarget) {
            toggleFullscreen();
        }
    }

    if (event.key === "Escape" && elements.sideMenu?.classList.contains("open")) {
        closeSideMenu();
    }
});

setTheme(state.currentTheme);
applyFontOverride(`${state.currentFontSize}%`);

window.changeFontSize = changeFontSize;
window.setTheme = setTheme;
