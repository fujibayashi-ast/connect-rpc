import {
  ChangeType,
  type WatchContactsResponse,
} from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";

const changeLabels: Partial<Record<ChangeType, string>> = {
  [ChangeType.CREATED]: "追加",
  [ChangeType.UPDATED]: "更新",
  [ChangeType.DELETED]: "削除",
};

// WatchContacts のイベントを、通知欄に出す 1 行の文にする。出すものがなければ undefined
export function describeEvent(res: WatchContactsResponse): string | undefined {
  const { event } = res;
  if (event.case === "snapshot") {
    return `接続しました（現在 ${event.value.contacts.length} 件）`;
  }
  if (event.case !== "change") return undefined;

  const { type, contact } = event.value;
  const label = changeLabels[type];
  if (!label || !contact) return undefined;
  return `${label}: ${contact.name}`;
}
