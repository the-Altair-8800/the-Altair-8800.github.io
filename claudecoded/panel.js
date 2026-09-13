/**
 * Wires an Intel 8080 to a front panel made of <display-bit> and
 * <toggle-switch> elements.
 */

import { I8080, STATUS } from "./i8080.js";
import { PROGRAMS } from "./programs.js";
import "./display-bit.js";
import "./toggle-switch.js";

const createElement = (tag, props = {}) => Object.assign(document.createElement(tag), props);

const hex = (v, width) => v.toString(16).toUpperCase().padStart(width, "0");
const $ = selector => document.querySelector(selector);

// --------------------------------------------------------------- panel layout

// Lamps in the status row, left to right, with the status bit each one watches.
const STATUS_LAMPS = [
  ["INTE", STATUS.INTE], ["PROT", STATUS.PROT], ["MEMR", STATUS.MEMR],
  ["INP", STATUS.INP], ["M1", STATUS.M1], ["OUT", STATUS.OUT],
  ["HLTA", STATUS.HLTA], ["STACK", STATUS.STACK], ["WO", STATUS.WO],
  ["INT", STATUS.INT],
];

// Control switches, left to right. Every one but the power switch is spring
// loaded, exactly like the real paddles.
const CONTROLS = [
  { id: "power", up: "ON", down: "OFF", maintained: true },
  { id: "run", up: "STOP", down: "RUN" },
  { id: "step", up: "SINGLE STEP" },
  { id: "examine", up: "EXAMINE", down: "EXAMINE NEXT" },
  { id: "deposit", up: "DEPOSIT", down: "DEPOSIT NEXT" },
  { id: "reset", up: "RESET", down: "CLR" },
  { id: "protect", up: "PROTECT", down: "UNPROTECT" },
  { id: "aux1", up: "AUX", down: "AUX" },
  { id: "aux2", up: "AUX", down: "AUX" },
];

/** Split bit numbers into the octal groups the silkscreen draws them in. */
const octalGroups = bits => {
  const groups = [];
  let run = [];
  let key = null;
  for (const bit of bits) {
    const next = Math.floor(bit / 3);
    if (next !== key && run.length) { groups.push(run); run = []; }
    key = next;
    run.push(bit);
  }
  if (run.length) groups.push(run);
  return groups;
};

/** Fill `host` with one octal-grouped bank of elements, highest bit first. */
const buildBank = (host, bits, make) => {
  const made = [];
  host.replaceChildren(...octalGroups(bits).map(group => {
    const box = createElement("bit-group");
    box.append(...group.map(bit => {
      const element = make(bit);
      made[bit] = element;
      return element;
    }));
    return box;
  }));
  return made;
};

// ------------------------------------------------------------------- machine

const memory = new Uint8Array(0x10000);

const state = {
  power: false,
  running: false,
  address: 0, // the front panel address register
  clock: 2_000_000, // Hz; the Altair shipped at 2 MHz
  lastOut: null,
};

const io = {
  input(port) {
    // IN FF reads the sense switches: the upper eight toggles of the bank.
    if (port === 0xff) return switchWord() >> 8;
    return 0x00;
  },
  output(port, value) {
    state.lastOut = { port, value };
  },
};

const cpu = new I8080(memory, io);

// ------------------------------------------------------------------ the lamps

const statusLamps = STATUS_LAMPS.map(([label]) =>
  createElement("display-bit", { label }));
const waitLamp = createElement("display-bit", { label: "WAIT" });
const hldaLamp = createElement("display-bit", { label: "HLDA" });

/** The status lamps are one group apiece rather than an octal bank. */
const lampGroup = (host, lamps) => {
  const group = createElement("bit-group");
  group.append(...lamps);
  host.replaceChildren(group);
};

lampGroup($("#status-lamps"), statusLamps);
lampGroup($("#wait-lamps"), [waitLamp, hldaLamp]);

const dataLamps = buildBank($("#data-lamps"), [7, 6, 5, 4, 3, 2, 1, 0], bit =>
  createElement("display-bit", { label: `D${bit}` }));

const addressLamps = buildBank($("#address-lamps"), [...Array(16).keys()].reverse(), bit =>
  createElement("display-bit", { label: `A${bit}` }));

// --------------------------------------------------------------- the switches

const dataSwitches = buildBank($("#data-switches"), [...Array(16).keys()].reverse(), bit => {
  const element = createElement("toggle-switch", { value: "down" });
  element.setAttribute("label", String(bit));
  return element;
});

const switchWord = () => dataSwitches.reduce((word, element, bit) =>
  word | (element.bit << bit), 0);

const controls = {};
$("#control-switches").replaceChildren(...CONTROLS.map(spec => {
  const element = createElement("toggle-switch");
  element.setAttribute("up", spec.up);
  if (spec.down) element.setAttribute("down", spec.down);
  if (spec.maintained) element.setAttribute("value", "down");
  else element.setAttribute("momentary", "");
  element.addEventListener("action", event => actuate(spec.id, event.detail.direction));
  controls[spec.id] = element;
  return element;
}));

// ------------------------------------------------------------- lamp rendering

const accAddress = new Uint32Array(16);
const accData = new Uint32Array(8);
const accStatus = new Uint32Array(STATUS_LAMPS.length);
let samples = 0;

/** Called once per bus cycle while the machine runs. */
const accumulate = machine => {
  const { addrBus, dataBus, status } = machine;
  for (let bit = 0; bit < 16; bit++) if (addrBus & (1 << bit)) accAddress[bit]++;
  for (let bit = 0; bit < 8; bit++) if (dataBus & (1 << bit)) accData[bit]++;
  for (let i = 0; i < STATUS_LAMPS.length; i++) if (status & STATUS_LAMPS[i][1]) accStatus[i]++;
  samples++;
};

const clearAccumulators = () => {
  accAddress.fill(0);
  accData.fill(0);
  accStatus.fill(0);
  samples = 0;
};

/** Lamps burn at their duty cycle over the frame, the way real ones do. */
const paintAveraged = () => {
  if (!samples) return;
  for (let bit = 0; bit < 16; bit++) addressLamps[bit].intensity = accAddress[bit] / samples;
  for (let bit = 0; bit < 8; bit++) dataLamps[bit].intensity = accData[bit] / samples;
  for (let i = 0; i < statusLamps.length; i++) statusLamps[i].intensity = accStatus[i] / samples;
  waitLamp.intensity = 0;
  hldaLamp.intensity = 0;
};

/** Lamps while the machine sits in WAIT, showing the address register. */
const paintStopped = () => {
  if (!state.power) return paintDark();
  const address = state.address;
  const byte = memory[address];
  let status = STATUS.MEMR | STATUS.WO;
  if (address === cpu.pc) status |= STATUS.M1;
  if (cpu.inte) status |= STATUS.INTE;
  if (cpu.protect) status |= STATUS.PROT;
  if (cpu.halted) status |= STATUS.HLTA;

  for (let bit = 0; bit < 16; bit++) addressLamps[bit].intensity = (address >> bit) & 1;
  for (let bit = 0; bit < 8; bit++) dataLamps[bit].intensity = (byte >> bit) & 1;
  for (let i = 0; i < statusLamps.length; i++) {
    statusLamps[i].intensity = status & STATUS_LAMPS[i][1] ? 1 : 0;
  }
  waitLamp.intensity = 1;
  hldaLamp.intensity = 0;
};

const paintDark = () => {
  for (const lamp of [...addressLamps, ...dataLamps, ...statusLamps, waitLamp, hldaLamp]) {
    lamp.intensity = 0;
  }
};

// ------------------------------------------------------------ panel operations

const announce = message => { $("#announce").textContent = message; };

const setPower = on => {
  state.power = on;
  state.running = false;
  $("#panel").dataset.power = on ? "on" : "off";
  for (const [id, element] of Object.entries(controls)) {
    if (id !== "power") element.disabled = !on;
  }
  for (const element of dataSwitches) element.disabled = !on;
  if (on) {
    state.address = cpu.pc;
    paintStopped();
  } else {
    paintDark();
  }
  announce(on ? "Power on. Machine stopped." : "Power off.");
  refreshMonitor();
};

const stop = () => {
  if (!state.running) return;
  state.running = false;
  state.address = cpu.pc;
  paintStopped();
  announce("Stopped.");
};

const start = () => {
  if (!state.power || state.running) return;
  state.running = true;
  clearAccumulators();
  announce("Running.");
};

const singleStep = () => {
  stop();
  cpu.step();
  state.address = cpu.pc;
  paintStopped();
};

const deposit = value => {
  if (cpu.protected(state.address)) {
    announce(`Address ${hex(state.address, 4)} is protected; deposit ignored.`);
    return;
  }
  memory[state.address] = value;
  announce(`Deposited ${hex(value, 2)} at ${hex(state.address, 4)}.`);
};

function actuate(id, direction) {
  if (id === "power") return setPower(direction === "up");
  if (!state.power) return;

  switch (id) {
    case "run":
      if (direction === "down") start(); else stop();
      break;

    case "step":
      if (direction === "up") singleStep();
      break;

    case "examine":
      stop();
      state.address = direction === "up" ? switchWord() : (state.address + 1) & 0xffff;
      cpu.pc = state.address;
      cpu.halted = false;
      paintStopped();
      announce(`Examining ${hex(state.address, 4)}.`);
      break;

    case "deposit":
      stop();
      if (direction === "down") {
        state.address = (state.address + 1) & 0xffff;
        cpu.pc = state.address;
      }
      deposit(switchWord() & 0xff);
      paintStopped();
      break;

    case "reset":
      if (direction === "up") {
        stop();
        cpu.reset();
        state.address = 0;
        paintStopped();
        announce("Reset. Program counter is zero.");
      } else {
        state.lastOut = null; // CLR clears the I/O side
        announce("I/O cleared.");
      }
      break;

    case "protect":
      cpu.protect = direction === "up";
      // A real PROTECT switch protects the memory board holding the address
      // register - 4K of it, on the boards of the day.
      cpu.protectFrom = state.address & 0xf000;
      cpu.protectTo = cpu.protectFrom + 0x1000;
      paintStopped();
      announce(cpu.protect
        ? `Protected ${hex(cpu.protectFrom, 4)}-${hex(cpu.protectTo - 1, 4)}.`
        : "Memory unprotected.");
      break;
  }
  refreshMonitor();
}

// ------------------------------------------------------------------- the clock

let previous = 0;

const frame = now => {
  requestAnimationFrame(frame);
  const elapsed = Math.min((now - previous) / 1000, 0.1);
  previous = now;
  if (!state.running) return;

  clearAccumulators();
  cpu.sample = accumulate;
  cpu.run(Math.round(state.clock * elapsed));
  cpu.sample = null;
  paintAveraged();
  state.address = cpu.pc;
};

requestAnimationFrame(now => { previous = now; frame(now); });

// ------------------------------------------------------------ operator's desk

const monitor = $("#monitor");

function refreshMonitor() {
  const flags = [
    cpu.fs ? "S" : "·", cpu.fz ? "Z" : "·", cpu.fac ? "A" : "·",
    cpu.fp ? "P" : "·", cpu.fcy ? "C" : "·",
  ].join("");

  const rows = [];
  for (let row = 0; row < 4; row++) {
    const base = (state.address + row * 8) & 0xffff;
    const bytes = [...Array(8).keys()]
      .map(i => hex(memory[(base + i) & 0xffff], 2)).join(" ");
    rows.push(`${hex(base, 4)}  ${bytes}`);
  }

  monitor.textContent = [
    `PC ${hex(cpu.pc, 4)}   SP ${hex(cpu.sp, 4)}   A ${hex(cpu.r[7], 2)}   F ${flags}`,
    `B ${hex(cpu.r[0], 2)} C ${hex(cpu.r[1], 2)}   D ${hex(cpu.r[2], 2)} E ${hex(cpu.r[3], 2)}   H ${hex(cpu.r[4], 2)} L ${hex(cpu.r[5], 2)}`,
    `ADDR ${hex(state.address, 4)}   SWITCHES ${hex(switchWord(), 4)}   SENSE ${hex(switchWord() >> 8, 2)}`,
    `STATE ${state.power ? (state.running ? "RUN" : "WAIT") : "OFF"}${cpu.halted ? " · HALTED" : ""}${cpu.protect ? " · PROT" : ""}`,
    "",
    ...rows,
  ].join("\n");
}

setInterval(refreshMonitor, 150);

// Program loader ------------------------------------------------------------

const listing = $("#listing");

const load = program => {
  memory.fill(0, program.origin, program.origin + program.bytes.length);
  memory.set(program.bytes, program.origin);
  stop();
  cpu.reset();
  cpu.pc = program.start;
  state.address = program.start;
  if (state.power) paintStopped();
  listing.replaceChildren(
    createElement("p", { className: "blurb", textContent: program.blurb }),
    createElement("pre", { className: "monitor", textContent: program.listing.join("\n") }),
    createElement("p", {
      className: "blurb",
      textContent: `${program.bytes.length} bytes at ${hex(program.origin, 4)}. ` +
        `Address register set to ${hex(program.start, 4)} - flick RUN when you are ready.`,
    }),
  );
  announce(`Loaded ${program.name}.`);
  refreshMonitor();
};

$("#programs").replaceChildren(...PROGRAMS.map(program =>
  createElement("button", {
    className: "load",
    type: "button",
    textContent: program.name,
    onclick: () => load(program),
  })));

$("#clock").addEventListener("change", event => {
  state.clock = Number(event.target.value);
});

$("#clear-memory").addEventListener("click", () => {
  memory.fill(0);
  stop();
  cpu.reset();
  state.address = 0;
  if (state.power) paintStopped();
  listing.replaceChildren();
  announce("Memory cleared.");
  refreshMonitor();
});

// Boot the page with the panel cold and the famous program ready to go.
load(PROGRAMS[0]);
setPower(false);
