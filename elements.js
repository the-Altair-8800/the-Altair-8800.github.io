/**
 * Bootstrap the custom elements used by the page.
 *
 * A browser does not automatically know about a custom element until it has been
 * imported and registered with `customElements.define()`. This file ensures that
 * the element classes are loaded into the page before the UI is used, and it
 * appends the shared stylesheet that gives the page its non-shadow global look.
 *
 * The pattern here is intentionally simple: each custom element owns its own
 * Shadow DOM and often its own stylesheet, while this page-level bootstrap file
 * adds a small global layer for the surrounding document.
 */
import "./altair-display-bit-led.js";
import "./altair-toggle-switch.js";
import "./altair-8800-panel.js";
