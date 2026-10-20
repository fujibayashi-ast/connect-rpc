import { Category } from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";

// カテゴリの表示名。一覧とフォームで共有する
export const categoryLabels: Record<number, string> = {
  [Category.UNSPECIFIED]: "選択してください",
  [Category.GENERAL]: "一般",
  [Category.SUPPORT]: "サポート",
  [Category.OTHER]: "その他",
};

// フォームの選択肢。表示順はここで決める
export const categoryOptions = [
  Category.UNSPECIFIED,
  Category.GENERAL,
  Category.SUPPORT,
  Category.OTHER,
].map((value) => ({ value, label: categoryLabels[value] }));
