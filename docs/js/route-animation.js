// Fetches unstyled_map.svg, injects it into #route-map-svg, and animates
// it: each .route-segment goes gray -> red -> white in walk order, timed
// to its share of the total route length, looping every LOOP_SECONDS.
// Playback is controlled by the buttons in .route-controls (play/pause,
// stop and rewind, step back one, step forward one).
//
// Cumulative distance is recomputed here from each segment's
// data-length-meters rather than trusting data-distance-from-start-m —
// that attribute is rounded independently per row in Postgres, and
// mixing the two rounding paths can push the last segment's end past
// exactly 1.0, which would break the loop boundary.
(function () {
  var LOOP_SECONDS = 120;

  function init(svgRoot) {
    var segments = Array.prototype.map.call(
      svgRoot.querySelectorAll(".route-segment"),
      function (el) {
        return { el: el, length: parseFloat(el.dataset.lengthMeters) };
      }
    );

    var totalLength = segments.reduce(function (sum, s) { return sum + s.length; }, 0);

    var runningBefore = 0;
    segments.forEach(function (s) {
      s.startFraction = runningBefore / totalLength;
      runningBefore += s.length;
      s.endFraction = runningBefore / totalLength;
    });

    if (segments.length === 0) return;

    var currentIndex = 0;
    var playing = true;
    var elapsedSeconds = 0;
    var lastFrameTime = null;

    var playPauseBtn = document.getElementById("route-play-pause");
    var stopBtn = document.getElementById("route-stop");
    var backBtn = document.getElementById("route-step-back");
    var forwardBtn = document.getElementById("route-step-forward");

    // SVG has no z-index — elements paint in document order. Since a
    // retraced segment's second <path> comes later in the document than
    // its first, it always sits on top, even while it's still gray and
    // the first pass has already turned white underneath it. Moving the
    // just-updated element to the end of its parent (re-appending it)
    // bumps it to the top of paint order, so whichever copy changed most
    // recently is always the one actually visible.
    function bringToFront(el) {
      el.parentNode.appendChild(el);
    }

    // Lets other scripts (route-directions.js) follow which stop is
    // currently highlighted without reaching into this closure.
    function announceCurrent(segment) {
      document.dispatchEvent(new CustomEvent("route-map:step", {
        detail: { stopOrder: parseInt(segment.el.dataset.stopOrder, 10) }
      }));
    }

    function setPlaying(value) {
      playing = value;
      if (playPauseBtn) {
        playPauseBtn.textContent = playing ? "⏸" : "▶";
        playPauseBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
      }
    }

    function syncElapsedToCurrent() {
      elapsedSeconds = segments[currentIndex].startFraction * LOOP_SECONDS;
    }

    function resetToStart() {
      segments.forEach(function (s) {
        s.el.classList.remove("is-current", "is-walked");
      });
      currentIndex = 0;
      elapsedSeconds = 0;
      segments[0].el.classList.add("is-current");
      bringToFront(segments[0].el);
      announceCurrent(segments[0]);
    }

    // Advances exactly one segment, wrapping (and clearing the walked
    // trail) when it runs past the end — a full loop completing.
    function stepForward() {
      segments[currentIndex].el.classList.remove("is-current");
      segments[currentIndex].el.classList.add("is-walked");
      bringToFront(segments[currentIndex].el);
      currentIndex++;
      if (currentIndex >= segments.length) {
        segments.forEach(function (s) { s.el.classList.remove("is-walked"); });
        currentIndex = 0;
      }
      segments[currentIndex].el.classList.add("is-current");
      bringToFront(segments[currentIndex].el);
      announceCurrent(segments[currentIndex]);
    }

    // Retreats exactly one segment. Does nothing at the very start — there's
    // no walked trail before it to un-walk into.
    function stepBackward() {
      if (currentIndex === 0) return;
      segments[currentIndex].el.classList.remove("is-current");
      currentIndex--;
      segments[currentIndex].el.classList.remove("is-walked");
      segments[currentIndex].el.classList.add("is-current");
      bringToFront(segments[currentIndex].el);
      announceCurrent(segments[currentIndex]);
    }

    function tick(timestampMs) {
      if (playing) {
        if (lastFrameTime !== null) {
          elapsedSeconds += (timestampMs - lastFrameTime) / 1000;
          if (elapsedSeconds >= LOOP_SECONDS) {
            elapsedSeconds -= LOOP_SECONDS;
          }
        }
        lastFrameTime = timestampMs;

        var progress = elapsedSeconds / LOOP_SECONDS;
        while (progress >= segments[currentIndex].endFraction) {
          stepForward();
        }
      } else {
        // Don't count paused time once playback resumes.
        lastFrameTime = null;
      }

      requestAnimationFrame(tick);
    }

    if (playPauseBtn) {
      playPauseBtn.addEventListener("click", function () {
        setPlaying(!playing);
      });
    }
    if (stopBtn) {
      stopBtn.addEventListener("click", function () {
        setPlaying(false);
        resetToStart();
      });
    }
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        setPlaying(false);
        stepBackward();
        syncElapsedToCurrent();
      });
    }
    if (forwardBtn) {
      forwardBtn.addEventListener("click", function () {
        setPlaying(false);
        stepForward();
        syncElapsedToCurrent();
      });
    }

    resetToStart();
    setPlaying(true);
    requestAnimationFrame(tick);
  }

  var container = document.getElementById("route-map-svg");
  if (!container) return;

  fetch("unstyled_map.svg")
    .then(function (response) { return response.text(); })
    .then(function (svgText) {
      container.innerHTML = svgText;
      init(container.querySelector("svg"));
    });
})();
