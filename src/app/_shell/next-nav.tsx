"use client";
// Navigering i Next.js: riktiga URL:er via next/navigation och next/link.
import NextLink from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { NavProvider, type LinkImpl, type Nav } from "@/shell/nav";

const LinkImplNext: LinkImpl = ({ href, children, ...rest }) => (
  <NextLink href={href} {...rest}>
    {children}
  </NextLink>
);

export function NextNavProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const search = useSearchParams();
  const router = useRouter();
  const nav = useMemo<Nav>(
    () => ({
      path: pathname,
      query: new URLSearchParams(search?.toString() ?? ""),
      push: (to) => router.push(to),
      replace: (to) => router.replace(to),
      back: () => router.back(),
      href: (to) => to,
    }),
    [pathname, search, router],
  );
  return (
    <NavProvider nav={nav} LinkImpl={LinkImplNext}>
      {children}
    </NavProvider>
  );
}
