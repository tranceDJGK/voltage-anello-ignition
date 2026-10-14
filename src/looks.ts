export const LOOKS = [
  { id: "ignition", label: "Ignition", hint: "Fasci bianchi, V viola, barre spente" },
  { id: "finale", label: "Finale", hint: "V elettrica, barre, show completo" },
  { id: "strisce", label: "Strisce", hint: "Barre rosse e ghiaccio in primo piano" },
  { id: "viola", label: "Viola", hint: "Campo violetto" },
  { id: "ambra", label: "Ambra", hint: "Controluce caldo" },
] as const;

export type LookId = (typeof LOOKS)[number]["id"];

export const SHOTS = [
  { id: "platea", label: "Platea" },
  { id: "folla", label: "Folla" },
  { id: "palco", label: "Palco" },
  { id: "anello", label: "Anello" },
  { id: "drone", label: "Drone" },
  { id: "sotto", label: "Sotto" },
] as const;

export type ShotId = (typeof SHOTS)[number]["id"];

export const MODES = [
  { id: "orbita", label: "Orbita" },
  { id: "cammina", label: "Cammina" },
  { id: "cinema", label: "Cinema" },
] as const;

export type Mode = (typeof MODES)[number]["id"];

export type LookColors = {
  beam: string;
  core: string;
  edge: string;
  arch: string;
  barA: string;
  barB: string;
  bars: number;
  fog: string;
  wash: string;
  exposure: number;
  sky: string;
};

export const LOOK_COLORS: Record<LookId, LookColors> = {
  ignition: {
    beam: "#f4f7ff",
    core: "#f7f9ff",
    edge: "#7a52ff",
    arch: "#4a1230",
    barA: "#14161c",
    barB: "#12141a",
    bars: 0.04,
    fog: "#07080e",
    wash: "#6d5cff",
    exposure: 1.02,
    sky: "#101624",
  },
  finale: {
    beam: "#eaf4ff",
    core: "#e7f6ff",
    edge: "#3c7dff",
    arch: "#a01840",
    barA: "#ff2944",
    barB: "#c6f2ff",
    bars: 1,
    fog: "#070910",
    wash: "#3d78ff",
    exposure: 1.08,
    sky: "#10182c",
  },
  strisce: {
    beam: "#e7fbff",
    core: "#f4fdff",
    edge: "#3ec8ff",
    arch: "#c01848",
    barA: "#ff1c3a",
    barB: "#f2fdff",
    bars: 1,
    fog: "#060910",
    wash: "#ff3358",
    exposure: 1.1,
    sky: "#0e1422",
  },
  viola: {
    beam: "#eadcff",
    core: "#f6ecff",
    edge: "#8d4dff",
    arch: "#54147a",
    barA: "#d24bff",
    barB: "#e4d4ff",
    bars: 0.88,
    fog: "#0a0712",
    wash: "#7a3dff",
    exposure: 1.06,
    sky: "#161028",
  },
  ambra: {
    beam: "#ffe0bc",
    core: "#fff3e2",
    edge: "#ff8b2e",
    arch: "#7a1c12",
    barA: "#ff5a1c",
    barB: "#ffe6c2",
    bars: 0.92,
    fog: "#0c0907",
    wash: "#ff8a2a",
    exposure: 1.06,
    sky: "#1a120c",
  },
};
