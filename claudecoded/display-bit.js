/**
 * <display-bit label="A15" on></display-bit>
 *
 * One lamp on a front panel: a captioned indicator that is lit or dark.
 *
 * Attributes / properties
 *   label      caption rendered above the lamp
 *   on         boolean, lamp fully lit
 *   intensity  0..1, how brightly the lamp burns. Real panel lamps flicker far
 *              faster than the eye can follow, so a running machine sets a
 *              fractional intensity (the duty cycle over the last frame) and
 *              the lamp glows at that brightness, just like the original.
 *   color      CSS colour of the lit lamp (default: a warm Altair red)
 *
 * Styling hooks: --bit-size, --bit-color, --bit-gap, ::part(label|lamp)
 */

const createElement = (tag, props = {}) => Object.assign(document.createElement(tag), props);

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: var(--bit-gap, .5em);
    font: 600 var(--bit-font-size, 10px)/1 var(--panel-font, ui-sans-serif, system-ui, sans-serif);
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--bit-label-color, #e7edf3);
    -webkit-user-select: none;
    user-select: none;
  }
  :host([hidden]) { display: none; }

  /* Undefined custom elements rather than spans, and inline by default, so
     both are given a display here. */
  bit-label {
    display: block;
    white-space: nowrap;
    opacity: .82;
  }

  bit-lamp {
    display: block;
    position: relative;
    width: var(--bit-size, 14px);
    height: var(--bit-size, 14px);
    border-radius: 50%;
    background:
      radial-gradient(circle at 35% 28%, #6d2320 0%, #401210 55%, #250a09 100%);
    box-shadow:
      inset 0 0 0 1px rgba(0, 0, 0, .55),
      inset 0 -1px 2px rgba(255, 255, 255, .12),
      0 1px 2px rgba(0, 0, 0, .5);
  }

  /* The lit filament, faded in by --i rather than swapped out, so partial
     intensities render as a genuinely dimmer lamp. */
  bit-lamp::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background:
      radial-gradient(circle at 35% 28%, #fff1ec 0%, var(--bit-color, #ff4326) 46%, #ad1206 100%);
    box-shadow: 0 0 calc(var(--bit-size, 14px) * .85) calc(var(--bit-size, 14px) * .16) rgba(255, 70, 40, .7);
    opacity: var(--i, 0);
    transition: opacity var(--bit-fade, 70ms) linear;
  }

  @media (prefers-reduced-motion: reduce) {
    bit-lamp::after { transition: none; }
  }
`);

class DisplayBit extends HTMLElement {
  static observedAttributes = ["label", "on", "intensity", "color"];

  #label = createElement("bit-label", { part: "label" });
  #lamp = createElement("bit-lamp", { part: "lamp" });
  #intensity = 0;

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).adoptedStyleSheets = [sheet];
    this.shadowRoot.append(this.#label, this.#lamp);
  }

  attributeChangedCallback(name, _old, value) {
    if (name === "label") this.#label.textContent = value ?? "";
    else if (name === "on") {
      // Guarded so that clearing a stale attribute cannot douse a lamp that is
      // being driven through `intensity` directly.
      if (value !== null) this.intensity = 1;
      else if (this.#intensity === 1) this.intensity = 0;
    }
    else if (name === "intensity") this.intensity = parseFloat(value) || 0;
    else if (name === "color") this.style.setProperty("--bit-color", value ?? "");
  }

  /** Lit or dark; stays in step with `intensity` in both directions. */
  get on() { return this.#intensity > 0; }
  set on(value) { this.toggleAttribute("on", !!value); }

  /** How brightly the lamp burns, 0..1. Cheap enough to set every frame. */
  get intensity() { return this.#intensity; }
  set intensity(value) {
    const i = value > 1 ? 1 : value < 0 ? 0 : +value || 0;
    if (i === this.#intensity) return;
    this.#intensity = i;
    this.#lamp.style.setProperty("--i", i);
    if (i !== 1 && this.hasAttribute("on")) this.removeAttribute("on");
  }

  get label() { return this.getAttribute("label") ?? ""; }
  set label(value) { this.setAttribute("label", value); }
}

customElements.define("display-bit", DisplayBit);

export { DisplayBit };
