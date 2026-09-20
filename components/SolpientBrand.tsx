import Image from "next/image";
import Link from "next/link";

export function SolpientBrand({
  className = "brand",
  subtitle = "Research",
  priority = false,
}: {
  className?: string;
  subtitle?: string;
  priority?: boolean;
}) {
  return (
    <Link className={className} href="/" aria-label="Solpient Research home">
      <Image
        className="solpientBrandMark"
        src="/solpient-mark.svg"
        alt=""
        width={38}
        height={38}
        priority={priority}
      />
      <span className="solpientBrandCopy">
        <strong>SOLPIENT</strong>
        <span>{subtitle}</span>
      </span>
    </Link>
  );
}
