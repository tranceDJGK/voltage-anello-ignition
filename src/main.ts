import { mountAnello, type StageHandle } from "./engine";
import { LOOKS, MODES, SHOTS, type LookId, type Mode, type ShotId } from "./looks";

const canvas = document.querySelector("canvas");
if (!canvas) throw new Error("canvas");

const modesEl = document.querySelector<HTMLElement>("#modes")!;
const shotsEl = document.querySelector<HTMLElement>("#shots")!;
const looksEl = document.querySelector<HTMLElement>("#looks")!;
const playBtn = document.querySelector<HTMLButtonElement>("#play")!;
const hint = document.querySelector<HTMLElement>("#hint")!;
const crowdEl = document.querySelector<HTMLElement>("#crowd")!;
const meter = document.querySelector<HTMLElement>("#meter")!;
const stick = document.querySelector<HTMLElement>("#stick")!;
const knob = document.querySelector<HTMLElement>("#knob")!;

let mode: Mode = "orbita";
let shot: ShotId = "platea";
let look: LookId = "finale";
let audioOn = false;
let api: StageHandle;

function chip(label: string, pressed: boolean, extra = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `chip ${extra}`.trim();
  b.textContent = label;
  b.setAttribute("aria-pressed", pressed ? "true" : "false");
  return b;
}

function paint() {
  modesEl.querySelectorAll("button").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.id === mode ? "true" : "false");
  });
  shotsEl.querySelectorAll("button").forEach((b) => {
    const on = b.dataset.id === shot && mode !== "cammina";
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  looksEl.querySelectorAll("button").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.id === look ? "true" : "false");
  });
  playBtn.textContent = audioOn ? "Click acceso" : "Accendi il click";
  hint.textContent =
    mode === "cammina"
      ? "WASD per camminare · trascina per guardare · Esc esce"
      : "Trascina per orbitare · scroll per entrare nel palco";
  stick.classList.toggle("on", mode === "cammina" && window.matchMedia("(max-width: 800px)").matches);
}

for (const item of MODES) {
  const b = chip(item.label, item.id === mode);
  b.dataset.id = item.id;
  b.addEventListener("click", () => {
    mode = item.id;
    api.setMode(item.id);
    paint();
  });
  modesEl.append(b);
}
for (const item of SHOTS) {
  const b = chip(item.label, item.id === shot);
  b.dataset.id = item.id;
  b.addEventListener("click", () => {
    shot = item.id;
    mode = "orbita";
    api.setShot(item.id);
    paint();
  });
  shotsEl.append(b);
}
for (const item of LOOKS) {
  const b = chip(item.label, item.id === look, "look");
  b.dataset.id = item.id;
  b.title = item.hint;
  b.addEventListener("click", () => {
    look = item.id;
    api.setLook(item.id);
    paint();
  });
  looksEl.append(b);
}

playBtn.addEventListener("click", () => {
  void api.toggleAudio().then((on) => {
    audioOn = on;
    paint();
  });
});

let pid = -1;
let origin = { x: 0, y: 0 };
stick.addEventListener("pointerdown", (ev) => {
  pid = ev.pointerId;
  origin = { x: ev.clientX, y: ev.clientY };
  stick.setPointerCapture(ev.pointerId);
});
stick.addEventListener("pointermove", (ev) => {
  if (ev.pointerId !== pid) return;
  const dx = Math.max(-1, Math.min(1, (ev.clientX - origin.x) / 46));
  const dy = Math.max(-1, Math.min(1, (origin.y - ev.clientY) / 46));
  api.setMove(dx, dy);
  knob.style.transform = `translate(${dx * 28}px, ${-dy * 28}px)`;
});
const stickEnd = (ev: PointerEvent) => {
  if (ev.pointerId !== pid) return;
  pid = -1;
  api.setMove(0, 0);
  knob.style.transform = "translate(0px, 0px)";
};
stick.addEventListener("pointerup", stickEnd);
stick.addEventListener("pointercancel", stickEnd);

api = mountAnello(canvas, {
  onReady: (info) => {
    crowdEl.textContent = `${info.crowd} in pista`;
  },
  onMode: (next) => {
    mode = next;
    paint();
  },
  onShot: (id) => {
    shot = id;
    paint();
  },
  onEnergy: (energy) => {
    meter.style.transform = `scaleX(${0.08 + energy * 0.92})`;
  },
});
api.setLook("finale");
paint();
