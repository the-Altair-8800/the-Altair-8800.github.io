/**
 * Shared, tiny helpers that make the custom-element code easier to read.
 *
 * These utilities are not part of the browser's Web Components API; they are just
 * convenience wrappers used by the panel. They help show a common pattern in
 * component authoring: create DOM nodes, apply attributes, apply inline styles,
 * and be careful about repetitive event handlers.
 */

/**
 * Create a DOM element and populate it with attributes, styles, classes and
 * children in one place.
 *
 * This mirrors the way many UI libraries build nodes, but it stays close to the
 * DOM API and therefore makes the component logic easier to follow for learners.
 */
export const createElement = (tag, props = {}) => {
    const element = document.createElement(tag);
    const {
        attrs = {},
        styles = {},
        append = [],
        classes = [],
        ...remainingProps
    } = props;

    if (classes.length) element.classList.add(...classes);

    for (const [key, value] of Object.entries(remainingProps)) {
        try {
            element[key] = value;
        } catch {
            if (value !== undefined && value !== null) element.setAttribute(key, value);
        }
    }

    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    for (const [key, value] of Object.entries(styles)) element.style[key] = value;
    element.append(...[append].flat(9));

    return element;
};

const DEBOUNCE_MS = 150;

/**
 * Delay a callback until the user has stopped triggering it for a moment.
 *
 * The browser fires input events quickly, especially for pointer and keyboard
 * activity. Debouncing is a practical pattern for components: it groups bursts of
 * input into a single update, preventing a machine from re-rendering or
 * re-acting tens of times per second when the user is just sliding a switch.
 */
export const debounce = (fn, wait = DEBOUNCE_MS) => {
    let timer = 0;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
};
