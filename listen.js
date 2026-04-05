const MANIFEST_PATH = "manifest.json";
const AUDIO_DIR = "audio/";
const GITHUB_MEDIA_AUDIO_BASE = "https://media.githubusercontent.com/media/KgitWH21/cereus_and_limnic_book_app/main/audio/";

const STORAGE_KEYS = {
    lastTrack: "cereusLimnic.listening.track",
    playbackSpeed: "cereusLimnic.listening.speed",
};

const state = {
    tracks: [],
    currentIndex: -1,
    pendingResumeTime: null,
    autoplayAfterLoad: false,
    playbackRate: loadStoredPlaybackRate(),
};

const elements = {
    audio: document.getElementById("chapter-audio"),
    chapterList: document.getElementById("audio-chapter-list"),
    currentChapterTitle: document.getElementById("current-chapter-title"),
    chapterHint: document.getElementById("chapter-hint"),
    status: document.getElementById("audio-status"),
    chapterCount: document.getElementById("chapter-count"),
    prevButton: document.getElementById("prev-track-btn"),
    nextButton: document.getElementById("next-track-btn"),
    playPauseButton: document.getElementById("play-pause-btn"),
    skipBackwardButton: document.getElementById("skip-backward-btn"),
    skipForwardButton: document.getElementById("skip-forward-btn"),
    seekBar: document.getElementById("seek-bar"),
    currentTime: document.getElementById("current-time"),
    totalTime: document.getElementById("total-time"),
    speedSelect: document.getElementById("speed-select"),
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

function getPositionKey(fileName) {
    return `cereusLimnic.listening.timestamp.${fileName}`;
}

function loadStoredPlaybackRate() {
    const parsedValue = Number(safeStorageGet(STORAGE_KEYS.playbackSpeed));
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 1;
}

function loadSavedPosition(fileName) {
    const parsedValue = Number(safeStorageGet(getPositionKey(fileName)));
    return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0;
}

function saveCurrentPosition() {
    const track = state.tracks[state.currentIndex];
    if (!track || !elements.audio) {
        return;
    }

    safeStorageSet(getPositionKey(track.file), String(Math.floor(elements.audio.currentTime)));
}

function setStatus(message, isError = false) {
    if (!elements.status) {
        return;
    }

    elements.status.textContent = message;
    elements.status.classList.toggle("error", isError);
}

function resolveTrackPath(fileName) {
    if (!fileName) {
        return "";
    }

    if (/^(https?:)?\/\//.test(fileName) || fileName.startsWith("./") || fileName.startsWith("../") || fileName.startsWith("/")) {
        return fileName;
    }

    return `${AUDIO_DIR}${fileName}`;
}

function buildGitHubMediaPath(fileName) {
    return `${GITHUB_MEDIA_AUDIO_BASE}${String(fileName)
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`;
}

function isLikelyLfsPointerResponse(response) {
    if (!response?.ok) {
        return false;
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const contentLength = Number(response.headers.get("content-length") || "0");

    return contentType.includes("text/plain") && Number.isFinite(contentLength) && contentLength > 0 && contentLength < 1024;
}

async function readManifestFile() {
    const response = await fetch(MANIFEST_PATH);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder("utf-16le").decode(buffer.slice(2));
    }

    return new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");
}

function formatTrackCount(count) {
    return `${count} ${count === 1 ? "track" : "tracks"}`;
}

function formatTime(valueInSeconds) {
    if (!Number.isFinite(valueInSeconds) || valueInSeconds < 0) {
        return "0:00";
    }

    const totalSeconds = Math.floor(valueInSeconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function updateTimeDisplay() {
    if (!elements.audio) {
        return;
    }

    const currentTime = Number.isFinite(elements.audio.currentTime) ? elements.audio.currentTime : 0;
    const duration = Number.isFinite(elements.audio.duration) ? elements.audio.duration : 0;

    if (elements.currentTime) {
        elements.currentTime.textContent = formatTime(currentTime);
    }

    if (elements.totalTime) {
        elements.totalTime.textContent = formatTime(duration);
    }

    if (elements.seekBar) {
        elements.seekBar.max = String(Math.max(0, Math.floor(duration)));
        elements.seekBar.value = String(Math.min(Math.floor(currentTime), Math.floor(duration || 0)));
    }
}

function updatePlayPauseButton() {
    if (!elements.playPauseButton || !elements.audio) {
        return;
    }

    elements.playPauseButton.textContent = elements.audio.paused ? "Play" : "Pause";
}

function updateNavigationState() {
    const hasTracks = state.tracks.length > 0;
    const isFirst = state.currentIndex <= 0;
    const isLast = state.currentIndex >= state.tracks.length - 1;

    if (elements.prevButton) {
        elements.prevButton.disabled = !hasTracks || isFirst;
    }

    if (elements.nextButton) {
        elements.nextButton.disabled = !hasTracks || isLast;
    }

    if (elements.playPauseButton) {
        elements.playPauseButton.disabled = !hasTracks || state.currentIndex < 0;
    }

    if (elements.skipBackwardButton) {
        elements.skipBackwardButton.disabled = !hasTracks || state.currentIndex < 0;
    }

    if (elements.skipForwardButton) {
        elements.skipForwardButton.disabled = !hasTracks || state.currentIndex < 0;
    }

    if (elements.seekBar) {
        elements.seekBar.disabled = !hasTracks || state.currentIndex < 0;
    }
}

function getTrackStateLabel(track, index) {
    if (index === state.currentIndex) {
        const savedPosition = loadSavedPosition(track.file);
        return savedPosition > 0 ? `Resume ${formatTime(savedPosition)}` : "Selected";
    }

    const savedPosition = loadSavedPosition(track.file);
    return savedPosition > 0 ? formatTime(savedPosition) : "Load";
}

function renderTrackList() {
    if (!elements.chapterList) {
        return;
    }

    elements.chapterList.innerHTML = "";

    state.tracks.forEach((track, index) => {
        const listItem = document.createElement("li");
        const button = document.createElement("button");
        const metaWrap = document.createElement("span");
        const indexLabel = document.createElement("span");
        const titleLabel = document.createElement("span");
        const stateLabel = document.createElement("span");
        const labelText = track.chapterLabel || `Chapter ${String(index + 1).padStart(2, "0")}`;

        button.type = "button";
        button.className = "chapter-button";
        if (index === state.currentIndex) {
            button.classList.add("active");
        }

        metaWrap.className = "chapter-meta";
        indexLabel.className = "chapter-index";
        titleLabel.className = "chapter-title";
        stateLabel.className = "chapter-state";

        indexLabel.textContent = labelText;
        titleLabel.textContent = track.title;
        stateLabel.textContent = getTrackStateLabel(track, index);

        metaWrap.appendChild(indexLabel);
        metaWrap.appendChild(titleLabel);
        button.appendChild(metaWrap);
        button.appendChild(stateLabel);

        button.addEventListener("click", () => {
            selectTrack(index);
        });

        listItem.appendChild(button);
        elements.chapterList.appendChild(listItem);
    });

    if (elements.chapterCount) {
        elements.chapterCount.textContent = formatTrackCount(state.tracks.length);
    }

    updateNavigationState();
}

async function checkAudioAvailability(filePath) {
    try {
        const response = await fetch(filePath, { method: "HEAD" });
        return response;
    } catch (error) {
        console.warn("Audio availability check failed:", error);
        return null;
    }
}

async function resolvePlayableTrackPath(track) {
    if (!track?.file) {
        return "";
    }

    if (track.url) {
        return track.url;
    }

    const localPath = resolveTrackPath(track.file);
    if (/^(https?:)?\/\//.test(localPath)) {
        return localPath;
    }

    const localResponse = await checkAudioAvailability(localPath);
    if (localResponse?.ok && !isLikelyLfsPointerResponse(localResponse)) {
        return localPath;
    }

    const githubMediaPath = buildGitHubMediaPath(track.file);
    const githubMediaResponse = await checkAudioAvailability(githubMediaPath);
    if (githubMediaResponse?.ok) {
        return githubMediaPath;
    }

    if (localResponse?.ok) {
        return localPath;
    }

    return githubMediaPath;
}

function updateTrackDetails(track) {
    if (elements.currentChapterTitle) {
        elements.currentChapterTitle.textContent = track ? track.title : "No track selected";
    }

    if (elements.chapterHint) {
        if (!track) {
            elements.chapterHint.textContent = "Choose a chapter to begin listening.";
        } else if (track.chapterLabel) {
            elements.chapterHint.textContent = track.chapterLabel;
        } else {
            elements.chapterHint.textContent = `Track ${String(state.currentIndex + 1).padStart(2, "0")} of ${state.tracks.length}`;
        }
    }
}

async function selectTrack(index, options = {}) {
    const { autoplay = false } = options;

    if (index < 0 || index >= state.tracks.length || !elements.audio) {
        return;
    }

    const track = state.tracks[index];
    const sameTrackSelected =
        state.currentIndex === index && elements.audio.dataset.file === track.file;

    state.currentIndex = index;
    state.pendingResumeTime = loadSavedPosition(track.file);
    state.autoplayAfterLoad = autoplay;

    safeStorageSet(STORAGE_KEYS.lastTrack, track.file);
    updateTrackDetails(track);
    renderTrackList();

    if (sameTrackSelected) {
        setStatus(`Ready to continue ${track.title}.`);

        if (autoplay) {
            safePlay(track.title);
        }

        return;
    }

    const nextSource = await resolvePlayableTrackPath(track);
    setStatus(`Loading ${track.title}...`);

    const availability = await checkAudioAvailability(nextSource);
    if (availability === null || availability.ok === false) {
        elements.audio.removeAttribute("src");
        elements.audio.dataset.file = "";
        elements.audio.load();
        setStatus(`Missing audio file: ${track.file}`, true);
        updateTimeDisplay();
        updatePlayPauseButton();
        return;
    }

    elements.audio.src = nextSource;
    elements.audio.dataset.file = track.file;
    elements.audio.playbackRate = state.playbackRate;
    elements.audio.load();
    updateTimeDisplay();
    updatePlayPauseButton();
}

function restorePendingPosition() {
    if (!elements.audio) {
        return;
    }

    const duration = Number.isFinite(elements.audio.duration) ? elements.audio.duration : 0;
    const resumeTime = state.pendingResumeTime ?? 0;
    state.pendingResumeTime = null;

    if (resumeTime > 0 && duration > 0) {
        try {
            elements.audio.currentTime = Math.min(resumeTime, Math.max(0, duration - 1));
        } catch (error) {
            console.warn("Could not restore listening position:", error);
        }
    }

    updateTimeDisplay();
    updatePlayPauseButton();

    const track = state.tracks[state.currentIndex];
    if (!track) {
        return;
    }

    if (state.autoplayAfterLoad) {
        safePlay(track.title);
        return;
    }

    if (resumeTime > 0) {
        setStatus(`Ready to resume ${track.title} at ${formatTime(elements.audio.currentTime)}.`);
    } else {
        setStatus(`Loaded ${track.title}. Press Play when you're ready.`);
    }
}

function safePlay(trackTitle) {
    if (!elements.audio) {
        return;
    }

    elements.audio.play()
        .then(() => {
            setStatus(`Playing ${trackTitle}.`);
            updatePlayPauseButton();
        })
        .catch((error) => {
            console.warn("Playback could not start automatically:", error);
            setStatus(`Loaded ${trackTitle}. Press Play to begin listening.`);
            updatePlayPauseButton();
        });
}

function moveTrack(direction, options = {}) {
    const nextIndex = state.currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= state.tracks.length) {
        return;
    }

    const shouldAutoplay = options.autoplay || (!elements.audio?.paused);
    selectTrack(nextIndex, { autoplay: shouldAutoplay });
}

async function handleAudioError() {
    const track = state.tracks[state.currentIndex];
    const fallbackSource = track?.file ? buildGitHubMediaPath(track.file) : "";

    if (
        track &&
        elements.audio &&
        fallbackSource &&
        elements.audio.src !== fallbackSource
    ) {
        const fallbackAvailability = await checkAudioAvailability(fallbackSource);
        if (fallbackAvailability?.ok) {
            elements.audio.src = fallbackSource;
            elements.audio.dataset.file = track.file;
            elements.audio.load();
            setStatus(`Retrying ${track.title} from the media host...`);
            return;
        }
    }

    const fileName = track?.file || "unknown file";
    setStatus(`Unable to play ${fileName}. Verify the file exists in /audio or update manifest.json.`, true);
    updatePlayPauseButton();
}

function togglePlayback() {
    if (!elements.audio) {
        return;
    }

    if (state.currentIndex < 0 && state.tracks.length > 0) {
        selectTrack(0, { autoplay: true });
        return;
    }

    if (elements.audio.paused) {
        const track = state.tracks[state.currentIndex];
        safePlay(track?.title || "the selected chapter");
    } else {
        elements.audio.pause();
        saveCurrentPosition();
        setStatus("Playback paused.");
        updatePlayPauseButton();
    }
}

function skipBy(seconds) {
    if (!elements.audio || state.currentIndex < 0) {
        return;
    }

    const duration = Number.isFinite(elements.audio.duration) ? elements.audio.duration : 0;
    const nextTime = Math.max(0, Math.min(elements.audio.currentTime + seconds, duration || elements.audio.currentTime + seconds));
    elements.audio.currentTime = nextTime;
    updateTimeDisplay();
    saveCurrentPosition();
}

function handleSeekInput() {
    if (!elements.audio || !elements.seekBar) {
        return;
    }

    const nextTime = Number(elements.seekBar.value);
    if (!Number.isFinite(nextTime)) {
        return;
    }

    try {
        elements.audio.currentTime = nextTime;
    } catch (error) {
        console.warn("Seek operation failed:", error);
    }

    updateTimeDisplay();
    saveCurrentPosition();
}

function persistPlaybackRate(rate) {
    state.playbackRate = rate;
    safeStorageSet(STORAGE_KEYS.playbackSpeed, String(rate));

    if (elements.audio) {
        elements.audio.playbackRate = rate;
    }
}

async function loadManifest() {
    try {
        const manifestText = await readManifestFile();
        const parsed = JSON.parse(manifestText);
        if (!Array.isArray(parsed)) {
            throw new Error("Manifest must be an array.");
        }

        state.tracks = parsed.filter((item) => item && item.title && item.file);
        renderTrackList();

        if (state.tracks.length === 0) {
            updateTrackDetails(null);
            setStatus("No audiobook tracks were found in manifest.json.", true);
            return;
        }

        const lastTrack = safeStorageGet(STORAGE_KEYS.lastTrack);
        const initialIndex = Math.max(
            0,
            state.tracks.findIndex((track) => track.file === lastTrack)
        );

        await selectTrack(initialIndex);
    } catch (error) {
        console.error("Could not load manifest.json:", error);
        updateTrackDetails(null);
        setStatus("Could not load manifest.json. Check the file structure and serve over HTTP.", true);
    }
}

elements.prevButton?.addEventListener("click", () => moveTrack(-1));
elements.nextButton?.addEventListener("click", () => moveTrack(1));
elements.playPauseButton?.addEventListener("click", togglePlayback);
elements.skipBackwardButton?.addEventListener("click", () => skipBy(-15));
elements.skipForwardButton?.addEventListener("click", () => skipBy(30));
elements.seekBar?.addEventListener("input", handleSeekInput);
elements.speedSelect?.addEventListener("change", (event) => {
    const nextRate = Number(event.target.value);
    if (Number.isFinite(nextRate) && nextRate > 0) {
        persistPlaybackRate(nextRate);
    }
});

elements.audio?.addEventListener("loadedmetadata", restorePendingPosition);
elements.audio?.addEventListener("durationchange", updateTimeDisplay);
elements.audio?.addEventListener("timeupdate", () => {
    updateTimeDisplay();
    saveCurrentPosition();
});
elements.audio?.addEventListener("play", updatePlayPauseButton);
elements.audio?.addEventListener("pause", updatePlayPauseButton);
elements.audio?.addEventListener("ratechange", () => {
    if (elements.speedSelect && elements.audio) {
        elements.speedSelect.value = String(elements.audio.playbackRate);
    }
});
elements.audio?.addEventListener("error", handleAudioError);
elements.audio?.addEventListener("ended", () => {
    saveCurrentPosition();

    if (state.currentIndex < state.tracks.length - 1) {
        moveTrack(1, { autoplay: true });
    } else {
        setStatus("Audiobook complete. No next track available.");
        updatePlayPauseButton();
    }
});

if (elements.speedSelect) {
    elements.speedSelect.value = String(state.playbackRate);
}

if (elements.audio) {
    elements.audio.playbackRate = state.playbackRate;
}

updateNavigationState();
updateTimeDisplay();
updatePlayPauseButton();
loadManifest();
