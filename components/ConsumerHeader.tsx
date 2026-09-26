import type { ReactNode } from "react";
import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import styles from "./ConsumerHeader.module.css";

type ActiveSection="what-matters"|"portfolio"|"research";

export function ConsumerHeader({
  active,
  subtitle,
  action,
}:{
  active?:ActiveSection;
  subtitle?:string;
  action?:ReactNode;
}){
  return(
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        <SolpientBrand subtitle={subtitle}/>
      </Link>

      <nav className={styles.nav} aria-label="Primary">
        <Link
          href="/what-matters"
          className={active==="what-matters"?styles.active:undefined}
        >
          What Matters
        </Link>
        <Link
          href="/portfolio"
          className={active==="portfolio"?styles.active:undefined}
        >
          Portfolio
        </Link>
        <Link
          href="/research"
          className={active==="research"?styles.active:undefined}
        >
          Research
        </Link>
      </nav>

      <div className={styles.actions}>
        {active==="research"?(
          <Link href="/research/request" className={styles.request}>
            Request research
          </Link>
        ):null}
        {action}
      </div>
    </header>
  );
}
