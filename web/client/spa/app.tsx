/**
 * The demo's router — the one that runs in the browser.
 *
 * [feature:spa] delete this file with the feature — see TEMPLATE.md.
 *
 * It is an ordinary `@remix-run/fetch-router` router: `Request` in, `Response` out, with
 * middleware, params, status codes and a default handler. `@remix-run/spa` changes one thing about
 * it — `render()` from that package makes a response carry a component tree rather than a body —
 * and `entry.ts` next door hands it to `run()`, which dispatches navigations through it instead of
 * over the network.
 *
 * The routes are `client/routes.ts`, the same objects `server/router.ts` maps, matched by the same
 * matcher. That is the reason a route lives in a file of its own on this site: two routers answer
 * the same URLs, one on each side.
 */

import {
  createController,
  createRouter,
  type RouterContext,
} from "@remix-run/fetch-router";
import { render } from "@remix-run/spa";
import type { Handle } from "@remix-run/component";

import { HELPER_SRC } from "../helper/install.ts";
import { Shell } from "../layout.tsx";
import { routes } from "../routes.ts";
import SpaPage, { parseSpaId, titleFor } from "../pages/spa.tsx";

/**
 * How many times this router has rendered a view in this document.
 *
 * The demo's evidence. A module-level count rather than something derived from the URL, because a
 * reload starts a new document and puts it back to zero — so the number on screen is exactly the
 * number of times the browser routed instead of fetching.
 *
 * The first one is not a navigation: `run()` renders the initial route itself, replacing what the
 * server sent. So the screen is shown one fewer than this.
 */
let renders = 0;

export const spaRouter = createRouter({
  // Every route's node passes through here on its way to the runtime, and this is where the shell
  // goes back around it. `run()` renders into `<body>` and clears what was there, so a route that
  // returned its screen alone would take the header and the footer with it.
  //
  // That clearing is also why the help button's URL comes from `HELPER_SRC`: the shell rendered
  // here replaces the server's, and this side cannot resolve an asset URL. `install.ts` read it
  // off the server's button while it was still in the document, which is before this runs.
  middleware: [
    render((content) => (
      <Shell documentLinks helper={HELPER_SRC}>{content}</Shell>
    )),
  ],

  // A client router is asked about every same-origin navigation the runtime intercepts, including
  // ones it has no route for. The shell's links opt out with `data-rmx-document`, so what reaches
  // here is a typed URL or a stale link — and answering it is this router's job, not the server's.
  defaultHandler: ({ render, url }) =>
    render(<NotFound pathname={url.pathname} />, { status: 404 }),
});

/** What this router's middleware hands its actions — `render`, in practice. */
type SpaContext = RouterContext<typeof spaRouter>;

// A controller, for the same reason `server/router.tsx` uses one: it owns every route in the map
// it is given, so a fourth view added to `routes.spa` is a type error here rather than a URL this
// router quietly answers with its 404.
spaRouter.map(
  routes.spa,
  createController<typeof routes.spa, SpaContext>(routes.spa, {
    actions: {
      show: ({ params, render, url }) => {
        const id = parseSpaId(params.id);
        if (id === null) {
          return render(<NotFound pathname={url.pathname} />, { status: 404 });
        }

        renders++;
        // `<head>` belongs to the document and is not re-rendered here, so the title is set the way a
        // client router has to set it. The server still writes the right one into each static file,
        // which is what a crawler and a link preview read.
        document.title = titleFor(id);

        return render(
          <SpaPage id={id} renderedBy="browser" navigations={renders - 1} />,
        );
      },
    },
  }),
);

/** What a URL of the demo's shape but none of its views gets. */
function NotFound(handle: Handle<{ pathname: string }>) {
  return () => (
    <>
      <h1>Not found</h1>
      <p>
        The router running in this browser has no route for{" "}
        <code>{handle.props.pathname}</code>. The server would have said the
        same thing; this one just said it without asking.
      </p>
      <p>
        <a href={routes.spa.show.href({ id: "1" })}>← Back to view 1</a>
      </p>
    </>
  );
}
