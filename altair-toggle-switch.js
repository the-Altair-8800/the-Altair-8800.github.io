import { debounce, createElement } from "./elements-shared-code.js";
import toggleSwitchStyles from "./altair-toggle-switch.css" with { type: "css" };

/**
 * A tactile switch component that behaves like a real Altair paddle.
 *
 * This file is a useful learning example for how a Web Component can hide a
 * moderately complex interaction behind a single element.
 *
 * The switch is a good demonstration of several Web Components ideas:
 * - the element owns its internal structure in a Shadow DOM
 * - it exposes attributes like `label`, `value`, and `momentary`
 * - it observes state changes with `static observedAttributes`
 * - it dispatches custom events like `action` and `change`
 * - it can present a better accessible interface than a bare `<div>`
 *
 * Example:
 * ```html
 * <toggle-switch label="15" value="down"></toggle-switch>
 * ```
 */

/**
 * `customElements.define()` registers the element with the browser so it can be
 * used in HTML. Once registered, it behaves like a native element, even though
 * the internal implementation is still JavaScript.
 */
customElements.define(
  "toggle-switch",
  class extends HTMLElement {
    /**
     * Observed attributes are a key part of component development.
     *
     * When an attribute listed here changes, the browser calls the component's
     * `attributeChangedCallback()`. That gives a component a declarative input
     * channel without forcing the user to reach into internal DOM nodes.
     */
    static observedAttributes = [
      "label",
      "up",
      "down",
      "value",
      "momentary",
      "disabled",
    ];

    #held = null;
    #clickPending = 0;

    constructor() {
      super()
        .attachShadow({ mode: "open" })
        .append(
          (this._label = createElement("span", {
            className: "caption label",
            part: "label",
          })),
          (this._up = createElement("span", {
            className: "caption up",
            part: "up",
          })),
          createElement("span", {
            className: "stage",
            append: [
              createElement("span", {
                className: "bezel",
                part: "bezel",
              }),
              createElement("span", {
                className: "paddle",
                part: "paddle",
              }),
              (this._hits = createElement("span", {
                className: "hits",
                onpointerdown: (evt) => this.#onPointerDown(evt),
                onkeydown: (evt) => this.#onKeyDown(evt),
                onkeyup: (evt) => this.#onKeyUp(evt),
                onclick: (evt) => this.#onClick(evt),
              })),
            ],
          }),
          (this._down = createElement("span", {
            className: "caption down",
            part: "down",
          })),
        );

      this.shadowRoot.adoptedStyleSheets = [toggleSwitchStyles];
    }

    /**
     * `connectedCallback()` fires when the element is attached to the page.
     *
     * This is where a component often initializes default state, sets up the
     * public API, and creates a first render. The real browser lifecycle is:
     * construct -> connect -> observe attributes -> render -> disconnect.
     */
    connectedCallback() {
      if (!this.hasAttribute("value"))
        this.setAttribute("value", this.momentary ? "center" : "down");
      this.#renderHits();
    }

    attributeChangedCallback(name, old, value) {
      if (name === "label") this._label.textContent = value ?? "";
      else if (name === "up") this._up.textContent = value ?? "";
      else if (name === "down") this._down.textContent = value ?? "";
      else if (name === "momentary" || name === "disabled")
        this.#renderHits();
      else if (name === "value" && old !== value) this.#renderHits();
    }

    // --- state -----------------------------------------------------------------

    get value() {
      return this.getAttribute("value") ?? "center";
    }
    set value(v) {
      this.setAttribute("value", v);
    }

    get momentary() {
      return this.hasAttribute("momentary");
    }
    set momentary(v) {
      this.toggleAttribute("momentary", !!v);
    }

    get disabled() {
      return this.hasAttribute("disabled");
    }
    set disabled(v) {
      this.toggleAttribute("disabled", !!v);
    }

    /** Up is 1, down is 0 - handy for the sixteen data switches. */
    get bit() {
      return this.value === "up" ? 1 : 0;
    }
    set bit(v) {
      this.value = v ? "up" : "down";
    }

    // --- rendering -------------------------------------------------------------

    #renderHits() {
      const directions = this.momentary
        ? [
          this.getAttribute("up") !== null && "up",
          this.getAttribute("down") !== null && "down",
        ].filter(Boolean)
        : ["toggle"];
      const wanted = directions.join(" ");
      if (this._hits.dataset.shape !== wanted) {
        this._hits.dataset.shape = wanted;
        this._hits.replaceChildren(
          ...directions.map((direction) => {
            // `dataset` is read only, so it cannot ride along in createElement.
            const hit = createElement("button", {
              className: "hit",
              part: "hit",
              type: "button",
            });
            hit.dataset.direction = direction;
            return hit;
          }),
        );
      }
      const name =
        this.getAttribute("label") || this.getAttribute("up") || "switch";
      for (const hit of this._hits.children) {
        const { direction } = hit.dataset;
        hit.disabled = this.disabled;
        if (direction === "toggle") {
          hit.setAttribute("role", "switch");
          hit.setAttribute("aria-checked", String(this.value === "up"));
          hit.setAttribute("aria-label", name);
        } else {
          hit.removeAttribute("role");
          hit.removeAttribute("aria-checked");
          hit.setAttribute(
            "aria-label",
            this.getAttribute(direction) || direction,
          );
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

    #onPointerDown = (evt) => {
      const hit = evt.target.closest(".hit");
      if (!hit || this.disabled || evt.button !== 0) return;
      evt.preventDefault();
      const direction = this.#directionFor(hit);
      this.#flick(direction);
      this.#clickPending = evt.timeStamp;
      if (this.momentary) {
        this.#held = direction;
        try {
          hit.setPointerCapture(evt.pointerId);
        } catch {
          /* synthetic pointer */
        }
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

    #onKeyDown = (evt) => {
      const hit = evt.target.closest(".hit");
      if (!hit || this.disabled) return;
      let direction = null;
      if (evt.key === "ArrowUp") direction = "up";
      else if (evt.key === "ArrowDown") direction = "down";
      else if (evt.key === " " || evt.key === "Enter") {
        direction = this.#directionFor(hit);
      }
      if (!direction || (this.momentary && this.#held === direction)) return;
      evt.preventDefault();
      this.#flick(direction);
      // Enter and space also produce a click; the arrow keys do not.
      if (evt.key === " " || evt.key === "Enter")
        this.#clickPending = evt.timeStamp;
      if (this.momentary) this.#held = direction;
    };

    /* Assistive technology activates a button by dispatching a bare click, with
 no pointer or key sequence behind it. Honour that, but ignore the click
 that trails a flick we have already handled. */
    #onClick = debounce((evt) => {
      const hit = evt.target.closest(".hit");
      if (!hit || this.disabled) return;
      // Swallow exactly the one click that trails a flick we have already handled,
      // and only if it arrives promptly. Anything else is a real activation.
      if (this.#clickPending && evt.timeStamp - this.#clickPending < 1000) {
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
    }, 150);

    #onKeyUp = (evt) => {
      if (
        this.momentary &&
        this.#held &&
        (evt.key === " " ||
          evt.key === "Enter" ||
          evt.key === "ArrowUp" ||
          evt.key === "ArrowDown")
      )
        this.#release();
    };

    #flick(direction) {
      const changed = this.value !== direction;
      this.value = direction;
      this.dispatchEvent(
        new CustomEvent("action", { bubbles: true, detail: { direction } }),
      );
      if (changed && !this.momentary) {
        this.dispatchEvent(
          new CustomEvent("change", {
            bubbles: true,
            detail: { value: direction },
          }),
        );
      }
    }

    #release() {
      if (!this.#held) return;
      this.#held = null;
      this.value = "center";
    }
  },
);
