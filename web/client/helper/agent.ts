/**
 * What the helper knows, and how it decides a turn.
 *
 * On a deployment with a server this file would not exist: `@remix-kbn/helper-agent/agent/claude`
 * would be behind the controller, this text would be its system prompt, and the answers would be
 * written by a model. GitHub Pages has no server and so nowhere to keep an API key, so what runs
 * here is `agent/dummy` — the same `Agent` interface, answering from a script.
 *
 * Everything else is the real thing. The client, the wire protocol, the streaming, the tool round
 * trip and the transcript are the package's own, and the only difference is that the sentences
 * below were written rather than generated. Which makes this the honest demonstration of the
 * arrangement: what a static host can show is everything except the model.
 *
 * The replies are matched against the most recent user message, first hit wins, so they are
 * ordered specific-first. `fallback` is where a real agent's judgement would be, and it does the
 * one thing a script can honestly do instead: say what it is and list what it can answer.
 */

import { dummyAgent, scriptedTurns } from "@remix-kbn/helper-agent/agent/dummy";
import type {
  Agent,
  AgentInput,
  DummyTurn,
} from "@remix-kbn/helper-agent/agent/dummy";

/** Every canned answer, in the order they are tried. */
const replies = [
  {
    match: /where am i|which page|what page|this page/i,
    turn: { toolCalls: [{ name: "where_am_i" }] },
  },
  {
    match: /bug|broken|doesn'?t work|not working|report/i,
    turn: {
      text:
        "Sorry — that should not happen. Tell me what you did and what you saw, and I will " +
        "draft an issue on this site's tracker for you to check and submit. (Try saying " +
        "“file it” once you have described it.)",
    },
  },
  {
    match: /file it|go ahead|draft (it|the report)|yes please/i,
    turn: {
      text:
        "Drafting it now — nothing is filed until you open the link and submit.",
      toolCalls: [{
        name: "draft_bug_report",
        input: {
          title: "Something is wrong on the demo site",
          body:
            "Reported from the in-page helper. Please describe what happened.",
        },
      }],
    },
  },
  {
    match: /island|hydrat/i,
    turn: {
      text:
        "An island is a component that is server-rendered like everything else and then wakes up " +
        "in the browser. A page opts in with `export const hydrate = true`, places the island, " +
        'and the shell writes one `<script type="module">` for the whole page. Every island is ' +
        "compiled as one graph, so two of them that import the same module get the same instance " +
        "— the two counters on the home page and the total below them are exactly that. A " +
        "page that places none, like the blog listing, ships no JavaScript at all.",
    },
  },
  {
    match: /spa|client.?side rout/i,
    turn: {
      text:
        "The SPA link in the header goes to a demo where a real `@remix-run/fetch-router` runs in " +
        "the browser: the three views route without a request, and the counter on screen shows " +
        "how many times it has. It is a document load to get in and out of, because a document " +
        "gets one runtime and that page starts a different one from the rest of the site. This " +
        "chat uses the same trick — see below.",
    },
  },
  {
    match: /blog|article|markdown/i,
    turn: {
      text:
        "The blog is Markdown files under `server/blog/`. The listing is generated from whatever " +
        "is on disk, so adding an article is adding a file — the article about that is the " +
        "second one in the list. The listing ships no JavaScript; an article does, because it " +
        "places a share button.",
    },
  },
  {
    match: /og|social|card|preview image/i,
    turn: {
      text:
        "Each page's social card is a PNG drawn at build time with Skia, from the same title and " +
        "description that go into `<head>`. Nothing on the site links to one, so the build is " +
        "told about them explicitly rather than finding them by crawling.",
    },
  },
  {
    match: /ssg|static|build|prerender|crawl/i,
    turn: {
      text:
        "The build runs the site's own router and crawls it from `/`, following links, and writes " +
        "what comes back as files. So there is no second description of the site anywhere: what " +
        "`deno task dev` serves is what gets written. `deno task build` puts it in `web/dist`.",
    },
  },
  {
    match: /deploy|gh.?pages|github pages|prefix|base/i,
    turn: {
      text:
        "It deploys to GitHub Pages, including a preview per pull request under its own sub-path. " +
        "That sub-path is why the deploy prefix is a value the site reads rather than a string " +
        "anyone types: routes are built on it, and the browser is told it through a `<meta>` tag " +
        "because `/repo/blog` and `/blog` are the same page under two deploys.",
    },
  },
  {
    match:
      /chat|helper|assistant|are you (a )?(real|ai|model|bot)|dummy|how do you work/i,
    turn: {
      text:
        "Honest answer: there is no model behind me. I am `@remix-kbn/helper-agent` with its " +
        "scripted agent, and the whole chat — panel, controller and all — is running " +
        "inside this page. The controller is mounted on a `fetch-router` in your browser and the " +
        "client posts to it with that router's own `fetch`, so nothing leaves the origin. On a " +
        "site with a server the same controller takes `agent/claude` instead, and only that one " +
        "line changes.",
    },
  },
  {
    match: /showcase|components?|remix.?ui/i,
    turn: {
      text:
        "The UI showcase has the headless `@remix-run/ui` primitives and animation helpers on one page, each a live island with " +
        "controls to change its parameters. It is also the page that proves the bundling works: " +
        "eighteen islands, one runtime.",
    },
  },
  {
    match: /fullscreen|game|canvas|viewport|safe area|notch/i,
    turn: {
      text:
        "The fullscreen page is the frame of a game with a placeholder where the game goes: " +
        "no site chrome, and a stage that fills whatever the browser leaves visible. One " +
        "action gets the rest of the screen on a phone: tap to fullscreen where the " +
        "Fullscreen API exists, scroll to fullscreen on iPhone Safari where it does not. On a " +
        "desktop the game simply starts, and fullscreen is a button in the corner.",
    },
  },
];

/** What to say when nothing matched, and after a tool has run. */
function fallback(input: AgentInput): DummyTurn {
  const last = input.messages.at(-1);

  if (last?.role === "tool") {
    const failed = last.results.filter((result) => result.isError);
    if (failed.length > 0) {
      return {
        text: `That did not work: ${failed.map((r) => r.content).join("; ")}`,
      };
    }

    return {
      text: `Here is what the page told me:\n\n${
        last.results.map((r) => r.content).join("\n")
      }\n\n` +
        "Anything else you want to know about it?",
    };
  }

  return {
    text:
      "I only know a handful of things about this site, because I am a script rather than a " +
      "model — ask me about the static build, islands and hydration, the SPA demo, the " +
      "blog, the social cards, deploying to GitHub Pages, or this chat itself. You can also ask " +
      "“what page am I on?”, or tell me about a bug and I will open a report.",
  };
}

/**
 * The agent this site's controller serves.
 *
 * `wordDelay` is left at its default: the words arriving one at a time is not decoration here, it
 * is the streaming path being exercised. Shorten it and the panel stops proving anything.
 */
export function siteAgent(): Agent {
  return dummyAgent({ script: scriptedTurns(replies, fallback) });
}
