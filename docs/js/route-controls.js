// Wires the "show directions" checkbox to the #route-directions panel.
// Playback buttons (play/pause, stop, step) are wired inside
// route-animation.js instead, since they need direct access to its
// animation state.
(function () {
  var checkbox = document.getElementById("route-show-directions");
  var panel = document.getElementById("route-directions");
  if (!checkbox || !panel) return;

  function sync() {
    panel.hidden = !checkbox.checked;
  }

  checkbox.addEventListener("change", sync);
  sync();
})();

// Wires the "show rotation slider" checkbox to the .route-rotate panel.
(function () {
  var checkbox = document.getElementById("route-show-rotate");
  var panel = document.getElementById("route-rotate");
  if (!checkbox || !panel) return;

  function sync() {
    panel.hidden = !checkbox.checked;
  }

  checkbox.addEventListener("change", sync);
  sync();
})();

// Wires the rotate slider to the map container. Range is -180 (full left)
// to 180 (full right), centered at 0 (no rotation, matching the slider's
// default value, so no initial sync is needed).
(function () {
  var slider = document.getElementById("route-rotate-slider");
  var map = document.getElementById("route-map-svg");
  if (!slider || !map) return;

  slider.addEventListener("input", function () {
    map.style.transform = "rotate(" + slider.value + "deg)";
  });
})();
