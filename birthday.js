(() => {
  "use strict";

  const letterButton = document.getElementById("letter-button");
  const letter = document.getElementById("birthday-letter");
  const wishButton = document.getElementById("wish-button");
  const layer = document.getElementById("celebration-layer");
  const toast = document.getElementById("birthday-toast");
  let toastTimer;

  function celebrate() {
    const colors = ["#cf9963", "#f3d17c", "#c4cea1", "#d9e0a3", "#e58e71", "#9d704d"];
    for (let index = 0; index < 44; index += 1) {
      const piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.textContent = ["✦", "♡", "✿", ""][index % 4];
      piece.style.setProperty("--confetti-color", colors[Math.floor(Math.random() * colors.length)]);
      piece.style.setProperty("--confetti-left", `${Math.random() * 100}%`);
      piece.style.setProperty("--confetti-delay", `${Math.random() * 450}ms`);
      piece.style.setProperty("--confetti-drift", `${Math.round(Math.random() * 240 - 120)}px`);
      piece.addEventListener("animationend", () => piece.remove(), { once: true });
      layer.appendChild(piece);
    }

    toast.textContent = "Yay! Semoga hari Chaca penuh kebahagiaan! 🎉";
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
  }

  wishButton.addEventListener("click", celebrate);
  letterButton.addEventListener("click", () => {
    const isOpening = letter.hidden;
    letter.hidden = !isOpening;
    letterButton.setAttribute("aria-expanded", String(isOpening));
    letterButton.innerHTML = isOpening
      ? 'Suratnya terbuka <span aria-hidden="true">♡</span>'
      : 'Buka surat kecil <span aria-hidden="true">♡</span>';
    if (isOpening) {
      celebrate();
      letter.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
})();
