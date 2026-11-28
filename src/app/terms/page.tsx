import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { SUPPORT_EMAIL } from "@/lib/legal";

export const metadata = { title: "Terms of Service · Orca" };

export default function TermsPage() {
  const mail = <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;
  return (
    <LegalPage title="Terms of Service">
      <p>By creating an account or using Orca, you agree to these terms.</p>

      <h2>The service</h2>
      <p>
        Orca helps you study: it turns course material you add into questions, tracks your progress and schedules reviews. Orca is new and
        changes often; features may change or stop, and the service may be unavailable at times.
      </p>

      <h2>Your account</h2>
      <p>Keep your password and any connector links Orca gives you private. You are responsible for what happens under your account.</p>

      <h2>Your content</h2>
      <p>
        You keep ownership of everything you add. You give Orca permission to store and process it, including with AI model providers, only to
        run the service for you. Add only material you have the right to use for your own study, and don&apos;t share other people&apos;s
        personal information through Orca.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Don&apos;t try to reach other students&apos; data, get around limits, or disrupt the service.</li>
        <li>Don&apos;t use Orca to break the law or your school&apos;s academic integrity rules.</li>
      </ul>

      <h2>AI-generated content</h2>
      <p>
        Questions, answers, grades and explanations are written by AI and can be wrong. Check anything important against your course material
        and your instructors. Orca is a study aid and doesn&apos;t guarantee any grade or result.
      </p>

      <h2>Third-party services</h2>
      <p>
        If you connect Google, Canvas, Notion or Claude, their own terms also apply to your use of them. How Orca handles the data they share is
        in the <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>Ending</h2>
      <p>
        You can stop using Orca at any time and ask us to delete your account. We may suspend accounts that break these terms or put the
        service or other students at risk.
      </p>

      <h2>Disclaimer and liability</h2>
      <p>
        Orca is provided &quot;as is&quot;, without warranties of any kind. To the extent the law allows, Orca isn&apos;t liable for indirect or
        consequential losses, or for lost data or results, arising from your use of the service.
      </p>

      <h2>Changes</h2>
      <p>We may update these terms. We change the date above when we do; using Orca after that means you accept the new terms.</p>

      <h2>Contact</h2>
      <p>{mail}</p>
    </LegalPage>
  );
}
