/* Way More Fish — place CCA info beside LDWF/regulations */
(function () {
  function headingSection(text) {
    return Array.from(document.querySelectorAll('section.card')).find(function (s) {
      var h = s.querySelector('h3');
      return h && h.textContent.trim() === text;
    }) || null;
  }

  function moveCca() {
    var cca = headingSection('CCA Artificial Reefs');
    var regs = headingSection('Louisiana regulations');
    if (!cca || !regs || !regs.parentNode) return;

    var muted = cca.querySelectorAll('.small.muted');
    if (muted[0]) {
      muted[0].textContent =
        'Gold dots mark verified published CCA reef locations. Tap a reef for coordinates and details.';
    }
    for (var i = 1; i < muted.length; i++) {
      muted[i].style.display = 'none';
    }

    regs.parentNode.insertBefore(cca, regs.nextSibling);
  }

  setTimeout(moveCca, 0);
})();
