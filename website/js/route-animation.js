// Fetches unstyled_map.svg, injects it into #route-map-svg, and animates
// it: each .route-segment goes gray -> red -> white in walk order, timed
// to its share of the total route length, looping every LOOP_SECONDS.
//
// Cumulative distance is recomputed here from each segment's
// data-length-meters rather than trusting data-distance-from-start-m —
// that attribute is rounded independently per row in Postgres, and
// mixing the two rounding paths can push the last segment's end past
// exactly 1.0, which would break the loop boundary.
(function () {
  var LOOP_SECONDS = 40;

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

    var currentIndex = 0;
    var lastProgress = 0;

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

    function reset() {
      segments.forEach(function (s) {
        s.el.classList.remove("is-current", "is-walked");
      });
      currentIndex = 0;
      if (segments.length > 0) {
        segments[0].el.classList.add("is-current");
        bringToFront(segments[0].el);
      }
    }

    function tick(timestampMs) {
      var elapsedSeconds = (timestampMs / 1000) % LOOP_SECONDS;
      var progress = elapsedSeconds / LOOP_SECONDS;

      if (progress < lastProgress) {
        reset();
      }
      lastProgress = progress;

      while (currentIndex < segments.length && progress >= segments[currentIndex].endFraction) {
        segments[currentIndex].el.classList.remove("is-current");
        segments[currentIndex].el.classList.add("is-walked");
        bringToFront(segments[currentIndex].el);
        currentIndex++;
        if (currentIndex < segments.length) {
          segments[currentIndex].el.classList.add("is-current");
          bringToFront(segments[currentIndex].el);
        }
      }

      requestAnimationFrame(tick);
    }

    reset();
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
