// @license http://www.gnu.org/licenses/agpl-3.0.html AGPL-3.0
// SPDX-License-Identifier: AGPL-3.0-only
function playMedia(overlay, tagName) {
    const media = overlay.parentElement.querySelector(tagName);
    const url = media.getAttribute("data-url");
    const startTime = parseFloat(media.getAttribute("data-start") || "0");
    media.setAttribute("controls", "");
    media.setAttribute("playsinline", "");
    overlay.style.display = "none";

    function startNative() {
        if (startTime > 0) {
            try { media.currentTime = startTime; } catch (e) {}
        }
        const pending = media.play();
        if (pending && pending.catch) pending.catch(function () {});
    }

    if (typeof Hls !== "undefined" && Hls.isSupported()) {
        var hls = new Hls({autoStartLoad: false});
        hls.loadSource(url);
        hls.attachMedia(media);
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            hls.loadLevel = hls.levels.length - 1;
            hls.startLoad(startTime);
            const pending = media.play();
            if (pending && pending.catch) pending.catch(function () {});
        });
    } else if (media.canPlayType && media.canPlayType('application/vnd.apple.mpegurl')) {
        if (media.readyState >= 2) {
            media.src = url;
            startNative();
        } else {
            media.addEventListener('canplay', startNative, { once: true });
            media.src = url;
            media.load();
        }
    }
}

function playVideo(overlay) { playMedia(overlay, 'video'); }
function playAudio(overlay) { playMedia(overlay, 'audio'); }
// @license-end
