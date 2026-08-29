/**
 * Guards on the API's input validation. These are pure functions, so they can
 * be tested without a Worker runtime or a database.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  isValidSlug,
  likeVisitor,
  pageTitleFromHtml,
  telegramCommentText,
  telegramLikeText,
  telegramMessagePayload,
} from "./lib.ts"

test("slug validation rejects traversal and junk", () => {
  for (const ok of ["algorithms", "a", "a-b-c", "note-2026"]) {
    assert.equal(isValidSlug(ok), true, ok)
  }
  for (const bad of [
    "../../etc/passwd",
    "/absolute",
    "Has Spaces",
    "UPPER",
    "-leading-dash",
    "trailing/slash",
    "",
    "x".repeat(200),
    null,
    42,
    {},
  ]) {
    assert.equal(isValidSlug(bad as never), false, JSON.stringify(bad))
  }
})

test("Telegram payload targets an optional validated forum topic", () => {
  assert.deepEqual(telegramMessagePayload("-100123", "hello"), {
    chat_id: "-100123",
    text: "hello",
    parse_mode: "HTML",
    disable_web_page_preview: true,
  })
  assert.deepEqual(telegramMessagePayload("-100123", "hello", " 42 "), {
    chat_id: "-100123",
    text: "hello",
    parse_mode: "HTML",
    disable_web_page_preview: true,
    message_thread_id: 42,
  })
  assert.deepEqual(
    telegramMessagePayload("-100123", "hello", undefined, {
      text: "Moderate or reply",
      url: "https://mandulaj.hu/api/moderate?token=abc",
    }),
    {
      chat_id: "-100123",
      text: "hello",
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Moderate or reply",
              url: "https://mandulaj.hu/api/moderate?token=abc",
            },
          ],
        ],
      },
    },
  )

  for (const invalid of ["0", "-1", "1.5", "topic", "9007199254740992"]) {
    assert.equal(telegramMessagePayload("-100123", "hello", invalid), null, invalid)
  }
})

test("Telegram comment alert is one sentence with title, author, body, and link", () => {
  assert.equal(
    pageTitleFromHtml("<title>Design &amp; Systems</title>", "fallback"),
    "Design & Systems",
  )
  assert.equal(pageTitleFromHtml("<html></html>", "fallback"), "fallback")
  assert.equal(
    telegramCommentText(
      "Design & Systems",
      "József <Admin>",
      "Useful & clear.",
      "https://mandulaj.hu/design#c-123",
    ),
    "💬 On <b>Design &amp; Systems</b>, <b>József &lt;Admin&gt;</b> commented: “Useful &amp; clear.”\n\n" +
      "https://mandulaj.hu/design#c-123",
  )
})

test("likes use a signed first-party browser cookie without personal data", async () => {
  const request = new Request("https://mandulaj.hu/api/likes", {
    headers: { "cf-connecting-ip": "203.0.113.4", "user-agent": "test browser" },
  })
  const passive = await likeVisitor(request, "secret", false)
  assert.equal(passive.current, null)
  assert.equal(passive.setCookie, undefined)

  const created = await likeVisitor(request, "secret", true)
  assert.ok(created.current)
  assert.match(created.setCookie ?? "", /^mandulaj_like=/)
  assert.doesNotMatch(created.setCookie ?? "", /203\.0\.113\.4|test browser/)
  assert.match(created.setCookie ?? "", /HttpOnly; Secure; SameSite=Lax/)

  const cookie = created.setCookie?.split(";", 1)[0]
  const returning = await likeVisitor(
    new Request("https://mandulaj.hu/api/likes", { headers: { cookie: cookie ?? "" } }),
    "secret",
    false,
  )
  assert.equal(returning.current, created.current)
})

test("Telegram like alert names the post and new total", () => {
  assert.equal(
    telegramLikeText("About & me", 2, "https://mandulaj.hu/about"),
    "❤️ <b>About &amp; me</b> received a like and now has <b>2 likes</b>.\n\n" +
      "https://mandulaj.hu/about",
  )
})
