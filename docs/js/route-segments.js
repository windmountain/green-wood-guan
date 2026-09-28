// Divides the route into ~0.56-mile chunks and colors them
// orange/blue/pink/orange/... when the "show segments" checkbox is
// checked.
//
// Chunk boundaries are rounded up to the nearest direction: legs (from
// route-directions.json — the same turn-by-turn units route-directions.js
// shows) are accumulated in walk order, and a chunk only closes once its
// accumulated distance reaches SEGMENT_METERS, at the end of whichever leg
// crossed the threshold. A chunk never splits a leg in the middle.
(function () {
  var SEGMENT_MILES = 0.56;
  var SEGMENT_METERS = SEGMENT_MILES * 1609.344;
  var COLORS = ["orange", "blue", "pink"];

  var checkbox = document.getElementById("route-show-segments");
  var mapContainer = document.getElementById("route-map-svg");
  if (!checkbox || !mapContainer) return;

  var legs = null;
  var svgRoot = null;

  function stopOrderToSegmentIndex() {
    var map = {};
    var segmentIndex = 0;
    var accumulated = 0;
    legs.forEach(function (leg) {
      for (var stopOrder = leg.first_stop_order; stopOrder <= leg.last_stop_order; stopOrder++) {
        map[stopOrder] = segmentIndex;
      }
      accumulated += leg.distance_meters;
      if (accumulated >= SEGMENT_METERS) {
        segmentIndex++;
        accumulated = 0;
      }
    });
    return map;
  }

  function colorSegments() {
    var map = stopOrderToSegmentIndex();
    svgRoot.querySelectorAll(".route-segment").forEach(function (el) {
      var index = map[parseInt(el.dataset.stopOrder, 10)];
      if (index === undefined) return;
      el.classList.add("route-segment-color-" + (index % COLORS.length));
    });
    markRepeatedPaths(map);
  }

  // A physical path (same data-path-id) walked more than once shows up as
  // two overlapping .route-segment elements. Dot the pair only when they
  // actually resolve to different segment colors (via the same map
  // colorSegments just used) — that's the only case where one copy can
  // visually mask the other in a conflicting color. Stop_order adjacency
  // isn't a reliable proxy for this: an immediate there-and-back usually
  // lands inside one chunk, but can straddle a chunk boundary (e.g.
  // stop_order 29/30, path 54229), so it's checked directly instead.
  function markRepeatedPaths(map) {
    var elsByPathId = {};
    svgRoot.querySelectorAll(".route-segment").forEach(function (el) {
      var pathId = el.dataset.pathId;
      (elsByPathId[pathId] = elsByPathId[pathId] || []).push(el);
    });
    Object.keys(elsByPathId).forEach(function (pathId) {
      var els = elsByPathId[pathId];
      if (els.length <= 1) return;
      var indexes = els.map(function (el) { return map[parseInt(el.dataset.stopOrder, 10)]; });
      var allSameColor = indexes.every(function (index) { return index === indexes[0]; });
      if (!allSameColor) {
        els.forEach(function (el) { el.classList.add("route-segment-repeated"); });
      }
    });
  }

  function sync() {
    var showSegments = checkbox.checked && legs && svgRoot;
    mapContainer.classList.toggle("show-segments", !!showSegments);
    if (showSegments) colorSegments();
  }

  checkbox.addEventListener("change", sync);

  function onSvgReady(svg) {
    svgRoot = svg;
    sync();
  }

  // route-animation.js injects the <svg> asynchronously (after its own
  // fetch of unstyled_map.svg resolves); watch for it directly rather
  // than coordinating through that script, so this keeps working even if
  // that file loads from a stale cache.
  var existingSvg = mapContainer.querySelector("svg");
  if (existingSvg) {
    onSvgReady(existingSvg);
  } else {
    var observer = new MutationObserver(function () {
      var svg = mapContainer.querySelector("svg");
      if (svg) {
        onSvgReady(svg);
        observer.disconnect();
      }
    });
    observer.observe(mapContainer, { childList: true });
  }

  fetch("route-directions.json")
    .then(function (response) { return response.json(); })
    .then(function (data) {
      legs = data;
      sync();
    });
})();
