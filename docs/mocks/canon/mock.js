// The mock's only behaviour: switch the card's state, pick per feature, and let state 2 turn into 3 as the agent would.
const go = (s) => {
  document.body.dataset.state = s;
  for (const b of document.querySelectorAll(".flow [data-go]")) b.toggleAttribute("aria-current", b.dataset.go === s);
  if (s === "2") setTimeout(() => document.body.dataset.state === "2" && go("3"), 1500);
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-go], .picks button"); if (!b) return;
  e.preventDefault();
  if (b.closest(".picks")) {
    for (const x of b.parentElement.children) x.setAttribute("aria-pressed", String(x === b));
    b.closest("li").dataset.pick = b.dataset.pick;
  } else if (b.dataset.go === "pin") document.querySelector(".target .pin")?.focus();
  else go(b.dataset.go);
});
addEventListener("keydown", (e) => { if (e.key === "c" && document.body.dataset.state === "1") go("2"); });
