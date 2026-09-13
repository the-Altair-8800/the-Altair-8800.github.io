# the-Altair-8800.github.io

&lt;altair-8800> simulator using web components.

Online: [The-Altair-8800.github.io](https://the-altair-8800.github.io/)

## Disclaimer

Claude Code wrote the whole Altair 8800 Simulator in 20 minutes.

It then took me a day to get rid of all the &lt;div> soup and replace them with proper *Custom Elements*

Claude Code had built much more, programs to load, settings to change. Because "my" code is about the Custom Elements/Web Components I disabled all the extras Claude Code coded (sometimes a bit blunt with early returns in JavaScript and !important in CSS)

Lesson learned: The prompt *"create the Altair 8800 with Web Components"* may have been a bit too short.

## Standalone component usage

The simulator can be mounted as a native web component in any page with:

```html
<script type="module" src="https://The-Altair-8800.github.io/define-elements.js"></script>
```

Usage in HTML:

```html
<altair-8800></altair-8800>
```

The component includes its own panel styling and its own machine wiring, so it can be embedded directly in a page or app shell.

## Web Components in plain English

This project is meant to be both a working simulator and an example of how browser-native Web Components work.

### 1. What is a Web Component?

A Web Component is just a custom HTML element with JavaScript behaviour behind it. The browser treats it like a real element, but the implementation can be custom.

Typical pieces of the API are:

- `HTMLElement` - the base class for a custom element
- `customElements.define()` - registers the custom tag name
- `observedAttributes` - tells the browser which attributes should trigger updates
- `attributeChangedCallback()` - runs when those attributes change
- Shadow DOM - gives the component its own hidden internal DOM tree

### 2. Why Shadow DOM matters

Shadow DOM is the mechanism that keeps a component's internal structure and styles separate from the rest of the page.

This gives you encapsulation:

- the component's internal DOM is not visible to page CSS by default
- the component's CSS does not leak into everything else on the page
- the element acts more like a black box than a raw collection of `<div>` tags

In this project, each component uses `attachShadow({ mode: "open" })` and then adopts a stylesheet with `this.shadowRoot.adoptedStyleSheets`.

### 3. Shared stylesheets and adoptedStyleSheets

The project uses a modern pattern for CSS:

```js
this.shadowRoot.adoptedStyleSheets = [panelStyles];
```

This is a way to attach a CSSStyleSheet object directly to the Shadow Root. It keeps the styling modular and reusable, while still maintaining encapsulation. The resulting component remains self-contained without needing to inject a giant inline `<style>` tag into the page.

The same idea works for shared resources: different components can import the same stylesheet module and adopt it in their own Shadow Root.

### 4. Observed attributes and the reactive feels of components

When a component defines `static observedAttributes`, the browser watches those attributes and calls `attributeChangedCallback()`. That makes the component feel declarative: you can configure it from markup.

Example:

```html
<display-bit-led label="A15" on></display-bit-led>
<toggle-switch label="15" value="down"></toggle-switch>
```

When the attribute changes, the component can update its text, visual state, or emitted events without a manual DOM walk.

### 5. Events and composition

A custom element is not just a tag; it also defines interactions. In this project:

- `<toggle-switch>` dispatches `action` and `change` events
- `<altair-8800>` listens for those events and transforms user input into machine operations
- the larger panel is assembled out of smaller, focused parts instead of one giant template

This is a classic Web Components pattern: small, reusable pieces composed into a larger interface.

### 6. Why this project is a good example

The Altair front panel is a nice teaching example because:

- the visual structure is easy to map to actual hardware
- the components are small and understandable on their own
- there are real examples of state, attributes, custom events, and encapsulated styling
- you can see how native browser features can replace a lot of framework boilerplate

## Demo page

The repository's main page still loads the component and the supporting primitives for the documentation/demo experience, but the standalone custom element is the reusable interface.
