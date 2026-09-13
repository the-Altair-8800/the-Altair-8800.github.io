/**
 * The main Altair 8800 front-panel component.
 *
 * This file is a useful example of a composition-based Web Component. Instead of
 * writing hundreds of nested `<div>` elements in the page, the component builds a
 * panel from smaller, self-contained custom elements (`<display-bit-led>` and
 * `<toggle-switch>`).
 *
 * The concept behind the component is straightforward:
 * - the element owns its own Shadow DOM tree
 * - it applies a stylesheet via `adoptedStyleSheets`
 * - it instantiates child custom elements to build the front panel
 * - it listens to events and synchronizes them with the machine state
 *
 * In Web Components terms, this is a higher-level component that composes many
 * smaller parts, which is a common pattern in modern UI architectures.
 */

import { I8080, STATUS } from "./i8080.js";
import { PROGRAMS } from "./programs.js";
import { debounce, createElement } from "./elements-shared-code.js";
import panelStyles from "./altair-8800-panel.css" with { type: "css" };
import globalStyles from "./index-styles.css" with { type: "css" };

const STRIP_UI_HACK = true; // hide content Claude Code create, easier than stripping it

const hex = (v, width) => v.toString(16).toUpperCase().padStart(width, "0");
const GROUPED_BANK = "grouped-bank";

// Lamps in the status row, left to right, with the status bit each one watches.
const STATUS_LAMPS = [
  ["INTE", STATUS.INTE],
  ["PROT", STATUS.PROT],
  ["MEMR", STATUS.MEMR],
  ["INP", STATUS.INP],
  ["M1", STATUS.M1],
  ["OUT", STATUS.OUT],
  ["HLTA", STATUS.HLTA],
  ["STACK", STATUS.STACK],
  ["WO", STATUS.WO],
  ["INT", STATUS.INT],
];

// Control switches, left to right. Every one but the power switch is spring
// loaded, exactly like the real paddles.
const CONTROLS = [
  { id: "power", up: "ON", down: "OFF", maintained: true, className: "power" },
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
const octalGroups = (bits) => {
  const groups = [];
  let run = [];
  let key = null;
  for (const bit of bits) {
    const next = Math.floor(bit / 3);
    if (next !== key && run.length) {
      groups.push(run);
      run = [];
    }
    key = next;
    run.push(bit);
  }
  if (run.length) groups.push(run);
  return groups;
};

/** Fill `host` with one octal-grouped bank of elements, highest bit first. */
const buildBank = (host, bits, make) => {
  const made = [];
  host.replaceChildren(
    ...octalGroups(bits).map((group) => {
      return createElement(GROUPED_BANK, {
        append: [...group.map((bit) => (made[bit] = make(bit)))],
      });
    }),
  );
  return made;
};

if (!customElements.get("altair-8800")) {
  customElements.define(
    "altair-8800",
    class Altair8800 extends HTMLElement {
      /**
       * `observedAttributes` lets the browser tell the element when a public
       * attribute changes. For a component like this, the power and clock values
       * are configuration inputs: the page can set them declaratively, and the
       * component can respond by updating the CPU and the panel state.
       */
      static get observedAttributes() {
        return ["power", "clock"];
      }

      constructor() {
        Object.assign(super(), {
          _initialised: false,
          _memory: new Uint8Array(0x10000),
          _state: {
            power: false,
            running: false,
            address: 0,
            clock: 2_000_000,
            lastOut: null,
          },
          _io: {
            input: (port) => {
              if (port === 0xff) return this.switchWord() >> 8;
              return 0x00;
            },
            output: (port, value) => {
              this._state.lastOut = { port, value };
            },
          },
          _refs: {},
          _accAddress: new Uint32Array(16),
          _accData: new Uint32Array(8),
          _accStatus: new Uint32Array(STATUS_LAMPS.length),
          _samples: 0,
          _previousFrame: 0,
          _monitorTimer: null,
          _rafHandle: null,
        });
        this._cpu = new I8080(this._memory, this._io);
      }

      get cpu() {
        return this._cpu;
      }

      get memory() {
        return this._memory;
      }

      get state() {
        return this._state;
      }

      connectedCallback() {
        if (this._initialised) return;
        this._initialised = true;
        this._buildPanel();
        this._wireUpMachine();
        this._attachOptionalPageControls();
        this.loadProgram(PROGRAMS[0]);
        this._setPower(true);
      }

      _attachOptionalPageControls() {
        const controls = {
          clock: document.querySelector("#clock"),
          clear: document.querySelector("#clear-memory"),
          announce: document.querySelector("#announce"),
          monitor: document.querySelector("#monitor"),
        };

        if (controls.clock && controls.clock !== this._refs.clock) {
          controls.clock.addEventListener("change", (event) => {
            this._state.clock = Number(event.target.value);
          });
        }

        if (controls.clear && controls.clear !== this._refs.clear) {
          controls.clear.addEventListener(
            "click",
            debounce(() => {
              this._memory.fill(0);
              this.stop();
              this._cpu.reset();
              this._state.address = 0;
              if (this._state.power) this.paintStopped();
              this.announce("Memory cleared.");
              this.refreshMonitor();
            }, 150),
          );
        }
      }

      disconnectedCallback() {
        if (this._rafHandle) cancelAnimationFrame(this._rafHandle);
        if (this._monitorTimer) clearInterval(this._monitorTimer);
        this._rafHandle = null;
        this._monitorTimer = null;
      }

      /**
       * Build the panel in the Shadow DOM.
       *
       * `attachShadow({ mode: "open" })` creates an isolated document fragment.
       * Styles assigned there do not leak into the page, and page styles do not
       * leak into the component. This is the canonical Shadow DOM encapsulation
       * pattern used by Web Components.
       */
      _buildPanel() {
        if (!this.shadowRoot) {
          this.attachShadow({ mode: "open" });
        }

        const titleBadge = createElement("title-badge", {
          append: [
            createElement("span", { className: "mits", textContent: "mits" }),
            createElement("span", {
              className: "model",
              textContent: "Altair 8800 Computer",
            }),
          ],
        });

        const statusRowLeft = createElement("status-row-left", {
          append: [
            createElement("status-lamps", { className: "bank" }),
            createElement("wait-lamps", { className: "bank" }),
          ],
        });

        const statusRow = createElement("status-row", {
          className: "row",
          append: [
            statusRowLeft,
            createElement("data-lamps", { className: "bank" }),
          ],
        });

        const addressRow = createElement("address-row", {
          className: "row",
          append: [createElement("address-lamps", { className: "bank" })],
        });

        const switchesRow = createElement("switches-row", {
          className: "row",
          append: [
            createElement("control-switches"),
            createElement("data-switches", { className: "bank" }),
          ],
        });

        const frontPanel = createElement("front-panel", {
          attrs: { "data-power": "off" },
          append: [titleBadge, statusRow, addressRow, switchesRow],
        });

        /**
         * Shared stylesheets are a modern way to keep component CSS reusable.
         *
         * `adoptedStyleSheets` lets a Shadow Root adopt a CSSStyleSheet object
         * instead of injecting a string into the template. This is especially
         * useful for large front-panel layouts, because multiple elements can share
         * the same stylesheet while still keeping the internal styles scoped.
         */
        this.shadowRoot.adoptedStyleSheets = [globalStyles,panelStyles];
        this.shadowRoot.replaceChildren(frontPanel);
        this._refs.panel = frontPanel;
      }

      _wireUpMachine() {
        const statusLamps = STATUS_LAMPS.map(([label]) =>
          createElement("display-bit-led", { label }),
        );
        const waitLamp = createElement("display-bit-led", { label: "WAIT" });
        const hldaLamp = createElement("display-bit-led", { label: "HLDA" });
        const dataLamps = buildBank(
          this._refs.panel.querySelector("data-lamps") ??
            createElement("data-lamps", { className: "bank" }),
          [7, 6, 5, 4, 3, 2, 1, 0],
          (bit) => createElement("display-bit-led", { label: `D${bit}` }),
        );

        const addressLamps = buildBank(
          this._refs.panel.querySelector("address-lamps") ??
            createElement("address-lamps", { className: "bank" }),
          [...Array(16).keys()].reverse(),
          (bit) => createElement("display-bit-led", { label: `A${bit}` }),
        );

        const signalLamps = createElement("status-lamps", {
          className: "bank",
        });
        const waitLamps = createElement("wait-lamps", { className: "bank" });
        signalLamps.replaceChildren(
          createElement(GROUPED_BANK, { append: statusLamps }),
        );
        waitLamps.replaceChildren(
          createElement(GROUPED_BANK, { append: [waitLamp, hldaLamp] }),
        );

        const dataSwitches = buildBank(
          this._refs.panel.querySelector("data-switches") ??
            createElement("data-switches", { className: "bank" }),
          [...Array(16).keys()].reverse(),
          (bit) =>
            createElement("toggle-switch", {
              value: "down",
              attrs: { label: String(bit) },
            }),
        );

        const controlSwitches = createElement("control-switches");
        const controls = {};
        controlSwitches.replaceChildren(
          ...CONTROLS.map((spec) => {
            const element = (controls[spec.id] = createElement(
              "toggle-switch",
              {
                className: spec.className ?? "",
                attrs: { up: spec.up },
              },
            ));
            if (spec.down) element.setAttribute("down", spec.down);
            if (spec.maintained) element.setAttribute("value", "down");
            else element.setAttribute("momentary", "");
            element.addEventListener("action", (event) =>
              this.actuate(spec.id, event.detail.direction),
            );
            return element;
          }),
        );

        const statusRowLeft = this._refs.panel.querySelector("status-row-left");
        const statusRow = this._refs.panel.querySelector("status-row");
        const addressRow = this._refs.panel.querySelector("address-row");
        const switchesRow = this._refs.panel.querySelector("switches-row");

        statusRowLeft.replaceChildren(signalLamps, waitLamps);
        statusRow.replaceChildren(
          statusRowLeft,
          createElement("data-lamps", {
            className: "bank",
            append: [
              ...octalGroups([7, 6, 5, 4, 3, 2, 1, 0]).map((group) =>
                createElement(GROUPED_BANK, {
                  append: group.map((bit) => dataLamps[bit]),
                }),
              ),
            ],
          }),
        );
        addressRow.replaceChildren(
          createElement("address-lamps", {
            className: "bank",
            append: [
              ...octalGroups([...Array(16).keys()].reverse()).map((group) =>
                createElement(GROUPED_BANK, {
                  append: group.map((bit) => addressLamps[bit]),
                }),
              ),
            ],
          }),
        );
        switchesRow.replaceChildren(
          controlSwitches,
          createElement("data-switches", {
            className: "bank",
            append: [
              ...octalGroups([...Array(16).keys()].reverse()).map((group) =>
                createElement(GROUPED_BANK, {
                  append: group.map((bit) => dataSwitches[bit]),
                }),
              ),
            ],
          }),
        );

        this._refs = {
          panel: this._refs.panel,
          statusLamps,
          waitLamp,
          hldaLamp,
          dataLamps,
          addressLamps,
          dataSwitches,
          controls,
          announce: this._getOrCreateAnnounce(),
          monitor: this._getOrCreateMonitor(),
          clock: this._getOrCreateClock(),
          clear: this._getOrCreateClearButton(),
        };

        this._refs.monitor.textContent = "";
        this._refs.clock.addEventListener("change", (event) => {
          this._state.clock = Number(event.target.value);
        });
        this._refs.clear.addEventListener(
          "click",
          debounce(() => {
            this._memory.fill(0);
            this.stop();
            this._cpu.reset();
            this._state.address = 0;
            if (this._state.power) this.paintStopped();
            this.announce("Memory cleared.");
            this.refreshMonitor();
          }, 150),
        );

        this._startFrameLoop();
        this._monitorTimer = setInterval(() => this.refreshMonitor(), 150);
      }

      _getOrCreateAnnounce() {
        const existing = this.shadowRoot.querySelector("#announce");
        if (existing) return existing;
        const el = createElement("p", {
          hidden: STRIP_UI_HACK,
          attrs: { id: "announce", role: "status", "aria-live": "polite" },
          styles: { position: "absolute", left: "-9999px" },
        });
        this.shadowRoot.append(el);
        return el;
      }

      _getOrCreateMonitor() {
        const existing = this.shadowRoot.querySelector("#monitor");
        if (existing) return existing;
        const el = createElement("pre", {
          className: "monitor",
          attrs: { id: "monitor", "aria-label": "Machine state" },
        });
        this.shadowRoot.append(el);
        return el;
      }

      _getOrCreateClock() {
        const existing = this.shadowRoot.querySelector("#clock");
        if (existing) return existing;
        const el = createElement("select", {
          hidden: STRIP_UI_HACK,
          attrs: { id: "clock" },
          append: [
            createElement("option", {
              attrs: { value: "2000000", selected: "selected" },
              textContent: "2 MHz (as shipped)",
            }),
            createElement("option", {
              attrs: { value: "500000" },
              textContent: "500 kHz",
            }),
            createElement("option", {
              attrs: { value: "100000" },
              textContent: "100 kHz",
            }),
            createElement("option", {
              attrs: { value: "20000" },
              textContent: "20 kHz",
            }),
            createElement("option", {
              attrs: { value: "2000" },
              textContent: "2 kHz — watch it think",
            }),
          ],
        });
        this.shadowRoot.append(el);
        return el;
      }

      _getOrCreateClearButton() {
        const existing = this.shadowRoot.querySelector("#clear-memory");
        if (existing) return existing;
        const el = createElement("button", {
          hidden: STRIP_UI_HACK,
          attrs: { id: "clear-memory", type: "button" },
          textContent: "Clear all 64K",
        });
        this.shadowRoot.append(el);
        return el;
      }

      announce(message) {
        this._refs.announce.textContent = message;
      }

      switchWord() {
        return this._refs.dataSwitches.reduce(
          (word, element, bit) => word | (element.bit << bit),
          0,
        );
      }

      _setPower(on) {
        this._state.power = on;
        this._state.running = false;
        this._refs.panel.dataset.power = on ? "on" : "off";
        for (const [id, element] of Object.entries(this._refs.controls)) {
          if (id !== "power") element.disabled = !on;
        }
        for (const element of this._refs.dataSwitches) element.disabled = !on;
        if (on) {
          this._state.address = this._cpu.pc;
          this.paintStopped();
        } else {
          this.paintDark();
        }
        this.announce(on ? "Power on. Machine stopped." : "Power off.");
        this.refreshMonitor();
      }

      stop() {
        if (!this._state.running) return;
        this._state.running = false;
        this._state.address = this._cpu.pc;
        this.paintStopped();
        this.announce("Stopped.");
      }

      start() {
        if (!this._state.power || this._state.running) return;
        this._state.running = true;
        this.clearAccumulators();
        this.announce("Running.");
      }

      singleStep() {
        this.stop();
        this._cpu.step();
        this._state.address = this._cpu.pc;
        this.paintStopped();
      }

      deposit(value) {
        if (this._cpu.protected(this._state.address)) {
          this.announce(
            `Address ${hex(this._state.address, 4)} is protected; deposit ignored.`,
          );
          return;
        }
        this._memory[this._state.address] = value;
        this.announce(
          `Deposited ${hex(value, 2)} at ${hex(this._state.address, 4)}.`,
        );
      }

      actuate(id, direction) {
        if (id === "power") return this._setPower(direction === "up");
        if (!this._state.power) return;

        switch (id) {
          case "run":
            if (direction === "down") this.start();
            else this.stop();
            break;
          case "step":
            if (direction === "up") this.singleStep();
            break;
          case "examine":
            this.stop();
            this._state.address =
              direction === "up"
                ? this.switchWord()
                : (this._state.address + 1) & 0xffff;
            this._cpu.pc = this._state.address;
            this._cpu.halted = false;
            this.paintStopped();
            this.announce(`Examining ${hex(this._state.address, 4)}.`);
            break;
          case "deposit":
            this.stop();
            if (direction === "down") {
              this._state.address = (this._state.address + 1) & 0xffff;
              this._cpu.pc = this._state.address;
            }
            this.deposit(this.switchWord() & 0xff);
            this.paintStopped();
            break;
          case "reset":
            if (direction === "up") {
              this.stop();
              this._cpu.reset();
              this._state.address = 0;
              this.paintStopped();
              this.announce("Reset. Program counter is zero.");
            } else {
              this._state.lastOut = null;
              this.announce("I/O cleared.");
            }
            break;
          case "protect":
            this._cpu.protect = direction === "up";
            this._cpu.protectFrom = this._state.address & 0xf000;
            this._cpu.protectTo = this._cpu.protectFrom + 0x1000;
            this.paintStopped();
            this.announce(
              this._cpu.protect
                ? `Protected ${hex(this._cpu.protectFrom, 4)}-${hex(this._cpu.protectTo - 1, 4)}.`
                : "Memory unprotected.",
            );
            break;
        }
        this.refreshMonitor();
      }

      clearAccumulators() {
        this._accAddress.fill(0);
        this._accData.fill(0);
        this._accStatus.fill(0);
        this._samples = 0;
      }

      accumulate(machine) {
        const { addrBus, dataBus, status } = machine;
        for (let bit = 0; bit < 16; bit++)
          if (addrBus & (1 << bit)) this._accAddress[bit]++;
        for (let bit = 0; bit < 8; bit++)
          if (dataBus & (1 << bit)) this._accData[bit]++;
        for (let i = 0; i < STATUS_LAMPS.length; i++)
          if (status & STATUS_LAMPS[i][1]) this._accStatus[i]++;
        this._samples++;
      }

      paintAveraged() {
        if (!this._samples) return;
        for (let bit = 0; bit < 16; bit++)
          this._refs.addressLamps[bit].intensity =
            this._accAddress[bit] / this._samples;
        for (let bit = 0; bit < 8; bit++)
          this._refs.dataLamps[bit].intensity =
            this._accData[bit] / this._samples;
        for (let i = 0; i < this._refs.statusLamps.length; i++)
          this._refs.statusLamps[i].intensity =
            this._accStatus[i] / this._samples;
        this._refs.waitLamp.intensity = 0;
        this._refs.hldaLamp.intensity = 0;
      }

      paintStopped() {
        if (!this._state.power) return this.paintDark();
        const address = this._state.address;
        const byte = this._memory[address];
        let status = STATUS.MEMR | STATUS.WO;
        if (address === this._cpu.pc) status |= STATUS.M1;
        if (this._cpu.inte) status |= STATUS.INTE;
        if (this._cpu.protect) status |= STATUS.PROT;
        if (this._cpu.halted) status |= STATUS.HLTA;

        for (let bit = 0; bit < 16; bit++)
          this._refs.addressLamps[bit].intensity = (address >> bit) & 1;
        for (let bit = 0; bit < 8; bit++)
          this._refs.dataLamps[bit].intensity = (byte >> bit) & 1;
        for (let i = 0; i < this._refs.statusLamps.length; i++) {
          this._refs.statusLamps[i].intensity =
            status & STATUS_LAMPS[i][1] ? 1 : 0;
        }
        this._refs.waitLamp.intensity = 1;
        this._refs.hldaLamp.intensity = 0;
      }

      paintDark() {
        for (const lamp of [
          ...this._refs.addressLamps,
          ...this._refs.dataLamps,
          ...this._refs.statusLamps,
          this._refs.waitLamp,
          this._refs.hldaLamp,
        ]) {
          lamp.intensity = 0;
        }
      }

      _startFrameLoop() {
        const frame = (now) => {
          this._rafHandle = requestAnimationFrame(frame);
          const elapsed = Math.min((now - this._previousFrame) / 1000, 0.1);
          this._previousFrame = now;
          if (!this._state.running) return;

          this.clearAccumulators();
          this._cpu.sample = (machine) => this.accumulate(machine);
          this._cpu.run(Math.round(this._state.clock * elapsed));
          this._cpu.sample = null;
          this.paintAveraged();
          this._state.address = this._cpu.pc;
        };

        this._previousFrame = performance.now();
        this._rafHandle = requestAnimationFrame(frame);
      }

      refreshMonitor() {
        const flags = [
          this._cpu.fs ? "S" : "·",
          this._cpu.fz ? "Z" : "·",
          this._cpu.fac ? "A" : "·",
          this._cpu.fp ? "P" : "·",
          this._cpu.fcy ? "C" : "·",
        ].join("");

        const rows = [];
        for (let row = 0; row < 4; row++) {
          const base = (this._state.address + row * 8) & 0xffff;
          const bytes = [...Array(8).keys()]
            .map((i) => hex(this._memory[(base + i) & 0xffff], 2))
            .join(" ");
          rows.push(`${hex(base, 4)}  ${bytes}`);
        }

        return;

        this._refs.monitor.textContent = [
          `PC ${hex(this._cpu.pc, 4)}   SP ${hex(this._cpu.sp, 4)}   A ${hex(this._cpu.r[7], 2)}   F ${flags}`,
          `B ${hex(this._cpu.r[0], 2)} C ${hex(this._cpu.r[1], 2)}   D ${hex(this._cpu.r[2], 2)} E ${hex(this._cpu.r[3], 2)}   H ${hex(this._cpu.r[4], 2)} L ${hex(this._cpu.r[5], 2)}`,
          `ADDR ${hex(this._state.address, 4)}   SWITCHES ${hex(this.switchWord(), 4)}   SENSE ${hex(this.switchWord() >> 8, 2)}`,
          `STATE ${this._state.power ? (this._state.running ? "RUN" : "WAIT") : "OFF"}${this._cpu.halted ? " · HALTED" : ""}${this._cpu.protect ? " · PROT" : ""}`,
          "",
          ...rows,
        ].join("\n");
      }

      loadProgram(program) {
        this._memory.fill(
          0,
          program.origin,
          program.origin + program.bytes.length,
        );
        this._memory.set(program.bytes, program.origin);
        this.stop();
        this._cpu.reset();
        this._cpu.pc = program.start;
        this._state.address = program.start;
        if (this._state.power) this.paintStopped();
        // Program list UI removed; panel now loads the selected program directly.
        this.announce(`Loaded ${program.name}.`);
        this.refreshMonitor();
      }
    },
  );
}
