// Fetches route-stats.json and splices each value into any element with a
// matching data-stat="<json key>" attribute.
(function () {
  fetch("route-stats.json")
    .then(function (response) { return response.json(); })
    .then(function (stats) {
      document.querySelectorAll("[data-stat]").forEach(function (el) {
        el.textContent = stats[el.dataset.stat];
      });
    });
})();
