import { Graph as UpstreamGraph, type GraphOptions } from "@quartz-community/graph"
import type { QuartzComponentConstructor } from "@quartz-community/types"

const UPSTREAM_LOADER =
  'Promise.all([e("https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"),e("https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.js")]).then(function(){t()})'

const LAZY_LOADER = `(function(){
  if (!window.matchMedia("(max-width: 800px)").matches) return Promise.resolve();
  return new Promise(function(resolve){
    var finished = false;
    function arm(){
      if (finished) return;
      var roots = document.querySelectorAll(".graph");
      for (var i = 0; i < roots.length; i++) {
        var root = roots[i];
        root.dataset.graphState = "idle";
        var outer = root.querySelector(".graph-outer");
        if (!outer || outer.querySelector(".graph-load")) continue;
        var button = document.createElement("button");
        button.type = "button";
        button.className = "graph-load";
        button.textContent = "Load graph";
        button.setAttribute("aria-label", "Load graph view");
        button.addEventListener("click", function(){
          if (finished) return;
          finished = true;
          document.removeEventListener("nav", arm);
          var currentRoots = document.querySelectorAll(".graph");
          for (var j = 0; j < currentRoots.length; j++) {
            currentRoots[j].dataset.graphState = "loading";
          }
          var buttons = document.querySelectorAll(".graph-load");
          for (var k = 0; k < buttons.length; k++) buttons[k].remove();
          resolve();
        }, { once: true });
        outer.appendChild(button);
      }
    }
    arm();
    document.addEventListener("nav", arm);
  });
})().then(function(){
  return Promise.all([e("https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"),e("https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.js")]);
}).then(function(){
  var roots = document.querySelectorAll(".graph");
  for (var i = 0; i < roots.length; i++) roots[i].dataset.graphState = "ready";
  t();
})`

const LAZY_CSS = `
.graph-load {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  border: 0;
  background: var(--light);
  color: var(--dark);
  cursor: pointer;
  font-family: var(--codeFont);
  font-size: 0.72rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.graph-load::after {
  content: "Tap to explore linked notes";
  display: block;
  margin-top: 0.55rem;
  color: var(--gray);
  font-family: var(--bodyFont);
  font-size: 0.78rem;
  letter-spacing: 0;
  text-transform: none;
}
.graph-load:hover,
.graph-load:focus-visible {
  color: var(--accent);
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
@media all and (max-width: 800px) {
  .graph[data-graph-state="idle"] .global-graph-icon,
  .graph[data-graph-state="loading"] .global-graph-icon {
    display: none;
  }
  .graph > .graph-outer {
    height: min(70vw, 250px);
    min-height: 220px;
  }
}
`

/**
 * Adds the mobile interaction gate to the pinned upstream graph script.
 *
 * Fail loudly if the package changes its loader: silently reverting to a
 * 538 KB mobile download would be much harder to notice than a build failure.
 */
export function deferMobileGraphLibraries(script: string): string {
  const first = script.indexOf(UPSTREAM_LOADER)
  if (first < 0 || first !== script.lastIndexOf(UPSTREAM_LOADER)) {
    throw new Error("The upstream graph loader changed; update the lazy graph patch")
  }
  return script.replace(UPSTREAM_LOADER, LAZY_LOADER)
}

export const Graph = ((userOpts?: Partial<GraphOptions>) => {
  const Component = UpstreamGraph(userOpts)
  const browserScript = Component.afterDOMLoaded
  if (typeof browserScript !== "string") {
    throw new Error("The upstream graph browser script changed shape; update the lazy graph patch")
  }
  Component.afterDOMLoaded = deferMobileGraphLibraries(browserScript)
  Component.css = `${Component.css ?? ""}\n${LAZY_CSS}`
  return Component
}) satisfies QuartzComponentConstructor

export default Graph
