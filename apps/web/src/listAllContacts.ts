import type { Contact } from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { contactClient } from "./client.ts";

// next_page_token が空になるまで ListContacts をたどり、全件を返す。
// ListContacts は NO_SIDE_EFFECTS なので、client の useHttpGet により GET で送られる。
// トークンの中身は読まず、そのまま次の呼び出しに渡す
export async function listAllContacts(signal: AbortSignal): Promise<Contact[]> {
  const contacts: Contact[] = [];
  let pageToken = "";
  do {
    const res = await contactClient.listContacts({ pageToken }, { signal });
    contacts.push(...res.contacts);
    pageToken = res.nextPageToken;
  } while (pageToken !== "");
  return contacts;
}
