// The mock's only behaviour: the Keep / Drop / Edit picks, the tally, the fix count, and the buttons that go to the next step.
const v = document.getElementById("view");
const tally = () => {
  const t = v.querySelector("#tally"); if (!t) return;
  const n = (p) => v.querySelectorAll(`tr[data-pick="${p}"]`).length;
  t.textContent = `Keep ${n("keep")} · Edit ${n("edit")} · Drop ${n("drop")}`;
};
const fixes = () => { const b = v.querySelector("[data-fix='']"); if (b) b.textContent = `Fix ${v.querySelectorAll("input[data-fix]:checked").length}`; };
v.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.closest(".seg")) for (const x of b.parentElement.children) x.setAttribute("aria-pressed", String(x === b));
  const p = b.dataset.pick, row = b.closest("tr[data-row]");
  if (p && row) { row.dataset.pick = p; tally(); }
  if (b.dataset.go) location.href = b.dataset.go;
});
v.addEventListener("change", fixes);
tally(); fixes();
