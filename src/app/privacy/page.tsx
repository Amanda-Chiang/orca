import { LegalPage } from "@/components/legal/LegalPage";
import { SUPPORT_EMAIL } from "@/lib/legal";

export const metadata = { title: "Privacy Policy · Orca" };

export default function PrivacyPage() {
  const mail = <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Orca is a study app: you add your course material, and Orca turns it into topics, objectives and quiz questions, tracks how well you know
        each objective and schedules reviews. This policy says what Orca stores, why, who else sees it, and how to remove it.
      </p>

      <h2>What Orca stores</h2>
      <ul>
        <li>Your account: your email address, password (stored hashed by our authentication provider), avatar and settings.</li>
        <li>Your courses: names, schedules, exams, the files and text you add, and the topics, objectives and questions made from them.</li>
        <li>Your study record: every answer you give, flags you set, study sessions and study time, and feedback you send us.</li>
        <li>Connections you choose to make (Canvas, Notion, Google, the Claude connector): the tokens they need, encrypted, and what you import through them.</li>
        <li>Basic activity: the days you used Orca and when you were last active, and usage and security logs that keep the service running and safe.</li>
      </ul>
      <p>Orca does not sell your data, show ads, or use your data for advertising.</p>

      <h2>How Orca uses it</h2>
      <p>
        Only to run Orca for you: to read your material, write and grade questions, track your progress and schedule your reviews. To do that,
        your material and answers are sent to an AI model provider (OpenAI or Anthropic), which processes them on Orca&apos;s behalf under its API
        terms and does not use them to train its models.
      </p>

      <h2>Google Calendar and Google Drive</h2>
      <p>Connecting Google is optional, and you choose each feature separately from Settings → Connections.</p>
      <ul>
        <li>
          <strong>Google Calendar</strong> (scopes <code>calendar.events.readonly</code> and <code>calendar.calendarlist.readonly</code>): Orca reads
          the list of your calendars and the events on them, read only, to
          show them beside your exams, due dates and review days in Orca&apos;s calendar. Orca never creates, changes or deletes
          anything in your Google Calendar. Event details are fetched when needed and are not kept after they are shown.
        </li>
        <li>
          <strong>Google Drive</strong> (scope <code>drive.file</code>): Orca can open only the files you pick in Google&apos;s file picker. It
          downloads each file you pick and adds it to your course as material, the same as a file you upload. It cannot see the rest of your
          Drive.
        </li>
        <li>Orca also reads your Google account&apos;s email address, to show which account is connected.</li>
      </ul>
      <p>
        Orca keeps a Google refresh token, encrypted, so it can read your calendar without asking you to sign in each time. Disconnecting Google
        in Settings revokes that token and deletes it from Orca. You can also remove Orca&apos;s access at any time from your Google
        account&apos;s permissions page (myaccount.google.com/permissions).
      </p>
      <p>
        Orca&apos;s use and transfer of information received from Google APIs to any other app will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited
        Use requirements. Specifically, Orca uses Google user data only to show your calendar and import the files you pick; does not transfer it
        to others except as needed to provide those features (for example, a Drive file you pick is processed by our AI model provider like any
        other material), to comply with the law, or as part of a merger or sale with notice to you; does not use it for advertising; and does not
        let people read it, except with your consent, for security, to comply with the law, or when it has been aggregated and anonymised for
        internal operations. Google user data is never used to train AI models.
      </p>

      <h2>Who else processes your data</h2>
      <p>
        Orca runs on Supabase (database, sign-in and file storage), Vercel (hosting) and Trigger.dev (background jobs), and uses OpenAI or
        Anthropic for AI processing. They handle data only to provide their service to Orca. We share data with others only when the law requires
        it.
      </p>

      <h2>Security</h2>
      <p>
        Data is sent over HTTPS. Each student&apos;s data is walled off from every other student&apos;s in the database, and the tokens for your
        connections are stored encrypted.
      </p>

      <h2>Deleting your data</h2>
      <ul>
        <li>You can remove any material from a course, and delete a course from its settings page.</li>
        <li>You can disconnect Google, Canvas, Notion or the Claude connector from Settings at any time.</li>
        <li>
          To delete your account and everything in it permanently, email {mail} from the address you signed up with. We delete it within 30
          days.
        </li>
      </ul>

      <h2>Children</h2>
      <p>Orca is for college students and is not meant for anyone under 13.</p>

      <h2>Changes</h2>
      <p>If this policy changes, we update the date above, and tell you in the app if the change is significant.</p>

      <h2>Contact</h2>
      <p>Questions or requests about your data: {mail}.</p>
    </LegalPage>
  );
}
