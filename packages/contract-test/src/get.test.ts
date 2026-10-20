import { expect, test } from "bun:test";
import { describeEach, rawGet } from "./helpers.ts";

type ContactJson = { id: string; name: string };
type ListJson = { contacts?: ContactJson[]; nextPageToken?: string };

describeEach("Connect の GET", ({ target, create }) => {
  test("ListContacts を GET で呼べる", async () => {
    const created = await create();

    // 他のデータで 1 ページに収まらないことがあるので、最後のページまでたどる
    const ids: string[] = [];
    let token = "";
    do {
      const res = await rawGet(target, "ListContacts", {
        pageSize: 100,
        pageToken: token,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ListJson;
      ids.push(...(body.contacts ?? []).map((c) => c.id));
      token = body.nextPageToken ?? "";
    } while (token);

    expect(ids).toContain(created.id);
  });

  test("GetContact を GET で呼べる", async () => {
    const created = await create({ name: "GET で取得" });

    const res = await rawGet(target, "GetContact", { id: created.id });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { contact?: ContactJson };
    expect(body.contact?.name).toBe("GET で取得");
  });

  test("NO_SIDE_EFFECTS でない RPC は GET で呼べない", async () => {
    const res = await rawGet(target, "CreateContact", {
      contact: { name: "x", email: "get-create@example.com", category: 1 },
    });

    expect(res.status).toBe(405);
  });

  test("応答はブラウザに使い回させない（Cache-Control: no-cache）", async () => {
    const res = await rawGet(target, "ListContacts", {});

    expect(res.headers.get("cache-control")).toBe("no-cache");
  });
});
