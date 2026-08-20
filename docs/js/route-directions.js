// Fetches route-directions.json and shows one turn-by-turn direction at a
// time in #route-directions, kept in sync with the map by listening for
// "route-map:step" events dispatched by route-animation.js as each
// .route-segment becomes current.
(function () {
  var container = document.getElementById("route-directions");
  if (!container) return;

  var legs = [];
  var currentLeg = null;

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function findLeg(stopOrder) {
    // Legs are contiguous ranges of stop_order, in order, so a linear scan
    // from the last match is enough — but the list is short, so just scan.
    for (var i = 0; i < legs.length; i++) {
      if (stopOrder >= legs[i].first_stop_order && stopOrder <= legs[i].last_stop_order) {
        return legs[i];
      }
    }
    return null;
  }

  function render(leg) {
    var instruction = leg.instruction === "start"
      ? (leg.name ? "Start on " + leg.name : "Start")
      : capitalize(leg.instruction) + (leg.name ? " onto " + leg.name : "");

    container.innerHTML =
      '<p class="route-direction">' +
        '<span class="route-direction-step-number">' + leg.step + '.</span> ' +
        '<span class="route-direction-instruction">' + instruction + '</span>' +
        '<span class="route-direction-distance">' +
          Math.round(leg.distance_meters) + ' m' +
          (leg.is_retrace ? ' · retracing' : '') +
        '</span>' +
      '</p>';
  }

  document.addEventListener("route-map:step", function (e) {
    var leg = findLeg(e.detail.stopOrder);
    if (leg && leg !== currentLeg) {
      currentLeg = leg;
      render(leg);
    }
  });

  fetch("route-directions.json")
    .then(function (response) { return response.json(); })
    .then(function (data) { legs = data; });
})();
