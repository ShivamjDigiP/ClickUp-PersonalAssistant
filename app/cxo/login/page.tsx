import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

// The sign-in page moved to /login (one page for everyone). Old links, bookmarks and Google errors still land here.
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Forward({ searchParams }: Props): Promise<null> {
  await connection();
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const k of ["next", "error"]) if (first(sp[k])) q.set(k, first(sp[k])!);
  redirect(`/login${q.size ? `?${q}` : ""}`);
}

export default function Page(props: Props) {
  return (
    <Suspense fallback={null}>
      <Forward {...props} />
    </Suspense>
  );
}
