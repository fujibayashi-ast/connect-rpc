import { expect, test } from "bun:test";
import { describeEach, listAll, rawPost, uniqueEmail } from "./helpers.ts";

type ErrorJson = { code: string };

// Connect-Timeout-Ms: 0 は「最初から期限切れ」でサーバーに届く。
// ハンドラが期限を守っていれば、遅いハンドラを用意しなくても deadline_exceeded になる
describeEach("タイムアウト", ({ target, client }) => {
  test("期限切れの呼び出しは deadline_exceeded", async () => {
    const res = await rawPost(
      target,
      "ListContacts",
      {},
      {
        "Connect-Timeout-Ms": "0",
      },
    );

    expect(res.status).toBe(504);
    expect(((await res.json()) as ErrorJson).code).toBe("deadline_exceeded");
  });

  test("期限切れの Create は何も作らない", async () => {
    const email = uniqueEmail();

    const res = await rawPost(
      target,
      "CreateContact",
      { contact: { name: "期限切れ", email, category: "CATEGORY_GENERAL" } },
      { "Connect-Timeout-Ms": "0" },
    );

    expect(((await res.json()) as ErrorJson).code).toBe("deadline_exceeded");
    const contacts = await listAll(client);
    expect(contacts.map((c) => c.email)).not.toContain(email);
  });

  test("十分な期限があれば成功する", async () => {
    const res = await rawPost(
      target,
      "ListContacts",
      {},
      {
        "Connect-Timeout-Ms": "5000",
      },
    );

    expect(res.status).toBe(200);
  });

  test("期限の値が不正なら invalid_argument", async () => {
    const res = await rawPost(
      target,
      "ListContacts",
      {},
      {
        "Connect-Timeout-Ms": "abc",
      },
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorJson).code).toBe("invalid_argument");
  });
});
