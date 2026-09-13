/**
 * A single front-panel lamp rendered as a Web Component.
 *
 * Web Components are built from a few browser standards that work together:
 * `HTMLElement`, `customElements.define()`, and Shadow DOM. The key idea is that
 * a component can encapsulate both markup and style, while still participating
 * in the page like any other HTML element.
 *
 * This element demonstrates a very common pattern:
 * - it creates a Shadow DOM subtree
 * - it defines a few attributes for configuration
 * - it reacts to attribute changes via `attributeChangedCallback()`
 * - it exposes CSS variables for styling via `::part()` and custom properties
 *
 * Example:
 * ```html
 * <display-bit-led label="A15" on></display-bit-led>
 * ```
 */
import { debounce, createElement } from "./elements-shared-code.js";
import displayBitStyles from "./altair-display-bit-led.css" with { type: "css" };

/**
 * `customElements.define()` is the browser API that turns a class into a real
 * HTML tag. A class extending `HTMLElement` becomes a component once registered.
 *
 * The browser keeps a registry of element names and constructor classes, so it
 * can create them later from HTML markup or from JavaScript.
 */
customElements.define(
  "display-bit-led",
  class extends HTMLElement {
    /**
     * `observedAttributes` tells the browser which attributes should trigger
     * `attributeChangedCallback()`. This is the Web Components equivalent of a
     * reactive signal: when the attribute changes, the element can update its
     * internal DOM and state.
     */
    static observedAttributes = ["label", "on", "intensity", "color"];

    #intensity = 0;

    constructor() {
      super()
        .attachShadow({ mode: "open" })
        .append(
          (this._label = createElement("span", {
            className: "label",
            part: "label",
          })),
          (this._lamp = createElement("span", {
            className: "lamp",
            part: "lamp",
          })),
        );

      /**
       * Shadow DOM keeps the element's internal structure hidden from the main
       * document. It is a separate DOM tree attached to the element.
       *
       * `adoptedStyleSheets` is a modern way to share CSS values with the
       * component without duplicating the whole stylesheet in every instance.
       * Here, the lamp uses a stylesheet imported as a CSS module, then adopts it
       * into its Shadow Root so the internal markup can be styled in isolation.
       */
      this.shadowRoot.adoptedStyleSheets = [displayBitStyles];
    }

    /**
     * React when the browser reports an attribute change.
     *
     * This callback is a crucial part of the standard Web Components lifecycle.
     * It lets attributes act like declarative inputs: set `label="A15"` in the
     * HTML and the component updates itself without anybody manually reaching in
     * and mutating internal nodes.
     */
    attributeChangedCallback(name, _old, value) {
      if (name === "label")
        this._label.textContent = value ?? "";
      else
        if (name === "on") {
          // Guarded so that clearing a stale attribute cannot douse a lamp that is
          // being driven through `intensity` directly.
          if (value !== null)
            this.intensity = 1;
          else
            if (this.#intensity === 1)
              this.intensity = 0;
        } else
          if (name === "intensity")
            this.intensity = parseFloat(value) || 0;
          else
            if (name === "color")
              this.style.setProperty("--bit-color", value ?? "");
    }

    /** Lit or dark; stays in step with `intensity` in both directions. */
    get on() {
      return this.#intensity > 0;
    }
    set on(value) {
      this.toggleAttribute("on", !!value);
    }

    /** How brightly the lamp burns, 0..1. Cheap enough to set every frame. */
    get intensity() {
      return this.#intensity;
    }
    set intensity(value) {
      const i = value > 1 ? 1 : value < 0 ? 0 : +value || 0;
      if (i === this.#intensity)
        return;

      this.#intensity = i;
      this._lamp.style.setProperty("--i", i);
      if (i !== 1 && this.hasAttribute("on"))
        this.removeAttribute("on");
    }

    get label() {
      return this.getAttribute("label") ?? "";
    }
    set label(value) {
      this.setAttribute("label", value);
    }
  },
);
