import { Alert, AlertDescription } from "@/components/ui/alert.tsx";

// 操作した場所のすぐ近くに出すエラー表示。Alert が role="alert" を付けるので読み上げられる
export function ErrorAlert({ children }: { children: string }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
