/**
 * <toggle-switch up="EXAMINE" down="EXAMINE NEXT" momentary></toggle-switch>
 * <toggle-switch label="15" value="down"></toggle-switch>
 *
 * A paddle toggle switch, the kind you flick with a fingernail.
 *
 * Two flavours, because the Altair front panel has two:
 *   - maintained (default) - stays where you put it, `value` is "up" or "down",
 *     one click toggles. Exposed to assistive tech as a switch.
 *   - momentary - spring loaded, rests at "center" and springs back the moment
 *     you let go. Up and down are separate commands, so each gets its own
 *     button and its own accessible name.
 *
 * Attributes / properties
 *   label      caption above the switch (the bit number, on a data switch)
 *   up / down  the words printed above and below the paddle
 *   value      "up" | "center" | "down"
 *   momentary  boolean, spring return to center
 *   disabled   boolean
 *
 * Events
 *   change  value settled somewhere new (maintained switches)
 *   action  {detail: {direction}} the switch was flicked up or down. Fires for
 *           both flavours, so `action` alone is enough to drive a panel.
 *
 * Styling hooks: --switch-size, --panel-font, ::part(label|up|down|paddle|hit)
 */

const createElement = (tag, props = {}) => Object.assign(document.createElement(tag), props);

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host {
    --size: var(--switch-size, 30px);
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: .35em;
    width: var(--switch-width, auto);
    font: 600 var(--switch-font-size, 9px)/1.15 var(--panel-font, ui-sans-serif, system-ui, sans-serif);
    letter-spacing: .07em;
    text-transform: uppercase;
    text-align: center;
    color: var(--switch-label-color, #e7edf3);
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  :host([hidden]) { display: none; }
  :host([disabled]) { opacity: .45; }

  /* The internals are undefined custom elements rather than spans, so each one
     needs a display of its own before anything else applies. */
  switch-label, switch-legend { display: block; opacity: .85; min-height: 1.15em; }
  switch-label:empty, switch-legend:empty { min-height: 0; }
  switch-label { opacity: 1; letter-spacing: .1em; }

  /* The paddle leans towards or away from you, so perspective does the work
     rather than a flat rotation. */
  switch-stage {
    display: block;
    position: relative;
    width: calc(var(--size) * .72);
    height: var(--size);
    perspective: calc(var(--size) * 4);
  }

  /* Chrome bezel nut the paddle emerges from. */
  switch-bezel {
    display: block;
    position: absolute;
    left: 50%;
    bottom: 0;
    width: calc(var(--size) * .72);
    height: calc(var(--size) * .34);
    translate: -50% 0;
    border-radius: 50%;
    background: linear-gradient(180deg, #9aa2aa 0%, #5d646b 45%, #2f353a 100%);
    box-shadow: 0 1px 2px rgba(0, 0, 0, .6), inset 0 1px 1px rgba(255, 255, 255, .35);
  }

  switch-paddle {
    display: block;
    position: absolute;
    left: 50%;
    bottom: calc(var(--size) * .1);
    width: calc(var(--size) * .34);
    height: calc(var(--size) * .86);
    translate: -50% 0;
    transform-origin: 50% 100%;
    border-radius: 46% 46% 30% 30% / 30% 30% 12% 12%;
    background: linear-gradient(90deg, #5c6167 0%, #eef2f6 26%, #c3c9cf 56%, #7d848b 82%, #4c5155 100%);
    box-shadow: 0 1px 3px rgba(0, 0, 0, .55), inset 0 -2px 3px rgba(0, 0, 0, .35);
    transition: transform 90ms cubic-bezier(.2, .9, .3, 1.4);
    transform: rotateX(-4deg);
  }
  :host([value="up"]) switch-paddle { transform: rotateX(34deg) translateY(-4%); }
  :host([value="down"]) switch-paddle { transform: rotateX(-40deg) translateY(6%); }

  @media (prefers-reduced-motion: reduce) {
    switch-paddle { transition: none; }
  }

  /* Invisible hit targets laid over the paddle: one per direction for a
     momentary switch, one for the whole thing otherwise. */
  switch-hits { position: absolute; inset: calc(var(--size) * -.12) -12%; display: flex; flex-direction: column; }
  .hit {
    flex: 1;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    border-radius: 3px;
  }
  .hit:focus-visible {
    outline: 2px solid var(--switch-focus, #6cc6ff);
    outline-offset: 1px;
  }
  :host([disabled]) .hit { cursor: not-allowed; }
`);

class ToggleSwitch extends HTMLElement {
  static observedAttributes = ["label", "up", "down", "value", "momentary", "disabled"];

  #label = createElement("switch-label", { part: "label" });
  #up = createElement("switch-legend", { part: "up" });
  #down = createElement("switch-legend", { part: "down" });
  #hits = createElement("switch-hits");
  #held = null;
  #clickPending = 0;

  constructor() {
    super();
    const stage = createElement("switch-stage");
    stage.append(
      createElement("switch-bezel", { part: "bezel" }),
      createElement("switch-paddle", { part: "paddle" }),
      this.#hits,
    );
    this.attachShadow({ mode: "open" }).adoptedStyleSheets = [sheet];
    this.shadowRoot.append(this.#label, this.#up, stage, this.#down);

    this.#hits.addEventListener("pointerdown", this.#onPointerDown);
    this.#hits.addEventListener("keydown", this.#onKeyDown);
    this.#hits.addEventListener("keyup", this.#onKeyUp);
    this.#hits.addEventListener("click", this.#onClick);
  }

  connectedCallback() {
    if (!this.hasAttribute("value")) this.setAttribute("value", this.momentary ? "center" : "down");
    this.#renderHits();
  }

  attributeChangedCallback(name, old, value) {
    if (name === "label") this.#label.textContent = value ?? "";
    else if (name === "up") this.#up.textContent = value ?? "";
    else if (name === "down") this.#down.textContent = value ?? "";
    else if (name === "momentary" || name === "disabled") this.#renderHits();
    else if (name === "value" && old !== value) this.#renderHits();
  }

  // --- state -----------------------------------------------------------------

  get value() { return this.getAttribute("value") ?? "center"; }
  set value(v) { this.setAttribute("value", v); }

  get momentary() { return this.hasAttribute("momentary"); }
  set momentary(v) { this.toggleAttribute("momentary", !!v); }

  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(v) { this.toggleAttribute("disabled", !!v); }

  /** Up is 1, down is 0 - handy for the sixteen data switches. */
  get bit() { return this.value === "up" ? 1 : 0; }
  set bit(v) { this.value = v ? "up" : "down"; }

  // --- rendering -------------------------------------------------------------

  #renderHits() {
    const directions = this.momentary
      ? [this.getAttribute("up") !== null && "up", this.getAttribute("down") !== null && "down"].filter(Boolean)
      : ["toggle"];
    const wanted = directions.join(" ");
    if (this.#hits.dataset.shape !== wanted) {
      this.#hits.dataset.shape = wanted;
      this.#hits.replaceChildren(...directions.map(direction => {
        // `dataset` is read only, so it cannot ride along in createElement.
        const hit = createElement("button", { className: "hit", part: "hit", type: "button" });
        hit.dataset.direction = direction;
        return hit;
      }));
    }
    const name = this.getAttribute("label") || this.getAttribute("up") || "switch";
    for (const hit of this.#hits.children) {
      const { direction } = hit.dataset;
      hit.disabled = this.disabled;
      if (direction === "toggle") {
        hit.setAttribute("role", "switch");
        hit.setAttribute("aria-checked", String(this.value === "up"));
        hit.setAttribute("aria-label", name);
      } else {
        hit.removeAttribute("role");
        hit.removeAttribute("aria-checked");
        hit.setAttribute("aria-label", this.getAttribute(direction) || direction);
      }
    }
  }

  // --- interaction -----------------------------------------------------------

  /** Which way this hit target throws the paddle. A maintained switch has a
      single target that simply goes the other way. */
  #directionFor(hit) {
    if (hit.dataset.direction !== "toggle") return hit.dataset.direction;
    return this.value === "up" ? "down" : "up";
  }

  #onPointerDown = event => {
    const hit = event.target.closest(".hit");
    if (!hit || this.disabled || event.button !== 0) return;
    event.preventDefault();
    const direction = this.#directionFor(hit);
    this.#flick(direction);
    this.#clickPending = event.timeStamp;
    if (this.momentary) {
      this.#held = direction;
      try { hit.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
      const release = () => {
        hit.removeEventListener("pointerup", release);
        hit.removeEventListener("pointercancel", release);
        this.#release();
      };
      hit.addEventListener("pointerup", release);
      hit.addEventListener("pointercancel", release);
    }
    hit.focus();
  };

  #onKeyDown = event => {
    const hit = event.target.closest(".hit");
    if (!hit || this.disabled) return;
    let direction = null;
    if (event.key === "ArrowUp") direction = "up";
    else if (event.key === "ArrowDown") direction = "down";
    else if (event.key === " " || event.key === "Enter") {
      direction = this.#directionFor(hit);
    }
    if (!direction || (this.momentary && this.#held === direction)) return;
    event.preventDefault();
    this.#flick(direction);
    // Enter and space also produce a click; the arrow keys do not.
    if (event.key === " " || event.key === "Enter") this.#clickPending = event.timeStamp;
    if (this.momentary) this.#held = direction;
  };

  /* Assistive technology activates a button by dispatching a bare click, with
     no pointer or key sequence behind it. Honour that, but ignore the click
     that trails a flick we have already handled. */
  #onClick = event => {
    const hit = event.target.closest(".hit");
    if (!hit || this.disabled) return;
    // Swallow exactly the one click that trails a flick we already handled,
    // and only if it arrives promptly. Anything else is a real activation.
    if (this.#clickPending && event.timeStamp - this.#clickPending < 1000) {
      this.#clickPending = 0;
      return;
    }
    const direction = this.#directionFor(hit);
    this.#clickPending = 0;
    this.#flick(direction);
    if (this.momentary) {
      this.#held = direction;
      setTimeout(() => this.#release(), 140);
    }
  };

  #onKeyUp = event => {
    if (this.momentary && this.#held && (event.key === " " || event.key === "Enter" ||
      event.key === "ArrowUp" || event.key === "ArrowDown")) this.#release();
  };

  #flick(direction) {
    const changed = this.value !== direction;
    this.value = direction;
    this.dispatchEvent(new CustomEvent("action", { bubbles: true, detail: { direction } }));
    if (changed && !this.momentary) {
      this.dispatchEvent(new CustomEvent("change", { bubbles: true, detail: { value: direction } }));
    }
  }

  #release() {
    if (!this.#held) return;
    this.#held = null;
    this.value = "center";
  }
}

customElements.define("toggle-switch", ToggleSwitch);

export { ToggleSwitch };
