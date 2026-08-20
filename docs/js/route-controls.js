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
