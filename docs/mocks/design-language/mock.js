// The mock's only behaviour: switch the view by hash, answer, edit a part, approve a group, filter the guide, preview a token.
const view = () => {
  const s = location.hash.slice(1);
  if (!document.querySelector(".s-" + s)) return;
  document.body.dataset.state = s;
  for (const a of document.querySelectorAll(".flow a")) a.toggleAttribute("aria-current", a.dataset.view === s);
};
addEventListener("hashchange", view);
view();
document.addEventListener("click", (e) => {
  const t = e.target;
  const ans = t.closest(".ans [data-ans]");
  if (ans) {
    if (ans.dataset.ans === "Record exception") location.hash = "#exception";
    else if (ans.dataset.ans === "Change language" && ans.closest("#d-0418")) location.href = "proposal.html";
    for (const b of ans.parentElement.children) b.setAttribute("aria-pressed", String(b === ans));
  }
  const pick = t.closest("[data-pick]");
  if (pick) {
    for (const b of pick.parentElement.children) b.setAttribute("aria-pressed", String(b === pick));
    document.getElementById("answered").textContent = document.querySelectorAll(".fsplit [aria-pressed=true]").length;
  }
  const grp = t.closest("button[data-group]");
  if (grp && !grp.disabled) {
    grp.textContent = "Approved"; grp.disabled = true;
    document.getElementById("approved").textContent = Number(document.getElementById("approved").textContent) + 1;
  }
  const back = t.closest("[data-back]");
  if (back) location.hash = back.dataset.back;
  const ed = t.closest("button[data-editor]");
  if (ed) ed.closest(".editable").classList.toggle("editing", ed.dataset.editor === "start");
  const seg = t.closest("#cls button");
  if (seg) {
    for (const b of seg.parentElement.children) b.setAttribute("aria-pressed", String(b === seg));
    const want = seg.textContent === "Rules" ? "rule" : seg.textContent === "Advice" ? "advice" : "";
    for (const r of document.querySelectorAll("tr[data-class]")) r.hidden = want && r.dataset.class !== want;
  }
});
document.addEventListener("submit", (e) => e.preventDefault());
document.getElementById("area-fs")?.addEventListener("change", (e) => document.body.style.setProperty("--area-fs", e.target.value));
