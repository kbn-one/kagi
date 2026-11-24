import { assertEquals } from "@std/assert";

import { relayTargetProblem } from "./relay_target.ts";

const SELF = "kagi.kbn.one";

Deno.test("relayTargetProblem allows public hosts, with or without a port", () => {
  for (
    const host of [
      "api.example.com",
      "api.example.com:8443",
      "kbn.one.example.com",
      "notkbn.one",
    ]
  ) {
    assertEquals(relayTargetProblem(host, SELF), null, host);
  }
});

Deno.test("relayTargetProblem refuses IP literals, however they are spelled", () => {
  for (
    const host of [
      "127.0.0.1",
      "10.0.0.1:8080",
      "0x7f.1",
      "2130706433",
      "169.254.169.254",
      "[::1]",
      "[fd00::1]:443",
    ]
  ) {
    assertEquals(typeof relayTargetProblem(host, SELF), "string", host);
  }
});

Deno.test("relayTargetProblem refuses localhost and this server's own domain", () => {
  for (
    const host of [
      "localhost",
      "LOCALHOST:8000",
      "app.localhost",
      "kbn.one",
      "kagi.kbn.one",
      "Other.KBN.one",
      "a.b.kbn.one:444",
    ]
  ) {
    assertEquals(typeof relayTargetProblem(host, SELF), "string", host);
  }
});
