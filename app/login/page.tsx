import Link from "next/link";
import { redirect } from "next/navigation";
import { SolpientBrand } from "@/components/SolpientBrand";
import { createConsumerServerClient } from "@/lib/supabase/server-client";
import { signInAction, signUpAction } from "./actions";
import styles from "./login.module.css";

export const dynamic="force-dynamic";

const errorText:Record<string,string>={
  missing:"Enter your email and password.",
  signin:"Email or password was not accepted.",
  signup:"Use a valid email and a password with at least 8 characters.",
  confirm:"We could not confirm that sign-in link. Request a new one or sign in again.",
};

export default async function LoginPage({
  searchParams,
}:{searchParams:Promise<{mode?:string;error?:string;message?:string}>}) {
  const params=await searchParams;
  const supabase=await createConsumerServerClient();
  const {data}=await supabase.auth.getClaims();
  if(data?.claims?.sub) redirect("/portfolio");

  const signup=params.mode==="signup";
  const error=params.error ? errorText[params.error] : null;
  const message=params.message==="check-email"
    ? "Check your email to confirm your account, then return here to sign in."
    : null;

  return(
    <main className={styles.shell}>
      <section className={styles.card}>
        <Link href="/" className={styles.brandLink}>
          <SolpientBrand subtitle="Portfolio" />
        </Link>
        <span className={styles.kicker}>KNOW WHEN YOUR THESIS CHANGES</span>
        <h1>{signup?"Create your Solpient account":"Sign in to your portfolio"}</h1>
        <p className={styles.lede}>
          Your portfolio is private to your account. Solpient uses it to connect published research to the companies you actually own.
        </p>

        {message?<div className={styles.notice}>{message}</div>:null}
        {error?<div className={styles.error}>{error}</div>:null}

        <form action={signup?signUpAction:signInAction} className={styles.form}>
          {signup?(
            <label>
              <span>Name</span>
              <input name="display_name" type="text" autoComplete="name" maxLength={120} placeholder="Your name" />
            </label>
          ):null}
          <label>
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
          </label>
          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete={signup?"new-password":"current-password"}
              minLength={8}
              required
              placeholder="At least 8 characters"
            />
          </label>
          <button type="submit">{signup?"Create account":"Sign in"}</button>
        </form>

        <div className={styles.switcher}>
          <span>{signup?"Already have an account?":"New to Solpient?"}</span>
          <Link href={signup?"/login":"/login?mode=signup"}>
            {signup?"Sign in":"Create an account"}
          </Link>
        </div>

        <Link className={styles.back} href="/">← Back to Research</Link>
      </section>
    </main>
  );
}
