import { expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import {
  Category,
  CreateContactRequestSchema,
} from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { ConnectError, type HandlerContext } from "@connectrpc/connect";
import { createContactService } from "./contact.ts";

const ctx = { signal: new AbortController().signal } as HandlerContext;

test("壊れた page_token は invalid_argument", async () => {
  const service = createContactService();
  await service.createContact(
    create(CreateContactRequestSchema, {
      contact: {
        name: "A",
        email: "a@example.com",
        category: Category.GENERAL,
      },
    }),
    ctx,
  );

  for (const pageToken of ["abc", "!!!", "KzU", "MA", "LTE", "MWUz"]) {
    expect(() => service.listContacts({ pageToken } as never, ctx)).toThrow(
      ConnectError,
    );
  }
});
